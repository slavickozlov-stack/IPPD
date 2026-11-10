// Общая модель данных. Модуль не зависит от Electron и может работать в main, renderer и тестах.

/** Место в исходном документе, откуда взято значение или к которому относится замечание. */
export interface SourceLocation {
  file: string
  section?: string
  /** Порядковый номер абзаца в теле документа (1..n), считая только непустые абзацы. */
  paragraph?: number
  /** Порядковый номер таблицы в документе (1..n). */
  table?: number
  /** Номер строки таблицы (1..n), включая строки заголовка. */
  row?: number
  /** Название столбца таблицы. */
  column?: string
  /** Страница, если формат её сообщает (PDF). Для DOCX страница недостоверна и не указывается. */
  page?: number
  sheet?: string
  /** Короткая выдержка исходного текста. */
  excerpt?: string
}

export type ProvenanceMethod = 'extracted' | 'registry' | 'manual' | 'derived'

/** Происхождение значения поля. */
export interface Provenance {
  method: ProvenanceMethod
  location?: SourceLocation
  /** Для ручного ввода: кто и когда изменил, с каким обоснованием. */
  editedBy?: string
  editedAt?: string
  note?: string
}

/** Поле с исходным значением и местом извлечения. value === null означает «неизвестно». */
export interface Field<T> {
  value: T | null
  raw: string | null
  source: Provenance | null
  /** Предыдущее значение, если поле изменено вручную. */
  previous?: { value: T | null; raw: string | null; source: Provenance | null }
}

export const unknownField = <T>(): Field<T> => ({ value: null, raw: null, source: null })

export type FileRole = 'ippd' | 'umm' | 'registry'

export interface LoadedFileInfo {
  id: string
  name: string
  role: FileRole
  size: number
  sha256: string
  format: 'docx' | 'xlsx' | 'csv' | 'pdf' | 'unknown'
  /** Ошибка чтения или распознавания: файл показывается, но в проверку не идёт. */
  error?: string
  /** Файл прочитан, но его форма требует ручного разбора (скан, неизвестный шаблон). */
  manualReason?: string
}

/** ISO-дата без времени: YYYY-MM-DD. */
export type IsoDate = string

export type UmmLifecycleStatus = 'active' | 'replaced' | 'cancelled' | 'draft' | 'other'

export interface ReplacementLink {
  designation: string
  revision?: string | null
}

/** Карточка УММ, извлечённая из файла УММ или из реестра. */
export interface UmmRecord {
  id: string
  origin: 'umm-file' | 'registry'
  fileId: string
  fileName: string
  designation: Field<string>
  title: Field<string>
  revision: Field<string>
  status: Field<UmmLifecycleStatus>
  /** Дата, на которую источник подтверждает статус (например, дата печати из АСУТД, дата выгрузки реестра). */
  statusAsOf: Field<IsoDate>
  validFrom: Field<IsoDate>
  validTo: Field<IsoDate>
  reviewDue: Field<IsoDate>
  approvedAt: Field<IsoDate>
  replacedBy: Field<ReplacementLink>
  /** Явная обратная связь «взамен» — документ, который заменяет этот УММ. */
  replaces: Field<ReplacementLink>
  issues: string[]
  /** Как прочитан источник: для диагностики распознавания реальных УММ. */
  recognition?: UmmRecognition
}

export interface UmmRecognition {
  /** docx — текст Word; pdf-text — PDF с текстовым слоем; pdf-stamp — скан, распознан только штамп АСУТД; pdf-scan — текста нет; filename — только имя файла. */
  form: 'docx' | 'pdf-text' | 'pdf-stamp' | 'pdf-scan' | 'filename' | 'registry'
  pages?: number
  /** Поля, найденные в источнике. */
  found: string[]
  /** Строки первых страниц, похожие на реквизиты, но не сопоставленные ни с одним полем шаблона. */
  unmatched: { text: string; location: SourceLocation }[]
}

export type ReferenceKind = 'umm' | 'primary-source' | 'electronic' | 'empty' | 'unrecognized'

/** Ссылка на материал в тематическом плане ИППД. */
export interface UmmReference {
  id: string
  planKind: 'theory' | 'practice'
  topicNumber: string
  topicTitle: string
  form: string
  /** Исходный текст ячейки «Учебные материалы». */
  cellRaw: string
  kind: ReferenceKind
  designationRaw: string | null
  designationNorm: string | null
  /** Редакция или изменение, если указаны прямо в ссылке. */
  revision: string | null
  bibIndex: number | null
  location: SourceLocation
  issues: string[]
}

export interface BibliographyEntry {
  index: number
  raw: string
  designationRaw: string | null
  designationNorm: string | null
  title: string | null
  location: SourceLocation
}

/** Нормализованное представление DOCX: абзацы и таблицы в порядке следования. */
export interface DocParagraph {
  kind: 'p'
  index: number
  text: string
  style?: string
  /** Страница (только для PDF). */
  page?: number
  /** Ближайший предшествующий заголовок раздела. */
  section?: string
}

export interface DocTable {
  kind: 't'
  index: number
  rows: string[][]
  section?: string
  /** Абзац, после которого стоит таблица. */
  afterParagraph?: number
}

export type DocBlock = DocParagraph | DocTable

export interface DocModel {
  fileName: string
  blocks: DocBlock[]
  paragraphs: DocParagraph[]
  tables: DocTable[]
}

export interface ParseIssue {
  severity: 'error' | 'warning' | 'info'
  message: string
  location?: SourceLocation
}

/** Сведения о полноте разбора ИППД. */
export interface IppdParseReport {
  templateId: string | null
  templateName: string | null
  templateSupported: boolean
  tablesFound: { theory: number[]; practice: number[]; internship: number[]; schedule: number[] }
  bibliographyFound: boolean
  issues: ParseIssue[]
  complete: boolean
  incompleteReasons: string[]
}

/** Строка тематического плана или план-графика после разбора. */
export interface PlanRow {
  table: number
  row: number
  number: string
  /** Строка темы (нет вложенных строк). */
  leaf: boolean
  /** Число ячеек совпадает с заголовком, графы определены. */
  structured: boolean
  cells: Partial<Record<string, string>>
  section?: string
}

export interface IppdExtraction {
  fileId: string
  fileName: string
  registrationNumber: Field<string>
  traineeName: Field<string>
  position: Field<string>
  references: UmmReference[]
  bibliography: BibliographyEntry[]
  /** Строки таблиц по видам: schedule, theory, practice, internship. */
  rows: Record<string, PlanRow[]>
  /** Карта столбцов таблиц: вид таблицы → ключ графы → название графы в документе. */
  columnTitles: Record<string, Record<string, string>>
  parse: IppdParseReport
}

export interface ExtractionBundle {
  files: LoadedFileInfo[]
  ippd: IppdExtraction | null
  ippdDoc: DocModel | null
  umm: UmmRecord[]
  /** Сообщения о файлах, которые не удалось прочитать. */
  fileIssues: { fileId: string; fileName: string; message: string }[]
}

// ——— Результаты проверки актуальности ———

export type ActualityStatus =
  | 'in_force'
  | 'expired'
  | 'replaced'
  | 'cancelled'
  | 'not_yet_effective'
  | 'review_overdue'
  | 'not_found'
  | 'needs_clarification'

export type CheckOutcome = 'ok' | 'problem' | 'unknown' | 'na'

export interface ActualityCheck {
  name: 'match' | 'status' | 'validFrom' | 'validTo' | 'reviewDue' | 'replacement' | 'sources'
  label: string
  outcome: CheckOutcome
  basis: string
}

export interface ActualityResult {
  referenceId: string
  reference: UmmReference
  status: ActualityStatus
  matchedRecordIds: string[]
  candidates: { recordId: string; designation: string; revision: string | null; reason: string }[]
  checks: ActualityCheck[]
  /** Короткое основание итогового статуса. */
  basis: string
  /** Что сделать специалисту. */
  action: string
  replacement?: {
    designation: string
    revision: string | null
    statusOnDate: ActualityStatus | null
    basis: string
  }
}

// ——— Результаты нормоконтроля ———

export type RuleOutcome = 'pass' | 'fail' | 'na' | 'manual'

export interface RuleFinding {
  ruleId: string
  outcome: RuleOutcome
  location?: SourceLocation
  actual?: string
  expected: string
  source: string
  action: string
}

export interface RuleResult {
  ruleId: string
  title: string
  severity: string
  approval: 'confirmed' | 'draft' | 'demo'
  outcome: RuleOutcome
  findings: RuleFinding[]
  note?: string
}

export type Verdict = 'no_remarks' | 'remarks' | 'incomplete'

export interface CheckReport {
  generatedAt: string
  checkDate: IsoDate
  profile: { id: string; name: string; version: string; mode: 'demo' | 'work'; sha256: string }
  files: LoadedFileInfo[]
  ippd: { fileName: string; registrationNumber: string | null; parse: IppdParseReport } | null
  counts: { referencesFound: number; ummReferences: number; matched: number; needsClarification: number; notFound: number }
  actuality: ActualityResult[]
  normcontrol: RuleResult[]
  coverage: { category: string; label: string; configured: boolean; note: string }[]
  manualEdits: { target: string; field: string; from: string | null; to: string | null; note: string; at: string }[]
  verdict: Verdict
  verdictReasons: string[]
}
