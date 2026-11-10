import { useState } from 'react'
import type { ActualityStatus, RuleOutcome } from '../../../core/model'
import { formatRu } from '../../../core/dates'
import { APPROVAL_LABEL, KIND_LABEL, OUTCOME_LABEL, SEVERITY_LABEL, STATUS_LABEL, STATUS_ORDER, VERDICT_LABEL, formatLocation } from '../../../core/labels'
import type { StepProps } from '../App'

const OUTCOMES: RuleOutcome[] = ['fail', 'manual', 'pass', 'na']

export function ReportStep({ s, call, busy, setStep, patch }: StepProps) {
  const r = s.report!
  const [tab, setTab] = useState<'umm' | 'nc' | 'meta'>('umm')
  const [statuses, setStatuses] = useState<Set<ActualityStatus>>(new Set(STATUS_ORDER))
  const [outcomes, setOutcomes] = useState<Set<RuleOutcome>>(new Set(OUTCOMES))
  const [saved, setSaved] = useState<string | null>(null)
  const [rechecked, setRechecked] = useState<number | null>(null)
  const toggle = <T,>(set: Set<T>, v: T, apply: (s: Set<T>) => void) => {
    const n = new Set(set)
    if (n.has(v)) n.delete(v)
    else n.add(v)
    apply(n)
  }
  async function addUmmAndRecheck() {
    const before = s.files.length
    const files = await call('Выбор новых УММ', () => window.ippd.pickFiles('umm'))
    if (!files || files.length === before) return
    const bundle = await call('Извлечение данных из новых УММ', () => window.ippd.extract())
    if (!bundle) return
    // Реквизиты новых файлов ещё не сверены — итог останется «неполным», пока специалист их не подтвердит.
    const report = await call('Перепроверка', () => window.ippd.runCheck({ checkDate: s.checkDate, profileId: s.profileId, confirmed: false, edits: s.edits }))
    if (report) {
      patch({ files, bundle, confirmed: false, report })
      setRechecked(files.length - before)
      setSaved(null)
    }
  }
  async function exportHtml() {
    const path = await call('Экспорт отчёта', () => window.ippd.exportReport())
    if (path) setSaved(path)
  }
  const act = r.actuality.filter((a) => statuses.has(a.status))
  const nc = r.normcontrol.filter((x) => outcomes.has(x.outcome))

  return (
    <section>
      <div className="card-head">
        <h1>4. Отчёт</h1>
        <div className="row-gap">
          <button className="secondary" onClick={() => { patch({ report: null }); setStep(2) }}>
            Повторить проверку
          </button>
          <button className="secondary" onClick={addUmmAndRecheck} disabled={!!busy}>
            Добавить УММ и перепроверить…
          </button>
          <button className="primary" onClick={exportHtml} disabled={!!busy}>
            Экспорт HTML…
          </button>
        </div>
      </div>
      {saved && <div className="alert ok">Отчёт сохранён: {saved}</div>}
      {rechecked != null && (
        <div className="alert warn">
          Добавлено УММ: {rechecked}. Ссылки пересмотрены сразу с учётом новых материалов. Реквизиты новых файлов не сверены —{' '}
          <button className="link" onClick={() => setStep(1)}>
            открыть сверку
          </button>
          .
        </div>
      )}
      {r.profile.mode === 'demo' && <div className="badge-demo">Демонстрационный профиль: правила и данные синтетические, не являются требованиями предприятия.</div>}
      <div className="card">
        <dl className="kv">
          <dt>ИППД</dt>
          <dd>
            {r.ippd?.fileName ?? '—'} {r.ippd?.registrationNumber ? `(${r.ippd.registrationNumber})` : ''}
          </dd>
          <dt>Дата проверки</dt>
          <dd>{formatRu(r.checkDate)}</dd>
          <dt>Профиль</dt>
          <dd>
            {r.profile.name} · версия {r.profile.version} · <code>{r.profile.sha256.slice(0, 12)}…</code>
          </dd>
          <dt>Файлы</dt>
          <dd>{r.files.map((f) => f.name).join('; ')}</dd>
        </dl>
        <div className={`verdict ${r.verdict}`}>
          <div className="verdict-title">{VERDICT_LABEL[r.verdict]}</div>
          <ul>
            {r.verdictReasons.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
          <div className="muted small">Результат передаётся специалисту для рассмотрения.</div>
        </div>
        <div className="grid-tiles">
          <div className="tile">
            <b>{r.counts.referencesFound}</b> ссылок найдено
          </div>
          <div className="tile">
            <b>{r.counts.ummReferences}</b> ссылок на УММ
          </div>
          <div className="tile">
            <b>{r.counts.matched}</b> сопоставлено
          </div>
          <div className="tile warn">
            <b>{r.counts.needsClarification}</b> требуют уточнения
          </div>
          <div className="tile bad">
            <b>{r.counts.notFound}</b> не найдены
          </div>
        </div>
      </div>

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'umm'} className={tab === 'umm' ? 'active' : ''} onClick={() => setTab('umm')}>
          Актуальность УММ ({r.actuality.length})
        </button>
        <button role="tab" aria-selected={tab === 'nc'} className={tab === 'nc' ? 'active' : ''} onClick={() => setTab('nc')}>
          Нормоконтроль ({r.normcontrol.filter((x) => x.outcome === 'fail').length} нарушений)
        </button>
        <button role="tab" aria-selected={tab === 'meta'} className={tab === 'meta' ? 'active' : ''} onClick={() => setTab('meta')}>
          Файлы и профиль
        </button>
      </div>

      {tab === 'umm' && (
        <div className="card">
          <div className="filters">
            {STATUS_ORDER.map((st) => {
              const n = r.actuality.filter((a) => a.status === st).length
              if (!n) return null
              return (
                <label key={st} className={`chip-filter s-${st}`}>
                  <input type="checkbox" checked={statuses.has(st)} onChange={() => toggle(statuses, st, setStatuses)} /> {STATUS_LABEL[st]} ({n})
                </label>
              )
            })}
          </div>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Статус</th>
                  <th>Тема</th>
                  <th>Ссылка</th>
                  <th>Место в ИППД</th>
                  <th>Основание</th>
                  <th>Что сделать</th>
                </tr>
              </thead>
              <tbody>
                {act.map((a) => (
                  <tr key={a.referenceId}>
                    <td>
                      <span className={`chip s-${a.status}`}>{STATUS_LABEL[a.status]}</span>
                    </td>
                    <td>
                      <b>{a.reference.topicNumber}</b> {a.reference.topicTitle.slice(0, 90)}
                      <div className="muted small">
                        {a.reference.form} · {KIND_LABEL[a.reference.kind]}
                      </div>
                    </td>
                    <td>
                      <code>{a.reference.designationRaw ?? a.reference.cellRaw}</code>
                      {a.reference.revision && <div className="small">изм. {a.reference.revision}</div>}
                    </td>
                    <td className="small">{formatLocation(a.reference.location)}</td>
                    <td className="small">
                      {a.basis}
                      {a.replacement && (
                        <div>
                          <b>Замена:</b> {a.replacement.designation}
                          {a.replacement.revision ? ` изм. ${a.replacement.revision}` : ''} — {a.replacement.statusOnDate ? STATUS_LABEL[a.replacement.statusOnDate] : 'статус не установлен'}
                        </div>
                      )}
                      <details>
                        <summary>проверки ({a.checks.length})</summary>
                        <ul className="checks">
                          {a.checks.map((c, i) => (
                            <li key={i} className={`c-${c.outcome}`}>
                              <b>{c.label}:</b> {c.basis}
                            </li>
                          ))}
                        </ul>
                        {a.candidates.length > 0 && (
                          <div>
                            Кандидаты:{' '}
                            {a.candidates.map((c) => `${c.designation}${c.revision ? ` изм. ${c.revision}` : ''} — ${c.reason}`).join('; ')}
                          </div>
                        )}
                      </details>
                    </td>
                    <td className="small">{a.action}</td>
                  </tr>
                ))}
                {!act.length && (
                  <tr>
                    <td colSpan={6} className="muted">
                      Нет строк для выбранных статусов.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'nc' && (
        <div className="card">
          <div className="filters">
            {OUTCOMES.map((o) => {
              const n = r.normcontrol.filter((x) => x.outcome === o).length
              if (!n) return null
              return (
                <label key={o} className={`chip-filter o-${o}`}>
                  <input type="checkbox" checked={outcomes.has(o)} onChange={() => toggle(outcomes, o, setOutcomes)} /> {OUTCOME_LABEL[o]} ({n})
                </label>
              )
            })}
          </div>
          {nc.map((rule) => (
            <div key={rule.ruleId} className={`rule o-border-${rule.outcome}`}>
              <div className="rule-head">
                <span className={`chip o-${rule.outcome}`}>{OUTCOME_LABEL[rule.outcome]}</span>
                <b>{rule.ruleId}</b> {rule.title}
                <span className="muted small">
                  {' '}
                  · {SEVERITY_LABEL[rule.severity]} · {APPROVAL_LABEL[rule.approval]}
                </span>
              </div>
              {rule.note && <div className="muted small">{rule.note}</div>}
              {rule.findings.filter((f) => f.outcome !== 'pass').length > 0 && (
                <ol className="findings">
                  {rule.findings
                    .filter((f) => f.outcome !== 'pass')
                    .map((f, i) => (
                      <li key={i}>
                        <div>
                          <b>Место:</b> {formatLocation(f.location)}
                        </div>
                        {f.actual && (
                          <div>
                            <b>Фактически:</b> {f.actual}
                          </div>
                        )}
                        <div>
                          <b>Требуется:</b> {f.expected}
                        </div>
                        <div>
                          <b>Основание:</b> {f.source}
                        </div>
                        <div>
                          <b>Что сделать:</b> {f.action}
                        </div>
                      </li>
                    ))}
                </ol>
              )}
              {rule.outcome === 'pass' && <div className="small muted">Нарушений не выявлено. Основание: {rule.findings[0]?.source ?? '—'}</div>}
            </div>
          ))}
          {!nc.length && <p className="muted">Нет правил для выбранных итогов.</p>}
        </div>
      )}

      {tab === 'meta' && (
        <div className="card">
          <h2>Состав файлов</h2>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Роль</th>
                  <th>Файл</th>
                  <th>Формат</th>
                  <th>SHA-256</th>
                  <th>Состояние</th>
                </tr>
              </thead>
              <tbody>
                {r.files.map((f) => (
                  <tr key={f.id}>
                    <td>{f.role === 'ippd' ? 'ИППД' : f.role === 'umm' ? 'УММ' : 'реестр'}</td>
                    <td>{f.name}</td>
                    <td>{f.format.toUpperCase()}</td>
                    <td>
                      <code>{f.sha256.slice(0, 16)}…</code>
                    </td>
                    <td className="small">{f.error ? `ошибка: ${f.error}` : f.manualReason ?? 'прочитан'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h2>Настройка профиля</h2>
          <div className="tablewrap">
            <table>
              <tbody>
                {r.coverage.map((c) => (
                  <tr key={c.category}>
                    <td>{c.label}</td>
                    <td>{c.configured ? <span className="chip o-pass">настроено</span> : <span className="chip o-manual">не настроено</span>}</td>
                    <td className="small">{c.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {r.manualEdits.length > 0 && (
            <>
              <h2>Ручные правки</h2>
              <ul>
                {r.manualEdits.map((e, i) => (
                  <li key={i}>
                    {e.target}, поле «{e.field}»: {e.from ?? '—'} → {e.to ?? '—'} ({e.note})
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  )
}
