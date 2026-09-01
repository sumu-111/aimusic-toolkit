/// <reference types="vite/client" />

import type {
  AnalysisResult,
  AnalyzeReq,
  CancelResult,
  ExecutePlanReq,
  ParseIntentReq,
  Plan,
  ProjectFile,
  ReadFileDataUrlResult,
  RenderResult,
  Result,
  SaveProjectResult,
  WorkerEvent,
} from './types/contract'

interface HostApi {
  /** preload 注入：File → 磁盘真实路径（Electron 官方 webUtils API）。 */
  getPathForFile: (file: File) => string
  /** preload 注入：本地 WAV → data URL（渲染进程无法直接加载 file://）。 */
  readFileAsDataUrl: (
    filePath: string,
  ) => Promise<Result<ReadFileDataUrlResult>>
  analyze: (req: AnalyzeReq) => Promise<Result<AnalysisResult>>
  parseIntent: (req: ParseIntentReq) => Promise<Result<Plan>>
  executePlan: (req: ExecutePlanReq) => Promise<Result<RenderResult>>
  cancel: () => Promise<Result<CancelResult>>
  saveProject: (project: ProjectFile) => Promise<Result<SaveProjectResult>>
  loadProject: () => Promise<Result<ProjectFile | null>>
  onWorkerEvent: (cb: (event: WorkerEvent) => void) => () => void
}

declare global {
  interface Window {
    api?: HostApi
  }
}

export {}
