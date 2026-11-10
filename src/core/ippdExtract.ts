import type {
  BibliographyEntry, DocModel, DocTable, Field, IppdExtraction, IppdParseReport, ParseIssue,
  PlanRow, ReferenceKind, SourceLocation, UmmReference
} from './model'
import { unknownField } from './model'
import { squash } from './docx'
import { findPrimaryCode, findUmmDesignations, normalizeDesignation, parseRevision } from './designation'
import type { ColumnKey, IppdTableKind, IppdTemplate } from './templates'

const TABLE_KINDS: IppdTableKind[] = ['schedule', 'theory', 'practice', 'internship']
const COLUMN_ORDER: ColumnKey[] = ['materials', 'number', 'title', 'form', 'place', 'hours', 'responsible', 'mark', 'dates']
export const TABLE_LABEL: Record<IppdTableKind, string> = {
  schedule: '2 План-график подготовки',
  theory: '3.1 Тематический план теоретической подготовки',
  practice: '3.2 Тематический план практической подготовки',
  internship: 'Тематический план стажировки'
}
const NUMBER_RE = /^\d+(\.\d+)*\.?$/

export function detectTemplate(doc: DocModel, templates: IppdTemplate[]): IppdTemplate | null {
  const text = [
    ...doc.paragraphs.slice(0, 400).map((p) => p.text),
    ...doc.tables.slice(0, 30).map((t) => (t.rows[0] ?? []).join(' '))
  ].join('\n')
  let best: { t: IppdTemplate; score: number } | null = null
  for (const t of templates) {
    const score = t.detect.patterns.filter((p) => new RegExp(p, 'iu').test(text)).length
    if (score >= t.detect.minMatches && (!best || score > best.score)) best = { t, score }
  }
  return best?.t ?? null
}

function headerRowsCount(t: DocTable): number {
  for (let i = 0; i < Math.min(t.rows.length, 4); i++) {
    const first = (t.rows[i][0] ?? '').trim()
    if (NUMBER_RE.test(first) && !isColumnNumberRow(t.rows[i])) return i
  }
  return 1
}

function isColumnNumberRow(cells: string[]): boolean {
  return cells.length > 2 && cells.every((c, i) => c.trim() === String(i + 1))
}

function tableHeaderText(t: DocTable): string {
  return squash(t.rows.slice(0, Math.max(1, headerRowsCount(t))).flat().join(' '))
}

export function classifyTables(doc: DocModel, tpl: IppdTemplate): Record<IppdTableKind, number[]> {
  const found: Record<IppdTableKind, number[]> = { schedule: [], theory: [], practice: [], internship: [] }
  const ambiguous: DocTable[] = []
  for (const t of doc.tables) {
    const header = tableHeaderText(t)
    const fits = TABLE_KINDS.filter((k) =>
      tpl.tables[k].headerAll.every((h) => h.split('|').some((alt) => header.includes(squash(alt))))
    )
    if (!fits.length) continue
    const bySection = fits.filter((k) => {
      const re = tpl.tables[k].sectionRegex
      return re && t.section && new RegExp(re, 'iu').test(t.section)
    })
    if (bySection.length === 1) found[bySection[0]].push(t.index)
    else if (fits.length === 1) found[fits[0]].push(t.index)
    else ambiguous.push(t)
  }
  // Теоретический и практический планы имеют одинаковые графы: без заголовка раздела — по порядку.
  for (const t of ambiguous) {
    if (!found.theory.length) found.theory.push(t.index)
    else if (!found.practice.length) found.practice.push(t.index)
  }
  return found
}

function mapColumns(header: string[], tpl: IppdTemplate): Partial<Record<ColumnKey, number>> {
  const map: Partial<Record<ColumnKey, number>> = {}
  const used = new Set<number>()
  for (const key of COLUMN_ORDER) {
    const syn = tpl.columns[key].map(squash)
    const idx = header.findIndex((h, i) => !used.has(i) && syn.some((s) => squash(h).includes(s)))
    if (idx >= 0) {
      map[key] = idx
      used.add(idx)
    }
  }
  return map
}

interface ParsedTable {
  rows: PlanRow[]
  columns: Partial<Record<ColumnKey, number>>
  header: string[]
  unreadable: number[]
}

function parsePlanTable(t: DocTable, tpl: IppdTemplate): ParsedTable {
  const hCount = Math.max(1, headerRowsCount(t))
  // Двухстрочный заголовок: берём последнюю строку заголовка с максимумом ячеек.
  const headerCandidates = t.rows.slice(0, hCount)
  const header = headerCandidates.reduce((a, b) => (b.length > a.length ? b : a), headerCandidates[0] ?? [])
  const columns = mapColumns(header, tpl)
  const rows: PlanRow[] = []
  const unreadable: number[] = []
  t.rows.forEach((cells, i) => {
    if (i < hCount || isColumnNumberRow(cells)) return
    if (!cells.some((c) => c.trim())) return
    const rawNum = (cells[columns.number ?? 0] ?? '').trim()
    const number = rawNum.replace(/\.$/, '')
    // Электронные курсы указываются «без времени» (П.00.10 п. 13.1): графа часов в строке может отсутствовать.
    const electronicNoHours =
      cells.length === header.length - 1 && columns.hours !== undefined && /Рекорд|(^|\s)ЭК(\s|$)/.test(cells.join(' '))
    const structured = cells.length === header.length || electronicNoHours
    const named: Partial<Record<string, string>> = {}
    if (structured)
      for (const [k, idx] of Object.entries(columns)) {
        const i = idx as number
        if (electronicNoHours && k === 'hours') named[k] = ''
        else named[k] = (cells[electronicNoHours && i > columns.hours! ? i - 1 : i] ?? '').trim()
      }
    else {
      named.number = number
      named.title = (cells[1] ?? '').trim()
      named.hours = (cells[2] ?? '').trim()
    }
    rows.push({ table: t.index, row: i + 1, number, leaf: false, structured, cells: named, section: t.section })
  })
  for (const r of rows) {
    if (!NUMBER_RE.test(r.number)) continue
    r.leaf = !rows.some((o) => o !== r && o.number.startsWith(r.number + '.'))
  }
  for (const r of rows) if (r.leaf && !r.structured) unreadable.push(r.row)
  return { rows, columns, header, unreadable }
}

function splitMaterials(cell: string): string[] {
  return cell
    .split(/\n|;/)
    .map((s) => s.trim())
    .filter(Boolean)
}

let refSeq = 0

/** Перенос строки внутри ячейки рядом с точкой — это перенос текста, а не пробел в обозначении. */
export function unwrapCellLines(raw: string): string {
  return raw.replace(/\s*\n\s*/g, (m, offset: number, all: string) => {
    const before = all[offset - 1]
    const after = all[offset + m.length]
    return before === '.' || after === '.' ? '' : ' '
  })
}

export function parseMaterialsCell(
  cell: string,
  ctx: { planKind: 'theory' | 'practice'; topicNumber: string; topicTitle: string; form: string; location: SourceLocation; electronic?: boolean }
): UmmReference[] {
  const base = { planKind: ctx.planKind, topicNumber: ctx.topicNumber, topicTitle: ctx.topicTitle, form: ctx.form, cellRaw: cell }
  const mk = (kind: ReferenceKind, extra: Partial<UmmReference>): UmmReference => ({
    id: `ref-${++refSeq}`,
    ...base,
    kind,
    designationRaw: null,
    designationNorm: null,
    revision: null,
    bibIndex: null,
    location: { ...ctx.location, excerpt: cell.slice(0, 200) },
    issues: [],
    ...extra
  })
  if (!cell.trim()) return [mk('empty', {})]
  const out: UmmReference[] = []
  // Обозначение может быть перенесено на следующую строку ячейки, поэтому ищем по всей ячейке.
  const found = findUmmDesignations(cell)
  let rest = cell
  found.forEach((f, i) => {
    const tailEnd = i + 1 < found.length ? found[i + 1].index : cell.length
    const tail = cell.slice(f.index + f.raw.length, tailEnd)
    const bib = tail.match(/^\s*\[(\d+)\]/)
    const norm = normalizeDesignation(unwrapCellLines(f.raw))
    const spanEnd = f.index + f.raw.length + (bib ? bib[0].length : 0)
    rest = rest.slice(0, f.index) + '\n'.repeat(spanEnd - f.index) + rest.slice(spanEnd)
    out.push(
      mk('umm', {
        designationRaw: unwrapCellLines(f.raw),
        designationNorm: norm.key,
        revision: parseRevision(tail.split(/\n|;/)[0] ?? ''),
        bibIndex: bib ? Number(bib[1]) : null,
        issues: norm.issues
      })
    )
  })
  if (ctx.electronic && !found.length) return [mk('electronic', { designationRaw: cell.replace(/\s+/g, ' ') })]
  // Без обозначений УММ ячейка описывает первоисточник: берём её целиком, строки — это перенос текста.
  if (!found.length && !/^\s*\[\d+\]\s*$/.test(cell)) {
    const flat = cell.replace(/\s*\n\s*/g, ' ').trim()
    if (/(^|\s)(ЭК|Рекорд)(\s|$)|электронн/i.test(flat)) return [mk('electronic', { designationRaw: flat })]
    const code = findPrimaryCode(flat)
    return [mk('primary-source', { designationRaw: flat, designationNorm: code ? normalizeDesignation(code).key : null, revision: parseRevision(flat) })]
  }
  for (const piece of splitMaterials(rest)) {
    if (!/[0-9A-Za-zА-Яа-яЁё]/.test(piece)) continue
    const onlyBib = piece.match(/^\[(\d+)\]$/)
    if (onlyBib) {
      const prev = [...out].reverse().find((r) => r.kind === 'umm' && r.bibIndex == null && r.designationNorm)
      if (prev) prev.bibIndex = Number(onlyBib[1])
      else out.push(mk('umm', { bibIndex: Number(onlyBib[1]), issues: ['bib-only'] }))
      continue
    }
    if (/(^|\s)(ЭК|Рекорд)(\s|$)|электронн/i.test(piece)) {
      out.push(mk('electronic', { designationRaw: piece }))
      continue
    }
    const code = findPrimaryCode(piece)
    // «Номер УММ + наименование» (П.00.10, прил. В, примечание 18): текст без шифра — наименование, а не отдельная ссылка.
    if (found.length && !code) continue
    out.push(
      mk(code ? 'primary-source' : 'unrecognized', {
        designationRaw: code ?? piece,
        designationNorm: code ? normalizeDesignation(code).key : null,
        revision: parseRevision(piece)
      })
    )
  }
  return out
}

function parseBibliography(doc: DocModel, tpl: IppdTemplate): { entries: BibliographyEntry[]; found: boolean } {
  const head = new RegExp(tpl.bibliography.headingRegex, 'iu')
  const entryRe = new RegExp(tpl.bibliography.entryRegex, 'u')
  const start = doc.paragraphs.findIndex((p) => head.test(p.text) && p.section !== 'Колонтитул')
  // В содержании «Библиография» тоже встречается — берём последний заголовок, после которого есть записи.
  const starts = doc.paragraphs
    .map((p, i) => (head.test(p.text) && p.section !== 'Колонтитул' ? i : -1))
    .filter((i) => i >= 0)
  const entries: BibliographyEntry[] = []
  for (const s of starts.length ? starts : start >= 0 ? [start] : []) {
    const local: BibliographyEntry[] = []
    for (let i = s + 1; i < doc.paragraphs.length; i++) {
      const p = doc.paragraphs[i]
      if (p.section === 'Колонтитул') break
      const m = p.text.match(entryRe)
      if (!m) {
        if (local.length && /^\s*Примечание/i.test(p.text)) break
        if (local.length && /^(Лист регистрации|Приложение|Анкета)/i.test(p.text.trim())) break
        continue
      }
      const rest = m[2].trim()
      const d = findUmmDesignations(rest)[0]
      const designationRaw = d?.raw ?? findPrimaryCode(rest)
      const title = rest.match(/«([^»]+(?:«[^»]*»[^»]*)*)»/)?.[1] ?? null
      local.push({
        index: Number(m[1]),
        raw: p.text.trim(),
        designationRaw: designationRaw ?? null,
        designationNorm: designationRaw ? normalizeDesignation(designationRaw).key : null,
        title,
        location: { file: doc.fileName, section: 'Библиография', paragraph: p.index, excerpt: p.text.slice(0, 200) }
      })
    }
    if (local.length) {
      entries.push(...local)
      break
    }
  }
  return { entries, found: starts.length > 0 }
}

function field(value: string | null, loc?: SourceLocation): Field<string> {
  if (!value) return unknownField<string>()
  return { value, raw: value, source: { method: 'extracted', location: loc } }
}

export function extractIppd(doc: DocModel, fileId: string, templates: IppdTemplate[]): IppdExtraction {
  refSeq = 0
  const issues: ParseIssue[] = []
  const incompleteReasons: string[] = []
  const tpl = detectTemplate(doc, templates)
  const empty: IppdExtraction = {
    fileId,
    fileName: doc.fileName,
    registrationNumber: unknownField(),
    traineeName: unknownField(),
    position: unknownField(),
    references: [],
    bibliography: [],
    rows: {},
    columnTitles: {},
    parse: {
      templateId: null,
      templateName: null,
      templateSupported: false,
      tablesFound: { schedule: [], theory: [], practice: [], internship: [] },
      bibliographyFound: false,
      issues,
      complete: false,
      incompleteReasons
    }
  }
  if (!tpl) {
    incompleteReasons.push('Шаблон ИППД не распознан: документ не похож на поддерживаемые формы. Требуется ручной разбор.')
    issues.push({ severity: 'error', message: 'Неподдерживаемый шаблон', location: { file: doc.fileName } })
    return empty
  }

  // Реквизиты титульного листа
  const regRe = new RegExp(tpl.registrationNumber.regex, 'u')
  const head = doc.paragraphs.filter((p) => p.section !== 'Колонтитул').slice(0, 80)
  const regP = head.find((p) => regRe.test(p.text))
  const regValue = regP?.text.match(regRe)?.[0].replace(/\s+/g, '') ?? null
  const loc = (p?: { index: number; text: string }): SourceLocation | undefined =>
    p ? { file: doc.fileName, section: 'Титульный лист', paragraph: p.index, excerpt: p.text.slice(0, 160) } : undefined
  // ФИО: строка вида «Фамилия Имя Отчество»; иначе — по месту в форме прил. В: строка между
  // «Индивидуальная программа подготовки» и «на должность …»
  const titleIdx = head.findIndex((p) => /^индивидуальн[а-яё]*\s+программ[а-яё]*\s+подготовки\s*$/i.test(p.text.trim()))
  const nameP =
    head.find((p) => /^[А-ЯЁ][а-яё-]+\s+[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+(вич|вна|ича|вны|ична|ичны|оглы|кызы)\s*$/.test(p.text.trim())) ??
    (titleIdx >= 0 && head[titleIdx + 2] && /^на\s+должность/i.test(head[titleIdx + 2].text.trim()) ? head[titleIdx + 1] : undefined)
  const posIdx = head.findIndex((p) => /^на\s+должность/i.test(p.text.trim()))
  let position: string | null = null
  if (posIdx >= 0) {
    const parts: string[] = []
    for (let i = posIdx; i < head.length && i < posIdx + 5; i++) {
      if (i > posIdx && /^(филиала|ИППД|[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+$)/.test(head[i].text.trim())) break
      parts.push(head[i].text.trim())
    }
    position = parts.join(' ').replace(/^на\s+должность\s*/i, '').replace(/\s+/g, ' ')
  }

  const tablesFound = classifyTables(doc, tpl)
  const rowsByKind: Record<string, PlanRow[]> = {}
  const columnTitles: Record<string, Record<string, string>> = {}
  const references: UmmReference[] = []
  for (const kind of TABLE_KINDS) {
    const idxs = tablesFound[kind]
    if (!idxs.length) {
      if (tpl.tables[kind].required) {
        incompleteReasons.push(`Не найдена таблица «${TABLE_LABEL[kind]}» — разбор неполный.`)
        issues.push({ severity: 'error', message: `Таблица «${TABLE_LABEL[kind]}» не найдена`, location: { file: doc.fileName } })
      }
      continue
    }
    rowsByKind[kind] = []
    for (const ti of idxs) {
      const t = doc.tables.find((x) => x.index === ti)!
      const parsed = parsePlanTable(t, tpl)
      columnTitles[kind] = Object.fromEntries(
        Object.entries(parsed.columns).map(([k, i]) => [k, (parsed.header[i as number] ?? '').replace(/\s+/g, ' ').trim()])
      )
      rowsByKind[kind].push(...parsed.rows)
      if (parsed.unreadable.length) {
        incompleteReasons.push(
          `Таблица ${ti} («${TABLE_LABEL[kind]}»): строки ${parsed.unreadable.join(', ')} не разобраны — число ячеек не совпадает с заголовком.`
        )
        for (const r of parsed.unreadable)
          issues.push({
            severity: 'error',
            message: 'Строка темы не разобрана: объединённые или пропущенные ячейки',
            location: { file: doc.fileName, section: TABLE_LABEL[kind], table: ti, row: r }
          })
      }
      if ((kind === 'theory' || kind === 'practice') && parsed.columns.materials === undefined) {
        incompleteReasons.push(`Таблица ${ti} («${TABLE_LABEL[kind]}»): не найдена графа «Учебные материалы».`)
        continue
      }
      if (kind === 'theory' || kind === 'practice') {
        for (const r of parsed.rows) {
          if (!r.leaf || !r.structured) continue
          references.push(
            ...parseMaterialsCell(r.cells.materials ?? '', {
              planKind: kind,
              topicNumber: r.number,
              topicTitle: r.cells.title ?? '',
              form: r.cells.form ?? '',
              electronic: /Рекорд|(^|\s)ЭК(\s|$)/.test(Object.values(r.cells).join(' ')),
              location: {
                file: doc.fileName,
                section: TABLE_LABEL[kind],
                table: ti,
                row: r.row,
                column: columnTitles[kind].materials || 'Учебные материалы'
              }
            })
          )
        }
      }
    }
    if ((kind === 'theory' || kind === 'practice') && !rowsByKind[kind].some((r) => r.leaf)) {
      incompleteReasons.push(`В таблице «${TABLE_LABEL[kind]}» не найдено ни одной строки темы.`)
    }
  }

  const bib = parseBibliography(doc, tpl)
  // Ссылка только номером библиографии — обозначение берём из записи библиографии.
  for (const r of references) {
    if (r.kind === 'umm' && !r.designationNorm && r.bibIndex != null) {
      const e = bib.entries.find((b) => b.index === r.bibIndex)
      if (e?.designationRaw) {
        r.designationRaw = e.designationRaw
        r.designationNorm = e.designationNorm
      } else r.kind = 'unrecognized'
    }
  }

  const material = references.filter((r) => r.kind === 'umm' || r.kind === 'primary-source')
  if (!material.length && !incompleteReasons.length)
    incompleteReasons.push('Ссылки на учебные материалы не извлечены: результат пуст и требует подтверждения специалистом.')

  const parse: IppdParseReport = {
    templateId: tpl.id,
    templateName: tpl.name,
    templateSupported: true,
    tablesFound,
    bibliographyFound: bib.found,
    issues,
    complete: incompleteReasons.length === 0,
    incompleteReasons
  }
  return {
    fileId,
    fileName: doc.fileName,
    registrationNumber: field(regValue, loc(regP)),
    traineeName: field(nameP?.text.trim() ?? null, loc(nameP)),
    position: field(position, loc(posIdx >= 0 ? head[posIdx] : undefined)),
    references,
    bibliography: bib.entries,
    rows: rowsByKind,
    columnTitles,
    parse
  }
}
