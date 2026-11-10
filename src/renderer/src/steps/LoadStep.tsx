import { useState } from 'react'
import type { FileRole } from '../../../core/model'
import type { StepProps } from '../App'

const ROLE: Record<FileRole, { title: string; hint: string; button: string }> = {
  ippd: { title: 'ИППД', hint: 'Один файл DOCX. Поддержана форма приложения В П.00.10 (Ростовская АЭС).', button: 'Выбрать ИППД' },
  umm: { title: 'УММ', hint: 'DOCX или PDF, можно целой папкой. Из PDF АСУТД читаются текст и штамп статуса; у сканов — только штамп, остальное вводится вручную.', button: 'Добавить УММ' },
  registry: { title: 'Реестр УММ (необязательно)', hint: 'XLSX или CSV, первая строка с заголовками («Обозначение», «Статус», даты).', button: 'Выбрать реестр' }
}

const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} МБ` : `${Math.max(1, Math.round(n / 1024))} КБ`)

export function LoadStep({ s, patch, call, busy, setStep }: StepProps) {
  const [folderNote, setFolderNote] = useState<string | null>(null)
  const profile = s.profiles.find((p) => p.id === s.profileId)
  const reset = { bundle: null, edits: [], confirmed: false, report: null }

  async function pick(role: FileRole) {
    const files = await call('Выбор файлов', () => window.ippd.pickFiles(role))
    if (files) patch({ files, ...reset })
  }
  async function pickFolder() {
    const v = await call('Поиск УММ в папке', () => window.ippd.pickFolder())
    if (v) {
      patch({ files: v.files, ...reset })
      setFolderNote(v.limited ? `Добавлено ${v.added}; достигнут предел — не более 500 файлов за раз.` : `Добавлено файлов из папки: ${v.added}.`)
    }
  }
  async function remove(id: string) {
    const files = await call('Удаление', () => window.ippd.removeFile(id))
    if (files) patch({ files, ...reset })
  }
  async function demo() {
    const v = await call('Загрузка демонстрационного комплекта', () => window.ippd.loadDemo())
    if (v) patch({ files: v.files, checkDate: v.checkDate, profileId: v.profileId, ...reset })
  }
  async function importProfile() {
    const v = await call('Импорт профиля', () => window.ippd.importProfile())
    if (v) patch({ profiles: v.profiles, profileErrors: v.errors })
  }
  async function next() {
    const bundle = await call('Извлечение данных из документов', () => window.ippd.extract())
    if (bundle) {
      patch({ bundle, edits: [], confirmed: false, report: null })
      setStep(1)
    }
  }

  const ippd = s.files.filter((f) => f.role === 'ippd')
  return (
    <section>
      <h1>1. Загрузка файлов</h1>
      <p className="lead">Загрузите ИППД и комплект УММ, на которые она ссылается. Исходные файлы открываются только для чтения.</p>
      <div className="demo-box">
        <div>
          <b>Демонстрационный комплект.</b> Синтетические ИППД, УММ, реестр и «скан» PDF с предсказуемым результатом (профиль «ДЕМО», дата 01.12.2026).
        </div>
        <button onClick={demo} disabled={!!busy}>
          Загрузить демо-комплект
        </button>
      </div>
      <div className="cards">
        {(Object.keys(ROLE) as FileRole[]).map((role) => {
          const list = s.files.filter((f) => f.role === role)
          return (
            <div className="card" key={role}>
              <div className="card-head">
                <h2>{ROLE[role].title}</h2>
                <div className="row-gap">
                  {role === 'umm' && (
                    <button className="secondary" onClick={pickFolder} disabled={!!busy}>
                      Папка…
                    </button>
                  )}
                  <button onClick={() => pick(role)} disabled={!!busy}>
                    {ROLE[role].button}
                  </button>
                </div>
              </div>
              {role === 'umm' && folderNote && <p className="small">{folderNote}</p>}
              <p className="muted small">{ROLE[role].hint}</p>
              {list.length ? (
                <ul className="files">
                  {list.map((f) => (
                    <li key={f.id}>
                      <span className="fname" title={f.name}>
                        {f.name}
                      </span>
                      <span className="muted small">{kb(f.size)}</span>
                      <button className="link" onClick={() => remove(f.id)} aria-label={`Убрать ${f.name}`}>
                        убрать
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted small">Файлы не выбраны.</p>
              )}
            </div>
          )
        })}
      </div>
      <div className="card">
        <div className="form-row">
          <label>
            Дата проверки
            <input type="date" value={s.checkDate} onChange={(e) => patch({ checkDate: e.target.value, report: null })} required />
          </label>
          <label className="grow">
            Профиль правил
            <select value={s.profileId} onChange={(e) => patch({ profileId: e.target.value, report: null })}>
              {s.profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.mode === 'demo' ? '[ДЕМО] ' : ''}
                  {p.name} — v{p.version}
                </option>
              ))}
            </select>
          </label>
          <button className="secondary" onClick={importProfile} disabled={!!busy}>
            Импорт профиля…
          </button>
        </div>
        {profile && (
          <p className="muted small">
            {profile.description} Правил: {profile.ruleCount}, применяются автоматически: {profile.appliedRuleCount}.
          </p>
        )}
        {profile?.mode === 'demo' && <div className="badge-demo">Демонстрационный профиль — только для синтетических данных</div>}
        {s.profileErrors.map((e) => (
          <div key={e} className="alert error small">
            {e}
          </div>
        ))}
      </div>
      <div className="actions">
        <span className="muted">{ippd.length ? '' : 'Выберите ИППД, чтобы продолжить.'}</span>
        <button className="primary" disabled={!ippd.length || !s.checkDate || !s.profileId || !!busy} onClick={next}>
          Извлечь данные →
        </button>
      </div>
    </section>
  )
}
