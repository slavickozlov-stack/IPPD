// Экспорт отчёта в самодостаточный HTML: без внешних ресурсов, все значения экранированы.
import type { CheckReport } from './model'
import { APPROVAL_LABEL, KIND_LABEL, OUTCOME_LABEL, SEVERITY_LABEL, STATUS_LABEL, STATUS_ORDER, VERDICT_LABEL, formatLocation } from './labels'
import { formatRu } from './dates'

const esc = (v: unknown) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const CSS = `
:root{--bg:#fff;--fg:#1d232b;--muted:#5d6876;--line:#d9dee5;--soft:#f4f6f9;--ok:#1f7a3f;--bad:#b3261e;--warn:#9a5b00;--info:#2457a6}
@media (prefers-color-scheme:dark){:root{--bg:#14181d;--fg:#e6e9ee;--muted:#9aa5b3;--line:#2c333c;--soft:#1c2128;--ok:#5cc47f;--bad:#ff8a80;--warn:#f0b35a;--info:#8fb4ff}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 -apple-system,"Segoe UI",Roboto,Arial,sans-serif}
main{max-width:1200px;margin:0 auto;padding:24px 16px 48px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:18px;margin:32px 0 8px;padding-bottom:6px;border-bottom:1px solid var(--line)}h3{font-size:15px;margin:18px 0 6px}
.muted{color:var(--muted)}.banner{background:#fff3cd;color:#5c4400;border:1px solid #e8c66a;padding:8px 12px;border-radius:6px;margin:12px 0;font-weight:600}
.verdict{border:2px solid var(--line);border-radius:8px;padding:12px 16px;margin:16px 0}.verdict.no_remarks{border-color:var(--ok)}.verdict.remarks{border-color:var(--bad)}.verdict.incomplete{border-color:var(--warn)}
.verdict b{font-size:18px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;margin:12px 0}
.tile{background:var(--soft);border-radius:6px;padding:8px 10px}.tile .n{font-size:20px;font-weight:700}
table{border-collapse:collapse;width:100%;margin:8px 0;font-size:13px}th,td{border:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}th{background:var(--soft);font-weight:600}
.chip{display:inline-block;padding:1px 8px;border-radius:10px;font-size:12px;font-weight:600;white-space:nowrap;border:1px solid currentColor}
.s-in_force,.o-pass{color:var(--ok)}.s-expired,.s-cancelled,.s-replaced,.s-not_found,.o-fail{color:var(--bad)}.s-review_overdue,.s-not_yet_effective,.s-needs_clarification,.o-manual{color:var(--warn)}.o-na{color:var(--muted)}
ul.checks{margin:4px 0 0;padding-left:18px}ul.checks li{margin:2px 0}code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;word-break:break-all}
.filter{margin:8px 0;display:flex;flex-wrap:wrap;gap:8px 16px}.filter label{white-space:nowrap}
.tablewrap{overflow-x:auto}
@media print{.filter{display:none}.banner{border-width:2px}}
`

const SCRIPT = `
document.querySelectorAll('[data-filter]').forEach(function(box){
  box.addEventListener('change',function(){
    var group=box.getAttribute('data-filter');
    var on={};document.querySelectorAll('[data-filter="'+group+'"]').forEach(function(b){on[b.value]=b.checked});
    document.querySelectorAll('[data-group="'+group+'"]').forEach(function(row){row.style.display=on[row.getAttribute('data-status')]?'':'none'});
  });
});`

export function renderReportHtml(r: CheckReport): string {
  const demo = r.profile.mode === 'demo'
  const statusCounts = STATUS_ORDER.map((s) => [s, r.actuality.filter((a) => a.status === s).length] as const).filter(([, n]) => n > 0)
  const outcomeCounts = (['fail', 'manual', 'pass', 'na'] as const).map((o) => [o, r.normcontrol.filter((x) => x.outcome === o).length] as const).filter(([, n]) => n > 0)

  const files = r.files
    .map(
      (f) =>
        `<tr><td>${esc(f.role === 'ippd' ? 'ИППД' : f.role === 'umm' ? 'УММ' : 'реестр')}</td><td>${esc(f.name)}</td><td>${esc(f.format.toUpperCase())}</td><td>${(f.size / 1024).toFixed(1)} КБ</td><td><code>${esc(f.sha256.slice(0, 16))}…</code></td><td>${esc(f.error ? `ошибка: ${f.error}` : f.manualReason ?? 'прочитан')}</td></tr>`
    )
    .join('')

  const actRows = r.actuality
    .map((a) => {
      const ref = a.reference
      const checks = a.checks.map((c) => `<li><b>${esc(c.label)}:</b> ${esc(c.basis)}</li>`).join('')
      const cands = a.candidates.length ? `<div class="muted">Кандидаты: ${a.candidates.map((c) => esc(`${c.designation}${c.revision ? ` изм. ${c.revision}` : ''} — ${c.reason}`)).join('; ')}</div>` : ''
      const repl = a.replacement
        ? `<div><b>Замена:</b> ${esc(a.replacement.designation)}${a.replacement.revision ? ` изм. ${esc(a.replacement.revision)}` : ''} — ${esc(a.replacement.statusOnDate ? STATUS_LABEL[a.replacement.statusOnDate] : 'статус не установлен')}</div>`
        : ''
      return `<tr data-group="act" data-status="${a.status}"><td><span class="chip s-${a.status}">${esc(STATUS_LABEL[a.status])}</span></td><td>${esc(ref.topicNumber)} ${esc(ref.topicTitle.slice(0, 120))}<div class="muted">${esc(ref.form)} · ${esc(KIND_LABEL[ref.kind])}</div></td><td><code>${esc(ref.designationRaw ?? ref.cellRaw)}</code>${ref.revision ? `<div>изм. ${esc(ref.revision)}</div>` : ''}${ref.bibIndex != null ? `<div class="muted">[${ref.bibIndex}]</div>` : ''}</td><td>${esc(formatLocation(ref.location))}</td><td>${esc(a.basis)}${repl}<ul class="checks">${checks}</ul>${cands}</td><td>${esc(a.action)}</td></tr>`
    })
    .join('')

  const ncRows = r.normcontrol
    .map((rule) => {
      const fs = rule.findings
        .filter((f) => f.outcome === 'fail' || f.outcome === 'manual')
        .map(
          (f) =>
            `<li><div><b>Место:</b> ${esc(formatLocation(f.location))}</div>${f.actual ? `<div><b>Фактически:</b> ${esc(f.actual)}</div>` : ''}<div><b>Требуется:</b> ${esc(f.expected)}</div><div><b>Что сделать:</b> ${esc(f.action)}</div></li>`
        )
        .join('')
      return `<tr data-group="nc" data-status="${rule.outcome}"><td><span class="chip o-${rule.outcome}">${esc(OUTCOME_LABEL[rule.outcome])}</span></td><td><b>${esc(rule.ruleId)}</b> ${esc(rule.title)}<div class="muted">${esc(SEVERITY_LABEL[rule.severity] ?? rule.severity)} · ${esc(APPROVAL_LABEL[rule.approval])}</div></td><td>${esc(rule.findings[0]?.source ?? '')}</td><td>${rule.note ? `<div class="muted">${esc(rule.note)}</div>` : ''}${fs ? `<ol class="checks">${fs}</ol>` : rule.outcome === 'pass' ? 'Нарушений не выявлено.' : ''}</td></tr>`
    })
    .join('')

  const cov = r.coverage
    .map((c) => `<tr><td>${esc(c.label)}</td><td>${c.configured ? '<span class="chip o-pass">настроено</span>' : '<span class="chip o-manual">не настроено</span>'}</td><td>${esc(c.note)}</td></tr>`)
    .join('')

  const edits = r.manualEdits.length
    ? `<h2>Ручные правки на шаге «Сверка»</h2><div class="tablewrap"><table><tr><th>Объект</th><th>Поле</th><th>Было</th><th>Стало</th><th>Обоснование</th><th>Когда</th></tr>${r.manualEdits
        .map((e) => `<tr><td>${esc(e.target)}</td><td>${esc(e.field)}</td><td>${esc(e.from ?? '—')}</td><td>${esc(e.to ?? '—')}</td><td>${esc(e.note)}</td><td>${esc(e.at)}</td></tr>`)
        .join('')}</table></div>`
    : ''

  const parse = r.ippd
    ? `<p>Шаблон: ${esc(r.ippd.parse.templateName ?? 'не распознан')}. Таблицы: план-график — ${esc(r.ippd.parse.tablesFound.schedule.join(', ') || 'нет')}, теоретическая подготовка — ${esc(r.ippd.parse.tablesFound.theory.join(', ') || 'нет')}, практическая — ${esc(r.ippd.parse.tablesFound.practice.join(', ') || 'нет')}, стажировка — ${esc(r.ippd.parse.tablesFound.internship.join(', ') || 'нет')}. Библиография: ${r.ippd.parse.bibliographyFound ? 'найдена' : 'не найдена'}.</p>${
        r.ippd.parse.incompleteReasons.length ? `<ul>${r.ippd.parse.incompleteReasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p>Разбор полный.</p>'
      }`
    : '<p>ИППД не загружена.</p>'

  const filter = (group: string, items: readonly (readonly [string, number])[], labels: Record<string, string>) =>
    `<div class="filter">Показать: ${items.map(([k, n]) => `<label><input type="checkbox" data-filter="${group}" value="${k}" checked> ${esc(labels[k])} (${n})</label>`).join('')}</div>`

  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>Отчёт ИППД Контроль — ${esc(r.ippd?.registrationNumber ?? r.ippd?.fileName ?? '')}</title><style>${CSS}</style></head>
<body><main>
<h1>Отчёт проверки ИППД</h1>
<div class="muted">ИППД Контроль · сформирован ${esc(new Date(r.generatedAt).toLocaleString('ru-RU'))}</div>
${demo ? '<div class="banner">ДЕМОНСТРАЦИОННЫЙ ПРОФИЛЬ. Правила и данные синтетические и не являются утверждёнными требованиями предприятия.</div>' : ''}
<table>
<tr><th>ИППД</th><td>${esc(r.ippd?.fileName ?? '—')}${r.ippd?.registrationNumber ? ` (${esc(r.ippd.registrationNumber)})` : ''}</td></tr>
<tr><th>Дата проверки</th><td>${esc(formatRu(r.checkDate))}</td></tr>
<tr><th>Профиль правил</th><td>${esc(r.profile.name)} · версия ${esc(r.profile.version)} · ${r.profile.mode === 'demo' ? 'демонстрационный' : 'рабочий'} · <code>${esc(r.profile.sha256.slice(0, 16))}…</code></td></tr>
</table>
<div class="verdict ${r.verdict}"><b>${esc(VERDICT_LABEL[r.verdict])}</b><ul>${r.verdictReasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
<div class="muted">Результат предназначен для рассмотрения специалистом и не заменяет его решение.</div></div>
<div class="grid">
<div class="tile"><div class="n">${r.counts.referencesFound}</div>ссылок на материалы найдено</div>
<div class="tile"><div class="n">${r.counts.ummReferences}</div>из них ссылок на УММ</div>
<div class="tile"><div class="n">${r.counts.matched}</div>сопоставлено с загруженными</div>
<div class="tile"><div class="n">${r.counts.needsClarification}</div>требуют уточнения</div>
<div class="tile"><div class="n">${r.counts.notFound}</div>не найдены</div>
</div>
<h2>Состав загруженных файлов</h2><div class="tablewrap"><table><tr><th>Роль</th><th>Файл</th><th>Формат</th><th>Размер</th><th>SHA-256</th><th>Состояние</th></tr>${files}</table></div>
<h2>Полнота разбора ИППД</h2>${parse}
<h2>1. Актуальность УММ на ${esc(formatRu(r.checkDate))}</h2>
${filter('act', statusCounts, STATUS_LABEL)}
<div class="tablewrap"><table><tr><th>Статус</th><th>Тема</th><th>Ссылка в ИППД</th><th>Место</th><th>Основание</th><th>Что сделать</th></tr>${actRows || '<tr><td colspan="6">Ссылок для проверки нет.</td></tr>'}</table></div>
<h2>2. Нормоконтроль ИППД</h2>
${filter('nc', outcomeCounts, OUTCOME_LABEL)}
<div class="tablewrap"><table><tr><th>Итог</th><th>Правило</th><th>Источник</th><th>Замечания</th></tr>${ncRows || '<tr><td colspan="4">В профиле нет правил.</td></tr>'}</table></div>
<h2>Настройка профиля</h2><div class="tablewrap"><table><tr><th>Проверка</th><th>Состояние</th><th>Основание</th></tr>${cov}</table></div>
${edits}
</main><script>${SCRIPT}</script></body></html>`
}
