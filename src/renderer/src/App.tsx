import { useEffect, useState } from 'react'
import type { CheckReport } from '../../core/model'
import type { ManualEdit } from '../../core/pipeline'
import { todayLocalIso } from '../../core/dates'
import type { ClientBundle, FileEntry, ProfileSummary } from '../../shared/api'
import { LoadStep } from './steps/LoadStep'
import { ReviewStep } from './steps/ReviewStep'
import { RunStep } from './steps/RunStep'
import { ReportStep } from './steps/ReportStep'

const STEPS = ['Загрузка файлов', 'Сверка извлечённых данных', 'Запуск проверки', 'Отчёт']

export interface AppState {
  files: FileEntry[]
  checkDate: string
  profileId: string
  profiles: ProfileSummary[]
  profileErrors: string[]
  bundle: ClientBundle | null
  edits: ManualEdit[]
  confirmed: boolean
  report: CheckReport | null
}

export function App() {
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [s, setS] = useState<AppState>({
    files: [],
    checkDate: todayLocalIso(),
    profileId: '',
    profiles: [],
    profileErrors: [],
    bundle: null,
    edits: [],
    confirmed: false,
    report: null
  })
  const patch = (p: Partial<AppState>) => setS((prev) => ({ ...prev, ...p }))

  async function call<T>(label: string, fn: () => Promise<{ ok: true; value: T } | { ok: false; error: string }>): Promise<T | null> {
    setBusy(label)
    setError(null)
    try {
      const r = await fn()
      if (!r.ok) {
        setError(r.error)
        return null
      }
      return r.value
    } finally {
      setBusy(null)
    }
  }

  useEffect(() => {
    call('Загрузка профилей', () => window.ippd.listProfiles()).then((v) => {
      if (!v) return
      const work = v.profiles.find((p) => p.mode === 'work') ?? v.profiles[0]
      patch({ profiles: v.profiles, profileErrors: v.errors, profileId: work?.id ?? '' })
    })
  }, [])

  const ctx = { s, patch, call, busy, setStep }
  const canGo = (i: number) => i === 0 || (i === 1 && !!s.bundle) || (i === 2 && !!s.bundle) || (i === 3 && !!s.report)

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="logo" aria-hidden>
            ИК
          </span>
          <div>
            <div className="title">ИППД Контроль</div>
            <div className="subtitle">Актуальность УММ и нормоконтроль индивидуальной программы подготовки</div>
          </div>
        </div>
        <nav className="steps" aria-label="Шаги">
          {STEPS.map((name, i) => (
            <button key={name} className={`step ${i === step ? 'active' : ''} ${i < step ? 'done' : ''}`} disabled={!canGo(i) || !!busy} onClick={() => setStep(i)}>
              <span className="num">{i + 1}</span>
              {name}
            </button>
          ))}
        </nav>
      </header>
      {error && (
        <div className="alert error" role="alert">
          <b>Ошибка:</b> {error}
          <button className="link" onClick={() => setError(null)}>
            скрыть
          </button>
        </div>
      )}
      {busy && <div className="alert info">{busy}…</div>}
      <main className="content">
        {step === 0 && <LoadStep {...ctx} />}
        {step === 1 && <ReviewStep {...ctx} />}
        {step === 2 && <RunStep {...ctx} />}
        {step === 3 && <ReportStep {...ctx} />}
      </main>
      <footer className="foot">Документы обрабатываются локально, без сетевых запросов. Результат передаётся специалисту для рассмотрения.</footer>
    </div>
  )
}

export type StepProps = {
  s: AppState
  patch: (p: Partial<AppState>) => void
  call: <T>(label: string, fn: () => Promise<{ ok: true; value: T } | { ok: false; error: string }>) => Promise<T | null>
  busy: string | null
  setStep: (i: number) => void
}
