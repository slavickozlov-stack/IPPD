import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Field, UmmRecord, UmmReference } from '../src/core/model'
import { parseProfile, type Profile } from '../src/core/profile'
import { loadTemplates } from '../src/main/resources'

export const root = join(__dirname, '..')
export const templates = loadTemplates(join(root, 'templates'))
export const profile = (id: string): Profile => parseProfile(JSON.parse(readFileSync(join(root, 'profiles', `${id}.profile.json`), 'utf8')), id)

const field = (origin: UmmRecord['origin']) => <T>(value: T | null): Field<T> =>
  value == null
    ? { value: null, raw: null, source: null }
    : { value, raw: String(value), source: { method: origin === 'registry' ? 'registry' : 'extracted', location: { file: origin === 'registry' ? 'реестр.xlsx' : 'umm.docx' } } }

export function rec(p: Partial<Record<keyof UmmRecord, unknown>> & { designation: string }, origin: UmmRecord['origin'] = 'umm-file'): UmmRecord {
  const f = field(origin)
  return {
    id: (p.id as string) ?? `${origin}-${p.designation}-${p.revision ?? ''}`,
    origin,
    fileId: 'f',
    fileName: origin === 'registry' ? 'реестр.xlsx' : 'umm.docx',
    designation: f(p.designation),
    title: f((p.title as string) ?? null),
    revision: f((p.revision as string) ?? null),
    status: f((p.status as UmmRecord['status']['value']) ?? null),
    statusAsOf: f((p.statusAsOf as string) ?? null),
    validFrom: f((p.validFrom as string) ?? null),
    validTo: f((p.validTo as string) ?? null),
    reviewDue: f((p.reviewDue as string) ?? null),
    approvedAt: f((p.approvedAt as string) ?? null),
    replacedBy: f((p.replacedBy as UmmRecord['replacedBy']['value']) ?? null),
    replaces: f((p.replaces as UmmRecord['replaces']['value']) ?? null),
    issues: []
  }
}

export function ref(designation: string, revision: string | null = null): UmmReference {
  return {
    id: 'ref-1',
    planKind: 'theory',
    topicNumber: '1.1',
    topicTitle: 'Тема',
    form: 'Сп',
    cellRaw: designation,
    kind: 'umm',
    designationRaw: designation,
    designationNorm: designation,
    revision,
    bibIndex: 1,
    location: { file: 'ippd.docx', table: 6, row: 3, column: 'Учебные материалы' },
    issues: []
  }
}
