import { contextBridge } from 'electron'

const api = {
  getRuntime: () => 'electron',
}

contextBridge.exposeInMainWorld('api', api)
