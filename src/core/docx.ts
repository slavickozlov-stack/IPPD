// Чтение DOCX без исполнения содержимого: читается только XML основного текста и колонтитулов.
import JSZip from 'jszip'
import { DOMParser } from '@xmldom/xmldom'
import type { DocBlock, DocModel, DocParagraph, DocTable } from './model'

export class DocumentReadError extends Error {}

const MAX_XML_BYTES = 40 * 1024 * 1024

type XNode = { nodeType: number; localName?: string | null; childNodes?: ArrayLike<XNode>; nodeValue?: string | null; getAttribute?: (n: string) => string | null }

const children = (n: XNode): XNode[] => (n.childNodes ? Array.from(n.childNodes) : [])
const isEl = (n: XNode, name: string) => n.nodeType === 1 && n.localName === name

function runText(node: XNode, out: string[]): void {
  for (const c of children(node)) {
    if (c.nodeType !== 1) continue
    switch (c.localName) {
      case 't':
        out.push(children(c).map((x) => x.nodeValue ?? '').join(''))
        break
      case 'tab':
        out.push('\t')
        break
      case 'br':
      case 'cr':
        out.push('\n')
        break
      case 'delText':
      case 'instrText':
      case 'del':
        break
      case 'tbl':
        // вложенная таблица внутри ячейки — берём текст построчно
        out.push(tableRows(c).map((r) => r.join(' | ')).join('\n'))
        break
      default:
        runText(c, out)
    }
  }
}

function paragraphText(p: XNode): string {
  const out: string[] = []
  runText(p, out)
  return out.join('').replace(/[ ]/g, ' ')
}

function paragraphStyle(p: XNode): string | undefined {
  for (const c of children(p)) {
    if (isEl(c, 'pPr')) {
      for (const d of children(c)) if (isEl(d, 'pStyle')) return d.getAttribute?.('w:val') ?? undefined
    }
  }
  return undefined
}

function cellText(tc: XNode): string {
  const parts: string[] = []
  for (const c of children(tc)) {
    if (isEl(c, 'p')) parts.push(paragraphText(c))
    else if (isEl(c, 'tbl')) parts.push(tableRows(c).map((r) => r.join(' | ')).join('\n'))
    else if (isEl(c, 'sdt')) for (const d of children(c)) if (isEl(d, 'sdtContent')) parts.push(cellText(d))
  }
  return parts
    .map((s) => s.trim())
    .filter(Boolean)
    .join('\n')
}

function tableRows(tbl: XNode): string[][] {
  const rows: string[][] = []
  const collectRow = (tr: XNode) => {
    const cells: string[] = []
    const visit = (n: XNode) => {
      for (const c of children(n)) {
        if (isEl(c, 'tc')) cells.push(cellText(c))
        else if (isEl(c, 'sdt')) for (const d of children(c)) if (isEl(d, 'sdtContent')) visit(d)
      }
    }
    visit(tr)
    rows.push(cells)
  }
  const visitTbl = (n: XNode) => {
    for (const c of children(n)) {
      if (isEl(c, 'tr')) collectRow(c)
      else if (isEl(c, 'sdt')) for (const d of children(c)) if (isEl(d, 'sdtContent')) visitTbl(d)
    }
  }
  visitTbl(tbl)
  return rows
}

/** Абзац похож на заголовок раздела: «3.1 Тематический план…», «Приложение А», «Библиография». */
export function looksLikeHeading(text: string): boolean {
  const t = text.trim()
  if (!t || t.length > 140) return false
  if (/^(\d+(\.\d+){0,3})\.?\s+[А-ЯЁA-Z«]/.test(t) && !/[;,]$/.test(t)) return true
  if (/^(Приложение\s+[А-ЯЁA-Z]?|Библиография|Содержание|Лист регистрации изменений|Лист согласования)\b/i.test(t)) return true
  return false
}

function parseXml(xml: string, what: string): XNode {
  const errors: string[] = []
  const doc = new DOMParser({
    onError: (level: string, msg: string) => {
      if (level !== 'warning') errors.push(msg)
    }
  }).parseFromString(xml, 'text/xml') as unknown as XNode
  if (errors.length) throw new DocumentReadError(`повреждён XML (${what}): ${errors[0]}`)
  return doc
}

export async function readDocx(buffer: Uint8Array, fileName: string): Promise<DocModel> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(buffer)
  } catch {
    throw new DocumentReadError('файл не является архивом DOCX (возможно, это DOC, PDF или повреждённый файл)')
  }
  const main = zip.file('word/document.xml')
  if (!main) throw new DocumentReadError('в архиве нет word/document.xml — это не документ Word')
  const xml = await main.async('string')
  if (xml.length > MAX_XML_BYTES) throw new DocumentReadError('документ слишком большой для разбора')
  const doc = parseXml(xml, 'document.xml')

  const blocks: DocBlock[] = []
  const paragraphs: DocParagraph[] = []
  const tables: DocTable[] = []
  let section: string | undefined
  let pIndex = 0
  let tIndex = 0

  const pushParagraph = (text: string, style?: string, forcedSection?: string) => {
    const t = text.replace(/\s+$/g, '')
    if (!t.trim()) return
    pIndex++
    if (!forcedSection && looksLikeHeading(t)) section = t.trim()
    const p: DocParagraph = { kind: 'p', index: pIndex, text: t, style, section: forcedSection ?? section }
    blocks.push(p)
    paragraphs.push(p)
  }

  const walkBody = (node: XNode) => {
    for (const c of children(node)) {
      if (isEl(c, 'p')) pushParagraph(paragraphText(c), paragraphStyle(c))
      else if (isEl(c, 'tbl')) {
        tIndex++
        const t: DocTable = { kind: 't', index: tIndex, rows: tableRows(c), section, afterParagraph: pIndex }
        blocks.push(t)
        tables.push(t)
      } else if (isEl(c, 'sdt')) {
        for (const d of children(c)) if (isEl(d, 'sdtContent')) walkBody(d)
      }
    }
  }
  const body = children(doc)
    .flatMap((n) => children(n))
    .find((n) => isEl(n, 'body'))
  if (!body) throw new DocumentReadError('в документе нет тела w:body')
  walkBody(body)

  // Колонтитулы: штамп АСУТД, номер изменения и т. п. Абзацы колонтитулов идут после основного текста.
  const hf = Object.keys(zip.files)
    .filter((n) => /^word\/(header|footer)\d*\.xml$/.test(n))
    .sort()
  for (const name of hf) {
    const x = await zip.file(name)!.async('string')
    if (x.length > MAX_XML_BYTES) continue
    const hdoc = parseXml(x, name)
    const visit = (n: XNode) => {
      for (const c of children(n)) {
        if (isEl(c, 'p')) pushParagraph(paragraphText(c), undefined, 'Колонтитул')
        else visit(c)
      }
    }
    visit(hdoc)
  }

  return { fileName, blocks, paragraphs, tables }
}

/** Сравнение заголовков без учёта пробелов, переносов и регистра («Наименованиекурса» = «Наименование курса»). */
export const squash = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/[\s­-]+/g, '')
