import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  CHANNELS,
  type AnalysisResult,
  type AnalyzeReq,
  type CancelResult,
  type ExecutePlanReq,
  type ParseIntentReq,
  type Plan,
  type RenderResult,
  type Result,
  type WorkerEvent,
} from '../src/types/contract.js'

const WORKER_EVENT_CHANNEL = 'worker_event'

const api = {
  analyze: (req: AnalyzeReq) =>
    ipcRenderer.invoke(CHANNELS.analyze, req) as Promise<Result<AnalysisResult>>,
  parseIntent: (req: ParseIntentReq) =>
    ipcRenderer.invoke(CHANNELS.parse_intent, req) as Promise<Result<Plan>>,
  executePlan: (req: ExecutePlanReq) =>
    ipcRenderer.invoke(CHANNELS.execute_plan, req) as Promise<
      Result<RenderResult>
    >,
  cancel: () => ipcRenderer.invoke('cancel') as Promise<Result<CancelResult>>,
  onWorkerEvent: (cb: (event: WorkerEvent) => void) => {
    const listener = (_event: IpcRendererEvent, event: WorkerEvent) => cb(event)

    ipcRenderer.on(WORKER_EVENT_CHANNEL, listener)

    return () => {
      ipcRenderer.removeListener(WORKER_EVENT_CHANNEL, listener)
    }
  },
}

contextBridge.exposeInMainWorld('api', api)
