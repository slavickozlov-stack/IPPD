// Ограниченный мост: только перечисленные вызовы, без доступа к Node.js и ipcRenderer из страницы.
import { contextBridge, ipcRenderer } from 'electron'
import type { IppdApi } from '../shared/api'

const api: IppdApi = {
  pickFiles: (role) => ipcRenderer.invoke('files:pick', { role }),
  pickFolder: () => ipcRenderer.invoke('files:pickFolder'),
  removeFile: (id) => ipcRenderer.invoke('files:remove', { id }),
  clearFiles: () => ipcRenderer.invoke('files:clear'),
  loadDemo: () => ipcRenderer.invoke('demo:load'),
  extract: () => ipcRenderer.invoke('extract:run'),
  listProfiles: () => ipcRenderer.invoke('profiles:list'),
  importProfile: () => ipcRenderer.invoke('profiles:import'),
  runCheck: (payload) => ipcRenderer.invoke('check:run', payload),
  exportReport: () => ipcRenderer.invoke('report:export')
}

contextBridge.exposeInMainWorld('ippd', api)
