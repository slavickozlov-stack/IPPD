import type { DocModel, DocParagraph, Field, IsoDate, ReplacementLink, SourceLocation, UmmLifecycleStatus, UmmRecord } from './model'
import { unknownField } from './model'
import { excelSerialToIso, findDateTokens, parseDate } from './dates'
import { formatLocation } from './labels'
import { squash } from './docx'
import { findPrimaryCode, findUmmDesignations, normalizeDesignation, normalizeRevision, parseRevision } from './designation'
import type { RegistryField, RegistryTemplate, UmmField, UmmTemplate } from './templates'
import type { Sheet } from './tabular'

const ext = (value: string, loc: SourceLocation, method: 'extracted' | 'registry' | 'derived' = 'extracted') => ({
  method,
  location: loc
})

function textField(raw: string | null, loc: SourceLocation, method: 'extracted' | 'registry' | 'derived' = 'extracted'): Field<string> {
  const v = raw?.trim()
  return v ? { value: v, raw: v, source: ext(v, loc, method) } : unknownField()
}

function dateField(raw: string | null, loc: SourceLocation, issues: string[], label: string, method: 'extracted' | 'registry' = 'extracted', numeric = false): Field<IsoDate> {
  const v = raw?.trim().replace(/[.,;]+$/, '').replace(/\s*г(ода|\.)?$/, '').trim()
  if (!v || /^_+$/.test(v)) return unknownField()
  let iso = numeric && /^\d+(\.\d+)?$/.test(v) ? excelSerialToIso(Number(v)) : parseDate(v)?.iso ?? null
  // «с 01.02.2025», «от «15» января 2025 г.» — берётся первая дата в тексте реквизита
  if (!iso && !numeric) {
    const t = findDateTokens(v)[0]?.token ?? v.match(/«?\s*\d{1,2}\s*»?\s+[а-яё]+\s+\d{4}/i)?.[0]
    if (t) iso = parseDate(t.replace(/\s+/g, ' '))?.iso ?? null
  }
  if (!iso) {
    issues.push(`${label}: значение «${v}» не распознано как дата`)
    return { value: null, raw: v, source: ext(v, loc, method) }
  }
  return { value: iso, raw: v, source: ext(v, loc, method) }
}

export function statusFromText(raw: string, words: UmmTemplate['statusWords']): UmmLifecycleStatus {
  const s = raw.toLowerCase().replace(/ё/g, 'е')
  const has = (list: string[]) => list.some((w) => s.includes(w.toLowerCase().replace(/ё/g, 'е')))
  // Порядок важен: «недействующий» содержит «действующий».
  if (has(words.cancelled)) return 'cancelled'
  if (has(words.replaced)) return 'replaced'
  if (has(words.draft)) return 'draft'
  if (has(words.active)) return 'active'
  return 'other'
}

/** Шифры документов в любом месте текста: П.00.10, ИОТ.27.26, ПСОТ.27.ЦТАИ.599, а также обозначения УММ. */
export function findDocCodes(text: string): string[] {
  const umm = findUmmDesignations(text).map((d) => normalizeDesignation(d.raw).key)
  const codes = [...text.matchAll(/(?<![А-ЯЁA-Zа-яё.])([А-ЯЁ]{1,6}(?:\.[А-ЯЁ]{1,6})?\.\d{2}(?:\.[0-9А-ЯЁ]{1,6}){0,3})(?![0-9А-ЯЁа-яё])/g)].map((m) => m[1])
  return [...umm, ...codes.filter((c) => !umm.some((u) => u.includes(c)))]
}

function linkFromText(raw: string, self?: string | null): ReplacementLink | null {
  const codes = findDocCodes(raw).filter((c) => c !== self)
  const d = codes[0] ?? findDocCodes(raw)[0]
  if (!d) return null
  return { designation: normalizeDesignation(d).key, revision: parseRevision(raw.slice(raw.indexOf(d) + d.length)) }
}

const DEFAULT_TYPE_WORDS = [
  'положение', 'инструкция', 'программа', 'учебный материал', 'план аудиторного занятия', 'план практического занятия',
  'учебное пособие', 'лекционный материал', 'пособие', 'методические рекомендации', 'план дистанционного обучения'
]

interface Found {
  value: string
  loc: SourceLocation
  /** Поле есть в документе, но не заполнено (подчёркивания). */
  blank?: boolean
}

const isBlank = (v: string) => !v.replace(/[_\s.«»"№-]/g, '').length || /^_{3,}/.test(v.trim())
const locOf = (doc: DocModel, p: DocParagraph): SourceLocation => ({ file: doc.fileName, section: p.section, paragraph: p.page ? undefined : p.index, page: p.page, excerpt: p.text.slice(0, 160) })

/** Абзацы «шапки» документа: первые страницы PDF или первые абзацы DOCX плюс колонтитулы. */
function headOf(doc: DocModel): DocParagraph[] {
  const body = doc.paragraphs.filter((p) => p.section !== 'Колонтитул')
  const head = body.some((p) => p.page) ? body.filter((p) => (p.page ?? 1) <= 3) : body.slice(0, 120)
  return head
}

/** Реквизиты «Подпись: значение», «Подпись значение» (без двоеточия, в т. ч. «4 ВЗАМЕН …») и двухстолбцовые таблицы. */
function labelledValues(doc: DocModel, tpl: UmmTemplate): { values: Partial<Record<UmmField, Found>>; used: Set<number> } {
  const values: Partial<Record<UmmField, Found>> = {}
  const used = new Set<number>()
  const keys = Object.keys(tpl.labels) as UmmField[]
  // Длинные подписи раньше коротких: «дата введения в действие» не должна стать «наименованием».
  const syns = keys
    .flatMap((k) => tpl.labels[k].map((s) => ({ k, s, sq: squash(s) })))
    .sort((a, b) => b.sq.length - a.sq.length)
  const byLabel = (label: string): UmmField | null => {
    const l = squash(label.replace(/[:：]\s*$/, ''))
    return syns.find((x) => l === x.sq || l.startsWith(x.sq))?.k ?? null
  }
  for (const t of doc.tables) {
    t.rows.forEach((r, ri) => {
      if (r.length < 2) return
      const k = byLabel(r[0])
      if (!k || values[k]) return
      const v = r[1].trim()
      values[k] = { value: v, blank: isBlank(v), loc: { file: doc.fileName, section: t.section ?? 'Реквизиты', table: t.index, row: ri + 1, column: r[0].trim() } }
    })
  }
  const head = headOf(doc)
  // Без двоеточия распознаются только датированные реквизиты и «взамен»: иначе заголовки таблиц
  // («Наименование документа», «Обозначение») ошибочно принимаются за реквизиты.
  const INLINE = new Set<UmmField>(['validFrom', 'validTo', 'reviewDue', 'approvedAt', 'replaces', 'replacedBy'])
  head.forEach((p, i) => {
    if (used.has(p.index)) return
    const text = p.text.replace(/^\s*\d{1,2}\s+(?=[А-ЯЁ]{3,})/, '') // «4 ВЗАМЕН …» в предисловии
    let k: UmmField | null = null
    let value = ''
    const colon = text.match(/^\s*([^:：]{3,60})[:：]\s*(.*)$/)
    if (colon) {
      k = byLabel(colon[1])
      value = colon[2]
    }
    if (!k) {
      const t = squash(text)
      const hit = syns.find((x) => INLINE.has(x.k) && t.startsWith(x.sq))
      if (hit) {
        // Значение — текст после подписи в исходной строке (с учётом пробелов в подписи)
        const words = hit.s.split(/\s+/).length
        const rest = text.trim().split(/\s+/).slice(words).join(' ')
        k = hit.k
        value = rest.replace(/^[–—:\-\s]+/, '')
        const dated = hit.k !== 'replaces' && hit.k !== 'replacedBy'
        if (dated && !isBlank(value) && !findDateTokens(value).length && !/«\s*\d{1,2}\s*»/.test(value)) k = null
      }
    }
    if (!k || values[k]) return
    // «ВЗАМЕН» в предисловии продолжается на следующих строках до следующего пункта
    if (k === 'replaces' || k === 'replacedBy' || k === 'title') {
      for (let j = i + 1; j < head.length && j <= i + 3; j++) {
        const nx = head[j].text
        if (/^\s*\d{1,2}\s+[А-ЯЁ]{3,}/.test(nx) || /^[^:：]{3,60}[:：]/.test(nx) || isBlank(nx)) break
        value += ' ' + nx
        used.add(head[j].index)
        if (/[.»]\s*$/.test(nx)) break
      }
    }
    used.add(p.index)
    values[k] = { value: value.trim(), blank: isBlank(value), loc: locOf(doc, p) }
  })
  return { values, used }
}

export function extractUmmFromDoc(doc: DocModel, fileId: string, tpl: UmmTemplate, recordId: string, form: 'docx' | 'pdf-text' = 'docx', pages?: number): UmmRecord {
  const issues: string[] = []
  const { values: lv, used } = labelledValues(doc, tpl)
  const L = (k: UmmField) => (lv[k] && !lv[k]!.blank ? lv[k] : undefined)
  for (const [k, v] of Object.entries(lv)) if (v?.blank) issues.push(`Реквизит «${tpl.labels[k as UmmField][0]}» есть в документе, но не заполнен (${formatLocation(v.loc)})`)
  const head = headOf(doc)
  const headers = doc.paragraphs.filter((p) => p.section === 'Колонтитул' || /«?(зам|нов)»?\s*\d+\s*$/.test(p.text))
  const fileLoc: SourceLocation = { file: doc.fileName }

  // Обозначение: подпись → обозначение УММ в шапке → отдельная строка-шифр на титульном листе → шифр в колонтитуле
  let designation: Field<string> = unknownField()
  if (L('designation')) designation = { value: normalizeDesignation(L('designation')!.value).key, raw: L('designation')!.value, source: { method: 'extracted', location: L('designation')!.loc } }
  if (!designation.value) {
    for (const p of head) {
      const d = findUmmDesignations(p.text)[0]
      if (d) {
        designation = { value: normalizeDesignation(d.raw).key, raw: d.raw, source: { method: 'extracted', location: locOf(doc, p) } }
        used.add(p.index)
        break
      }
    }
  }
  if (!designation.value) {
    const codeLine = head.find((p) => /^[А-ЯЁ]{1,6}(?:\.[0-9А-ЯЁ]{1,6}){1,4}$/.test(p.text.trim()))
    if (codeLine) {
      designation = { value: normalizeDesignation(codeLine.text.trim()).key, raw: codeLine.text.trim(), source: { method: 'extracted', location: locOf(doc, codeLine), note: 'отдельная строка титульного листа' } }
      used.add(codeLine.index)
    }
  }
  if (!designation.value) {
    const h = headers.map((p) => ({ p, m: p.text.match(/^([А-ЯЁ]{1,6}(?:\.[0-9А-ЯЁ]{1,6}){1,4})\s+«?(?:зам|нов)/) })).find((x) => x.m)
    if (h) designation = { value: normalizeDesignation(h.m![1]).key, raw: h.m![1], source: { method: 'extracted', location: locOf(doc, h.p), note: 'из колонтитула' } }
  }

  // Изменение: подпись → максимальный номер «зам N»/«нов N» в колонтитулах страниц
  let revision: Field<string> = unknownField()
  if (L('revision')) revision = { value: normalizeRevision(L('revision')!.value), raw: L('revision')!.value, source: { method: 'extracted', location: L('revision')!.loc } }
  else {
    const nums = headers
      .map((p) => ({ p, m: p.text.match(/«?(?:зам|нов)»?\s*(\d+)\s*$/) }))
      .filter((x) => x.m)
      .map((x) => ({ p: x.p, n: Number(x.m![1]) }))
    if (nums.length) {
      const top = nums.reduce((a, b) => (b.n > a.n ? b : a))
      revision = { value: String(top.n), raw: top.p.text, source: { method: 'derived', location: locOf(doc, top.p), note: `наибольший номер изменения в колонтитулах страниц (${nums.length} стр.)` } }
    }
  }

  // Наименование: подпись → строки между словом вида документа и обозначением на титульном листе
  let title: Field<string> = L('title') ? textField(L('title')!.value.replace(/^«|»$/g, ''), L('title')!.loc) : unknownField()
  if (!title.value) {
    const typeWords = tpl.titleTypeWords ?? DEFAULT_TYPE_WORDS
    const ti = head.findIndex((p) => typeWords.some((w) => squash(p.text) === squash(w) || squash(p.text).startsWith(squash(w))))
    if (ti >= 0) {
      const parts: string[] = []
      const first = head[ti].text.replace(new RegExp(`^(${typeWords.join('|')})`, 'i'), '').trim()
      if (first) parts.push(first)
      for (let j = ti + 1; j < head.length && j <= ti + 4; j++) {
        const t = head[j].text.trim()
        if (findDocCodes(t)[0] === t || /^[А-ЯЁ]{1,6}(?:\.[0-9А-ЯЁ]{1,6}){1,4}$/.test(t) || /^(Распорядительный|Дата|Регистрационный)/i.test(t)) break
        parts.push(t)
      }
      const v = parts.join(' ').replace(/^«|»$/g, '').trim()
      if (v) title = { value: v, raw: v, source: { method: 'extracted', location: locOf(doc, head[ti]), note: 'титульный лист' } }
    }
  }

  // Статус: подпись → штамп АСУТД (на каждой странице, дата печати = дата, на которую подтверждён статус)
  let status: Field<UmmLifecycleStatus> = unknownField()
  let statusAsOf: Field<IsoDate> = unknownField()
  if (L('status')) status = { value: statusFromText(L('status')!.value, tpl.statusWords), raw: L('status')!.value, source: { method: 'extracted', location: L('status')!.loc } }
  const stampRe = new RegExp(tpl.asutdStamp, 'u')
  const stamps = doc.paragraphs.map((p) => ({ p, m: p.text.match(stampRe) })).filter((x) => x.m)
  if (stamps.length) {
    const { p, m } = stamps[0]
    const loc = locOf(doc, p)
    const distinct = new Set(stamps.map((x) => x.m![1].trim().toLowerCase()))
    if (distinct.size > 1) issues.push(`Штампы АСУТД на разных страницах расходятся: ${[...distinct].join(', ')}`)
    const st: Field<UmmLifecycleStatus> = { value: statusFromText(m![1], tpl.statusWords), raw: m![1], source: { method: 'extracted', location: loc, note: `штамп АСУТД № ${m![2]} от ${m![3]}` } }
    if (status.value && st.value !== status.value) issues.push(`Статус в реквизитах («${status.raw}») расходится со штампом АСУТД («${m![1]}»)`)
    if (!status.value) status = st
    if (m![4]) statusAsOf = { value: parseDate(m![4])?.iso ?? null, raw: m![4], source: { method: 'extracted', location: loc, note: 'дата печати из штампа АСУТД' } }
  }

  // Дата утверждения: подпись → дата под «УТВЕРЖДАЮ»
  let approvedAtRaw = L('approvedAt') ? { value: L('approvedAt')!.value, loc: L('approvedAt')!.loc } : null
  if (!approvedAtRaw) {
    const all = [...head, ...doc.tables.flatMap((t) => t.rows.flat().flatMap((c) => c.split('\n')).map((text, i): DocParagraph => ({ kind: 'p', index: -1 - i, text, section: t.section })))]
    const ui = all.findIndex((p) => /^\s*УТВЕРЖДАЮ\s*$/i.test(p.text))
    if (ui >= 0)
      for (let j = ui + 1; j < all.length && j <= ui + 8; j++) {
        const m = all[j].text.match(/«\s*(\d{1,2})\s*»\s*([а-яё]+)\s+(\d{4})|(\d{2}\.\d{2}\.\d{4})/i)
        if (m) {
          approvedAtRaw = { value: m[4] ?? `${m[1]} ${m[2]} ${m[3]}`, loc: { file: doc.fileName, section: 'УТВЕРЖДАЮ', page: all[j].page, excerpt: all[j].text } }
          break
        }
      }
  }

  const linkField = (x: Found | undefined): Field<ReplacementLink> => {
    if (!x) return unknownField()
    const link = linkFromText(x.value, designation.value)
    if (!link) issues.push(`Не удалось выделить обозначение в «${x.value.slice(0, 120)}»`)
    return { value: link, raw: x.value, source: { method: 'extracted', location: x.loc } }
  }
  const replaces = linkField(L('replaces'))
  if (replaces.value && replaces.value.designation === designation.value)
    issues.push(`«Взамен» указывает на документ с тем же обозначением ${designation.value} — это предыдущее изменение того же документа, а не другой УММ`)

  const rec: UmmRecord = {
    id: recordId,
    origin: 'umm-file',
    fileId,
    fileName: doc.fileName,
    designation,
    title,
    revision,
    status,
    statusAsOf,
    validFrom: dateField(L('validFrom')?.value ?? null, L('validFrom')?.loc ?? fileLoc, issues, 'Дата введения в действие'),
    validTo: dateField(L('validTo')?.value ?? null, L('validTo')?.loc ?? fileLoc, issues, 'Дата окончания действия'),
    reviewDue: dateField(L('reviewDue')?.value ?? null, L('reviewDue')?.loc ?? fileLoc, issues, 'Срок пересмотра'),
    approvedAt: dateField(approvedAtRaw?.value ?? null, approvedAtRaw?.loc ?? fileLoc, issues, 'Дата утверждения'),
    replacedBy: linkField(L('replacedBy')),
    replaces: replaces.value?.designation === designation.value ? unknownField() : replaces,
    issues
  }
  const FIELDS = ['designation', 'title', 'revision', 'status', 'statusAsOf', 'validFrom', 'validTo', 'reviewDue', 'approvedAt', 'replacedBy', 'replaces'] as const
  const unmatched = head
    .filter((p) => !used.has(p.index) && (/^[^:：]{3,50}[:：]\s*\S/.test(p.text) || (findDateTokens(p.text).length > 0 && /дата|срок|действ|утвержд|пересмотр|замен|введ/i.test(p.text))))
    .slice(0, 20)
    .map((p) => ({ text: p.text.slice(0, 200), location: locOf(doc, p) }))
  rec.recognition = { form, pages, found: FIELDS.filter((f) => (rec[f] as Field<unknown>).value != null), unmatched }
  return rec
}

/** Скан с текстовым штампом АСУТД: статус и дата статуса — из штампа, обозначение — из имени файла. */
export function extractStampOnly(doc: DocModel, fileId: string, tpl: UmmTemplate, recordId: string, pages: number): UmmRecord {
  const rec = extractUmmFromDoc(doc, fileId, tpl, recordId, 'pdf-text', pages)
  const byName = recordFromFileName(doc.fileName, fileId, recordId, 'скан: из текста распознан только штамп АСУТД — остальные реквизиты введите вручную')
  rec.designation = rec.designation.value ? rec.designation : byName.designation
  rec.revision = rec.revision.value ? rec.revision : byName.revision
  rec.issues = [...byName.issues, ...rec.issues]
  rec.recognition = { ...rec.recognition!, form: 'pdf-stamp', found: (['designation', 'revision', 'status', 'statusAsOf'] as const).filter((f) => rec[f].value != null) }
  return rec
}

/** Файл, содержимое которого не разбирается (PDF, скан): обозначение и изменение предполагаются по имени файла. */
export function recordFromFileName(fileName: string, fileId: string, recordId: string, reason: string): UmmRecord {
  const base = fileName.replace(/\.[^.]+$/, '')
  const d = findUmmDesignations(base)[0]?.raw ?? findPrimaryCode(base)
  const loc: SourceLocation = { file: fileName, section: 'Имя файла' }
  const revRaw = base.match(/(?:изм|ред|зам)[._\s]*№?\s*\d+/i)?.[0] ?? null
  return {
    id: recordId,
    origin: 'umm-file',
    fileId,
    fileName,
    designation: d
      ? { value: normalizeDesignation(d).key, raw: d, source: { method: 'derived', location: loc, note: 'предположение по имени файла — подтвердите' } }
      : unknownField(),
    title: unknownField(),
    revision: revRaw ? { value: normalizeRevision(revRaw), raw: revRaw, source: { method: 'derived', location: loc, note: 'по имени файла' } } : unknownField(),
    status: unknownField(),
    statusAsOf: unknownField(),
    validFrom: unknownField(),
    validTo: unknownField(),
    reviewDue: unknownField(),
    approvedAt: unknownField(),
    replacedBy: unknownField(),
    replaces: unknownField(),
    issues: reason ? [reason] : [],
    recognition: { form: 'filename', found: d ? ['designation', ...(revRaw ? ['revision'] : [])] : [], unmatched: [] }
  }
}

export function extractRegistry(sheet: Sheet, fileName: string, fileId: string, tpl: RegistryTemplate): { records: UmmRecord[]; issues: string[] } {
  const issues: string[] = []
  const headerIdx = sheet.rows.findIndex((r) => r.some((c) => tpl.columns.designation.some((s) => squash(c).includes(squash(s)))))
  if (headerIdx < 0) return { records: [], issues: ['Не найдена строка заголовков с графой «Обозначение»: структура реестра не распознана'] }
  const header = sheet.rows[headerIdx]
  const col: Partial<Record<RegistryField, number>> = {}
  const used = new Set<number>()
  // Более длинные синонимы проверяются раньше: «изменение замены» не должно попасть в «изменение».
  const fields = (Object.keys(tpl.columns) as RegistryField[]).sort(
    (a, b) => Math.max(...tpl.columns[b].map((s) => s.length)) - Math.max(...tpl.columns[a].map((s) => s.length))
  )
  for (const f of fields) {
    const idx = header.findIndex((h, i) => !used.has(i) && tpl.columns[f].some((s) => squash(h).includes(squash(s))))
    if (idx >= 0) {
      col[f] = idx
      used.add(idx)
    }
  }
  const records: UmmRecord[] = []
  for (let r = headerIdx + 1; r < sheet.rows.length; r++) {
    const row = sheet.rows[r]
    if (!row || !row.some((c) => c && c.trim())) continue
    const recIssues: string[] = []
    const loc = (f: RegistryField): SourceLocation => ({
      file: fileName,
      sheet: sheet.name,
      row: r + 1,
      column: col[f] !== undefined ? header[col[f]!] : undefined
    })
    const get = (f: RegistryField) => (col[f] !== undefined ? (row[col[f]!] ?? '').trim() : '')
    const isNum = (f: RegistryField) => (col[f] !== undefined ? !!sheet.numeric[r]?.[col[f]!] : false)
    const dRaw = get('designation')
    if (!dRaw) {
      issues.push(`Строка ${r + 1}: пустое обозначение — строка пропущена`)
      continue
    }
    const statusRaw = get('status')
    const repRaw = get('replacedBy')
    const repRev = get('replacedByRevision')
    const revRaw = get('revision')
    const df = (f: RegistryField, label: string) => dateField(get(f) || null, loc(f), recIssues, label, 'registry', isNum(f))
    records.push({
      id: `reg-${r + 1}`,
      origin: 'registry',
      fileId,
      fileName,
      designation: { value: normalizeDesignation(dRaw).key, raw: dRaw, source: { method: 'registry', location: loc('designation') } },
      title: textField(get('title') || null, loc('title'), 'registry'),
      revision: revRaw ? { value: normalizeRevision(revRaw), raw: revRaw, source: { method: 'registry', location: loc('revision') } } : unknownField(),
      status: statusRaw
        ? { value: statusFromText(statusRaw, DEFAULT_STATUS_WORDS), raw: statusRaw, source: { method: 'registry', location: loc('status') } }
        : unknownField(),
      statusAsOf: df('statusAsOf', 'Статус на дату'),
      validFrom: df('validFrom', 'Дата введения'),
      validTo: df('validTo', 'Дата окончания'),
      reviewDue: df('reviewDue', 'Срок пересмотра'),
      approvedAt: df('approvedAt', 'Дата утверждения'),
      replacedBy: repRaw
        ? {
            value: { designation: normalizeDesignation(repRaw).key, revision: normalizeRevision(repRev || null) },
            raw: repRev ? `${repRaw} (изм. ${repRev})` : repRaw,
            source: { method: 'registry', location: loc('replacedBy') }
          }
        : unknownField(),
      replaces: unknownField(),
      issues: recIssues
    })
  }
  return { records, issues }
}

export const DEFAULT_STATUS_WORDS: UmmTemplate['statusWords'] = {
  active: ['действующий', 'действует', 'действующая', 'введен в действие'],
  replaced: ['заменен', 'заменён'],
  cancelled: ['отменен', 'отменён', 'аннулирован', 'недействующий'],
  draft: ['проект', 'на согласовании']
}
