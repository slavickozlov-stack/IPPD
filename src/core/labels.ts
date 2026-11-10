import type { ActualityStatus, RuleOutcome, SourceLocation, Verdict } from './model'

export const STATUS_LABEL: Record<ActualityStatus, string> = {
  in_force: 'действует',
  expired: 'срок действия истёк',
  replaced: 'заменён',
  cancelled: 'отменён',
  not_yet_effective: 'ещё не вступил в силу',
  review_overdue: 'просрочен пересмотр',
  not_found: 'не найден в загруженных материалах',
  needs_clarification: 'требуется уточнение'
}

export const STATUS_ORDER: ActualityStatus[] = [
  'needs_clarification', 'not_found', 'cancelled', 'replaced', 'expired', 'not_yet_effective', 'review_overdue', 'in_force'
]

export const OUTCOME_LABEL: Record<RuleOutcome, string> = {
  pass: 'соответствует',
  fail: 'нарушение',
  na: 'не применимо',
  manual: 'требуется ручная проверка'
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  no_remarks: 'Замечаний нет',
  remarks: 'Есть замечания',
  incomplete: 'Проверка неполная'
}

export const SEVERITY_LABEL: Record<string, string> = {
  critical: 'критическое',
  major: 'существенное',
  minor: 'незначительное',
  info: 'к сведению'
}

export const APPROVAL_LABEL: Record<string, string> = {
  confirmed: 'подтверждено',
  draft: 'черновик',
  demo: 'ДЕМО'
}

export function formatLocation(l?: SourceLocation | null): string {
  if (!l) return '—'
  const parts = [
    `«${l.file}»`,
    l.section && `раздел «${l.section}»`,
    l.sheet && `лист «${l.sheet}»`,
    l.table != null && `таблица ${l.table}`,
    l.row != null && `строка ${l.row}`,
    l.column && `графа «${l.column}»`,
    l.paragraph != null && `абзац ${l.paragraph}`,
    l.page != null && `страница ${l.page}`
  ]
  return parts.filter(Boolean).join(', ')
}

export const KIND_LABEL: Record<string, string> = {
  umm: 'УММ',
  'primary-source': 'первоисточник',
  electronic: 'электронный курс',
  empty: 'пусто',
  unrecognized: 'не распознано'
}
