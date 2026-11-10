import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildDocx, demoIppdBlocks } from '../scripts/demoBuilder'
import { readDocx } from '../src/core/docx'
import { extractIppd } from '../src/core/ippdExtract'
import { extractAll, runCheck } from '../src/core/pipeline'
import { runRules } from '../src/core/rules/engine'
import { normalizeDesignation } from '../src/core/designation'
import { parseProfile, ProfileError } from '../src/core/profile'
import { profile, root, templates } from './helpers'

const docOf = async (blocks = demoIppdBlocks(), name = 'ippd.docx') => readDocx(await buildDocx(blocks), name)

describe('разбор ИППД', () => {
  it('демо-ИППД: шаблон распознан, разбор полный, ссылки с местом', async () => {
    const x = extractIppd(await docOf(), 'f1', templates.ippd)
    expect(x.parse.templateId).toBe('ippd-roaes-p0010')
    expect(x.parse.complete).toBe(true)
    expect(x.registrationNumber.value).toBe('ИППД.99.ДЕМО.001')
    const r = x.references.find((r) => r.topicNumber === '1.1')!
    expect(r).toMatchObject({ kind: 'umm', designationNorm: 'I.К1.Т13.УМСИ.ДЕМО.0101.2024', bibIndex: 1, form: 'Сп' })
    expect(r.location).toMatchObject({ table: 5, row: 3, column: 'Учебные материалы' })
  })

  it('неподдерживаемый шаблон: разбор неполный, нормоконтроль уходит в ручную проверку', async () => {
    const doc = await docOf([{ p: 'Служебная записка' }, { p: 'Прошу выделить помещение.' }, { t: [['Дата', 'Подпись']] }], 'letter.docx')
    const x = extractIppd(doc, 'f1', templates.ippd)
    expect(x.parse.templateSupported).toBe(false)
    expect(x.parse.complete).toBe(false)
    expect(x.parse.incompleteReasons[0]).toContain('Шаблон ИППД не распознан')
    const res = runRules(x, doc, profile('demo'))
    expect(res.every((r) => r.outcome === 'manual')).toBe(true)
    expect(res[0].note).toContain('не разобрана по поддерживаемому шаблону')
  })

  it('нет таблицы тематического плана — «Проверка неполная»', async () => {
    const files = [{ id: 'f1', name: 'ippd.docx', role: 'ippd' as const, data: await buildDocx(demoIppdBlocks({ dropTheory: true })) }]
    const bundle = await extractAll(files, templates)
    expect(bundle.ippd!.parse.complete).toBe(false)
    expect(bundle.ippd!.parse.incompleteReasons.join(' ')).toContain('Не найдена таблица «3.1 Тематический план теоретической подготовки»')
    const p = profile('demo')
    const report = runCheck(bundle, p, { checkDate: '2026-12-01', confirmed: true, edits: [], profileSha256: 'x' })
    expect(report.verdict).toBe('incomplete')
    expect(report.verdictReasons.join(' ')).toContain('Не найдена таблица')
  })

  it('строка темы с объединёнными ячейками — разбор неполный с указанием строки', async () => {
    const x = extractIppd(await docOf(demoIppdBlocks({ breakRow: true })), 'f1', templates.ippd)
    expect(x.parse.complete).toBe(false)
    expect(x.parse.incompleteReasons.join(' ')).toMatch(/строки 4 не разобраны/)
  })
})

describe('нормоконтроль', () => {
  it('пустая обязательная ячейка: место, фактическое значение, требование и источник', async () => {
    const doc = await docOf()
    const x = extractIppd(doc, 'f1', templates.ippd)
    const r = runRules(x, doc, profile('demo')).find((r) => r.ruleId === 'NC-30')!
    expect(r.outcome).toBe('fail')
    expect(r.findings).toHaveLength(1)
    expect(r.findings[0]).toMatchObject({
      location: { table: 5, row: 7, column: 'Учебные материалы' },
      expected: 'графа «Учебные материалы» заполнена',
      source: 'П.00.10 изм.31, п. 6.10.1, с. 12'
    })
    expect(r.findings[0].actual).toContain('тема 1.6')
  })

  it('в рабочем профиле неподтверждённые правила не применяются автоматически', async () => {
    const doc = await docOf()
    const x = extractIppd(doc, 'f1', templates.ippd)
    const res = runRules(x, doc, profile('roaes-p0010-draft'))
    expect(res.every((r) => r.outcome === 'manual')).toBe(true)
    expect(res.find((r) => r.ruleId === 'NC-30')!.findings[0].action).toContain('Проверить вручную')
  })

  it('пустой рабочий профиль: «замечаний нет» недоступно, показаны ненастроенные проверки', async () => {
    const bundle = await extractAll([{ id: 'f1', name: 'ippd.docx', role: 'ippd', data: await buildDocx(demoIppdBlocks()) }], templates)
    const report = runCheck(bundle, profile('work-empty'), { checkDate: '2026-12-01', confirmed: true, edits: [], profileSha256: 'x' })
    expect(report.coverage.every((c) => !c.configured)).toBe(true)
    expect(report.verdict).not.toBe('no_remarks')
  })

  it('схема профиля: неизвестный тип проверки отклоняется', () => {
    const p = JSON.parse(readFileSync(join(root, 'profiles/demo.profile.json'), 'utf8'))
    p.rules[0].check = { type: 'magic', foo: 1 }
    expect(() => parseProfile(p, 'bad')).toThrow(ProfileError)
  })

  it('схема профиля: новое правило поддерживаемого типа добавляется без изменения кода', async () => {
    const p = JSON.parse(readFileSync(join(root, 'profiles/demo.profile.json'), 'utf8'))
    p.rules.push({ ...p.rules[0], id: 'NC-100', title: 'Раздел «Цель подготовки»', check: { type: 'paragraph_present', pattern: 'цель\\s+подготовки', description: 'п. 1.1 «Цель подготовки»' } })
    const doc = await docOf()
    const res = runRules(extractIppd(doc, 'f1', templates.ippd), doc, parseProfile(p, 'ext'))
    expect(res.find((r) => r.ruleId === 'NC-100')!.outcome).toBe('pass')
  })
})

describe('обозначения', () => {
  it('латиница и пробелы нормализуются для сопоставления, но фиксируются как замечание', () => {
    expect(normalizeDesignation('IІ.K1.T1.ПАЗ. ОПОП.3166.2023')).toMatchObject({ key: 'II.К1.Т1.ПАЗ.ОПОП.3166.2023', issues: expect.arrayContaining(['mixed-script', 'space-around-dot']) })
    expect(normalizeDesignation('I.К1.Т13.УМСИ.ООП.0042.2024').key).toBe('I.К1.Т13.УМСИ.ООП.0042.2024')
  })
})
