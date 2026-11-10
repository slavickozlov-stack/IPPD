import type { IsoDate } from './model'

export interface ParsedDate {
  iso: IsoDate
  /** Запись в формате ДД.ММ.ГГГГ без отклонений. */
  canonical: boolean
  raw: string
}

const MONTHS: Record<string, number> = {
  января: 1, февраля: 2, марта: 3, апреля: 4, мая: 5, июня: 6,
  июля: 7, августа: 8, сентября: 9, октября: 10, ноября: 11, декабря: 12
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0')

export function isValidYmd(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

export const toIso = (y: number, m: number, d: number): IsoDate => `${pad(y, 4)}-${pad(m)}-${pad(d)}`

/** Разбирает одну дату. Возвращает null, если строка не похожа на дату или дата невозможна. */
export function parseDate(input: string | null | undefined): ParsedDate | null {
  if (input == null) return null
  const raw = String(input).trim()
  if (!raw) return null

  let m = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/)
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
    return isValidYmd(y, mo, d) ? { iso: toIso(y, mo, d), canonical: false, raw } : null
  }
  m = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})\s*(?:г\.?|года?)?$/)
  if (m) {
    const d = Number(m[1])
    const mo = Number(m[2])
    let y = Number(m[3])
    if (m[3].length === 2) y += 2000
    if (!isValidYmd(y, mo, d)) return null
    const canonical = m[1].length === 2 && m[2].length === 2 && m[3].length === 4
    return { iso: toIso(y, mo, d), canonical, raw }
  }
  m = raw.match(/^«?\s*(\d{1,2})\s*»?\s+([а-яё]+)\s+(\d{4})\s*(?:г\.?|года?)?$/i)
  if (m && MONTHS[m[2].toLowerCase()]) {
    const d = Number(m[1])
    const mo = MONTHS[m[2].toLowerCase()]
    const y = Number(m[3])
    return isValidYmd(y, mo, d) ? { iso: toIso(y, mo, d), canonical: false, raw } : null
  }
  return null
}

/** Серийный номер даты Excel (система 1900) в ISO. */
export function excelSerialToIso(serial: number): IsoDate | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2958465) return null
  const ms = Math.round((serial - 25569) * 86400 * 1000)
  const dt = new Date(ms)
  return toIso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate())
}

/** Находит в тексте все фрагменты, похожие на даты вида Д.М.Г (включая ошибочные). */
export function findDateTokens(text: string): { token: string; index: number }[] {
  const out: { token: string; index: number }[] = []
  const re = /(?<![\d.])\d{1,2}\.\d{1,2}\.\d{2,4}(?![\d.]*\d)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) out.push({ token: m[0], index: m.index })
  return out
}

export function compareIso(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export function addYears(iso: IsoDate, years: number): IsoDate {
  const [y, m, d] = iso.split('-').map(Number)
  let ny = y + years
  let nd = d
  if (m === 2 && d === 29 && !isValidYmd(ny, 2, 29)) nd = 28
  return toIso(ny, m, nd)
}

export function formatRu(iso: IsoDate | null | undefined): string {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y}`
}

export function todayLocalIso(now = new Date()): IsoDate {
  return toIso(now.getFullYear(), now.getMonth() + 1, now.getDate())
}
