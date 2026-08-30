/// <reference types="vite/client" />

import type {
  AnalysisResult,
  AnalyzeReq,
  CancelResult,
  ExecutePlanReq,
  ParseIntentReq,
  Plan,
  ProjectFile,
  RenderResult,
  Result,
  SaveProjectResult,
  WorkerEvent,
} from './types/contract'

interface HostApi {
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
