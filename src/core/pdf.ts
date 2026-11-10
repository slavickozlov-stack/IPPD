// Чтение текстового слоя PDF (pdf.js) без отрисовки, шрифтов, скриптов и eval. Скан без текста распознаётся как скан.
import type { DocModel, DocParagraph } from './model'
import { DocumentReadError, looksLikeHeading } from './docx'

export const MAX_PDF_PAGES = 400
/** Строка штампа АСУТД — присутствует и на сканах, поэтому не считается «текстом документа». */
const STAMP_RE = /^\s*АСУТД-\d+\./

export interface PdfRead {
  doc: DocModel
  pages: number
  /** full — есть текст документа; stamp-only — только штамп АСУТД; none — текста нет (скан). */
  textLayer: 'full' | 'stamp-only' | 'none'
}

type TextItem = { str: string; transform: number[]; hasEOL?: boolean }

export async function readPdf(buffer: Uint8Array, fileName: string): Promise<PdfRead> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  // В pdf.js 6 нет компиляции через eval/new Function; шрифты не подключаются, XFA выключен, скрипты документа не исполняются (только чтение текста).
  const task = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    disableFontFace: true,
    useSystemFonts: false,
    enableXfa: false,
    verbosity: 0
  })
  let pdf
  try {
    pdf = await task.promise
  } catch (e) {
    throw new DocumentReadError(`PDF не открывается: ${(e as Error).message}`)
  }
  const pages = pdf.numPages
  const paragraphs: DocParagraph[] = []
  let section: string | undefined
  let idx = 0
  let docChars = 0
  let stampLines = 0
  for (let n = 1; n <= Math.min(pages, MAX_PDF_PAGES); n++) {
    const page = await pdf.getPage(n)
    const tc = await page.getTextContent()
    const lines: string[] = []
    let cur = ''
    let lastY: number | null = null
    for (const it of tc.items as TextItem[]) {
      if (typeof it.str !== 'string') continue
      const y = Math.round(it.transform[5])
      if (lastY !== null && Math.abs(y - lastY) > 2) {
        lines.push(cur)
        cur = ''
      }
      cur += it.str
      lastY = y
      if (it.hasEOL) {
        lines.push(cur)
        cur = ''
        lastY = null
      }
    }
    if (cur) lines.push(cur)
    for (const raw of lines) {
      const text = raw.replace(/\s+/g, ' ').trim()
      if (!text) continue
      const stamp = STAMP_RE.test(text)
      if (stamp) stampLines++
      else docChars += text.length
      if (!stamp && looksLikeHeading(text)) section = text
      paragraphs.push({ kind: 'p', index: ++idx, text, page: n, section: stamp ? 'Колонтитул' : section })
    }
    page.cleanup()
  }
  await task.destroy()
  const textLayer = docChars > 200 ? 'full' : stampLines ? 'stamp-only' : 'none'
  return { doc: { fileName, blocks: paragraphs, paragraphs, tables: [] }, pages, textLayer }
}
