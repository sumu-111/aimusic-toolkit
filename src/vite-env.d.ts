/// <reference types="vite/client" />

import type {
  AnalysisResult,
  AnalyzeReq,
  CancelResult,
  ExecutePlanReq,
  ParseIntentReq,
  Plan,
  RenderResult,
  Result,
  WorkerEvent,
} from './types/contract'

interface HostApi {
  analyze: (req: AnalyzeReq) => Promise<Result<AnalysisResult>>
  parseIntent: (req: ParseIntentReq) => Promise<Result<Plan>>
  executePlan: (req: ExecutePlanReq) => Promise<Result<RenderResult>>
  cancel: () => Promise<Result<CancelResult>>
  onWorkerEvent: (cb: (event: WorkerEvent) => void) => () => void
}

declare global {
  interface Window {
    api?: HostApi
  }
}

export {}
