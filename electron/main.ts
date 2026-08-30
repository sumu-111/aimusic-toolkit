import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CHANNELS,
  ErrorCode,
  type AnalysisResult,
  type AnalyzeReq,
  type CancelResult,
  type ExecutePlanReq,
  type ParseIntentReq,
  type Plan,
  type RenderResult,
  type Result,
} from '../src/types/contract.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const WORKER_EVENT_CHANNEL = 'worker_event'

function workerDown<T>(channel: string): Result<T> {
  return {
    ok: false,
    error: {
      error_code: ErrorCode.WORKER_DOWN,
      message: `Python worker is not available for ${channel}`,
    },
  }
}

function registerIpcHandlers() {
  ipcMain.handle(CHANNELS.analyze, (_event, payload: AnalyzeReq) => {
    console.info('[ipc-main] worker unavailable', CHANNELS.analyze, payload)
    return workerDown<AnalysisResult>(CHANNELS.analyze)
  })

  ipcMain.handle(CHANNELS.parse_intent, (_event, payload: ParseIntentReq) => {
    console.info('[ipc-main] worker unavailable', CHANNELS.parse_intent, payload)
    return workerDown<Plan>(CHANNELS.parse_intent)
  })

  ipcMain.handle(CHANNELS.execute_plan, (_event, payload: ExecutePlanReq) => {
    console.info('[ipc-main] worker unavailable', CHANNELS.execute_plan, payload)
    return workerDown<RenderResult>(CHANNELS.execute_plan)
  })

  ipcMain.handle('cancel', () => {
    console.info('[ipc-main] worker unavailable', 'cancel')
    return workerDown<CancelResult>('cancel')
  })
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1400,
    minHeight: 800,
    backgroundColor: '#0f1115',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    void win.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    void win.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(() => {
  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

export { WORKER_EVENT_CHANNEL }
