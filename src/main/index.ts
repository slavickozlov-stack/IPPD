// Main-процесс: окно с изолированным renderer, файловые диалоги и обработка документов локально.
import { app, BrowserWindow, dialog, ipcMain, session, type IpcMainInvokeEvent } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { copyFileSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { z } from 'zod'
import type { CheckReport, ExtractionBundle, FileRole } from '../core/model'
import { extractAll, runCheck, MAX_FILE_BYTES } from '../core/pipeline'
import { renderReportHtml } from '../core/reportHtml'
import { coverage } from '../core/rules/engine'
import { isApplied } from '../core/profile'
import type { TemplateSet } from '../core/templates'
import type { ClientBundle, FileEntry, ProfileSummary, Result } from '../shared/api'
import { loadProfileFile, loadProfiles, loadTemplates, type LoadedProfile } from './resources'

const DEV_URL = process.env['ELECTRON_RENDERER_URL']
const resDir = (name: string) => (app.isPackaged ? join(process.resourcesPath, name) : join(app.getAppPath(), name))
const userProfilesDir = () => join(app.getPath('userData'), 'profiles')

interface Registered extends FileEntry {
  path: string
}

const state = {
  files: new Map<string, Registered>(),
  bundle: null as ExtractionBundle | null,
  report: null as CheckReport | null,
  profiles: [] as (LoadedProfile & { origin: 'bundled' | 'imported' })[],
  profileErrors: [] as string[],
  templates: null as TemplateSet | null
}

function reloadProfiles() {
  const bundled = loadProfiles([resDir('profiles')])
  const imported = loadProfiles([userProfilesDir()])
  state.profiles = [
    ...bundled.profiles.map((p) => ({ ...p, origin: 'bundled' as const })),
    ...imported.profiles.filter((p) => !bundled.profiles.some((b) => b.profile.id === p.profile.id)).map((p) => ({ ...p, origin: 'imported' as const }))
  ]
  state.profileErrors = [...bundled.errors, ...imported.errors]
}

function profileSummaries(): { profiles: ProfileSummary[]; errors: string[] } {
  return {
    profiles: state.profiles.map(({ profile: p, sha256, origin }) => ({
      id: p.id,
      name: p.name,
      version: p.version,
      mode: p.mode,
      description: p.description,
      sha256,
      ruleCount: p.rules.length,
      appliedRuleCount: p.rules.filter((r) => isApplied(r.approval, p.mode)).length,
      coverage: coverage(p),
      origin
    })),
    errors: state.profileErrors
  }
}

const fileList = (): FileEntry[] => [...state.files.values()].map(({ path: _p, ...f }) => f)

function register(path: string, role: FileRole): Registered {
  const st = statSync(path)
  if (!st.isFile()) throw new Error(`${basename(path)}: это не файл`)
  const entry: Registered = { id: randomUUID(), name: basename(path), role, size: st.size, path }
  if (role === 'ippd' || role === 'registry') for (const [id, f] of state.files) if (f.role === role) state.files.delete(id)
  for (const f of state.files.values()) if (f.path === path) return f
  state.files.set(entry.id, entry)
  state.bundle = null
  state.report = null
  return entry
}

const UMM_EXT = new Set(['.docx', '.pdf', '.doc', '.odt', '.rtf'])
export const MAX_FOLDER_FILES = 500

/** Файлы УММ в папке и подпапках (до 5 уровней), без скрытых и временных файлов Word «~$…». */
function collectUmm(dir: string, depth = 0, out: string[] = []): string[] {
  if (depth > 5 || out.length >= MAX_FOLDER_FILES) return out
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'ru'))) {
    if (e.name.startsWith('.') || e.name.startsWith('~$')) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) collectUmm(p, depth + 1, out)
    else if (e.isFile() && UMM_EXT.has(extname(e.name).toLowerCase())) out.push(p)
    if (out.length >= MAX_FOLDER_FILES) break
  }
  return out
}

const FILTERS: Record<FileRole, Electron.FileFilter[]> = {
  ippd: [{ name: 'ИППД (Word)', extensions: ['docx'] }],
  umm: [{ name: 'УММ (Word, PDF)', extensions: ['docx', 'pdf', 'doc', 'odt', 'rtf'] }],
  registry: [{ name: 'Реестр (Excel, CSV)', extensions: ['xlsx', 'csv'] }]
}

const roleSchema = z.enum(['ippd', 'umm', 'registry'])
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const editSchema = z.object({
  target: z.enum(['umm', 'ref']),
  id: z.string().min(1).max(200),
  field: z.enum(['designation', 'title', 'revision', 'status', 'statusAsOf', 'validFrom', 'validTo', 'reviewDue', 'approvedAt', 'replacedBy']),
  value: z.string().max(500),
  note: z.string().max(1000)
})
const runSchema = z.object({
  checkDate: isoDate,
  profileId: z.string().min(1).max(100),
  confirmed: z.boolean(),
  edits: z.array(editSchema).max(2000)
})

function trusted(e: IpcMainInvokeEvent): boolean {
  const url = e.senderFrame?.url ?? ''
  return DEV_URL ? url.startsWith(DEV_URL) : url.startsWith('file://')
}

function handle<T>(channel: string, fn: (e: IpcMainInvokeEvent, arg: unknown) => Promise<T> | T) {
  ipcMain.handle(channel, async (e, arg): Promise<Result<T>> => {
    if (!trusted(e)) return { ok: false, error: 'запрос отклонён: неизвестный источник' }
    try {
      return { ok: true, value: await fn(e, arg) }
    } catch (err) {
      const msg = err instanceof z.ZodError ? `некорректные данные запроса: ${err.issues.map((i) => i.path.join('.') + ' ' + i.message).join('; ')}` : (err as Error).message
      return { ok: false, error: msg }
    }
  })
}

function registerIpc() {
  handle('files:pick', async (e, arg) => {
    const { role } = z.object({ role: roleSchema }).parse(arg)
    const win = BrowserWindow.fromWebContents(e.sender)!
    // Для сквозного теста: путь к УММ подставляется вместо системного диалога.
    const testPick = role === 'umm' ? process.env.IPPD_TEST_PICK_UMM : undefined
    if (testPick) {
      register(testPick, role)
      return fileList()
    }
    const res = await dialog.showOpenDialog(win, {
      title: role === 'ippd' ? 'Выберите ИППД' : role === 'umm' ? 'Выберите файлы УММ' : 'Выберите реестр УММ',
      properties: role === 'umm' ? ['openFile', 'multiSelections'] : ['openFile'],
      filters: FILTERS[role]
    })
    if (!res.canceled) for (const p of res.filePaths) register(p, role)
    return fileList()
  })
  handle('files:pickFolder', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)!
    const dir = process.env.IPPD_TEST_PICK_UMM_DIR ?? (await dialog.showOpenDialog(win, { title: 'Выберите папку с УММ', properties: ['openDirectory'] })).filePaths[0]
    if (!dir) return { files: fileList(), added: 0, limited: false }
    const before = state.files.size
    const found = collectUmm(dir)
    for (const p of found) register(p, 'umm')
    return { files: fileList(), added: state.files.size - before, limited: found.length >= MAX_FOLDER_FILES }
  })
  handle('files:remove', (_e, arg) => {
    const { id } = z.object({ id: z.string().max(100) }).parse(arg)
    state.files.delete(id)
    state.bundle = null
    return fileList()
  })
  handle('files:clear', () => {
    state.files.clear()
    state.bundle = null
    state.report = null
    return fileList()
  })
  handle('demo:load', () => {
    const dir = resDir('demo')
    const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as { ippd: string; umm: string[]; registry: string; checkDate: string; profile: string }
    state.files.clear()
    register(join(dir, m.ippd), 'ippd')
    for (const u of m.umm) register(join(dir, u), 'umm')
    register(join(dir, m.registry), 'registry')
    return { files: fileList(), checkDate: m.checkDate, profileId: m.profile }
  })
  handle('extract:run', async (): Promise<ClientBundle> => {
    if (!state.templates) state.templates = loadTemplates(resDir('templates'))
    const inputs = []
    const readErrors: { id: string; name: string; role: FileRole; message: string }[] = []
    for (const f of state.files.values()) {
      try {
        if (statSync(f.path).size > MAX_FILE_BYTES) throw new Error('файл больше 60 МБ')
        // Только чтение: файл открывается флагом 'r' и не изменяется.
        inputs.push({ id: f.id, name: f.name, role: f.role, data: new Uint8Array(await readFile(f.path, { flag: 'r' })) })
      } catch (err) {
        readErrors.push({ id: f.id, name: f.name, role: f.role, message: `не удалось прочитать файл: ${(err as NodeJS.ErrnoException).code ?? (err as Error).message}` })
      }
    }
    const bundle = await extractAll(inputs, state.templates)
    for (const r of readErrors) {
      bundle.files.push({ id: r.id, name: r.name, role: r.role, size: 0, sha256: '', format: 'unknown', error: r.message })
      bundle.fileIssues.push({ fileId: r.id, fileName: r.name, message: r.message })
    }
    state.bundle = bundle
    state.report = null
    const { ippdDoc: _doc, ...client } = bundle
    return client
  })
  handle('profiles:list', () => {
    reloadProfiles()
    return profileSummaries()
  })
  handle('profiles:import', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)!
    const res = await dialog.showOpenDialog(win, { title: 'Импорт профиля правил (JSON)', properties: ['openFile'], filters: [{ name: 'Профиль правил', extensions: ['json'] }] })
    if (res.canceled || !res.filePaths[0]) return { ...profileSummaries(), imported: null }
    const src = res.filePaths[0]
    const lp = loadProfileFile(src) // проверка схемы до копирования
    mkdirSync(userProfilesDir(), { recursive: true })
    copyFileSync(src, join(userProfilesDir(), `${lp.profile.id}.profile.json`))
    reloadProfiles()
    return { ...profileSummaries(), imported: `${lp.profile.name} ${lp.profile.version}` }
  })
  handle('check:run', (_e, arg) => {
    const p = runSchema.parse(arg)
    if (!state.bundle) throw new Error('сначала выполните извлечение данных')
    const lp = state.profiles.find((x) => x.profile.id === p.profileId)
    if (!lp) throw new Error(`профиль ${p.profileId} не найден`)
    state.report = runCheck(state.bundle, lp.profile, { checkDate: p.checkDate, confirmed: p.confirmed, edits: p.edits, profileSha256: lp.sha256 })
    return state.report
  })
  handle('report:export', async (e) => {
    if (!state.report) throw new Error('нет отчёта для экспорта')
    const win = BrowserWindow.fromWebContents(e.sender)!
    const name = `Отчёт ${state.report.ippd?.registrationNumber ?? 'ИППД'} на ${state.report.checkDate}.html`.replace(/[\\/:*?"<>|]/g, '_')
    const target = process.env.IPPD_EXPORT_PATH ?? (await dialog.showSaveDialog(win, { title: 'Сохранить отчёт', defaultPath: join(app.getPath('documents'), name), filters: [{ name: 'HTML', extensions: ['html'] }] })).filePath
    if (!target) return null
    const html = renderReportHtml(state.report)
    writeFileSync(target, html, 'utf8')
    return `${target} (SHA-256 ${createHash('sha256').update(html).digest('hex').slice(0, 12)}…)`
  })
}

function lockDown() {
  // Никаких сетевых запросов: разрешены только локальные ресурсы приложения (и dev-сервер в режиме разработки).
  session.defaultSession.webRequest.onBeforeRequest((details, cb) => {
    const u = details.url
    const allowed = u.startsWith('file://') || u.startsWith('devtools://') || (DEV_URL && (u.startsWith(DEV_URL) || u.startsWith(DEV_URL.replace('http', 'ws'))))
    cb({ cancel: !allowed })
  })
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
  app.on('web-contents-created', (_e, wc) => {
    wc.setWindowOpenHandler(() => ({ action: 'deny' }))
    wc.on('will-navigate', (ev, url) => {
      if (url !== wc.getURL()) ev.preventDefault()
    })
    wc.on('will-attach-webview', (ev) => ev.preventDefault())
  })
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: 'ИППД Контроль',
    backgroundColor: '#f6f7f9',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false
    }
  })
  if (DEV_URL) win.loadURL(DEV_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(() => {
  lockDown()
  reloadProfiles()
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
