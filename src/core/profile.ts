// Профиль правил: версионируемый JSON. Схема проверяется при загрузке; новые правила поддерживаемых типов
// добавляются в JSON без изменения кода.
import Ajv from 'ajv'

export type Approval = 'confirmed' | 'draft' | 'demo'
export type Severity = 'critical' | 'major' | 'minor' | 'info'

export interface RuleSource {
  document: string
  clause: string
  page?: string
  note?: string
}

export interface Setting<T> {
  value: T
  approval: Approval
  source: RuleSource
}

export interface ActualitySettings {
  /** Последний день действия включается в срок действия. */
  validToInclusive?: Setting<boolean> | null
  /** День начала действия — первый день действия. */
  validFromInclusive?: Setting<boolean> | null
  /** День срока пересмотра ещё не считается просрочкой. */
  reviewDueInclusive?: Setting<boolean> | null
  /** Вычислять срок пересмотра от даты утверждения, если он не указан. */
  reviewPeriodFromApproval?: Setting<{ years: number }> | null
  /** Если редакция в ссылке не указана и загружено несколько редакций. */
  revisionSelection?: Setting<'single-in-force'> | null
  /** Какой источник главнее при расхождении. */
  sourcePriority?: Setting<'registry' | 'umm-file'> | null
  /** Принимать статус «действующий» на дату позже даты, на которую статус подтверждён источником. */
  statusAsOfPolicy?: Setting<'accept-if-no-end-date'> | null
  /**
   * Новая редакция УММ выпускается под новым номером. Если загружен УММ той же темы
   * (тот же уровень, курс, тема, вид, подразделение) с более поздним годом, ссылку на старый
   * нужно пересмотреть сразу: 'replaced' — считать старый заменённым, 'clarify' — отправить на уточнение.
   */
  newerEditionPolicy?: Setting<'replaced' | 'clarify'> | null
}

export type CheckSpec =
  | { type: 'paragraph_present'; pattern: string; description: string }
  | { type: 'field_format'; field: 'registrationNumber' | 'traineeName' | 'position'; pattern?: string; forbid?: string; description: string }
  | { type: 'table_present'; table: TableKind }
  | { type: 'table_structure'; table: TableKind; columns: ColumnName[] }
  | { type: 'cells_filled'; table: TableKind; columns: ColumnName[]; rows: 'leaf' | 'all' }
  | { type: 'dates_format'; table: TableKind; column: ColumnName; format: 'DD.MM.YYYY' }
  | { type: 'numbering'; table: TableKind }
  | { type: 'designation_format'; pattern: string; scope: 'references' | 'bibliography' | 'both'; description: string }
  | { type: 'form_material_match'; mapping: Record<string, string[]> }
  | { type: 'bibliography_crossref'; requireSequential: boolean; reportUnused: boolean }
  | { type: 'manual'; instruction: string }

export type TableKind = 'schedule' | 'theory' | 'practice' | 'internship'
export type ColumnName = 'number' | 'title' | 'form' | 'place' | 'hours' | 'materials' | 'responsible' | 'mark' | 'dates'

export interface Rule {
  id: string
  title: string
  template: string
  section: string
  requirement: string
  source: RuleSource
  severity: Severity
  approval: Approval
  category: CoverageCategory
  check: CheckSpec
}

export interface Profile {
  schemaVersion: 1
  id: string
  name: string
  version: string
  mode: 'demo' | 'work'
  description: string
  templates: string[]
  checkPrimarySources: boolean
  actuality: ActualitySettings
  rules: Rule[]
}

export type CoverageCategory =
  | 'sections' | 'requisites' | 'tables' | 'cells' | 'dates' | 'designations' | 'numbering'
  | 'form-material' | 'bibliography' | 'manual-layout'

export const COVERAGE_LABELS: Record<CoverageCategory, string> = {
  sections: 'Обязательные разделы ИППД',
  requisites: 'Реквизиты титульного листа',
  tables: 'Наличие и структура таблиц',
  cells: 'Заполнение обязательных ячеек',
  dates: 'Формат дат',
  designations: 'Формат обозначений УММ',
  numbering: 'Нумерация курсов, разделов, тем',
  'form-material': 'Соответствие формы обучения виду УММ',
  bibliography: 'Ссылки на библиографию',
  'manual-layout': 'Оформление страницы и подписи (ручная проверка)'
}

export const ACTUALITY_LABELS: Record<keyof ActualitySettings, string> = {
  validToInclusive: 'Граничный день даты окончания действия',
  validFromInclusive: 'Граничный день даты введения в действие',
  reviewDueInclusive: 'Граничный день срока пересмотра',
  reviewPeriodFromApproval: 'Срок пересмотра от даты утверждения',
  revisionSelection: 'Автовыбор редакции, если она не указана',
  sourcePriority: 'Приоритет реестра или документа при расхождении',
  statusAsOfPolicy: 'Статус, подтверждённый на более раннюю дату',
  newerEditionPolicy: 'Новый УММ той же темы (новый номер) — пересмотр ссылки'
}

const sourceSchema = {
  type: 'object',
  required: ['document', 'clause'],
  additionalProperties: false,
  properties: { document: { type: 'string', minLength: 1 }, clause: { type: 'string', minLength: 1 }, page: { type: 'string' }, note: { type: 'string' } }
}
const approval = { enum: ['confirmed', 'draft', 'demo'] }
const setting = (value: object) => ({
  anyOf: [
    { type: 'null' },
    { type: 'object', required: ['value', 'approval', 'source'], additionalProperties: false, properties: { value, approval, source: sourceSchema } }
  ]
})
const tableKind = { enum: ['schedule', 'theory', 'practice', 'internship'] }
const columnName = { enum: ['number', 'title', 'form', 'place', 'hours', 'materials', 'responsible', 'mark', 'dates'] }
const regex = { type: 'string', minLength: 1, format: 'regex' }

const checkSchemas = [
  { required: ['type', 'pattern', 'description'], properties: { type: { const: 'paragraph_present' }, pattern: regex, description: { type: 'string' } } },
  {
    required: ['type', 'field', 'description'],
    properties: {
      type: { const: 'field_format' },
      field: { enum: ['registrationNumber', 'traineeName', 'position'] },
      pattern: regex,
      forbid: regex,
      description: { type: 'string' }
    }
  },
  { required: ['type', 'table'], properties: { type: { const: 'table_present' }, table: tableKind } },
  { required: ['type', 'table', 'columns'], properties: { type: { const: 'table_structure' }, table: tableKind, columns: { type: 'array', items: columnName, minItems: 1 } } },
  {
    required: ['type', 'table', 'columns', 'rows'],
    properties: { type: { const: 'cells_filled' }, table: tableKind, columns: { type: 'array', items: columnName, minItems: 1 }, rows: { enum: ['leaf', 'all'] } }
  },
  { required: ['type', 'table', 'column', 'format'], properties: { type: { const: 'dates_format' }, table: tableKind, column: columnName, format: { const: 'DD.MM.YYYY' } } },
  { required: ['type', 'table'], properties: { type: { const: 'numbering' }, table: tableKind } },
  {
    required: ['type', 'pattern', 'scope', 'description'],
    properties: { type: { const: 'designation_format' }, pattern: regex, scope: { enum: ['references', 'bibliography', 'both'] }, description: { type: 'string' } }
  },
  {
    required: ['type', 'mapping'],
    properties: {
      type: { const: 'form_material_match' },
      mapping: { type: 'object', minProperties: 1, additionalProperties: { type: 'array', items: { type: 'string' } } }
    }
  },
  {
    required: ['type', 'requireSequential', 'reportUnused'],
    properties: { type: { const: 'bibliography_crossref' }, requireSequential: { type: 'boolean' }, reportUnused: { type: 'boolean' } }
  },
  { required: ['type', 'instruction'], properties: { type: { const: 'manual' }, instruction: { type: 'string', minLength: 1 } } }
].map((s) => ({ type: 'object', additionalProperties: false, ...s }))

export const profileSchema = {
  $id: 'ippd-control/profile.schema.json',
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'id', 'name', 'version', 'mode', 'description', 'templates', 'checkPrimarySources', 'actuality', 'rules'],
  properties: {
    $schema: { type: 'string' },
    schemaVersion: { const: 1 },
    id: { type: 'string', pattern: '^[a-z0-9][a-z0-9._-]*$' },
    name: { type: 'string', minLength: 1 },
    version: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+$' },
    mode: { enum: ['demo', 'work'] },
    description: { type: 'string' },
    templates: { type: 'array', items: { type: 'string' } },
    checkPrimarySources: { type: 'boolean' },
    actuality: {
      type: 'object',
      additionalProperties: false,
      properties: {
        validToInclusive: setting({ type: 'boolean' }),
        validFromInclusive: setting({ type: 'boolean' }),
        reviewDueInclusive: setting({ type: 'boolean' }),
        reviewPeriodFromApproval: setting({ type: 'object', required: ['years'], additionalProperties: false, properties: { years: { type: 'integer', minimum: 1, maximum: 50 } } }),
        revisionSelection: setting({ enum: ['single-in-force'] }),
        sourcePriority: setting({ enum: ['registry', 'umm-file'] }),
        statusAsOfPolicy: setting({ enum: ['accept-if-no-end-date'] }),
        newerEditionPolicy: setting({ enum: ['replaced', 'clarify'] })
      }
    },
    rules: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'title', 'template', 'section', 'requirement', 'source', 'severity', 'approval', 'category', 'check'],
        properties: {
          id: { type: 'string', pattern: '^[A-ZА-Я0-9][A-ZА-Я0-9._-]*$' },
          title: { type: 'string', minLength: 1 },
          template: { type: 'string' },
          section: { type: 'string' },
          requirement: { type: 'string', minLength: 1 },
          source: sourceSchema,
          severity: { enum: ['critical', 'major', 'minor', 'info'] },
          approval,
          category: { enum: Object.keys(COVERAGE_LABELS) },
          check: { oneOf: checkSchemas }
        }
      }
    }
  }
}

const ajv = new Ajv({ allErrors: true, strict: false })
ajv.addFormat('regex', (s: string) => {
  try {
    new RegExp(s, 'u')
    return true
  } catch {
    return false
  }
})
const validate = ajv.compile(profileSchema)

export class ProfileError extends Error {}

export function parseProfile(json: unknown, origin: string): Profile {
  if (!validate(json)) {
    const msg = (validate.errors ?? []).slice(0, 5).map((e) => `${e.instancePath || '/'} ${e.message}`).join('; ')
    throw new ProfileError(`Профиль «${origin}» не соответствует схеме: ${msg}`)
  }
  const p = json as unknown as Profile
  const ids = new Set<string>()
  for (const r of p.rules) {
    if (ids.has(r.id)) throw new ProfileError(`Профиль «${origin}»: повторяется идентификатор правила ${r.id}`)
    ids.add(r.id)
  }
  if (p.mode === 'work' && p.rules.some((r) => r.approval === 'demo'))
    throw new ProfileError(`Профиль «${origin}»: рабочий профиль не может содержать демонстрационные правила`)
  return p
}

/** Правило или настройка применяются: в рабочем режиме только подтверждённые, в демо — также помеченные demo. */
export function isApplied(approval: Approval, mode: Profile['mode']): boolean {
  return approval === 'confirmed' || (mode === 'demo' && approval === 'demo')
}

export function appliedSetting<T>(s: Setting<T> | null | undefined, mode: Profile['mode']): Setting<T> | null {
  return s && isApplied(s.approval, mode) ? s : null
}

export const sourceText = (s: RuleSource) => `${s.document}, ${s.clause}${s.page ? `, с. ${s.page}` : ''}${s.note ? ` (${s.note})` : ''}`
