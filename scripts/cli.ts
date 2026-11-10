// Проверка из командной строки: npm run cli -- --ippd X.docx --umm a.docx b.docx --registry r.xlsx --date 2026-12-01 --profile demo --out report.html
// Диагностика распознавания УММ: npm run cli -- --probe-umm файл1.docx файл2.pdf …
import { readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { extractAll, runCheck, type InputFile } from '../src/core/pipeline'
import { loadProfiles, loadTemplates } from '../src/main/resources'
import { renderReportHtml } from '../src/core/reportHtml'
import { STATUS_LABEL, OUTCOME_LABEL, VERDICT_LABEL, formatLocation } from '../src/core/labels'
import { todayLocalIso } from '../src/core/dates'

const root = join(__dirname, '..')
const args = process.argv.slice(2)
const opt: Record<string, string[]> = {}
let key = ''
for (const a of args) {
  if (a.startsWith('--')) opt[(key = a.slice(2))] = []
  else opt[key]?.push(a)
}

const FIELD_RU: Record<string, string> = {
  designation: 'Обозначение', title: 'Наименование', revision: 'Изменение', status: 'Статус', statusAsOf: 'Статус на дату',
  validFrom: 'Введён в действие', validTo: 'Окончание действия', reviewDue: 'Срок пересмотра', approvedAt: 'Дата утверждения',
  replacedBy: 'Заменён на', replaces: 'Взамен'
}

/** Диагностика распознавания УММ: что найдено, откуда и какие строки похожи на реквизиты, но не сопоставлены. */
async function probeUmm(paths: string[]) {
  const templates = loadTemplates(join(root, 'templates'))
  const files: InputFile[] = paths.map((p, i) => ({ id: `u${i + 1}`, name: basename(p), role: 'umm', data: readFileSync(p) }))
  const bundle = await extractAll(files, templates)
  for (const f of bundle.files) {
    const rec = bundle.umm.find((r) => r.fileId === f.id)
    console.log(`\n## ${f.name}  [${rec?.recognition?.form ?? f.format}${rec?.recognition?.pages ? `, ${rec.recognition.pages} стр.` : ''}]`)
    if (f.error) console.log('  ОШИБКА:', f.error)
    if (!rec) continue
    for (const k of Object.keys(FIELD_RU)) {
      const fld = (rec as any)[k]
      const v = fld.value == null ? '—' : typeof fld.value === 'object' ? JSON.stringify(fld.value) : fld.value
      console.log(`  ${FIELD_RU[k].padEnd(20)} ${String(v).slice(0, 70).padEnd(40)} ${fld.source ? `← ${formatLocation(fld.source.location)}${fld.source.note ? ` (${fld.source.note})` : ''}` : ''}`)
    }
    for (const i of rec.issues) console.log('  !', i)
    for (const u of rec.recognition?.unmatched ?? []) console.log('  ? не сопоставлено:', u.text, '—', formatLocation(u.location))
  }
}

async function main() {
  if (opt['probe-umm']) return probeUmm(opt['probe-umm'])
  if (opt.demo) {
    const m = JSON.parse(readFileSync(join(root, 'demo/manifest.json'), 'utf8'))
    opt.ippd = [join(root, 'demo', m.ippd)]
    opt.umm = m.umm.map((u: string) => join(root, 'demo', u))
    opt.registry = [join(root, 'demo', m.registry)]
    opt.date ??= [m.checkDate]
    opt.profile ??= [m.profile]
  }
  const files: InputFile[] = []
  let n = 0
  const add = (role: InputFile['role'], p: string) => files.push({ id: `f${++n}`, name: basename(p), role, data: readFileSync(p) })
  for (const p of opt.ippd ?? []) add('ippd', p)
  for (const p of opt.umm ?? []) add('umm', p)
  for (const p of opt.registry ?? []) add('registry', p)
  const templates = loadTemplates(join(root, 'templates'))
  const { profiles, errors } = loadProfiles([join(root, 'profiles')])
  for (const e of errors) console.error('!', e)
  const lp = profiles.find((p) => p.profile.id === (opt.profile?.[0] ?? 'demo'))
  if (!lp) throw new Error(`профиль не найден; доступны: ${profiles.map((p) => p.profile.id).join(', ')}`)
  const bundle = await extractAll(files, templates)
  const report = runCheck(bundle, lp.profile, { checkDate: opt.date?.[0] ?? todayLocalIso(), confirmed: true, edits: [], profileSha256: lp.sha256 })
  console.log(`Итог: ${VERDICT_LABEL[report.verdict]}`)
  for (const r of report.verdictReasons) console.log('  -', r)
  console.log('Счётчики:', JSON.stringify(report.counts))
  for (const a of report.actuality) console.log(`  [${STATUS_LABEL[a.status]}] ${a.reference.topicNumber} ${a.reference.designationRaw} — ${a.basis}`)
  for (const r of report.normcontrol) if (r.outcome !== 'pass') console.log(`  {${OUTCOME_LABEL[r.outcome]}} ${r.ruleId} ${r.title}: ${r.findings.filter((f) => f.outcome === 'fail').map((f) => f.actual).join(' | ')}`)
  if (opt.out?.[0]) {
    writeFileSync(opt.out[0], renderReportHtml(report))
    console.log('Отчёт:', opt.out[0])
  }
}
main().catch((e) => {
  console.error('Ошибка:', e.message)
  process.exit(1)
})
