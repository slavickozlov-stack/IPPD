// Проверка переключателя темы: по умолчанию светлая (даже при тёмной теме ОС), выбор сохраняется после перезапуска.
import { _electron as electron } from 'playwright'
import electronPath from 'electron'
import { mkdirSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'e2e', 'output')
mkdirSync(out, { recursive: true })
const userData = join(tmpdir(), `ippd-theme-${process.pid}`)
const fails = []
const check = (c, m) => (console.log(`${c ? '✓' : '✗'} ${m}`), c || fails.push(m))
const launch = () => electron.launch({ executablePath: electronPath, args: [root, `--user-data-dir=${userData}`], colorScheme: 'dark' })
const bg = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor)

let app = await launch()
let page = await app.firstWindow()
await page.waitForSelector('text=1. Загрузка файлов')
check((await page.evaluate(() => document.documentElement.dataset.theme)) === 'light', 'по умолчанию — светлая тема')
check((await bg(page)) === 'rgb(246, 247, 249)', `светлый фон при тёмной теме ОС (${await bg(page)})`)
await page.screenshot({ path: join(out, 'theme-light.png') })
await page.click('.theme-switch >> text=Тёмная')
check((await bg(page)) === 'rgb(18, 22, 27)', 'переключение на тёмную')
await page.screenshot({ path: join(out, 'theme-dark.png') })
await page.click('.theme-switch >> text=Как в системе')
check((await bg(page)) === 'rgb(18, 22, 27)', '«Как в системе» следует тёмной теме ОС')
await page.click('.theme-switch >> text=Светлая')
await app.close()
app = await launch()
page = await app.firstWindow()
await page.waitForSelector('text=1. Загрузка файлов')
check((await bg(page)) === 'rgb(246, 247, 249)', 'выбор темы сохранился после перезапуска')
await app.close()
rmSync(userData, { recursive: true, force: true })
if (fails.length) process.exit(1)
