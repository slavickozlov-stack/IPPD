// Движок нормоконтроля: исполняет правила профиля поддерживаемых типов над извлечённой ИППД.
import type { DocModel, IppdExtraction, PlanRow, RuleFinding, RuleOutcome, RuleResult, SourceLocation } from '../model'
import type { CheckSpec, Profile, Rule, TableKind } from '../profile'
import { ACTUALITY_LABELS, COVERAGE_LABELS, isApplied, sourceText } from '../profile'
import type { CoverageCategory } from '../profile'
import { findDateTokens, parseDate } from '../dates'
import { DESIGNATION_ISSUE_TEXT, normalizeDesignation, ummTypeOf } from '../designation'
import type { DesignationIssue } from '../designation'
import { TABLE_LABEL } from '../ippdExtract'

const COLUMN_FALLBACK: Record<string, string> = {
  number: 'Номер', title: 'Наименование', form: 'Форма обучения', place: 'Место', hours: 'Продолжительность',
  materials: 'Учебные материалы', responsible: 'Ответственный', mark: 'Отметка', dates: 'Календарные сроки'
}

interface Ctx {
  ippd: IppdExtraction
  doc: DocModel | null
  rule: Rule
  src: string
}

type CheckOut = { findings: RuleFinding[]; outcome?: RuleOutcome; note?: string }

const fail = (ctx: Ctx, location: SourceLocation | undefined, actual: string, expected: string, action: string): RuleFinding => ({
  ruleId: ctx.rule.id,
  outcome: 'fail',
  location,
  actual,
  expected,
  source: ctx.src,
  action
})

const tableLoc = (ctx: Ctx, kind: TableKind, r?: PlanRow, column?: string): SourceLocation => ({
  file: ctx.ippd.fileName,
  section: TABLE_LABEL[kind],
  table: r?.table ?? ctx.ippd.parse.tablesFound[kind][0],
  row: r?.row,
  column: column ? ctx.ippd.columnTitles[kind]?.[column] || COLUMN_FALLBACK[column] : undefined
})

function missingTable(ctx: Ctx, kind: TableKind): CheckOut | null {
  if (ctx.ippd.parse.tablesFound[kind].length) return null
  const required = kind !== 'practice'
  return required
    ? { findings: [], outcome: 'manual', note: `Таблица «${TABLE_LABEL[kind]}» не найдена при разборе — проверить вручную.` }
    : { findings: [], outcome: 'na', note: `Таблица «${TABLE_LABEL[kind]}» отсутствует — правило не применимо.` }
}

const isElectronic = (r: PlanRow) => /Рекорд|(^|\s)ЭК(\s|$)/.test(Object.values(r.cells).join(' '))

const checkers: { [K in CheckSpec['type']]: (ctx: Ctx, c: Extract<CheckSpec, { type: K }>) => CheckOut } = {
  paragraph_present(ctx, c) {
    const re = new RegExp(c.pattern, 'iu')
    const texts = [
      ...(ctx.doc?.paragraphs.filter((p) => p.section !== 'Колонтитул').map((p) => p.text) ?? []),
      ...(ctx.doc?.tables.map((t) => (t.rows[0] ?? []).join(' ')) ?? [])
    ]
    if (texts.some((t) => re.test(t))) return { findings: [] }
    return {
      findings: [fail(ctx, { file: ctx.ippd.fileName, section: 'Документ целиком' }, 'не найден', c.description, `Добавить: ${c.description}.`)]
    }
  },
  field_format(ctx, c) {
    const f = ctx.ippd[c.field]
    const loc = f.source?.location ?? { file: ctx.ippd.fileName, section: 'Титульный лист' }
    if (!f.value) return { findings: [fail(ctx, loc, 'реквизит не найден', c.description, `Указать реквизит: ${c.description}.`)] }
    if (c.pattern && !new RegExp(c.pattern, 'u').test(f.value))
      return { findings: [fail(ctx, loc, f.value, c.description, 'Исправить реквизит по форме.')] }
    if (c.forbid && new RegExp(c.forbid, 'u').test(f.value))
      return { findings: [fail(ctx, loc, f.value, c.description, 'Заменить заполнитель фактическим значением.')] }
    return { findings: [] }
  },
  table_present(ctx, c) {
    if (ctx.ippd.parse.tablesFound[c.table].length) return { findings: [] }
    return {
      findings: [fail(ctx, { file: ctx.ippd.fileName, section: TABLE_LABEL[c.table] }, 'таблица не найдена', `таблица «${TABLE_LABEL[c.table]}»`, 'Добавить таблицу по форме приложения В П.00.10 или проверить её оформление.')]
    }
  },
  table_structure(ctx, c) {
    const miss = missingTable(ctx, c.table)
    if (miss) return miss
    const have = ctx.ippd.columnTitles[c.table] ?? {}
    const absent = c.columns.filter((k) => !have[k])
    if (!absent.length) return { findings: [] }
    return {
      findings: [
        fail(ctx, tableLoc(ctx, c.table, undefined), `графы не найдены: ${absent.map((k) => `«${COLUMN_FALLBACK[k]}»`).join(', ')}`, `графы: ${c.columns.map((k) => `«${COLUMN_FALLBACK[k]}»`).join(', ')}`, 'Привести заголовок таблицы к форме.')
      ]
    }
  },
  cells_filled(ctx, c) {
    const miss = missingTable(ctx, c.table)
    if (miss) return miss
    const findings: RuleFinding[] = []
    for (const r of ctx.ippd.rows[c.table] ?? []) {
      if (!r.structured || (c.rows === 'leaf' && !r.leaf)) continue
      for (const col of c.columns) {
        if (col === 'hours' && isElectronic(r)) continue
        if (!(r.cells[col] ?? '').trim())
          findings.push(
            fail(ctx, tableLoc(ctx, c.table, r, col), `пустая ячейка (тема ${r.number || '—'} «${(r.cells.title ?? '').slice(0, 80)}»)`, `графа «${ctx.ippd.columnTitles[c.table]?.[col] || COLUMN_FALLBACK[col]}» заполнена`, 'Заполнить ячейку.')
          )
      }
    }
    return { findings }
  },
  dates_format(ctx, c) {
    const miss = missingTable(ctx, c.table)
    if (miss) return miss
    const findings: RuleFinding[] = []
    for (const r of ctx.ippd.rows[c.table] ?? []) {
      const text = r.cells[c.column] ?? ''
      for (const { token } of findDateTokens(text)) {
        const d = parseDate(token)
        if (!d) findings.push(fail(ctx, tableLoc(ctx, c.table, r, c.column), `«${token}» — несуществующая дата`, 'дата в формате ДД.ММ.ГГГГ', 'Исправить дату.'))
        else if (!d.canonical) findings.push(fail(ctx, tableLoc(ctx, c.table, r, c.column), `«${token}»`, 'дата в формате ДД.ММ.ГГГГ', `Записать как ${d.iso.split('-').reverse().join('.')}.`))
      }
    }
    return { findings }
  },
  numbering(ctx, c) {
    const miss = missingTable(ctx, c.table)
    if (miss) return miss
    const findings: RuleFinding[] = []
    const seen = new Map<string, PlanRow>()
    const lastChild = new Map<string, number>()
    for (const r of ctx.ippd.rows[c.table] ?? []) {
      if (!r.number) continue
      if (!/^\d+(\.\d+)*$/.test(r.number)) {
        findings.push(fail(ctx, tableLoc(ctx, c.table, r, 'number'), `«${r.number}»`, 'номер вида 1, 1.1, 1.1.1', 'Исправить номер.'))
        continue
      }
      if (seen.has(r.number)) {
        findings.push(fail(ctx, tableLoc(ctx, c.table, r, 'number'), `номер ${r.number} повторяется (первый раз — строка ${seen.get(r.number)!.row})`, 'уникальные номера', 'Перенумеровать.'))
        continue
      }
      seen.set(r.number, r)
      const parts = r.number.split('.').map(Number)
      const parent = parts.slice(0, -1).join('.')
      const last = parts[parts.length - 1]
      if (parent && !seen.has(parent))
        findings.push(fail(ctx, tableLoc(ctx, c.table, r, 'number'), `${r.number}: нет вышестоящего пункта ${parent}`, 'иерархическая нумерация без пропусков', 'Проверить нумерацию.'))
      const prev = lastChild.get(parent) ?? 0
      if (last !== prev + 1)
        findings.push(
          fail(ctx, tableLoc(ctx, c.table, r, 'number'), `${r.number} после ${prev ? (parent ? `${parent}.${prev}` : String(prev)) : 'начала уровня'}`, `ожидался номер ${parent ? `${parent}.` : ''}${prev + 1}`, 'Исправить нумерацию.')
        )
      lastChild.set(parent, last)
    }
    return { findings }
  },
  designation_format(ctx, c) {
    const re = new RegExp(c.pattern, 'u')
    const findings: RuleFinding[] = []
    const describe = (raw: string) => {
      const issues = normalizeDesignation(raw).issues as DesignationIssue[]
      return issues.length ? `${raw} — ${issues.map((i) => DESIGNATION_ISSUE_TEXT[i]).join('; ')}` : raw
    }
    if (c.scope !== 'bibliography')
      for (const r of ctx.ippd.references)
        if (r.kind === 'umm' && r.designationRaw && !r.issues.includes('bib-only') && !re.test(r.designationRaw))
          findings.push(fail(ctx, { ...r.location, excerpt: undefined }, describe(r.designationRaw), c.description, `Исправить обозначение в теме ${r.topicNumber}.`))
    if (c.scope !== 'references')
      for (const b of ctx.ippd.bibliography)
        if (b.designationRaw && /[КK]\s*\d/.test(b.designationRaw) && !re.test(b.designationRaw))
          findings.push(fail(ctx, b.location, describe(b.designationRaw), c.description, `Исправить обозначение в записи [${b.index}] библиографии.`))
    return { findings }
  },
  form_material_match(ctx, c) {
    const findings: RuleFinding[] = []
    let applicable = 0
    for (const r of ctx.ippd.references) {
      if (r.kind !== 'umm' || !r.designationNorm) continue
      const type = ummTypeOf(r.designationNorm)
      const forms = r.form.split(/[,;\s]+/).filter((f) => f in c.mapping)
      if (!type || !forms.length) continue
      applicable++
      if (forms.some((f) => c.mapping[f].includes(type))) continue
      findings.push(
        fail(
          ctx,
          { ...r.location, excerpt: undefined },
          `тема ${r.topicNumber}: форма «${r.form}», вид УММ «${type}» (${r.designationRaw})`,
          forms.map((f) => `для формы «${f}» — ${c.mapping[f].length ? c.mapping[f].join(', ') : 'первоисточник, не УММ'}`).join('; '),
          'Подобрать УММ соответствующего вида или исправить форму обучения.'
        )
      )
    }
    return applicable ? { findings } : { findings, outcome: 'na', note: 'Нет ссылок на УММ с распознанной формой обучения.' }
  },
  bibliography_crossref(ctx, c) {
    const findings: RuleFinding[] = []
    const bib = ctx.ippd.bibliography
    const umm = ctx.ippd.references.filter((r) => r.kind === 'umm')
    if (!umm.length) return { findings, outcome: 'na', note: 'Ссылок на УММ нет.' }
    for (const r of umm) {
      const loc = { ...r.location, excerpt: undefined }
      if (r.bibIndex == null) {
        const rest = r.cellRaw.replace(r.designationRaw ?? '', '').replace(/[^А-Яа-яЁёA-Za-z]/g, '')
        if (rest.length < 10)
          findings.push(fail(ctx, loc, `тема ${r.topicNumber}: «${r.cellRaw.replace(/\s+/g, ' ')}»`, 'регистрационный номер УММ и номер записи библиографии в квадратных скобках либо номер и наименование УММ', 'Добавить [n] со ссылкой на библиографию или наименование УММ.'))
        continue
      }
      const e = bib.find((b) => b.index === r.bibIndex)
      if (!e) {
        findings.push(fail(ctx, loc, `тема ${r.topicNumber}: [${r.bibIndex}] — такой записи нет в библиографии`, 'запись библиографии с этим номером', 'Добавить запись в библиографию или исправить номер.'))
        continue
      }
      if (r.issues.includes('bib-only')) {
        findings.push(fail(ctx, loc, `тема ${r.topicNumber}: обозначение в графе не распознано («${r.cellRaw.replace(/\s+/g, ' ')}»), в [${r.bibIndex}] — ${e.designationRaw ?? '—'}`, 'регистрационный номер УММ в графе', 'Записать обозначение УММ по установленной форме.'))
        continue
      }
      if (e.designationNorm && r.designationNorm && e.designationNorm !== r.designationNorm)
        findings.push(fail(ctx, loc, `тема ${r.topicNumber}: в графе ${r.designationRaw}, в библиографии [${r.bibIndex}] — ${e.designationRaw}`, 'одинаковое обозначение в графе и библиографии', 'Согласовать обозначение или номер записи.'))
    }
    if (c.requireSequential) {
      bib.forEach((b, i) => {
        if (b.index !== i + 1) findings.push(fail(ctx, b.location, `запись [${b.index}] на позиции ${i + 1}`, 'сквозная нумерация записей 1, 2, 3 …', 'Перенумеровать библиографию.'))
      })
    }
    if (c.reportUnused) {
      const used = new Set(umm.map((r) => r.bibIndex))
      for (const b of bib) if (!used.has(b.index)) findings.push(fail(ctx, b.location, `[${b.index}] ${b.designationRaw ?? ''} — нет ссылок из тематического плана`, 'в библиографии только УММ, на которые есть ссылки', 'Удалить запись или добавить ссылку.'))
    }
    return { findings }
  },
  manual(ctx, c) {
    return {
      findings: [{ ruleId: ctx.rule.id, outcome: 'manual', location: { file: ctx.ippd.fileName, section: ctx.rule.section }, expected: ctx.rule.requirement, source: ctx.src, action: c.instruction }],
      outcome: 'manual'
    }
  }
}

export function runRules(ippd: IppdExtraction | null, doc: DocModel | null, profile: Profile): RuleResult[] {
  return profile.rules.map((rule) => {
    const src = sourceText(rule.source)
    const base = { ruleId: rule.id, title: rule.title, severity: rule.severity, approval: rule.approval }
    const manual = (note: string, action: string): RuleResult => ({
      ...base,
      outcome: 'manual',
      note,
      findings: [{ ruleId: rule.id, outcome: 'manual', location: ippd ? { file: ippd.fileName, section: rule.section } : undefined, expected: rule.requirement, source: src, action }]
    })
    if (!isApplied(rule.approval, profile.mode))
      return manual(
        rule.approval === 'draft' ? 'Правило не подтверждено (черновик) и в рабочем профиле не применяется автоматически.' : 'Демонстрационное правило не применяется в рабочем профиле.',
        `Проверить вручную: ${rule.requirement}`
      )
    if (!ippd || !ippd.parse.templateSupported)
      return manual('ИППД не разобрана по поддерживаемому шаблону.', `Проверить вручную: ${rule.requirement}`)
    if (rule.template !== '*' && rule.template !== ippd.parse.templateId)
      return { ...base, outcome: 'na', note: `Правило относится к шаблону ${rule.template}.`, findings: [] }
    const ctx: Ctx = { ippd, doc, rule, src }
    const out = (checkers[rule.check.type] as (c: Ctx, s: CheckSpec) => CheckOut)(ctx, rule.check)
    const outcome: RuleOutcome = out.outcome ?? (out.findings.some((f) => f.outcome === 'fail') ? 'fail' : 'pass')
    return { ...base, outcome, findings: out.findings, note: out.note }
  })
}

export function coverage(profile: Profile): { category: string; label: string; configured: boolean; note: string }[] {
  const rows: { category: string; label: string; configured: boolean; note: string }[] = []
  for (const [cat, label] of Object.entries(COVERAGE_LABELS) as [CoverageCategory, string][]) {
    const rules = profile.rules.filter((r) => r.category === cat)
    const applied = rules.filter((r) => isApplied(r.approval, profile.mode))
    const drafts = rules.filter((r) => r.approval === 'draft').length
    rows.push({
      category: cat,
      label,
      configured: applied.length > 0,
      note: applied.length
        ? `правил применяется: ${applied.length}${drafts ? `; черновиков: ${drafts}` : ''}`
        : rules.length
          ? `есть ${rules.length} неподтверждённых правил — будут показаны как ручная проверка`
          : 'правила не настроены'
    })
  }
  for (const [key, label] of Object.entries(ACTUALITY_LABELS) as [keyof typeof ACTUALITY_LABELS, string][]) {
    const s = profile.actuality[key]
    const applied = !!s && isApplied(s.approval, profile.mode)
    rows.push({
      category: `actuality.${key}`,
      label: `УММ: ${label}`,
      configured: applied,
      note: applied ? `${s!.approval === 'demo' ? 'ДЕМО: ' : ''}${sourceText(s!.source)}` : s ? 'значение не подтверждено — спорные случаи уйдут на уточнение' : 'не настроено — спорные случаи уйдут на уточнение'
    })
  }
  return rows
}
