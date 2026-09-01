import {
  contextBridge,
  ipcRenderer,
  webUtils,
  type IpcRendererEvent,
} from 'electron'
import {
  CHANNELS,
  type AnalysisResult,
  type AnalyzeReq,
  type CancelResult,
  type ExecutePlanReq,
  type ParseIntentReq,
  type Plan,
  type ProjectFile,
  type ReadFileDataUrlResult,
  type RenderResult,
  type Result,
  type SaveProjectResult,
  type WorkerEvent,
} from '../src/types/contract.js'

const WORKER_EVENT_CHANNEL = 'worker_event'

const api = {
  /** 渲染进程 File → 磁盘真实路径（Electron 官方 webUtils API）。 */
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  readFileAsDataUrl: (filePath: string) =>
    ipcRenderer.invoke(CHANNELS.read_file_data_url, filePath) as Promise<
      Result<ReadFileDataUrlResult>
    >,
  analyze: (req: AnalyzeReq) =>
    ipcRenderer.invoke(CHANNELS.analyze, req) as Promise<Result<AnalysisResult>>,
  parseIntent: (req: ParseIntentReq) =>
    ipcRenderer.invoke(CHANNELS.parse_intent, req) as Promise<Result<Plan>>,
  executePlan: (req: ExecutePlanReq) =>
    ipcRenderer.invoke(CHANNELS.execute_plan, req) as Promise<
      Result<RenderResult>
    >,
  cancel: () => ipcRenderer.invoke('cancel') as Promise<Result<CancelResult>>,
  saveProject: (project: ProjectFile) =>
    ipcRenderer.invoke(CHANNELS.save_project, project) as Promise<
      Result<SaveProjectResult>
    >,
  loadProject: () =>
    ipcRenderer.invoke(CHANNELS.load_project) as Promise<
      Result<ProjectFile | null>
    >,
  onWorkerEvent: (cb: (event: WorkerEvent) => void) => {
    const listener = (_event: IpcRendererEvent, event: WorkerEvent) => cb(event)

    ipcRenderer.on(WORKER_EVENT_CHANNEL, listener)

    return () => {
      ipcRenderer.removeListener(WORKER_EVENT_CHANNEL, listener)
    }
  },
}

contextBridge.exposeInMainWorld('api', api)
