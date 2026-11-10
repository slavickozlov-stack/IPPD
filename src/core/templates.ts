// Шаблоны разбора. Описываются в JSON (каталог templates/) и проверяются схемой при загрузке.

export type IppdTableKind = 'schedule' | 'theory' | 'practice' | 'internship'
export type ColumnKey = 'number' | 'title' | 'form' | 'place' | 'hours' | 'materials' | 'responsible' | 'mark' | 'dates'

export interface IppdTemplate {
  schemaVersion: 1
  kind: 'ippd'
  id: string
  name: string
  version: string
  basis: string[]
  detect: { patterns: string[]; minMatches: number }
  registrationNumber: { regex: string }
  tables: Record<IppdTableKind, { sectionRegex?: string; headerAll: string[]; required: boolean }>
  columns: Record<ColumnKey, string[]>
  bibliography: { headingRegex: string; entryRegex: string }
}

export type UmmField =
  | 'designation' | 'title' | 'revision' | 'status' | 'validFrom' | 'validTo'
  | 'reviewDue' | 'approvedAt' | 'replaces' | 'replacedBy'

export interface UmmTemplate {
  schemaVersion: 1
  kind: 'umm'
  id: string
  name: string
  version: string
  confirmed: boolean
  basis: string[]
  labels: Record<UmmField, string[]>
  asutdStamp: string
  /** Слова вида документа на титульном листе, после которых идёт наименование. */
  titleTypeWords?: string[]
  statusWords: { active: string[]; replaced: string[]; cancelled: string[]; draft: string[] }
}

export type RegistryField =
  | 'designation' | 'title' | 'revision' | 'status' | 'statusAsOf' | 'validFrom' | 'validTo'
  | 'reviewDue' | 'approvedAt' | 'replacedBy' | 'replacedByRevision'

export interface RegistryTemplate {
  schemaVersion: 1
  kind: 'registry'
  id: string
  name: string
  version: string
  confirmed: boolean
  basis: string[]
  columns: Record<RegistryField, string[]>
}

export interface TemplateSet {
  ippd: IppdTemplate[]
  umm: UmmTemplate
  registry: RegistryTemplate
}

export const templateSchema = {
  type: 'object',
  required: ['schemaVersion', 'kind', 'id', 'name', 'version'],
  properties: {
    schemaVersion: { const: 1 },
    kind: { enum: ['ippd', 'umm', 'registry'] },
    id: { type: 'string', pattern: '^[a-z0-9][a-z0-9._-]*$' },
    name: { type: 'string', minLength: 1 },
    version: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+$' },
    basis: { type: 'array', items: { type: 'string' } }
  },
  allOf: [
    {
      if: { properties: { kind: { const: 'ippd' } } },
      then: { required: ['detect', 'registrationNumber', 'tables', 'columns', 'bibliography'] }
    },
    { if: { properties: { kind: { const: 'umm' } } }, then: { required: ['labels', 'asutdStamp', 'statusWords', 'confirmed'] } },
    { if: { properties: { kind: { const: 'registry' } } }, then: { required: ['columns', 'confirmed'] } }
  ]
} as const
