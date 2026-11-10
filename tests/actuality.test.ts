import { describe, expect, it } from 'vitest'
import { checkReference } from '../src/core/actuality'
import { profile, rec, ref } from './helpers'

const D = 'I.К1.Т13.УМСИ.ООП.0591.2024'
const demo = profile('demo')
const empty = profile('work-empty')
const check = (name: string) => (r: ReturnType<typeof checkReference>) => r.checks.find((c) => c.name === name)!

describe('дата окончания действия', () => {
  const r = rec({ designation: D, status: 'active', validFrom: '2024-01-01', validTo: '2026-06-30' })

  it('день после окончания — срок действия истёк', () => {
    const res = checkReference(ref(D), [r], '2026-07-01', empty)
    expect(res.status).toBe('expired')
    expect(res.basis).toContain('действует по 30.06.2026')
    expect(res.basis).toContain('дата проверки позже')
  })

  it('граничный день при включающем правиле — действует, основание ссылается на правило', () => {
    const res = checkReference(ref(D), [r], '2026-06-30', demo)
    expect(res.status).toBe('in_force')
    expect(check('validTo')(res).basis).toContain('граничный день включается')
    expect(check('validTo')(res).basis).toContain('ДЕМО-правило')
  })

  it('граничный день без правила — требуется уточнение', () => {
    const res = checkReference(ref(D), [r], '2026-06-30', empty)
    expect(res.status).toBe('needs_clarification')
    expect(res.basis).toContain('правило о граничном дне не настроено')
  })

  it('до даты введения — ещё не вступил в силу', () => {
    const res = checkReference(ref(D), [rec({ designation: D, validFrom: '2027-01-01', validTo: '2030-01-01' })], '2026-12-01', empty)
    expect(res.status).toBe('not_yet_effective')
    expect(res.basis).toContain('введён в действие 01.01.2027')
  })
})

describe('срок пересмотра проверяется отдельно от срока действия', () => {
  it('документ действует, но пересмотр просрочен', () => {
    const r = rec({ designation: D, status: 'active', validTo: '2029-12-31', reviewDue: '2026-06-30' })
    const res = checkReference(ref(D), [r], '2026-12-01', empty)
    expect(res.status).toBe('review_overdue')
    expect(check('validTo')(res).outcome).toBe('ok')
    expect(check('reviewDue')(res).outcome).toBe('problem')
    expect(res.basis).toContain('пересмотреть до 30.06.2026')
    expect(res.basis).toContain('документ действует')
  })

  it('срок пересмотра вычисляется от даты утверждения только при наличии правила', () => {
    const r = rec({ designation: D, status: 'active', validTo: '2035-01-01', approvedAt: '2020-03-01' })
    const withRule = checkReference(ref(D), [r], '2026-12-01', demo)
    expect(withRule.status).toBe('review_overdue')
    expect(check('reviewDue')(withRule).basis).toContain('вычислен: дата утверждения 01.03.2020 + 5 г.')
    const noRule = checkReference(ref(D), [r], '2026-12-01', empty)
    expect(noRule.status).toBe('in_force')
    expect(check('reviewDue')(noRule).basis).toContain('правило вычисления от даты утверждения не настроено')
  })
})

describe('отсутствующие даты и статусы', () => {
  it('нет ни статуса, ни дат — требуется уточнение', () => {
    const res = checkReference(ref(D), [rec({ designation: D })], '2026-12-01', empty)
    expect(res.status).toBe('needs_clarification')
    expect(res.basis).toBe('нет сведений ни о статусе, ни о сроке действия')
    expect(check('validTo')(res).basis).toBe('дата окончания действия не указана')
  })

  it('статус «действующий» подтверждён на более раннюю дату и срок неизвестен — уточнение', () => {
    const r = rec({ designation: D, status: 'active', statusAsOf: '2026-07-27' })
    const res = checkReference(ref(D), [r], '2026-12-01', empty)
    expect(res.status).toBe('needs_clarification')
    expect(res.basis).toContain('статус подтверждён на дату раньше даты проверки')
  })

  it('не найден: подсказка по названию не превращается в совпадение', () => {
    const other = rec({ designation: 'I.К1.Т99.УМСИ.ООП.0001.2020', title: 'Средства индивидуальной защиты работников', status: 'active', validTo: '2030-01-01' })
    const r = { ...ref(D), topicTitle: 'Средства индивидуальной защиты работников' }
    const res = checkReference(r, [other], '2026-12-01', empty)
    expect(res.status).toBe('not_found')
    expect(res.matchedRecordIds).toEqual([])
    expect(res.candidates[0].reason).toContain('только подсказка')
  })

  it('ведущие нули значимы: 0591 и 591 — разные обозначения', () => {
    const res = checkReference(ref(D), [rec({ designation: 'I.К1.Т13.УМСИ.ООП.591.2024', status: 'active', validTo: '2030-01-01' })], '2026-12-01', empty)
    expect(res.status).not.toBe('in_force')
    expect(res.matchedRecordIds).toEqual([])
  })
})

describe('редакции и источники', () => {
  const r1 = rec({ designation: D, revision: '1', status: 'active', validFrom: '2023-01-01', validTo: '2025-01-01' })
  const r2 = rec({ designation: D, revision: '2', status: 'active', validFrom: '2025-01-02', validTo: '2030-01-01' })

  it('редакция не указана, загружено несколько, правила нет — уточнение со списком кандидатов', () => {
    const res = checkReference(ref(D), [r1, r2], '2026-12-01', empty)
    expect(res.status).toBe('needs_clarification')
    expect(res.basis).toContain('загружено несколько: изм. 1, изм. 2; правило выбора не настроено')
    expect(res.candidates).toHaveLength(2)
  })

  it('редакция не указана, правило «единственная действующая» — выбрана изм. 2 с основанием', () => {
    const res = checkReference(ref(D), [r1, r2], '2026-12-01', demo)
    expect(res.status).toBe('in_force')
    expect(check('match')(res).basis).toContain('редакция выбрана автоматически')
  })

  it('указанная в ссылке редакция не загружена — уточнение', () => {
    const res = checkReference(ref(D, '3'), [r1, r2], '2026-12-01', demo)
    expect(res.status).toBe('needs_clarification')
    expect(res.basis).toContain('в ИППД указано изм. 3')
  })

  it('реестр и документ расходятся — без правила уточнение, с правилом показан приоритет', () => {
    const file = rec({ designation: D, status: 'active', validTo: '2026-10-31' })
    const reg = rec({ designation: D, status: 'active', validTo: '2028-12-31' }, 'registry')
    const noRule = checkReference(ref(D), [file, reg], '2026-12-01', empty)
    expect(noRule.status).toBe('needs_clarification')
    expect(noRule.basis).toContain('источники расходятся: дата окончания')
    // Ответ специалиста: при расхождении главнее реквизиты самого УММ
    const withRule = checkReference(ref(D), [file, reg], '2026-12-01', profile('roaes-p0010-draft'))
    expect(withRule.status).toBe('expired')
    expect(check('sources')(withRule).basis).toContain('применён приоритет «документ УММ»')
    expect(check('sources')(withRule).basis).toContain('Ответ специалиста УТП')
  })

  it('заменён: показаны обозначение замены и её статус на дату', () => {
    const old = rec({ designation: D, status: 'replaced', replacedBy: { designation: 'I.К1.Т13.УМСИ.ООП.0700.2026', revision: null } })
    const neu = rec({ designation: 'I.К1.Т13.УМСИ.ООП.0700.2026', status: 'active', validFrom: '2026-01-01', validTo: '2031-01-01' })
    const res = checkReference(ref(D), [old, neu], '2026-12-01', empty)
    expect(res.status).toBe('replaced')
    expect(res.replacement).toMatchObject({ designation: 'I.К1.Т13.УМСИ.ООП.0700.2026', statusOnDate: 'in_force' })
    expect(res.action).toContain('Заменить ссылку на I.К1.Т13.УМСИ.ООП.0700.2026')
  })

  it('заменён, но замена не загружена — статус замены не установлен', () => {
    const old = rec({ designation: D, status: 'replaced', replacedBy: { designation: 'I.К1.Т13.УМСИ.ООП.0700.2026', revision: null } })
    const res = checkReference(ref(D), [old], '2026-12-01', empty)
    expect(res.status).toBe('replaced')
    expect(res.replacement?.statusOnDate).toBeNull()
    expect(res.replacement?.basis).toContain('не загружен')
  })

  it('отменён', () => {
    const res = checkReference(ref(D), [rec({ designation: D, status: 'cancelled' }, 'registry')], '2026-12-01', empty)
    expect(res.status).toBe('cancelled')
    expect(res.basis).toContain('реестр')
  })
})

describe('новый УММ той же темы под новым номером', () => {
  const work = profile('roaes-p0010-draft')
  const old = rec({ designation: 'I.К1.Т13.УМСИ.ООП.3591.2024', status: 'active', validTo: '2030-01-01' })
  const neu = rec({ designation: 'I.К1.Т13.УМСИ.ООП.4801.2026', status: 'active', validFrom: '2026-11-01', validTo: '2031-01-01' })

  it('загружен новый действующий УММ — ссылка на старый сразу считается заменённой, с основанием', () => {
    const res = checkReference(ref(old.designation.value!), [old, neu], '2026-12-01', work)
    expect(res.status).toBe('replaced')
    expect(res.basis).toContain('загружен более новый УММ той же темы I.К1.Т13.УМСИ.ООП.4801.2026')
    expect(res.basis).toContain('Ответ специалиста УТП')
    expect(res.replacement).toMatchObject({ designation: 'I.К1.Т13.УМСИ.ООП.4801.2026', statusOnDate: 'in_force' })
    expect(res.action).toContain('Заменить ссылку на I.К1.Т13.УМСИ.ООП.4801.2026')
  })

  it('новый УММ ещё не вступил в силу — пересмотр через уточнение', () => {
    const future = rec({ designation: 'I.К1.Т13.УМСИ.ООП.4801.2026', status: 'active', validFrom: '2027-01-01', validTo: '2031-01-01' })
    const res = checkReference(ref(old.designation.value!), [old, future], '2026-12-01', work)
    expect(res.status).toBe('needs_clarification')
    expect(res.basis).toContain('ещё не вступил в силу')
  })

  it('без правила — только подсказка в проверках, статус не меняется', () => {
    const res = checkReference(ref(old.designation.value!), [old, neu], '2026-12-01', empty)
    expect(res.status).toBe('in_force')
    expect(check('replacement')(res).basis).toContain('правило пересмотра по новому УММ не настроено')
  })

  it('другая тема или тот же год — не считается новой редакцией', () => {
    const otherTheme = rec({ designation: 'I.К1.Т14.УМСИ.ООП.4801.2026', status: 'active', validTo: '2031-01-01' })
    const sameYear = rec({ designation: 'I.К1.Т13.УМСИ.ООП.3600.2024', status: 'active', validTo: '2031-01-01' })
    const res = checkReference(ref(old.designation.value!), [old, otherTheme, sameYear], '2026-12-01', work)
    expect(res.status).toBe('in_force')
  })
})
