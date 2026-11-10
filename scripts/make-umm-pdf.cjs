// Синтетические PDF-образцы УММ с настоящим текстовым слоем (печать Chromium) и «скан» только со штампом АСУТД.
// Запуск: npm run demo:pdf. Строки совпадают с ASUTD_UMM из scripts/demoBuilder.ts.
const { app, BrowserWindow } = require('electron')
const { writeFileSync, mkdirSync, mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

const SYNTH = 'СИНТЕТИЧЕСКИЙ ДОКУМЕНТ ДЛЯ ДЕМОНСТРАЦИИ. Не является документом предприятия.'
const header = 'I.К5.Т40.УМСИ.ДЕМО.0401.2025 «зам» 2'
const stamp = 'АСУТД-2. Действующий. № 99401 от 20.01.2025. Печать 01.11.2026.'
const oldStamp = 'АСУТД-2. Заменён. № 99220 от 01.03.2021. Печать 01.11.2026.'
const lines = [
  SYNTH, 'Филиал «Демонстрационная атомная станция»', 'УТВЕРЖДАЮ', 'Начальник УТП ДЕМО', '(подпись)', '«15» января 2025 г.',
  'Учебный материал для самостоятельного изучения', '«Средства пожаротушения»', 'I.К5.Т40.УМСИ.ДЕМО.0401.2025',
  'Дата введения в действие 01.02.2025', 'Дата окончания действия 31.01.2030', 'Предисловие',
  '1 РАЗРАБОТАН Учебно-тренировочным подразделением (синтетика)', '2 ВВЕДЕН В ДЕЙСТВИЕ распоряжением от 20.01.2025 № 9/ДЕМО-1',
  '3 ВЗАМЕН Учебного материала «Средства пожаротушения»', 'I.К5.Т40.УМСИ.ДЕМО.0220.2021, утверждённого 10.03.2021.',
  '1 Цели изучения', 'Текст учебного материала отсутствует: документ создан только для проверки чтения реквизитов.'
]
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
const page = (body) => `<!doctype html><meta charset="utf-8"><style>body{font:14px Arial,sans-serif;margin:0}p{margin:0 0 8px}</style>${body}`
const tpl = (t) => `<div style="font-size:9px;width:100%;text-align:center;font-family:Arial">${esc(t)}</div>`

async function print(html, withHeader, footer = stamp) {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } })
  const dir = mkdtempSync(join(tmpdir(), 'ippd-pdf-'))
  const file = join(dir, 'page.html')
  writeFileSync(file, html)
  await win.loadFile(file)
  rmSync(dir, { recursive: true, force: true })
  const pdf = await win.webContents.printToPDF({
    pageSize: 'A4',
    displayHeaderFooter: true,
    headerTemplate: withHeader ? tpl(header) : '<span></span>',
    footerTemplate: tpl(footer),
    margins: { top: 0.8, bottom: 0.8, left: 0.8, right: 0.6 }
  })
  win.destroy()
  return pdf
}

// Окна печати закрываются по одному — приложение не должно завершаться между ними.
app.on('window-all-closed', () => {})

app.whenReady().then(async () => {
  const out = join(__dirname, '..', 'demo', 'образцы форм УММ')
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, 'УММ АСУТД (синтетика).pdf'), await print(page(lines.map((l) => `<p>${esc(l)}</p>`).join('')), true))
  // «Скан»: на странице нет текста документа (только рамка), текстовый слой есть лишь у штампа АСУТД
  writeFileSync(
    join(out, 'I.К5.Т40.УМСИ.ДЕМО.0220.2021 скан со штампом.pdf'),
    await print(page('<div style="height:900px;border:2px solid #999"></div>'), false, oldStamp)
  )
  console.log('PDF-образцы записаны в', out)
  app.quit()
})
