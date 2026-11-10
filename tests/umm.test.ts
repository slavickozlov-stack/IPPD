import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ASUTD_UMM, buildAsutdUmmDocx, buildBlankPdf } from '../scripts/demoBuilder'
import { readDocx } from '../src/core/docx'
import { readPdf } from '../src/core/pdf'
import { extractUmmFromDoc } from '../src/core/ummExtract'
import { checkReference } from '../src/core/actuality'
import { extractAll } from '../src/core/pipeline'
import type { DocModel } from '../src/core/model'
import { profile, ref, root, templates } from './helpers'

const forms = join(root, 'demo', 'образцы форм УММ')
const expected = {
  designation: ASUTD_UMM.designation,
  title: 'Средства пожаротушения',
  revision: '2',
  status: 'active',
  statusAsOf: '2026-11-01',
  validFrom: '2025-02-01',
  validTo: '2030-01-31',
  approvedAt: '2025-01-15',
  replaces: { designation: 'I.К5.Т40.УМСИ.ДЕМО.0220.2021', revision: null }
}

describe('чтение УММ в оформлении документов АСУТД', () => {
  it('DOCX: реквизиты титульного листа, «ВЗАМЕН», изменение из колонтитула, штамп', async () => {
    const doc = await readDocx(await buildAsutdUmmDocx(), 'umm.docx')
    const rec = extractUmmFromDoc(doc, 'f', templates.umm, 'r', 'docx')
    for (const [k, v] of Object.entries(expected)) expect((rec as any)[k].value, k).toEqual(v)
    expect(rec.revision.source).toMatchObject({ method: 'derived', note: expect.stringContaining('колонтитул') })
    expect(rec.status.source?.note).toContain('штамп АСУТД № 99401 от 20.01.2025')
    expect(rec.recognition?.unmatched.map((u) => u.text)).toContain('2 ВВЕДЕН В ДЕЙСТВИЕ распоряжением от 20.01.2025 № 9/ДЕМО-1')
  })

  it('PDF с текстовым слоем: те же реквизиты и номер страницы в месте извлечения', async () => {
    const pdf = await readPdf(readFileSync(join(forms, 'УММ АСУТД (синтетика).pdf')), 'umm.pdf')
    expect(pdf.textLayer).toBe('full')
    const rec = extractUmmFromDoc(pdf.doc, 'f', templates.umm, 'r', 'pdf-text', pdf.pages)
    for (const [k, v] of Object.entries(expected)) expect((rec as any)[k].value, k).toEqual(v)
    expect(rec.validTo.source?.location?.page).toBe(1)
  })

  it('скан со штампом: статус и дата статуса из штампа, обозначение из имени файла', async () => {
    const name = 'I.К5.Т40.УМСИ.ДЕМО.0220.2021 скан со штампом.pdf'
    const b = await extractAll([{ id: 'u1', name, role: 'umm', data: readFileSync(join(forms, name)) }], templates)
    const rec = b.umm[0]
    expect(rec.recognition?.form).toBe('pdf-stamp')
    expect(rec.status.value).toBe('replaced')
    expect(rec.statusAsOf.value).toBe('2026-11-01')
    expect(rec.designation).toMatchObject({ value: 'I.К5.Т40.УМСИ.ДЕМО.0220.2021', source: { method: 'derived' } })
    expect(b.files[0].manualReason).toContain('распознан только штамп АСУТД')
  })

  it('скан без текста — ручной разбор; DOC — понятная ошибка формата', async () => {
    const b = await extractAll(
      [
        { id: 'u1', name: 'ИОТ.99.01 изм.3.pdf', role: 'umm', data: buildBlankPdf() },
        { id: 'u2', name: 'ППД.99.01.doc', role: 'umm', data: new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]) }
      ],
      templates
    )
    expect(b.umm[0].recognition?.form).toBe('pdf-scan')
    expect(b.files[0].manualReason).toContain('скан без текстового слоя')
    expect(b.files[1].error).toBe('формат DOC/ODT/RTF не читается: сохраните УММ как DOCX или PDF')
  })

  it('заголовки таблиц не принимаются за реквизиты, незаполненный реквизит фиксируется', () => {
    const doc: DocModel = {
      fileName: 'x.pdf',
      blocks: [],
      tables: [],
      paragraphs: [
        { kind: 'p', index: 1, text: 'ПР.ИД.99.01', page: 1 },
        { kind: 'p', index: 2, text: 'Дата окончания действия ______________', page: 1 },
        { kind: 'p', index: 3, text: 'Наименование документа Должен знать', page: 2 },
        { kind: 'p', index: 4, text: 'Обозначение документа', page: 2 }
      ]
    }
    const rec = extractUmmFromDoc(doc, 'f', templates.umm, 'r', 'pdf-text', 2)
    expect(rec.designation.value).toBe('ПР.ИД.99.01')
    expect(rec.title.value).toBeNull()
    expect(rec.validTo.value).toBeNull()
    expect(rec.issues.join(' ')).toContain('«дата окончания действия» есть в документе, но не заполнен')
  })

  it('старый УММ заменён новым по связи «ВЗАМЕН», замена действует на дату', async () => {
    const files = ['УММ АСУТД (синтетика).pdf', 'I.К5.Т40.УМСИ.ДЕМО.0220.2021 скан со штампом.pdf'].map((n, i) => ({ id: `u${i}`, name: n, role: 'umm' as const, data: readFileSync(join(forms, n)) }))
    const b = await extractAll(files, templates)
    const res = checkReference(ref('I.К5.Т40.УМСИ.ДЕМО.0220.2021'), b.umm, '2026-12-01', profile('roaes-p0010-draft'))
    expect(res.status).toBe('replaced')
    expect(res.replacement).toMatchObject({ designation: ASUTD_UMM.designation, statusOnDate: 'in_force' })
  })
})
