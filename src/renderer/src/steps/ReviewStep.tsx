import { useMemo, useState } from 'react'
import type { Field, UmmRecord, UmmReference } from '../../../core/model'
import type { ManualEdit, UmmEditableField } from '../../../core/pipeline'
import { formatRu } from '../../../core/dates'
import { DESIGNATION_ISSUE_TEXT } from '../../../core/designation'
import { KIND_LABEL, formatLocation } from '../../../core/labels'
import type { StepProps } from '../App'

const LIFECYCLE: Record<string, string> = { active: 'действующий', replaced: 'заменён', cancelled: 'отменён', draft: 'проект', other: 'иной' }

const UMM_FIELDS: { key: UmmEditableField; label: string; date?: boolean }[] = [
  { key: 'designation', label: 'Обозначение' },
  { key: 'revision', label: 'Изменение' },
  { key: 'title', label: 'Наименование' },
  { key: 'status', label: 'Статус' },
  { key: 'statusAsOf', label: 'Статус на дату', date: true },
  { key: 'validFrom', label: 'Введён в действие', date: true },
  { key: 'validTo', label: 'Окончание действия', date: true },
  { key: 'reviewDue', label: 'Срок пересмотра', date: true },
  { key: 'approvedAt', label: 'Дата утверждения', date: true },
  { key: 'replacedBy', label: 'Заменён на' }
]

function display(f: Field<unknown>, key: string): string {
  if (f.value == null) return f.raw ? `«${f.raw}» (не распознано)` : '—'
  if (key === 'status') return `${LIFECYCLE[f.value as string] ?? f.value}${f.raw && f.raw.toLowerCase() !== LIFECYCLE[f.value as string] ? ` («${f.raw}»)` : ''}`
  if (key === 'replacedBy') {
    const v = f.value as { designation: string; revision?: string | null }
    return `${v.designation}${v.revision ? ` изм. ${v.revision}` : ''}`
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(f.value))) return formatRu(String(f.value))
  return String(f.value)
}

function provenance(f: Field<unknown>): string {
  if (!f.source) return 'нет в источнике'
  const how = { extracted: 'извлечено', registry: 'из реестра', manual: 'ручной ввод', derived: 'выведено' }[f.source.method]
  return `${how}: ${formatLocation(f.source.location)}${f.source.note ? ` — ${f.source.note}` : ''}`
}

const FORM_LABEL: Record<string, string> = {
  docx: 'DOCX',
  'pdf-text': 'PDF с текстом',
  'pdf-stamp': 'скан, только штамп АСУТД',
  'pdf-scan': 'скан без текста',
  filename: 'только имя файла',
  registry: 'реестр'
}

const editKey = (e: Pick<ManualEdit, 'target' | 'id' | 'field'>) => `${e.target}:${e.id}:${e.field}`

function UmmEditor({ rec, edits, onSave, onClose }: { rec: UmmRecord; edits: ManualEdit[]; onSave: (e: ManualEdit[]) => void; onClose: () => void }) {
  const current = (k: string) => edits.find((e) => editKey(e) === `umm:${rec.id}:${k}`)
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(UMM_FIELDS.map((f) => [f.key, current(f.key)?.value ?? (rec[f.key].value == null ? '' : display(rec[f.key] as Field<unknown>, f.key).replace(/ \(«.*»\)$/, ''))]))
  )
  const [note, setNote] = useState(edits.find((e) => e.target === 'umm' && e.id === rec.id)?.note ?? '')
  const changed = UMM_FIELDS.filter((f) => {
    const orig = rec[f.key].value == null ? '' : display(rec[f.key] as Field<unknown>, f.key).replace(/ \(«.*»\)$/, '')
    return (values[f.key] ?? '') !== orig || !!current(f.key)
  })
  return (
    <div className="editor" role="dialog" aria-label="Правка реквизитов УММ">
      <h3>Реквизиты: {rec.fileName}</h3>
      <div className="editor-grid">
        {UMM_FIELDS.map((f) => (
          <label key={f.key}>
            {f.label}
            {f.key === 'status' ? (
              <select value={values.status} onChange={(e) => setValues({ ...values, status: e.target.value })}>
                <option value="">— неизвестно —</option>
                {Object.values(LIFECYCLE).map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            ) : (
              <input value={values[f.key]} placeholder={f.date ? 'ДД.ММ.ГГГГ' : ''} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />
            )}
            <span className="muted tiny">{provenance(rec[f.key] as Field<unknown>)}</span>
          </label>
        ))}
      </div>
      <label>
        Обоснование правки (обязательно): откуда взято значение
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="например: реестр АСУТД на 01.12.2026, карточка № …" />
      </label>
      <div className="actions">
        <button className="secondary" onClick={onClose}>
          Отмена
        </button>
        <button
          className="primary"
          disabled={!note.trim() || !changed.length}
          onClick={() => onSave(changed.map((f) => ({ target: 'umm', id: rec.id, field: f.key, value: values[f.key] ?? '', note: note.trim() })))}
        >
          Сохранить ({changed.length})
        </button>
      </div>
    </div>
  )
}

function RefEditor({ r, onSave, onClose }: { r: UmmReference; onSave: (e: ManualEdit[]) => void; onClose: () => void }) {
  const [designation, setDesignation] = useState(r.designationRaw ?? '')
  const [revision, setRevision] = useState(r.revision ?? '')
  const [note, setNote] = useState('')
  const edits: ManualEdit[] = []
  if (designation !== (r.designationRaw ?? '')) edits.push({ target: 'ref', id: r.id, field: 'designation', value: designation, note })
  if (revision !== (r.revision ?? '')) edits.push({ target: 'ref', id: r.id, field: 'revision', value: revision, note })
  return (
    <div className="editor" role="dialog" aria-label="Правка ссылки">
      <h3>
        Ссылка в теме {r.topicNumber}: «{r.cellRaw}»
      </h3>
      <div className="editor-grid">
        <label>
          Обозначение УММ
          <input value={designation} onChange={(e) => setDesignation(e.target.value)} />
        </label>
        <label>
          Изменение (если указано в ссылке)
          <input value={revision} onChange={(e) => setRevision(e.target.value)} />
        </label>
      </div>
      <label>
        Обоснование правки (обязательно)
        <input value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="actions">
        <button className="secondary" onClick={onClose}>
          Отмена
        </button>
        <button className="primary" disabled={!note.trim() || !edits.length} onClick={() => onSave(edits.map((e) => ({ ...e, note: note.trim() })))}>
          Сохранить
        </button>
      </div>
    </div>
  )
}

export function ReviewStep({ s, patch, setStep }: StepProps) {
  const b = s.bundle!
  const [editing, setEditing] = useState<{ kind: 'umm' | 'ref'; id: string } | null>(null)
  const [showAll, setShowAll] = useState(false)
  const ippd = b.ippd
  const refs = ippd?.references ?? []
  const shown = showAll ? refs : refs.filter((r) => r.kind === 'umm' || r.kind === 'unrecognized' || r.kind === 'empty' || r.issues.length)
  const edited = useMemo(() => new Set(s.edits.map((e) => `${e.target}:${e.id}`)), [s.edits])
  const saveEdits = (list: ManualEdit[]) => {
    const keys = new Set(list.map(editKey))
    patch({ edits: [...s.edits.filter((e) => !keys.has(editKey(e))), ...list], confirmed: false, report: null })
    setEditing(null)
  }
  const counts = {
    all: refs.filter((r) => r.kind !== 'empty').length,
    umm: refs.filter((r) => r.kind === 'umm').length,
    primary: refs.filter((r) => r.kind === 'primary-source').length,
    electronic: refs.filter((r) => r.kind === 'electronic').length,
    empty: refs.filter((r) => r.kind === 'empty').length,
    unrecognized: refs.filter((r) => r.kind === 'unrecognized').length
  }

  return (
    <section>
      <h1>2. Сверка извлечённых данных</h1>
      <p className="lead">Проверьте, что ссылки и реквизиты извлечены верно. Исправления сохраняются как ручной ввод с обоснованием и попадают в отчёт.</p>

      {b.fileIssues.length > 0 && (
        <div className="alert error">
          <b>Проблемы с файлами:</b>
          <ul>
            {b.fileIssues.map((i, n) => (
              <li key={n}>
                «{i.fileName}»: {i.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card">
        <h2>ИППД: {ippd?.fileName ?? 'не загружена'}</h2>
        {ippd && (
          <>
            <dl className="kv">
              <dt>Шаблон</dt>
              <dd>{ippd.parse.templateName ?? <b className="bad">не распознан — требуется ручной разбор</b>}</dd>
              <dt>Регистрационный номер</dt>
              <dd title={provenance(ippd.registrationNumber as Field<unknown>)}>{ippd.registrationNumber.value ?? '—'}</dd>
              <dt>Работник</dt>
              <dd>{ippd.traineeName.value ?? '—'}</dd>
              <dt>Должность</dt>
              <dd>{ippd.position.value ?? '—'}</dd>
              <dt>Таблицы</dt>
              <dd>
                план-график: {ippd.parse.tablesFound.schedule.join(', ') || 'нет'}; теоретическая: {ippd.parse.tablesFound.theory.join(', ') || 'нет'}; практическая:{' '}
                {ippd.parse.tablesFound.practice.join(', ') || 'нет'}; стажировка: {ippd.parse.tablesFound.internship.join(', ') || 'нет'}; библиография:{' '}
                {ippd.parse.bibliographyFound ? `${ippd.bibliography.length} записей` : 'нет'}
              </dd>
            </dl>
            <div className={`alert ${ippd.parse.complete ? 'ok' : 'warn'}`}>
              {ippd.parse.complete ? (
                'Разбор полный: все обязательные таблицы найдены, строки тем прочитаны.'
              ) : (
                <>
                  <b>Проверка неполная.</b>
                  <ul>
                    {ippd.parse.incompleteReasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </>
        )}
        <div className="grid-tiles">
          <div className="tile">
            <b>{counts.all}</b> ссылок найдено
          </div>
          <div className="tile">
            <b>{counts.umm}</b> на УММ
          </div>
          <div className="tile">
            <b>{counts.primary}</b> первоисточников
          </div>
          <div className="tile">
            <b>{counts.electronic}</b> электронных курсов
          </div>
          <div className={`tile ${counts.empty ? 'warn' : ''}`}>
            <b>{counts.empty}</b> пустых ячеек
          </div>
          <div className={`tile ${counts.unrecognized ? 'warn' : ''}`}>
            <b>{counts.unrecognized}</b> не распознано
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Ссылки на учебные материалы</h2>
          <label className="inline">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> показать первоисточники и электронные курсы
          </label>
        </div>
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Тема</th>
                <th>Форма</th>
                <th>Вид</th>
                <th>Как записано</th>
                <th>Ключ сопоставления</th>
                <th>Изм.</th>
                <th>[n]</th>
                <th>Место</th>
                <th>Замечания разбора</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className={edited.has(`ref:${r.id}`) ? 'edited' : ''}>
                  <td>
                    <b>{r.topicNumber}</b> <span className="muted small">{r.topicTitle.slice(0, 70)}</span>
                  </td>
                  <td>{r.form}</td>
                  <td>{KIND_LABEL[r.kind]}</td>
                  <td>
                    <code>{r.designationRaw ?? (r.kind === 'empty' ? '(пусто)' : r.cellRaw)}</code>
                  </td>
                  <td>
                    <code>{r.designationNorm ?? '—'}</code>
                  </td>
                  <td>{r.revision ?? '—'}</td>
                  <td>{r.bibIndex ?? '—'}</td>
                  <td className="small">
                    табл. {r.location.table}, стр. {r.location.row}
                  </td>
                  <td className="small">
                    {r.issues.map((i) => DESIGNATION_ISSUE_TEXT[i as keyof typeof DESIGNATION_ISSUE_TEXT] ?? (i === 'bib-only' ? 'обозначение в графе не распознано, взято из библиографии' : i)).join('; ')}
                  </td>
                  <td>
                    {(r.kind === 'umm' || r.kind === 'unrecognized' || r.kind === 'primary-source') && (
                      <button className="link" onClick={() => setEditing({ kind: 'ref', id: r.id })}>
                        исправить
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!shown.length && (
                <tr>
                  <td colSpan={10} className="muted">
                    Ссылки не извлечены.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {editing?.kind === 'ref' && <RefEditor r={refs.find((r) => r.id === editing.id)!} onSave={saveEdits} onClose={() => setEditing(null)} />}
      </div>

      <div className="card">
        <h2>Реквизиты УММ ({b.umm.length})</h2>
        <p className="muted small">Наведите на значение, чтобы увидеть место извлечения. «—» — поле неизвестно; это допустимо, неизвестное не подменяется предположением.</p>
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Источник</th>
                <th>Распознано</th>
                {UMM_FIELDS.map((f) => (
                  <th key={f.key}>{f.label}</th>
                ))}
                <th>Замечания</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {b.umm.map((rec) => (
                <tr key={rec.id} className={edited.has(`umm:${rec.id}`) ? 'edited' : ''}>
                  <td className="small">
                    {rec.origin === 'registry' ? 'реестр' : 'файл'}: {rec.fileName}
                  </td>
                  <td className="small">
                    {rec.recognition ? (
                      <>
                        <b>{rec.recognition.found.length}</b>/{UMM_FIELDS.length + 1} · {FORM_LABEL[rec.recognition.form]}
                        {rec.recognition.pages ? `, ${rec.recognition.pages} стр.` : ''}
                        {rec.recognition.unmatched.length > 0 && (
                          <details>
                            <summary>не сопоставлено: {rec.recognition.unmatched.length}</summary>
                            <ul className="checks">
                              {rec.recognition.unmatched.map((u, i) => (
                                <li key={i} title={formatLocation(u.location)}>
                                  {u.text}
                                </li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </>
                    ) : (
                      'реестр'
                    )}
                  </td>
                  {UMM_FIELDS.map((f) => {
                    const e = s.edits.find((x) => x.target === 'umm' && x.id === rec.id && x.field === f.key)
                    const fld = rec[f.key] as Field<unknown>
                    return (
                      <td key={f.key} title={provenance(fld)} className={fld.source?.method === 'derived' ? 'derived' : ''}>
                        {e ? (
                          <span className="manual" title={`ручной ввод: ${e.note}`}>
                            {e.value || '—'} ✎
                          </span>
                        ) : (
                          display(fld, f.key)
                        )}
                      </td>
                    )
                  })}
                  <td className="small">{rec.issues.join('; ')}</td>
                  <td>
                    <button className="link" onClick={() => setEditing({ kind: 'umm', id: rec.id })}>
                      изменить
                    </button>
                  </td>
                </tr>
              ))}
              {!b.umm.length && (
                <tr>
                  <td colSpan={UMM_FIELDS.length + 4} className="muted">
                    УММ не загружены — все ссылки получат статус «не найден в загруженных материалах».
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {editing?.kind === 'umm' && <UmmEditor rec={b.umm.find((r) => r.id === editing.id)!} edits={s.edits} onSave={saveEdits} onClose={() => setEditing(null)} />}
      </div>

      <div className="actions">
        <button className="secondary" onClick={() => setStep(0)}>
          ← Назад
        </button>
        <label className="inline confirm">
          <input type="checkbox" checked={s.confirmed} onChange={(e) => patch({ confirmed: e.target.checked, report: null })} /> Извлечённые данные сверены
          {s.edits.length ? ` (ручных правок: ${s.edits.length})` : ''}
        </label>
        <button className="primary" onClick={() => setStep(2)}>
          Далее →
        </button>
      </div>
    </section>
  )
}
