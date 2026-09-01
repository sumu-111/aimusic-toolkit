import { app, BrowserWindow, ipcMain } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CHANNELS,
  ErrorCode,
  type AnalyzeReq,
  type CancelResult,
  type ExecutePlanReq,
  type ParseIntentReq,
  type ProjectFile,
  type ReadFileDataUrlResult,
  type Result,
  type SaveProjectResult,
} from '../src/types/contract.js'
import {
  analyzeTrack,
  cancelExecution,
  executePlanTrack,
  parseIntentTrack,
} from './workerBridge.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const WORKER_EVENT_CHANNEL = 'worker_event'
const PROJECT_FILE_NAME = 'project.json'

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
  // 以下四个 handler 桥接到 Python Flask worker（workerBridge.ts）。
  ipcMain.handle(CHANNELS.analyze, (_event, payload: AnalyzeReq) => {
    console.info('[ipc-main] analyze', payload.track_id, payload.file_path)
    return analyzeTrack(payload)
  })

  ipcMain.handle(CHANNELS.parse_intent, (_event, payload: ParseIntentReq) => {
    console.info('[ipc-main] parse_intent', payload.text)
    return parseIntentTrack(payload)
  })

  ipcMain.handle(CHANNELS.execute_plan, (_event, payload: ExecutePlanReq) => {
    console.info('[ipc-main] execute_plan', payload.plan_id)
    return executePlanTrack(payload)
  })

  ipcMain.handle('cancel', (): Result<CancelResult> => {
    console.info('[ipc-main] cancel')
    return cancelExecution()
  })

  // 渲染产物 WAV → data URL：渲染进程被 Chromium 禁止加载 file:// 本地资源。
  // 仅放行 .wav 且文件存在的场景，返回 base64 data URL 供 wavesurfer 播放。
  ipcMain.handle(
    CHANNELS.read_file_data_url,
    async (_event, filePath: string): Promise<Result<ReadFileDataUrlResult>> => {
      try {
        if (typeof filePath !== 'string' || !filePath.toLowerCase().endsWith('.wav')) {
          return fail<ReadFileDataUrlResult>('仅支持 .wav 文件')
        }
        const stat = await fs.stat(filePath)
        if (!stat.isFile()) {
          return fail<ReadFileDataUrlResult>('文件不存在')
        }
        const data = await fs.readFile(filePath)
        const dataUrl = `data:audio/wav;base64,${data.toString('base64')}`
        return ok({ dataUrl, sizeBytes: data.byteLength })
      } catch (error) {
        return fail<ReadFileDataUrlResult>(
          error instanceof Error ? error.message : String(error),
        )
      }
    },
  )

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
    minWidth: 1600,
    minHeight: 1000,
    backgroundColor: '#0f1115',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  win.maximize()

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
