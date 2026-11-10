// Сквозной прогон интерфейса в настоящем Electron: импорт демо-комплекта → сверка с ручной правкой → проверка → экспорт HTML.
import { _electron as electron } from 'playwright'
import electronPath from 'electron'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'e2e', 'output')
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
const exportPath = join(out, 'demo-report.html')
const fails = []
const check = (cond, msg) => {
  console.log(`${cond ? '✓' : '✗'} ${msg}`)
  if (!cond) fails.push(msg)
}

const app = await electron.launch({ executablePath: electronPath, args: [root], env: { ...process.env, IPPD_EXPORT_PATH: exportPath, IPPD_TEST_PICK_UMM_DIR: join(root, 'demo', 'образцы форм УММ'), IPPD_TEST_PICK_UMM: join(root, 'demo', JSON.parse(readFileSync(join(root, 'demo/manifest.json'), 'utf8')).extraUmm) } })
try {
  const page = await app.firstWindow()
  await page.waitForSelector('text=1. Загрузка файлов')
  const sec = await page.evaluate(() => ({ require: typeof window.require, process: typeof window.process, api: Object.keys(window.ippd ?? {}) }))
  check(sec.require === 'undefined' && sec.process === 'undefined', `в renderer нет Node.js (require: ${sec.require}, process: ${sec.process})`)
  check(sec.api.length === 10, `preload открывает только API ippd (${sec.api.join(', ')})`)
  const today = await page.inputValue('input[type=date]')
  check(/^\d{4}-\d{2}-\d{2}$/.test(today), `по умолчанию предложена текущая дата ${today}`)
  await page.screenshot({ path: join(out, '1-load-empty.png') })

  await page.click('text=Загрузить демо-комплект')
  await page.waitForSelector('text=ИППД.99.ДЕМО.001 (синтетика).docx')
  check((await page.inputValue('input[type=date]')) === '2026-12-01', 'демо-комплект подставил дату 01.12.2026')
  await page.click('text=Папка…')
  await page.waitForSelector('text=Добавлено файлов из папки: 3')
  check(true, 'импорт папки с УММ добавил 3 файла (DOCX, PDF с текстом, скан со штампом)')
  await page.screenshot({ path: join(out, '1-load-demo.png') })
  await page.click('text=Извлечь данные →')
  await page.waitForSelector('text=2. Сверка извлечённых данных')
  check(await page.isVisible('text=Разбор полный'), 'разбор демо-ИППД полный')
  const pdfRow = page.locator('tr', { hasText: 'УММ АСУТД (синтетика).pdf' })
  check((await pdfRow.textContent()).includes('PDF с текстом') && (await pdfRow.textContent()).includes('31.01.2030'), 'PDF-УММ: распознан текстовый слой, дата окончания 31.01.2030')
  const scanRow = page.locator('tr', { hasText: 'скан со штампом.pdf' })
  check((await scanRow.textContent()).includes('только штамп АСУТД') && (await scanRow.textContent()).includes('заменён'), 'скан: статус «заменён» прочитан из штампа АСУТД')
  await page.screenshot({ path: join(out, '2-review.png'), fullPage: true })

  // Ручной ввод реквизитов для PDF-скана
  const row = page.locator('tr', { hasText: 'ИОТ.99.01 изм.3 (скан).pdf' })
  await row.locator('text=изменить').click()
  const editor = page.locator('.editor')
  await editor.locator('label:has-text("Статус") select').first().selectOption('действующий')
  await editor.locator('label:has-text("Окончание действия") input').fill('31.12.2027')
  await editor.locator('label:has-text("Обоснование") input').fill('Сверено с карточкой АСУТД (синтетика)')
  await editor.locator('button.primary').click()
  check(await row.locator('.manual').count() >= 2, 'ручные правки отображаются в таблице УММ')
  await page.check('text=Извлечённые данные сверены')
  await page.click('text=Далее →')
  await page.waitForSelector('text=3. Запуск проверки')
  await page.screenshot({ path: join(out, '3-run.png'), fullPage: true })
  await page.click('text=Запустить проверку')
  await page.waitForSelector('text=4. Отчёт')
  const verdict = await page.textContent('.verdict-title')
  check(verdict === 'Есть замечания', `итог «${verdict}»`)
  const body = await page.textContent('main')
  for (const st of ['действует', 'срок действия истёк', 'заменён', 'отменён', 'просрочен пересмотр', 'не найден в загруженных материалах'])
    check(body.includes(st), `в отчёте есть статус «${st}»`)
  check(body.includes('Замена:') && body.includes('I.К1.Т20.УМСИ.ДЕМО.0207.2025'), 'для заменённого УММ показан заменяющий документ')
  await page.screenshot({ path: join(out, '4-report-umm.png'), fullPage: true })

  // фильтр статусов
  await page.locator('.chip-filter', { hasText: 'действует' }).locator('input').uncheck()
  const rowsAfter = await page.locator('tbody tr .chip.s-in_force').count()
  check(rowsAfter === 0, 'фильтр скрывает строки со статусом «действует»')

  await page.click('role=tab[name=/Нормоконтроль/]')
  const nc = await page.textContent('main')
  check(nc.includes('NC-30') && nc.includes('пустая ячейка'), 'нормоконтроль: пустая обязательная ячейка')
  check(nc.includes('NC-61') && nc.includes('вид УММ «ПАЗ»'), 'нормоконтроль: форма обучения и вид УММ')
  await page.screenshot({ path: join(out, '4-report-nc.png'), fullPage: true })

  await page.click('text=Экспорт HTML…')
  await page.waitForSelector('text=Отчёт сохранён')
  check(existsSync(exportPath), `HTML-отчёт записан: ${exportPath}`)
  const html = readFileSync(exportPath, 'utf8')
  check(html.includes('ДЕМОНСТРАЦИОННЫЙ ПРОФИЛЬ') && html.includes('1. Актуальность УММ') && html.includes('2. Нормоконтроль ИППД'), 'HTML содержит пометку ДЕМО и оба раздела')
  check(html.includes('Сверено с карточкой АСУТД (синтетика)'), 'HTML содержит журнал ручных правок')
  check(!/https?:\/\//.test(html.replace(/http:\/\/json-schema\.org[^"]*/g, '')), 'HTML не ссылается на внешние ресурсы')

  // Загрузка новой редакции УММ из отчёта — ссылки пересматриваются сразу
  await page.click('role=tab[name=/Актуальность УММ/]')
  await page.click('text=Добавить УММ и перепроверить…')
  await page.waitForSelector('text=Добавлено УММ: 1')
  const row11 = page.locator('tbody tr', { hasText: 'Средства коллективной' }).first()
  check((await row11.textContent()).includes('заменён') && (await row11.textContent()).includes('0301.2026'), 'после добавления новой редакции тема 1.1 сразу получила статус «заменён» со ссылкой на 0301.2026')
  check((await page.textContent('.verdict-title')) === 'Проверка неполная', 'пока новые реквизиты не сверены, итог — «Проверка неполная»')
  await page.screenshot({ path: join(out, '5-recheck.png'), fullPage: true })
} finally {
  await app.close()
}
if (fails.length) {
  console.error(`\nНе прошло проверок: ${fails.length}`)
  process.exit(1)
}
console.log('\nE2E: все проверки пройдены. Скриншоты и отчёт: e2e/output/')
