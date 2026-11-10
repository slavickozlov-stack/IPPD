export type Theme = 'light' | 'dark' | 'system'

const KEY = 'ippd-theme'

export const THEME_LABEL: Record<Theme, string> = { light: 'Светлая', dark: 'Тёмная', system: 'Как в системе' }

/** Сохранённый выбор; по умолчанию — светлая тема. Хранилище может быть недоступно — тогда тоже светлая. */
export function savedTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    /* хранилище недоступно */
  }
  return 'light'
}

export function applyTheme(t: Theme): void {
  document.documentElement.dataset.theme = t
  try {
    localStorage.setItem(KEY, t)
  } catch {
    /* выбор просто не запомнится */
  }
}
