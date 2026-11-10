// Сопоставление ссылок ИППД с УММ и проверка актуальности на дату.
import type {
  ActualityCheck, ActualityResult, ActualityStatus, Field, IsoDate, ReplacementLink, UmmRecord, UmmReference
} from './model'
import { addYears, compareIso, formatRu } from './dates'
import { editionOf, normalizeDesignation, similarity } from './designation'
import type { ActualitySettings, Profile, Setting } from './profile'
import { appliedSetting, sourceText } from './profile'
import { STATUS_LABEL } from './labels'

export { STATUS_LABEL }

const LIFECYCLE_LABEL = { active: 'действующий', replaced: 'заменён', cancelled: 'отменён', draft: 'проект', other: 'иной' } as const

type Applied = { [K in keyof ActualitySettings]-?: NonNullable<ActualitySettings[K]> | null }

export function appliedActuality(profile: Profile): Applied {
  const a = profile.actuality
  const m = profile.mode
  return {
    validToInclusive: appliedSetting(a.validToInclusive, m),
    validFromInclusive: appliedSetting(a.validFromInclusive, m),
    reviewDueInclusive: appliedSetting(a.reviewDueInclusive, m),
    reviewPeriodFromApproval: appliedSetting(a.reviewPeriodFromApproval, m),
    revisionSelection: appliedSetting(a.revisionSelection, m),
    sourcePriority: appliedSetting(a.sourcePriority, m),
    statusAsOfPolicy: appliedSetting(a.statusAsOfPolicy, m),
    newerEditionPolicy: appliedSetting(a.newerEditionPolicy, m)
  }
}

const where = (f: Field<unknown>) => {
  if (!f.source) return ''
  const l = f.source.location ?? { file: '' }
  const parts = [l.file, l.sheet && `лист «${l.sheet}»`, l.table && `табл. ${l.table}`, l.row && `стр. ${l.row}`, l.paragraph && `абз. ${l.paragraph}`, l.column && `графа «${l.column}»`]
  const how = f.source?.method === 'manual' ? 'ручной ввод' : f.source?.method === 'registry' ? 'реестр' : f.source?.method === 'derived' ? 'выведено' : ''
  const body = [how, ...parts].filter(Boolean).join(', ')
  return body || f.source.note ? ` [${body}${f.source.note ? `; ${f.source.note}` : ''}]` : ''
}
const ruleRef = (s: Setting<unknown>) => `${s.approval === 'demo' ? 'ДЕМО-правило' : 'правило'}: ${sourceText(s.source)}`

export interface Evaluation {
  status: ActualityStatus
  checks: ActualityCheck[]
  basis: string
}

function boundary(
  date: IsoDate,
  edge: IsoDate,
  inclusive: Setting<boolean> | null,
  label: string,
  edgeField: Field<unknown>,
  kind: 'from' | 'to'
): { outcome: ActualityCheck['outcome']; basis: string } {
  const c = compareIso(date, edge)
  const e = `${label} ${formatRu(edge)}${where(edgeField)}`
  if (kind === 'to') {
    if (c < 0) return { outcome: 'ok', basis: `${e} — дата проверки раньше` }
    if (c > 0) return { outcome: 'problem', basis: `${e} — дата проверки позже` }
  } else {
    if (c > 0) return { outcome: 'ok', basis: `${e} — дата проверки позже` }
    if (c < 0) return { outcome: 'problem', basis: `${e} — дата проверки раньше` }
  }
  if (!inclusive) return { outcome: 'unknown', basis: `${e} совпадает с датой проверки; правило о граничном дне не настроено` }
  const ok = inclusive.value
  return { outcome: ok ? 'ok' : 'problem', basis: `${e} совпадает с датой проверки; граничный день ${ok ? 'включается' : 'не включается'} (${ruleRef(inclusive)})` }
}

/** Статус одной (уже объединённой) карточки УММ на дату. */
export function evaluateRecord(rec: UmmRecord, date: IsoDate, s: Applied): Evaluation {
  const checks: ActualityCheck[] = []
  const st = rec.status.value
  const statusCheck: ActualityCheck = { name: 'status', label: 'Статус', outcome: 'unknown', basis: 'статус в источниках не указан' }
  if (st) {
    const asOf = rec.statusAsOf.value ? ` на ${formatRu(rec.statusAsOf.value)}` : ''
    statusCheck.basis = `статус «${rec.status.raw ?? LIFECYCLE_LABEL[st]}»${asOf}${where(rec.status)}`
    statusCheck.outcome = st === 'active' ? 'ok' : st === 'draft' || st === 'other' ? 'unknown' : 'problem'
  }
  checks.push(statusCheck)

  const fromCheck: ActualityCheck = { name: 'validFrom', label: 'Начало действия', outcome: 'unknown', basis: 'дата введения в действие не указана' }
  if (rec.validFrom.value) Object.assign(fromCheck, boundary(date, rec.validFrom.value, s.validFromInclusive, 'введён в действие', rec.validFrom, 'from'))
  else if (rec.validFrom.raw) fromCheck.basis = `дата введения «${rec.validFrom.raw}» не распознана`
  checks.push(fromCheck)

  const toCheck: ActualityCheck = { name: 'validTo', label: 'Окончание действия', outcome: 'unknown', basis: 'дата окончания действия не указана' }
  if (rec.validTo.value) Object.assign(toCheck, boundary(date, rec.validTo.value, s.validToInclusive, 'действует по', rec.validTo, 'to'))
  else if (rec.validTo.raw) toCheck.basis = `дата окончания «${rec.validTo.raw}» не распознана`
  checks.push(toCheck)

  const reviewCheck: ActualityCheck = { name: 'reviewDue', label: 'Срок пересмотра', outcome: 'unknown', basis: 'срок пересмотра не указан' }
  let reviewDue = rec.reviewDue.value
  let reviewField: Field<unknown> = rec.reviewDue
  let reviewNote = ''
  if (!reviewDue && rec.approvedAt.value && s.reviewPeriodFromApproval) {
    reviewDue = addYears(rec.approvedAt.value, s.reviewPeriodFromApproval.value.years)
    reviewField = rec.approvedAt
    reviewNote = ` (вычислен: дата утверждения ${formatRu(rec.approvedAt.value)} + ${s.reviewPeriodFromApproval.value.years} г.; ${ruleRef(s.reviewPeriodFromApproval)})`
  } else if (!reviewDue && rec.approvedAt.value) {
    reviewCheck.basis = 'срок пересмотра не указан; правило вычисления от даты утверждения не настроено'
  }
  if (reviewDue) {
    const b = boundary(date, reviewDue, s.reviewDueInclusive, 'пересмотреть до', reviewField, 'to')
    reviewCheck.outcome = b.outcome
    reviewCheck.basis = b.basis + reviewNote
  }
  checks.push(reviewCheck)

  const done = (status: ActualityStatus, basis: string): Evaluation => ({ status, checks, basis })
  if (st === 'cancelled') return done('cancelled', statusCheck.basis)
  if (st === 'replaced') return done('replaced', statusCheck.basis)
  if (fromCheck.outcome === 'problem') return done('not_yet_effective', fromCheck.basis)
  if (toCheck.outcome === 'problem') return done('expired', toCheck.basis)
  if (fromCheck.outcome === 'unknown' && rec.validFrom.value) return done('needs_clarification', fromCheck.basis)
  if (toCheck.outcome === 'unknown' && rec.validTo.value) return done('needs_clarification', toCheck.basis)
  if (st === 'draft' || st === 'other') return done('needs_clarification', `${statusCheck.basis}: статус не позволяет считать документ действующим`)

  let evidence = ''
  if (toCheck.outcome === 'ok') evidence = toCheck.basis
  else if (st === 'active') {
    const asOf = rec.statusAsOf.value
    if (asOf && compareIso(asOf, date) < 0) {
      if (!s.statusAsOfPolicy)
        return done(
          'needs_clarification',
          `${statusCheck.basis}; статус подтверждён на дату раньше даты проверки, дата окончания действия неизвестна`
        )
      evidence = `${statusCheck.basis}; принят по ${ruleRef(s.statusAsOfPolicy)}`
    } else evidence = statusCheck.basis
  }
  if (!evidence) return done('needs_clarification', 'нет сведений ни о статусе, ни о сроке действия')
  if (reviewCheck.outcome === 'problem') return done('review_overdue', `${reviewCheck.basis}; при этом документ действует: ${evidence}`)
  if (reviewCheck.outcome === 'unknown' && reviewDue) return done('needs_clarification', reviewCheck.basis)
  return done('in_force', evidence)
}

const MERGE_FIELDS = ['title', 'status', 'statusAsOf', 'validFrom', 'validTo', 'reviewDue', 'approvedAt', 'replacedBy', 'replaces'] as const
const FIELD_LABEL: Record<(typeof MERGE_FIELDS)[number], string> = {
  title: 'наименование',
  status: 'статус',
  statusAsOf: 'дата статуса',
  validFrom: 'дата введения',
  validTo: 'дата окончания',
  reviewDue: 'срок пересмотра',
  approvedAt: 'дата утверждения',
  replacedBy: 'заменяющий документ',
  replaces: 'взамен'
}

export interface MergeResult {
  record: UmmRecord
  conflicts: string[]
  resolved: string[]
}

/** Объединяет карточки одного документа из разных источников; расхождения — конфликт или приоритет по правилу. */
export function mergeRecords(recs: UmmRecord[], s: Applied): MergeResult {
  const base: UmmRecord = JSON.parse(JSON.stringify(recs[0]))
  const conflicts: string[] = []
  const resolved: string[] = []
  for (const f of MERGE_FIELDS) {
    const withValue = recs.filter((r) => (r[f] as Field<unknown>).value != null)
    if (!withValue.length) continue
    const distinct = new Map<string, UmmRecord[]>()
    for (const r of withValue) {
      const k = JSON.stringify((r[f] as Field<unknown>).value)
      distinct.set(k, [...(distinct.get(k) ?? []), r])
    }
    if (f === 'title') {
      ;(base as any)[f] = withValue[0][f]
      continue
    }
    if (distinct.size === 1) {
      // Предпочтение ручному вводу, затем документу
      const pick = withValue.find((r) => (r[f] as Field<unknown>).source?.method === 'manual') ?? withValue[0]
      ;(base as any)[f] = pick[f]
      continue
    }
    const desc = [...distinct.values()]
      .map((rs) => `${(rs[0][f] as Field<unknown>).raw ?? JSON.stringify((rs[0][f] as Field<unknown>).value)}${where(rs[0][f] as Field<unknown>)}`)
      .join(' ≠ ')
    const manual = withValue.filter((r) => (r[f] as Field<unknown>).source?.method === 'manual')
    if (manual.length === 1) {
      ;(base as any)[f] = manual[0][f]
      resolved.push(`${FIELD_LABEL[f]}: ${desc}; принято значение, подтверждённое специалистом вручную`)
      continue
    }
    const origins = new Set(withValue.map((r) => r.origin))
    if (s.sourcePriority && origins.size > 1) {
      const winner = withValue.find((r) => r.origin === s.sourcePriority!.value)!
      ;(base as any)[f] = winner[f]
      resolved.push(
        `${FIELD_LABEL[f]}: ${desc}; применён приоритет «${s.sourcePriority.value === 'registry' ? 'реестр' : 'документ УММ'}» (${ruleRef(s.sourcePriority)})`
      )
      continue
    }
    conflicts.push(`${FIELD_LABEL[f]}: ${desc}`)
  }
  base.id = recs.map((r) => r.id).join('+')
  return { record: base, conflicts, resolved }
}

const ACTION: Record<ActualityStatus, string> = {
  in_force: 'Действий не требуется.',
  expired: 'Заменить ссылку на действующий УММ либо получить подтверждение продления срока действия.',
  replaced: 'Заменить ссылку в ИППД на заменяющий документ и проверить его соответствие теме.',
  cancelled: 'Исключить ссылку или подобрать действующий УММ по теме.',
  not_yet_effective: 'Уточнить дату введения в действие; на дату проверки УММ применять нельзя.',
  review_overdue: 'Документ формально действует, но срок пересмотра прошёл: уточнить у разработчика результат пересмотра.',
  not_found: 'Загрузить УММ (или реестр) либо проверить обозначение в ИППД.',
  needs_clarification: 'Сверить исходные данные и подтвердить значения вручную на шаге «Сверка».'
}

function revisionGroups(recs: UmmRecord[]): Map<string, UmmRecord[]> {
  const groups = new Map<string, UmmRecord[]>()
  const nulls = recs.filter((r) => !r.revision.value)
  for (const r of recs.filter((r) => r.revision.value)) groups.set(r.revision.value!, [...(groups.get(r.revision.value!) ?? []), r])
  if (groups.size === 1) {
    const [k, v] = [...groups.entries()][0]
    groups.set(k, [...v, ...nulls])
  } else if (groups.size === 0 && nulls.length) groups.set('', nulls)
  else if (nulls.length) groups.set('?', nulls)
  return groups
}

const revLabel = (k: string) => (k === '' ? 'без указания изменения' : k === '?' ? 'изменение не указано' : `изм. ${k}`)

function findReplacement(
  link: ReplacementLink,
  records: UmmRecord[],
  date: IsoDate,
  s: Applied,
  depth: number
): ActualityResult['replacement'] {
  const key = normalizeDesignation(link.designation).key
  let recs = records.filter((r) => r.designation.value === key)
  if (link.revision) recs = recs.filter((r) => !r.revision.value || r.revision.value === link.revision)
  const name = `${key}${link.revision ? ` изм. ${link.revision}` : ''}`
  if (!recs.length) return { designation: key, revision: link.revision ?? null, statusOnDate: null, basis: `заменяющий документ ${name} не загружен — его статус не установлен` }
  const groups = revisionGroups(recs)
  if (groups.size > 1) return { designation: key, revision: link.revision ?? null, statusOnDate: 'needs_clarification', basis: `загружено несколько редакций ${key}` }
  const m = mergeRecords([...groups.values()][0], s)
  if (m.conflicts.length) return { designation: key, revision: link.revision ?? null, statusOnDate: 'needs_clarification', basis: `расхождение источников: ${m.conflicts.join('; ')}` }
  const ev = evaluateRecord(m.record, date, s)
  let basis = ev.basis
  if (ev.status === 'replaced' && depth < 3 && m.record.replacedBy.value) {
    const next = findReplacement(m.record.replacedBy.value, records, date, s, depth + 1)
    basis += `; далее заменён на ${next?.designation}: ${next?.statusOnDate ? STATUS_LABEL[next.statusOnDate] : 'статус не установлен'}`
  }
  return { designation: key, revision: m.record.revision.value ?? link.revision ?? null, statusOnDate: ev.status, basis }
}

export function checkReference(ref: UmmReference, records: UmmRecord[], date: IsoDate, profile: Profile, bibTitle?: string | null): ActualityResult {
  const s = appliedActuality(profile)
  const result = (status: ActualityStatus, basis: string, extra: Partial<ActualityResult> = {}): ActualityResult => ({
    referenceId: ref.id,
    reference: ref,
    status,
    matchedRecordIds: [],
    candidates: [],
    checks: [],
    basis,
    action: ACTION[status],
    ...extra
  })
  if (!ref.designationNorm) return result('needs_clarification', 'обозначение в ссылке не распознано', { action: 'Указать обозначение УММ вручную на шаге «Сверка».' })
  const key = ref.designationNorm
  const exact = records.filter((r) => r.designation.value === key)
  if (!exact.length) {
    const fuzzy = normalizeDesignation(key).fuzzyKey
    const close = records.filter((r) => r.designation.value && normalizeDesignation(r.designation.value).fuzzyKey === fuzzy)
    const titleHints = records.filter(
      (r) => r.title.value && (similarity(r.title.value, bibTitle ?? '') >= 0.5 || similarity(r.title.value, ref.topicTitle) >= 0.5)
    )
    const candidates = [
      ...close.map((r) => ({ recordId: r.id, designation: r.designation.value!, revision: r.revision.value, reason: 'обозначение совпадает без учёта регистра и разделителей' })),
      ...titleHints
        .filter((r) => !close.includes(r))
        .map((r) => ({ recordId: r.id, designation: r.designation.value ?? '—', revision: r.revision.value, reason: `совпадение по названию «${r.title.value}» — только подсказка` }))
    ]
    if (close.length)
      return result('needs_clarification', `точного совпадения обозначения нет; найден близкий вариант ${close[0].designation.value}`, {
        candidates,
        action: 'Проверить обозначение в ИППД и в УММ: возможна опечатка или ошибка оформления.'
      })
    return result('not_found', `УММ ${key} отсутствует среди загруженных файлов и реестра`, { candidates })
  }

  const groups = revisionGroups(exact)
  let chosen: UmmRecord[] | null = null
  let choiceBasis = ''
  const candidates = [...groups.entries()].map(([k, rs]) => ({
    recordId: rs.map((r) => r.id).join('+'),
    designation: key,
    revision: k || null,
    reason: `${revLabel(k)}: ${rs.map((r) => (r.origin === 'registry' ? 'реестр' : r.fileName)).join(', ')}`
  }))
  if (ref.revision) {
    chosen = groups.get(ref.revision) ?? null
    if (!chosen)
      return result('needs_clarification', `в ИППД указано изм. ${ref.revision}, загружены: ${[...groups.keys()].map(revLabel).join(', ')}`, {
        candidates,
        action: 'Загрузить указанную редакцию или исправить ссылку.'
      })
    choiceBasis = `редакция по ссылке: изм. ${ref.revision}`
  } else if (groups.size === 1) {
    chosen = [...groups.values()][0]
  } else {
    if (!s.revisionSelection)
      return result('needs_clarification', `редакция в ссылке не указана, загружено несколько: ${[...groups.keys()].map(revLabel).join(', ')}; правило выбора не настроено`, {
        candidates,
        action: 'Выбрать редакцию вручную или настроить правило выбора в профиле.'
      })
    const inForce = [...groups.entries()].filter(([, rs]) => {
      const m = mergeRecords(rs, s)
      return !m.conflicts.length && evaluateRecord(m.record, date, s).status === 'in_force'
    })
    if (inForce.length !== 1)
      return result('needs_clarification', `редакция не указана; действующих на дату редакций: ${inForce.length}`, { candidates })
    chosen = inForce[0][1]
    choiceBasis = `редакция выбрана автоматически: единственная действующая на дату (${ruleRef(s.revisionSelection)})`
  }

  const merged = mergeRecords(chosen, s)
  const matchCheck: ActualityCheck = {
    name: 'match',
    label: 'Сопоставление',
    outcome: 'ok',
    basis: `совпадение по обозначению ${key}${merged.record.revision.value ? `, изм. ${merged.record.revision.value}` : ''}${choiceBasis ? `; ${choiceBasis}` : ''}`
  }
  const ids = chosen.map((r) => r.id)
  if (merged.conflicts.length) {
    return result('needs_clarification', `источники расходятся: ${merged.conflicts.join('; ')}`, {
      matchedRecordIds: ids,
      candidates,
      checks: [matchCheck, { name: 'sources', label: 'Согласованность источников', outcome: 'problem', basis: merged.conflicts.join('; ') + (s.sourcePriority ? '' : '; приоритет источников не настроен') }],
      action: 'Уточнить верное значение и ввести его вручную либо настроить приоритет источников в профиле.'
    })
  }
  const ev = evaluateRecord(merged.record, date, s)
  const checks = [matchCheck, ...(merged.resolved.length ? [{ name: 'sources' as const, label: 'Согласованность источников', outcome: 'ok' as const, basis: merged.resolved.join('; ') }] : []), ...ev.checks]
  let status = ev.status
  let basis = ev.basis
  let replacement: ActualityResult['replacement']

  // Явная связь «взамен» из нового документа
  const replacing = records.filter((r) => r.replaces.value && normalizeDesignation(r.replaces.value.designation).key === key && r.designation.value !== key)
  const link = merged.record.replacedBy.value ?? (replacing[0]?.designation.value ? { designation: replacing[0].designation.value, revision: replacing[0].revision.value } : null)
  if (status === 'replaced' || (replacing.length && status !== 'cancelled')) {
    if (link) replacement = findReplacement(link, records, date, s, 0)
    if (status !== 'replaced' && replacing.length) {
      const newIsInForce = replacement?.statusOnDate === 'in_force'
      if (merged.record.status.value === 'active') {
        status = 'needs_clarification'
        basis = `${replacing[0].designation.value} выпущен «взамен» ${key}${where(replacing[0].replaces)}, но ${key} имеет статус «действующий»`
      } else if (newIsInForce) {
        status = 'replaced'
        basis = `${replacing[0].designation.value} выпущен «взамен» ${key}${where(replacing[0].replaces)} и действует на дату проверки`
      }
    }
    checks.push({
      name: 'replacement',
      label: 'Замена',
      outcome: replacement ? (replacement.statusOnDate === 'in_force' ? 'ok' : 'unknown') : 'unknown',
      basis: replacement
        ? `заменён на ${replacement.designation}${replacement.revision ? ` изм. ${replacement.revision}` : ''}: ${replacement.statusOnDate ? STATUS_LABEL[replacement.statusOnDate] : 'статус не установлен'} — ${replacement.basis}`
        : 'заменяющий документ в источниках не указан'
    })
  }
  // Новый УММ той же темы с более поздним годом: ссылку на старый нужно пересмотреть сразу.
  const mine = editionOf(key)
  if (mine && status !== 'replaced' && status !== 'cancelled' && !replacement) {
    const newer = records
      .filter((r) => r.designation.value && r.designation.value !== key)
      .map((r) => ({ r, e: editionOf(r.designation.value!) }))
      .filter((x) => x.e && x.e.theme === mine.theme && x.e.year > mine.year)
      .sort((a, b) => b.e!.year - a.e!.year || b.e!.number - a.e!.number)
    if (newer.length) {
      const latest = newer[0].r
      const repl = findReplacement({ designation: latest.designation.value!, revision: latest.revision.value }, records, date, s, 0)!
      const others = newer.length > 1 ? `; также загружены: ${newer.slice(1).map((x) => x.r.designation.value).join(', ')}` : ''
      const found = `загружен более новый УММ той же темы ${latest.designation.value} (${newer[0].e!.year} г. позже ${mine.year} г.)${where(latest.designation)}${others}`
      const policy = s.newerEditionPolicy
      if (!policy) {
        checks.push({ name: 'replacement', label: 'Новая редакция', outcome: 'unknown', basis: `${found}; правило пересмотра по новому УММ не настроено` })
      } else {
        replacement = repl
        const rule = ruleRef(policy)
        if (policy.value === 'replaced' && repl.statusOnDate === 'in_force') {
          status = 'replaced'
          basis = `${found} и действует на дату проверки; новая редакция УММ выпускается под новым номером — ссылку нужно пересмотреть (${rule})`
        } else {
          status = 'needs_clarification'
          basis = `${found}; статус нового УММ на дату: ${repl.statusOnDate ? STATUS_LABEL[repl.statusOnDate] : 'не установлен'} — пересмотреть ссылку (${rule})`
        }
        checks.push({ name: 'replacement', label: 'Новая редакция', outcome: repl.statusOnDate === 'in_force' ? 'ok' : 'unknown', basis: `${latest.designation.value}: ${repl.statusOnDate ? STATUS_LABEL[repl.statusOnDate] : 'статус не установлен'} — ${repl.basis}` })
      }
    }
  }
  const action =
    status === 'replaced' && replacement
      ? `Заменить ссылку на ${replacement.designation}${replacement.revision ? ` изм. ${replacement.revision}` : ''}${replacement.statusOnDate === 'in_force' ? '' : ' (статус замены на дату проверки требует уточнения)'}.`
      : status === 'needs_clarification' && replacement
        ? `Пересмотреть ссылку с учётом нового УММ ${replacement.designation}: уточнить, заменяет ли он ссылочный и действует ли на дату проверки.`
        : ACTION[status]
  return { referenceId: ref.id, reference: ref, status, matchedRecordIds: ids, candidates: groups.size > 1 ? candidates : [], checks, basis, action, replacement }
}
