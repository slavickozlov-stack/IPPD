// Обозначения УММ. Структура подтверждена примерами П.00.10 изм.31 (Прил. Б, «Библиография (пример)», с. 50)
// и образцами ИППД: <уровень>.К<курс>.Т<тема>.<вид УММ>.<подразделение>.<номер>.<год>,
// например I.К1.Т13.УМСИ.ООП.3591.2024. Смысл отдельных частей регламентом в приложенных материалах не раскрыт.

const LATIN_TO_CYR: Record<string, string> = {
  A: 'А', B: 'В', C: 'С', E: 'Е', H: 'Н', K: 'К', M: 'М', O: 'О', P: 'Р', T: 'Т', X: 'Х', Y: 'У',
  a: 'а', c: 'с', e: 'е', o: 'о', p: 'р', x: 'х', y: 'у'
}
const CYR_TO_LATIN_ROMAN: Record<string, string> = { 'І': 'I', 'і': 'I', 'Х': 'X', 'х': 'X', 'Ⅰ': 'I', 'Ⅴ': 'V' }

export type DesignationIssue = 'mixed-script' | 'space-around-dot' | 'inner-space' | 'missing-dot'

export interface NormalizedDesignation {
  /** Ключ сопоставления: регистр, ведущие нули и все значимые части сохраняются. */
  key: string
  /** Грубый ключ только для подсказок (без разделителей и регистра). */
  fuzzyKey: string
  issues: DesignationIssue[]
}

const hasCyr = (s: string) => /[А-Яа-яЁё]/.test(s)

export function normalizeDesignation(raw: string): NormalizedDesignation {
  const issues = new Set<DesignationIssue>()
  let s = raw.replace(/[   ]/g, ' ').replace(/\s+/g, ' ').trim()
  if (/\s\.|\.\s/.test(s)) {
    issues.add('space-around-dot')
    s = s.replace(/\s*\.\s*/g, '.')
  }
  const segments = s.split('.').map((seg, i) => {
    if (i === 0 && /^[IVXІіХхⅠⅤ]+$/.test(seg)) {
      const fixed = [...seg].map((ch) => CYR_TO_LATIN_ROMAN[ch] ?? ch).join('')
      if (fixed !== seg) issues.add('mixed-script')
      return fixed
    }
    const latinLetters = seg.match(/[A-Za-z]/g) ?? []
    const onlyLookalikes = latinLetters.every((ch) => ch in LATIN_TO_CYR)
    if (latinLetters.length && onlyLookalikes && (hasCyr(seg) || i > 0 || /\d/.test(seg))) {
      const fixed = [...seg].map((ch) => LATIN_TO_CYR[ch] ?? ch).join('')
      if (fixed !== seg) issues.add('mixed-script')
      return fixed
    }
    return seg
  })
  const key = segments.join('.')
  if (/\s/.test(key)) issues.add('inner-space')
  if (/[А-Яа-яЁё]\d/.test(key) && /^(I|II|III|IV|V)?\.?К\d/.test(key)) {
    // «ОППТОиР4970» — номер прилеплен к подразделению без точки
    const parts = key.split('.')
    if (parts.some((p, i) => i > 2 && /^[А-Яа-яЁё]{2,}\d{3,}$/.test(p))) issues.add('missing-dot')
  }
  const fuzzyKey = key
    .toUpperCase()
    .replace(/[^0-9A-ZА-ЯЁ]/g, '')
  return { key, fuzzyKey, issues: [...issues] }
}

export const DESIGNATION_ISSUE_TEXT: Record<DesignationIssue, string> = {
  'mixed-script': 'в обозначении смешаны латинские и кириллические буквы',
  'space-around-dot': 'пробел рядом с точкой-разделителем',
  'inner-space': 'пробел внутри обозначения вместо точки',
  'missing-dot': 'пропущена точка между частями обозначения'
}

/** Нестрогий поиск обозначений УММ в тексте (ловит и ошибочно оформленные). */
const LOOSE_UMM_RE =
  /(?:(?<![A-Za-zА-Яа-яЁё])[IVXІ]{1,4}\s*\.\s*)?(?<![A-Za-zА-Яа-яЁё])[КK]\s*\d+\s*\.\s*[ТT]\s*\d+\s*\.\s*[A-Za-zА-Яа-яЁё]{1,6}\s*\.\s*[A-Za-zА-Яа-яЁё]{2,12}\s*[.\s]?\s*\d{1,6}\s*[.\s]\s*\d{4}(?!\d)/g

export function findUmmDesignations(text: string): { raw: string; index: number }[] {
  const out: { raw: string; index: number }[] = []
  let m: RegExpExecArray | null
  LOOSE_UMM_RE.lastIndex = 0
  while ((m = LOOSE_UMM_RE.exec(text))) out.push({ raw: m[0].trim(), index: m.index })
  return out
}

/** Вид УММ (УМСИ, ПАЗ, ППЗ …) из нормализованного обозначения. */
export function ummTypeOf(key: string): string | null {
  const parts = key.split('.')
  const startsWithLevel = /^(I|II|III|IV|V)$/.test(parts[0])
  const idx = startsWithLevel ? 3 : 2
  return parts[idx] ?? null
}

/** Редакция / номер изменения, указанные рядом со ссылкой: «изм. 2», «ред. 3», «зам 8». */
export function parseRevision(text: string): string | null {
  const m = text.match(/(?:изм(?:енение)?|ред(?:акция)?|«?зам»?)\s*\.?\s*№?\s*(\d+)/i)
  return m ? String(Number(m[1])) : null
}

export function normalizeRevision(raw: string | null | undefined): string | null {
  if (raw == null) return null
  const s = String(raw).trim()
  if (!s) return null
  const parsed = parseRevision(s)
  if (parsed) return parsed
  if (/^\d+$/.test(s)) return String(Number(s))
  return s
}

/** Шифр первоисточника в начале строки: ИОТ.27.26, П.00.10, СТО 1.1.1.01.004.0441-2025, № 170-ФЗ … */
export function findPrimaryCode(text: string): string | null {
  const t = text.trim()
  const m =
    t.match(/^(СТО\s+[\d.]+-\d{4})/) ||
    t.match(/^(№\s*\d+-ФЗ)/) ||
    t.match(/^([А-ЯЁA-Z]{1,6}(?:\.[А-ЯЁA-Z]{1,6})?(?:\.[0-9А-ЯЁA-Z]+){1,4})/) ||
    t.match(/^(РД\s+[\d.-]+)/)
  return m ? m[1].replace(/\s+/g, ' ') : null
}

export function similarity(a: string, b: string): number {
  const tok = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[«»"“”().,;:–—-]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 2)
    )
  const A = tok(a)
  const B = tok(b)
  if (!A.size || !B.size) return 0
  let inter = 0
  for (const w of A) if (B.has(w)) inter++
  return inter / (A.size + B.size - inter)
}

/**
 * Тема и выпуск УММ: всё до номера (уровень, курс, тема, вид, подразделение) и пара «номер, год».
 * Новая редакция УММ выпускается под новым номером (ответ специалиста УТП, 10.11.2026).
 */
export function editionOf(key: string): { theme: string; number: number; year: number } | null {
  const parts = key.split('.')
  if (parts.length < 6 || !/^К\d+$/.test(parts[parts.length - 6] ?? '') && !/^К\d+$/.test(parts[parts.length - 5] ?? '')) return null
  const num = parts[parts.length - 2]
  const year = parts[parts.length - 1]
  if (!/^\d+$/.test(num) || !/^\d{4}$/.test(year)) return null
  return { theme: parts.slice(0, -2).join('.'), number: Number(num), year: Number(year) }
}
