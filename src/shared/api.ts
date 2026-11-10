// Контракт между renderer и main. Renderer видит только эти функции через preload.
import type { CheckReport, ExtractionBundle, FileRole, IsoDate } from '../core/model'
import type { ManualEdit } from '../core/pipeline'

export interface FileEntry {
  id: string
  name: string
  role: FileRole
  size: number
}

export interface ProfileSummary {
  id: string
  name: string
  version: string
  mode: 'demo' | 'work'
  description: string
  sha256: string
  ruleCount: number
  appliedRuleCount: number
  coverage: CheckReport['coverage']
  origin: 'bundled' | 'imported'
}

export type ClientBundle = Omit<ExtractionBundle, 'ippdDoc'>

export interface RunPayload {
  checkDate: IsoDate
  profileId: string
  confirmed: boolean
  edits: ManualEdit[]
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string }

export interface IppdApi {
  pickFiles(role: FileRole): Promise<Result<FileEntry[]>>
  /** Папка с УММ: файлы DOCX/PDF (и DOC/ODT/RTF — для сообщения о формате) во вложенных папках. */
  pickFolder(): Promise<Result<{ files: FileEntry[]; added: number; limited: boolean }>>
  removeFile(id: string): Promise<Result<FileEntry[]>>
  clearFiles(): Promise<Result<FileEntry[]>>
  loadDemo(): Promise<Result<{ files: FileEntry[]; checkDate: IsoDate; profileId: string }>>
  extract(): Promise<Result<ClientBundle>>
  listProfiles(): Promise<Result<{ profiles: ProfileSummary[]; errors: string[] }>>
  importProfile(): Promise<Result<{ profiles: ProfileSummary[]; errors: string[]; imported: string | null }>>
  runCheck(payload: RunPayload): Promise<Result<CheckReport>>
  exportReport(): Promise<Result<string | null>>
}

declare global {
  interface Window {
    ippd: IppdApi
  }
}
