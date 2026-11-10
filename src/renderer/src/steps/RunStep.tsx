import { formatRu } from '../../../core/dates'
import type { StepProps } from '../App'

export function RunStep({ s, patch, call, busy, setStep }: StepProps) {
  const profile = s.profiles.find((p) => p.id === s.profileId)
  const b = s.bundle!
  const notConfigured = profile?.coverage.filter((c) => !c.configured) ?? []
  const warnings: string[] = []
  if (!s.confirmed) warnings.push('Извлечённые данные не отмечены как сверенные — итог будет «Проверка неполная».')
  if (b.ippd && !b.ippd.parse.complete) warnings.push('Разбор ИППД неполный — итог будет «Проверка неполная».')
  if (b.fileIssues.length) warnings.push(`Есть файлы с ошибками чтения: ${b.fileIssues.length}.`)
  if (notConfigured.length) warnings.push(`В профиле не настроено проверок: ${notConfigured.length}. Итог «замечаний нет» недоступен, спорные случаи уйдут на уточнение.`)

  async function run() {
    const report = await call('Проверка', () => window.ippd.runCheck({ checkDate: s.checkDate, profileId: s.profileId, confirmed: s.confirmed, edits: s.edits }))
    if (report) {
      patch({ report })
      setStep(3)
    }
  }

  return (
    <section>
      <h1>3. Запуск проверки</h1>
      <div className="card">
        <dl className="kv">
          <dt>Дата проверки</dt>
          <dd>
            <input type="date" value={s.checkDate} onChange={(e) => patch({ checkDate: e.target.value, report: null })} /> ({formatRu(s.checkDate)})
          </dd>
          <dt>Профиль</dt>
          <dd>
            {profile ? `${profile.name}, версия ${profile.version} (${profile.mode === 'demo' ? 'демонстрационный' : 'рабочий'})` : '—'}
            {profile?.mode === 'demo' && <span className="badge-demo inline-badge">ДЕМО</span>}
          </dd>
          <dt>Файлы</dt>
          <dd>
            ИППД: {b.files.filter((f) => f.role === 'ippd').length}, УММ: {b.files.filter((f) => f.role === 'umm').length}, реестр: {b.files.filter((f) => f.role === 'registry').length}
          </dd>
          <dt>Ручные правки</dt>
          <dd>{s.edits.length}</dd>
        </dl>
        {warnings.length > 0 && (
          <div className="alert warn">
            <ul>
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <div className="card">
        <h2>Что будет проверено</h2>
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Проверка</th>
                <th>Состояние</th>
                <th>Основание</th>
              </tr>
            </thead>
            <tbody>
              {profile?.coverage.map((c) => (
                <tr key={c.category}>
                  <td>{c.label}</td>
                  <td>{c.configured ? <span className="chip o-pass">настроено</span> : <span className="chip o-manual">не настроено</span>}</td>
                  <td className="small">{c.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="actions">
        <button className="secondary" onClick={() => setStep(1)}>
          ← К сверке
        </button>
        <button className="primary" onClick={run} disabled={!!busy || !s.checkDate}>
          Запустить проверку
        </button>
      </div>
    </section>
  )
}
