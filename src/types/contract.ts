export type Bar = {
  index: number
  start_sec: number
  end_sec: number
}

export type PitchPoint = {
  t: number
  pitch: number
  confidence: number
}

export type AnalyzeReq = {
  track_id: string
  file_path: string
}

export type AnalysisResult = {
  bars: Bar[]
  pitch: PitchPoint[]
}

export type TrackSummary = {
  track_id: string
  file_path: string
  file_name?: string
  duration_sec?: number
  sample_rate?: number
  url?: string
}

export type ProjectState = {
  track: TrackSummary | null
  analysis: AnalysisResult | null
  selectedBarIndex: number | null
  plan?: Plan | null
  render?: RenderResult | null
  history?: HistoryItem[]
  nodes?: unknown[]
}

export type ParseIntentReq = {
  text: string
  project_state: ProjectState
}

export type Plan = {
  plan_id: string
  op: 'correct_pitch'
  track: string
  start_sec: number
  end_sec: number
  mode: string
  scale: string
  strength: number
}

export type ExecutePlanReq = {
  plan_id: string
  parameters: Partial<Plan>
}

export type RenderResult = {
  output_path: string
  before_cents: number
  after_cents: number
  curve: { t: number; before: number; after: number }[]
}

export type ApiError = {
  error_code: string
  message: string
}

export type HistoryItem = {
  id: string
  created_at: string
  text: string
  plan: Plan
  render: RenderResult | null
  status: 'rendered' | 'reverted' | 'failed'
  error?: ApiError
}

export type ProjectFile = {
  nodes: unknown[]
  analysis: AnalysisResult | null
  history: HistoryItem[]
  version: string
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: ApiError }

export type CancelResult = {
  cancelled: true
}

export type WorkerEvent = {
  type: string
  payload?: unknown
}

export const CHANNELS = {
  analyze: 'analyze',
  analysis_result: 'analysis_result',
  parse_intent: 'parse_intent',
  plan: 'plan',
  execute_plan: 'execute_plan',
  render_result: 'render_result',
} as const

export const ErrorCode = {
  ANALYZE_FAILED: 'ANALYZE_FAILED',
  PARSE_FAILED: 'PARSE_FAILED',
  PRECHECK_FAILED: 'PRECHECK_FAILED',
  RENDER_FAILED: 'RENDER_FAILED',
  RENDER_TIMEOUT: 'RENDER_TIMEOUT',
  CANCELLED: 'CANCELLED',
  WORKER_DOWN: 'WORKER_DOWN',
} as const

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode]
