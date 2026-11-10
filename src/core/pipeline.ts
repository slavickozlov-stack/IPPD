// Сквозной сценарий: файлы → извлечение → правки специалиста → проверка → отчёт.
import { createHash } from 'node:crypto'
import type {
  CheckReport, DocModel, ExtractionBundle, Field, FileRole, IsoDate, LoadedFileInfo, UmmLifecycleStatus, UmmRecord,
  UmmReference, Verdict
} from './model'
import { DocumentReadError, readDocx } from './docx'
import { extractIppd } from './ippdExtract'
import { extractRegistry, extractStampOnly, extractUmmFromDoc, recordFromFileName, statusFromText } from './ummExtract'
import { readPdf } from './pdf'
import { readCsv, readXlsx } from './tabular'
import type { TemplateSet } from './templates'
import type { Profile } from './profile'
import { checkReference } from './actuality'
import { coverage, runRules } from './rules/engine'
import { parseDate } from './dates'
import { normalizeDesignation, normalizeRevision } from './designation'

export interface InputFile {
  id: string
  name: string
  role: FileRole
  data: Uint8Array
}

export const MAX_FILE_BYTES = 60 * 1024 * 1024

export function detectFormat(name: string, data: Uint8Array): LoadedFileInfo['format'] {
  const lower = name.toLowerCase()
  const zip = data[0] === 0x50 && data[1] === 0x4b
  if (data[0] === 0x25 && data[1] === 0x50 && data[2] === 0x44 && data[3] === 0x46) return 'pdf'
  if (zip && lower.endsWith('.docx')) return 'docx'
  if (zip && lower.endsWith('.xlsx')) return 'xlsx'
  if (lower.endsWith('.csv')) return 'csv'
  return 'unknown'
}

export async function extractAll(files: InputFile[], templates: TemplateSet): Promise<ExtractionBundle> {
  const infos: LoadedFileInfo[] = []
  const fileIssues: ExtractionBundle['fileIssues'] = []
  let ippd: ExtractionBundle['ippd'] = null
  let ippdDoc: DocModel | null = null
  const umm: UmmRecord[] = []

  for (const f of files) {
    const info: LoadedFileInfo = {
      id: f.id,
      name: f.name,
      role: f.role,
      size: f.data.byteLength,
      sha256: createHash('sha256').update(f.data).digest('hex'),
      format: detectFormat(f.name, f.data)
    }
    infos.push(info)
    const problem = (msg: string) => {
      info.error = msg
      fileIssues.push({ fileId: f.id, fileName: f.name, message: msg })
    }
    try {
      if (f.data.byteLength > MAX_FILE_BYTES) {
        problem('файл больше 60 МБ — не обрабатывается')
        continue
      }
      if (f.role === 'ippd') {
        if (info.format !== 'docx') {
          problem(info.format === 'pdf' ? 'ИППД в PDF не поддерживается: загрузите DOCX или выполните ручной разбор' : 'неподдерживаемый формат ИППД: ожидается DOCX')
          continue
        }
        const doc = await readDocx(f.data, f.name)
        ippdDoc = doc
        ippd = extractIppd(doc, f.id, templates.ippd)
        if (!ippd.parse.templateSupported) info.manualReason = 'неизвестная форма ИППД — требуется ручной разбор'
      } else if (f.role === 'umm') {
        const id = `umm-${f.id}`
        let rec: UmmRecord
        if (info.format === 'docx') {
          rec = extractUmmFromDoc(await readDocx(f.data, f.name), f.id, templates.umm, id, 'docx')
        } else if (info.format === 'pdf') {
          const pdf = await readPdf(f.data, f.name)
          if (pdf.textLayer === 'full') rec = extractUmmFromDoc(pdf.doc, f.id, templates.umm, id, 'pdf-text', pdf.pages)
          else if (pdf.textLayer === 'stamp-only') {
            rec = extractStampOnly(pdf.doc, f.id, templates.umm, id, pdf.pages)
            info.manualReason = 'скан: распознан только штамп АСУТД — остальные реквизиты введите вручную'
          } else {
            rec = recordFromFileName(f.name, f.id, id, 'PDF без текстового слоя (скан): реквизиты введите или подтвердите вручную')
            rec.recognition = { form: 'pdf-scan', pages: pdf.pages, found: rec.recognition!.found, unmatched: [] }
            info.manualReason = 'скан без текстового слоя — требуется ручной разбор'
          }
        } else {
          problem(
            /\.(doc|odt|rtf)$/i.test(f.name)
              ? 'формат DOC/ODT/RTF не читается: сохраните УММ как DOCX или PDF'
              : 'неподдерживаемый формат УММ: ожидается DOCX или PDF'
          )
          continue
        }
        // Обозначение: из текста; если не найдено — из имени файла; расхождение с именем файла фиксируется
        const byName = recordFromFileName(f.name, f.id, id, '')
        if (!rec.designation.value && byName.designation.value) {
          rec.designation = byName.designation
          rec.issues.push('обозначение в тексте не найдено — взято из имени файла, подтвердите на шаге «Сверка»')
        } else if (rec.designation.value && byName.designation.value && byName.designation.value !== rec.designation.value) {
          rec.issues.push(`обозначение в тексте ${rec.designation.value} не совпадает с именем файла (${byName.designation.value})`)
        }
        if (!rec.designation.value) {
          rec.issues.push('обозначение не найдено ни в тексте, ни в имени файла — укажите вручную')
          info.manualReason ??= 'реквизиты УММ не распознаны'
        }
        umm.push(rec)
      } else {
        if (info.format !== 'xlsx' && info.format !== 'csv') {
          problem('реестр должен быть в формате XLSX или CSV')
          continue
        }
        const sheet = info.format === 'xlsx' ? await readXlsx(f.data) : readCsv(new TextDecoder('utf-8').decode(f.data))
        const { records, issues } = extractRegistry(sheet, f.name, f.id, templates.registry)
        if (!records.length) problem(issues[0] ?? 'в реестре нет записей')
        else for (const i of issues) fileIssues.push({ fileId: f.id, fileName: f.name, message: i })
        for (const r of records) r.id = `${f.id}-${r.id}`
        umm.push(...records)
      }
    } catch (e) {
      problem(e instanceof DocumentReadError ? e.message : `ошибка чтения: ${(e as Error).message}`)
    }
  }
  return { files: infos, ippd, ippdDoc, umm, fileIssues }
}

// ——— Ручные правки на шаге «Сверка» ———

export type UmmEditableField = 'designation' | 'title' | 'revision' | 'status' | 'statusAsOf' | 'validFrom' | 'validTo' | 'reviewDue' | 'approvedAt' | 'replacedBy'
export type RefEditableField = 'designation' | 'revision'

export interface ManualEdit {
  target: 'umm' | 'ref'
  id: string
  field: UmmEditableField | RefEditableField
  /** Значение в том виде, как его ввёл специалист; пустая строка — «неизвестно». */
  value: string
  note: string
}

const DATE_FIELDS = new Set(['statusAsOf', 'validFrom', 'validTo', 'reviewDue', 'approvedAt'])

export class EditError extends Error {}

export function applyEdits(bundle: ExtractionBundle, edits: ManualEdit[], at = new Date().toISOString()): { bundle: ExtractionBundle; log: CheckReport['manualEdits'] } {
  const b: ExtractionBundle = JSON.parse(JSON.stringify(bundle))
  const log: CheckReport['manualEdits'] = []
  const source = (note: string) => ({ method: 'manual' as const, editedAt: at, editedBy: 'специалист', note: note || 'ручной ввод без комментария' })
  for (const e of edits) {
    const raw = e.value.trim()
    if (e.target === 'umm') {
      const rec = b.umm.find((r) => r.id === e.id)
      if (!rec) throw new EditError(`карточка УММ ${e.id} не найдена`)
      const field = rec[e.field as UmmEditableField] as Field<unknown>
      const prev = { value: field.value, raw: field.raw, source: field.source }
      let value: unknown = raw || null
      if (raw && DATE_FIELDS.has(e.field)) {
        const d = parseDate(raw)
        if (!d) throw new EditError(`«${raw}» — не дата (ожидается ДД.ММ.ГГГГ)`)
        value = d.iso
      } else if (raw && e.field === 'status') value = statusFromText(raw, { active: ['действ'], replaced: ['замен'], cancelled: ['отмен', 'аннулир'], draft: ['проект'] }) as UmmLifecycleStatus
      else if (raw && e.field === 'designation') value = normalizeDesignation(raw).key
      else if (raw && e.field === 'revision') value = normalizeRevision(raw)
      else if (raw && e.field === 'replacedBy') {
        const m = raw.match(/^(.*?)(?:\s+(?:изм|ред)\.?\s*(\d+))?$/i)!
        value = { designation: normalizeDesignation(m[1]).key, revision: m[2] ?? null }
      }
      ;(rec as any)[e.field] = { value, raw: raw || null, source: source(e.note), previous: prev }
      log.push({ target: `${rec.fileName} (${rec.designation.value ?? rec.id})`, field: e.field, from: prev.raw, to: raw || null, note: e.note, at })
    } else {
      const ref = b.ippd?.references.find((r) => r.id === e.id)
      if (!ref) throw new EditError(`ссылка ${e.id} не найдена`)
      const from = e.field === 'designation' ? ref.designationRaw : ref.revision
      if (e.field === 'designation') {
        ref.designationRaw = raw || null
        ref.designationNorm = raw ? normalizeDesignation(raw).key : null
        if (raw && (ref.kind === 'unrecognized' || ref.kind === 'empty')) ref.kind = 'umm'
        ref.issues = ref.issues.filter((i) => i !== 'bib-only')
      } else ref.revision = normalizeRevision(raw || null)
      ref.issues.push(`исправлено вручную: ${e.note || 'без комментария'}`)
      log.push({ target: `тема ${ref.topicNumber} (табл. ${ref.location.table}, стр. ${ref.location.row})`, field: e.field, from, to: raw || null, note: e.note, at })
    }
  }
  return { bundle: b, log }
}

// ——— Проверка ———

export interface RunOptions {
  checkDate: IsoDate
  confirmed: boolean
  edits: ManualEdit[]
  profileSha256: string
  now?: Date
}

function inActualityScope(r: UmmReference, records: UmmRecord[], profile: Profile): boolean {
  if (r.kind === 'umm' || r.kind === 'unrecognized') return true
  if (r.kind === 'primary-source' && r.designationNorm)
    return profile.checkPrimarySources || records.some((x) => x.designation.value === r.designationNorm)
  return false
}

export function runCheck(source: ExtractionBundle, profile: Profile, opts: RunOptions): CheckReport {
  const now = opts.now ?? new Date()
  const { bundle, log } = applyEdits(source, opts.edits, now.toISOString())
  const ippd = bundle.ippd
  const refs = ippd?.references ?? []
  const actuality = refs
    .filter((r) => inActualityScope(r, bundle.umm, profile))
    .map((r) => checkReference(r, bundle.umm, opts.checkDate, profile, ippd?.bibliography.find((b) => b.index === r.bibIndex)?.title))
  const normcontrol = runRules(ippd, bundle.ippdDoc, profile)
  const cov = coverage(profile)

  const reasonsIncomplete: string[] = []
  if (!ippd) reasonsIncomplete.push('ИППД не загружена или не прочитана.')
  else reasonsIncomplete.push(...ippd.parse.incompleteReasons)
  for (const f of bundle.files) if (f.error) reasonsIncomplete.push(`Файл «${f.name}» не обработан: ${f.error}.`)
  if (!opts.confirmed) reasonsIncomplete.push('Извлечённые данные не подтверждены специалистом на шаге «Сверка».')

  const problems = actuality.filter((a) => a.status !== 'in_force')
  const fails = normcontrol.filter((r) => r.outcome === 'fail')
  const manual = normcontrol.filter((r) => r.outcome === 'manual')
  const unconfigured = cov.filter((c) => !c.configured)
  const reasons: string[] = []
  let verdict: Verdict
  if (reasonsIncomplete.length) {
    verdict = 'incomplete'
    reasons.push(...reasonsIncomplete)
    if (problems.length || fails.length) reasons.push(`При этом уже выявлено: ссылок с замечаниями — ${problems.length}, нарушений нормоконтроля — ${fails.length}.`)
  } else if (problems.length || fails.length) {
    verdict = 'remarks'
    if (problems.length) reasons.push(`Ссылок на УММ с замечаниями или требующих уточнения: ${problems.length}.`)
    if (fails.length) reasons.push(`Правил нормоконтроля с нарушениями: ${fails.length}.`)
    if (manual.length) reasons.push(`Требуют ручной проверки: ${manual.length}.`)
  } else if (manual.length || unconfigured.length) {
    verdict = 'incomplete'
    if (manual.length) reasons.push(`Автоматических замечаний нет, но ${manual.length} проверок требуют ручной проверки специалистом.`)
    if (unconfigured.length) reasons.push(`В профиле не настроено проверок: ${unconfigured.length} — итог «замечаний нет» недоступен.`)
  } else {
    verdict = 'no_remarks'
    reasons.push('Разбор полный, все применимые проверки выполнены, замечаний нет. Результат передаётся специалисту для рассмотрения.')
  }

  return {
    generatedAt: now.toISOString(),
    checkDate: opts.checkDate,
    profile: { id: profile.id, name: profile.name, version: profile.version, mode: profile.mode, sha256: opts.profileSha256 },
    files: bundle.files,
    ippd: ippd ? { fileName: ippd.fileName, registrationNumber: ippd.registrationNumber.value, parse: ippd.parse } : null,
    counts: {
      referencesFound: refs.filter((r) => r.kind !== 'empty').length,
      ummReferences: refs.filter((r) => r.kind === 'umm').length,
      matched: actuality.filter((a) => a.matchedRecordIds.length > 0).length,
      needsClarification: actuality.filter((a) => a.status === 'needs_clarification').length,
      notFound: actuality.filter((a) => a.status === 'not_found').length
    },
    actuality,
    normcontrol,
    coverage: cov,
    manualEdits: log,
    verdict,
    verdictReasons: reasons
  }
}
