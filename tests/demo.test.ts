import { readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { extractAll, runCheck } from '../src/core/pipeline'
import { renderReportHtml } from '../src/core/reportHtml'
import { profile, root, templates } from './helpers'

describe('демонстрационный комплект даёт предсказуемый отчёт', async () => {
  const m = JSON.parse(readFileSync(join(root, 'demo/manifest.json'), 'utf8'))
  const paths: [string, 'ippd' | 'umm' | 'registry'][] = [[m.ippd, 'ippd'], ...m.umm.map((u: string) => [u, 'umm']), [m.registry, 'registry']]
  const files = paths.map(([p, role], i) => ({ id: `f${i}`, name: basename(p), role, data: readFileSync(join(root, 'demo', p)) }))
  const bundle = await extractAll(files, templates)
  const report = runCheck(bundle, profile('demo'), { checkDate: m.checkDate, confirmed: true, edits: [], profileSha256: 'x', now: new Date('2026-12-01T09:00:00Z') })
  const byTopic = Object.fromEntries(report.actuality.map((a) => [a.reference.topicNumber, a.status]))

  it('статусы по темам', () => {
    expect(byTopic).toEqual({
      '1.1': 'in_force',
      '1.3': 'replaced',
      '1.4': 'expired',
      '1.5': 'needs_clarification',
      '2.1': 'review_overdue',
      '2.2': 'in_force',
      '2.3': 'not_found',
      '2.4': 'in_force',
      '2.5': 'expired',
      '2.6': 'cancelled',
      '2.7': 'replaced'
    })
  })

  it('нарушения нормоконтроля', () => {
    const fails = report.normcontrol.filter((r) => r.outcome === 'fail').map((r) => r.ruleId)
    expect(fails).toEqual(['NC-07', 'NC-30', 'NC-32', 'NC-33', 'NC-40', 'NC-50', 'NC-60', 'NC-61', 'NC-62'])
    expect(report.verdict).toBe('remarks')
  })

  it('ручной ввод реквизитов скана снимает уточнение и попадает в журнал', () => {
    const pdf = bundle.umm.find((u) => u.fileName.endsWith('.pdf'))!
    const edited = runCheck(bundle, profile('demo'), {
      checkDate: m.checkDate,
      confirmed: true,
      profileSha256: 'x',
      edits: [
        { target: 'umm', id: pdf.id, field: 'status', value: 'действующий', note: 'карточка АСУТД' },
        { target: 'umm', id: pdf.id, field: 'validTo', value: '31.12.2027', note: 'карточка АСУТД' }
      ]
    })
    const a = edited.actuality.find((x) => x.reference.topicNumber === '1.5')!
    expect(a.status).toBe('in_force')
    expect(a.basis).toContain('ручной ввод')
    expect(edited.manualEdits).toHaveLength(2)
  })

  it('добавление новой редакции УММ сразу пересматривает ссылки на старую', async () => {
    const extra = { id: 'fx', name: basename(m.extraUmm), role: 'umm' as const, data: readFileSync(join(root, 'demo', m.extraUmm)) }
    const b2 = await extractAll([...files, extra], templates)
    const r2 = runCheck(b2, profile('demo'), { checkDate: m.checkDate, confirmed: true, edits: [], profileSha256: 'x' })
    for (const t of ['1.1', '2.4']) {
      const a = r2.actuality.find((x) => x.reference.topicNumber === t)!
      expect(a.status).toBe('replaced')
      expect(a.replacement?.designation).toBe('I.К1.Т13.УМСИ.ДЕМО.0301.2026')
    }
  })

  it('без подтверждения сверки итог — «Проверка неполная»', () => {
    const r = runCheck(bundle, profile('demo'), { checkDate: m.checkDate, confirmed: false, edits: [], profileSha256: 'x' })
    expect(r.verdict).toBe('incomplete')
  })

  it('HTML-отчёт экранирует данные и не содержит внешних ресурсов', () => {
    const html = renderReportHtml(report)
    expect(html).toContain('ДЕМОНСТРАЦИОННЫЙ ПРОФИЛЬ')
    expect(html).not.toMatch(/<(img|link|iframe)\b/)
    expect(html).not.toMatch(/src="http/)
  })
})
