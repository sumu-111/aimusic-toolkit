import { app, BrowserWindow, ipcMain } from 'electron'
import fs from 'node:fs/promises'
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
  type ProjectFile,
  type RenderResult,
  type Result,
  type SaveProjectResult,
} from '../src/types/contract.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const WORKER_EVENT_CHANNEL = 'worker_event'
const PROJECT_FILE_NAME = 'project.json'

function workerDown<T>(channel: string): Result<T> {
  return {
    ok: false,
    error: {
      error_code: ErrorCode.WORKER_DOWN,
      message: `Python worker is not available for ${channel}`,
    },
  }
}

function ok<T>(data: T): Result<T> {
  return { ok: true, data }
}

function fail<T>(message: string): Result<T> {
  return {
    ok: false,
    error: {
      error_code: ErrorCode.PRECHECK_FAILED,
      message,
    },
  }
}

function getProjectPath() {
  return path.join(app.getPath('userData'), PROJECT_FILE_NAME)
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

  ipcMain.handle(
    CHANNELS.save_project,
    async (_event, project: ProjectFile): Promise<Result<SaveProjectResult>> => {
      try {
        const projectPath = getProjectPath()

        await fs.mkdir(path.dirname(projectPath), { recursive: true })
        await fs.writeFile(projectPath, JSON.stringify(project, null, 2), 'utf8')

        return ok({ saved: true, path: projectPath })
      } catch (error) {
        return fail<SaveProjectResult>(
          error instanceof Error ? error.message : String(error),
        )
      }
    },
  )

  ipcMain.handle(
    CHANNELS.load_project,
    async (): Promise<Result<ProjectFile | null>> => {
      try {
        const projectPath = getProjectPath()

        try {
          await fs.access(projectPath)
        } catch {
          return ok(null)
        }

        const rawProject = await fs.readFile(projectPath, 'utf8')

        return ok(JSON.parse(rawProject) as ProjectFile)
      } catch (error) {
        return fail<ProjectFile | null>(
          error instanceof Error ? error.message : String(error),
        )
      }
    },
  )
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
