// Загрузка шаблонов и профилей с диска с проверкой схемы. Без зависимостей от Electron — используется и в CLI/тестах.
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import Ajv from 'ajv'
import { parseProfile, type Profile } from '../core/profile'
import { templateSchema, type IppdTemplate, type RegistryTemplate, type TemplateSet, type UmmTemplate } from '../core/templates'

const validateTemplate = new Ajv({ allErrors: true, strict: false }).compile(templateSchema)

export function loadTemplates(dir: string): TemplateSet {
  const ippd: IppdTemplate[] = []
  let umm: UmmTemplate | null = null
  let registry: RegistryTemplate | null = null
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.template.json')).sort()) {
    const json = JSON.parse(readFileSync(join(dir, f), 'utf8')) as IppdTemplate | UmmTemplate | RegistryTemplate
    if (!validateTemplate(json as unknown)) throw new Error(`Шаблон ${f} не соответствует схеме: ${validateTemplate.errors?.map((e) => `${e.instancePath} ${e.message}`).join('; ')}`)
    if (json.kind === 'ippd') ippd.push(json)
    else if (json.kind === 'umm') umm = json
    else registry = json
  }
  if (!ippd.length || !umm || !registry) throw new Error(`В каталоге шаблонов ${dir} нет полного набора (ippd, umm, registry)`)
  return { ippd, umm, registry }
}

export interface LoadedProfile {
  profile: Profile
  sha256: string
  file: string
}

export function loadProfileFile(path: string): LoadedProfile {
  const text = readFileSync(path, 'utf8')
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (e) {
    throw new Error(`Профиль ${path}: некорректный JSON (${(e as Error).message})`)
  }
  return { profile: parseProfile(json, path), sha256: createHash('sha256').update(text).digest('hex'), file: path }
}

export function loadProfiles(dirs: string[]): { profiles: LoadedProfile[]; errors: string[] } {
  const profiles: LoadedProfile[] = []
  const errors: string[] = []
  for (const dir of dirs) {
    let names: string[] = []
    try {
      names = readdirSync(dir).filter((n) => n.endsWith('.profile.json'))
    } catch {
      continue
    }
    for (const n of names.sort()) {
      try {
        const p = loadProfileFile(join(dir, n))
        if (profiles.some((x) => x.profile.id === p.profile.id)) errors.push(`Профиль ${n}: идентификатор ${p.profile.id} уже загружен`)
        else profiles.push(p)
      } catch (e) {
        errors.push((e as Error).message)
      }
    }
  }
  return { profiles, errors }
}
