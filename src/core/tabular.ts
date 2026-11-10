// Минимальное чтение XLSX (первый лист) и CSV без формул и макросов: берутся только сохранённые значения.
import JSZip from 'jszip'
import { DOMParser } from '@xmldom/xmldom'
import { DocumentReadError } from './docx'

export interface Sheet {
  name: string
  /** Значения ячеек как строки; числовые значения — как записаны в файле. */
  rows: string[][]
  /** Пометка, что значение ячейки — число (для дат в формате Excel). */
  numeric: boolean[][]
}

type XEl = {
  localName: string
  getAttribute(n: string): string | null
  getElementsByTagName(n: string): ArrayLike<XEl>
  textContent: string | null
}

const parse = (xml: string) => new DOMParser().parseFromString(xml, 'text/xml') as unknown as XEl

function colIndex(ref: string): number {
  const letters = ref.replace(/\d+/g, '')
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

export async function readXlsx(buffer: Uint8Array): Promise<Sheet> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(buffer)
  } catch {
    throw new DocumentReadError('файл не является книгой XLSX')
  }
  const wb = zip.file('xl/workbook.xml')
  if (!wb) throw new DocumentReadError('в архиве нет xl/workbook.xml — это не книга Excel')
  const wbDoc = parse(await wb.async('string'))
  const sheets = Array.from(wbDoc.getElementsByTagName('sheet'))
  const sheetName = sheets[0]?.getAttribute('name') ?? 'Лист1'

  const relsFile = zip.file('xl/_rels/workbook.xml.rels')
  let sheetPath = 'xl/worksheets/sheet1.xml'
  if (relsFile && sheets[0]) {
    const rid = sheets[0].getAttribute('r:id')
    const rels = Array.from(parse(await relsFile.async('string')).getElementsByTagName('Relationship'))
    const target = rels.find((r) => r.getAttribute('Id') === rid)?.getAttribute('Target')
    if (target) sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`
  }
  const shared: string[] = []
  const ss = zip.file('xl/sharedStrings.xml')
  if (ss) {
    for (const si of Array.from(parse(await ss.async('string')).getElementsByTagName('si'))) {
      shared.push(Array.from(si.getElementsByTagName('t')).map((t) => t.textContent ?? '').join(''))
    }
  }
  const sheetFile = zip.file(sheetPath)
  if (!sheetFile) throw new DocumentReadError(`в книге нет листа ${sheetPath}`)
  const sDoc = parse(await sheetFile.async('string'))
  const rows: string[][] = []
  const numeric: boolean[][] = []
  for (const row of Array.from(sDoc.getElementsByTagName('row'))) {
    const r = Number(row.getAttribute('r') ?? rows.length + 1) - 1
    rows[r] = rows[r] ?? []
    numeric[r] = numeric[r] ?? []
    for (const c of Array.from(row.getElementsByTagName('c'))) {
      const ref = c.getAttribute('r')
      const ci = ref ? colIndex(ref) : rows[r].length
      const t = c.getAttribute('t')
      let value = ''
      if (t === 'inlineStr') value = Array.from(c.getElementsByTagName('t')).map((x) => x.textContent ?? '').join('')
      else {
        const v = c.getElementsByTagName('v')[0]?.textContent ?? ''
        value = t === 's' ? (shared[Number(v)] ?? '') : v
      }
      rows[r][ci] = value
      numeric[r][ci] = !t || t === 'n'
    }
  }
  for (let i = 0; i < rows.length; i++) {
    rows[i] = Array.from(rows[i] ?? [], (v) => v ?? '')
    numeric[i] = Array.from(numeric[i] ?? [], (v) => !!v)
  }
  return { name: sheetName, rows, numeric }
}

export function readCsv(text: string): Sheet {
  const src = text.replace(/^﻿/, '')
  const firstLine = src.split(/\r?\n/, 1)[0] ?? ''
  const delim = (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) ? ';' : ','
  const rows: string[][] = []
  let row: string[] = []
  let cur = ''
  let q = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (q) {
      if (ch === '"' && src[i + 1] === '"') {
        cur += '"'
        i++
      } else if (ch === '"') q = false
      else cur += ch
    } else if (ch === '"') q = true
    else if (ch === delim) {
      row.push(cur)
      cur = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(cur)
      rows.push(row)
      row = []
      cur = ''
    } else cur += ch
  }
  if (cur || row.length) {
    row.push(cur)
    rows.push(row)
  }
  return { name: 'CSV', rows, numeric: rows.map((r) => r.map(() => false)) }
}
