import {
  CHANNELS,
  ErrorCode,
  type AnalysisResult,
  type AnalyzeReq,
  type CancelResult,
  type ErrorCodeValue,
  type ExecutePlanReq,
  type ParseIntentReq,
  type Plan,
  type RenderResult,
  type Result,
} from '../types/contract'
import {
  mockAnalyze,
  mockCancel,
  mockExecutePlan,
  mockParseIntent,
} from './mock'

function isResult<T>(value: unknown): value is Result<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'ok' in value &&
    typeof (value as { ok: unknown }).ok === 'boolean'
  )
}

function useMockApi() {
  const env = (import.meta as ImportMeta & { env?: { VITE_MOCK?: string } }).env

  return env?.VITE_MOCK === '1' || typeof window === 'undefined' || !window.api
}

function toError(errorCode: ErrorCodeValue, cause: unknown) {
  return {
    error_code: errorCode,
    message: cause instanceof Error ? cause.message : String(cause),
  }
}

async function invoke<T>(
  channel: string,
  hostCall: () => Promise<Result<T>>,
  mockCall: () => Promise<Result<T>>,
  errorCode: ErrorCodeValue,
): Promise<Result<T>> {
  const start = performance.now()

  try {
    const result = useMockApi() ? await mockCall() : await hostCall()

    if (isResult<T>(result)) {
      return result
    }

    return {
      ok: false,
      error: {
        error_code: errorCode,
        message: `Invalid response from ${channel}`,
      },
    }
  } catch (error) {
    return {
      ok: false,
      error: toError(errorCode, error),
    }
  } finally {
    const cost = Math.round(performance.now() - start)
    console.info(`[ipc] channel=${channel} cost=${cost}ms`)
  }
}

export async function analyze(
  req: AnalyzeReq,
): Promise<Result<AnalysisResult>> {
  return invoke(
    CHANNELS.analyze,
    () => window.api!.analyze(req),
    () => mockAnalyze(req),
    ErrorCode.ANALYZE_FAILED,
  )
}

export async function parseIntent(req: ParseIntentReq): Promise<Result<Plan>> {
  return invoke(
    CHANNELS.parse_intent,
    () => window.api!.parseIntent(req),
    () => mockParseIntent(req),
    ErrorCode.PARSE_FAILED,
  )
}

export async function executePlan(
  req: ExecutePlanReq,
): Promise<Result<RenderResult>> {
  return invoke(
    CHANNELS.execute_plan,
    () => window.api!.executePlan(req),
    () => mockExecutePlan(req),
    ErrorCode.RENDER_FAILED,
  )
}

export async function cancel(): Promise<Result<CancelResult>> {
  return invoke(
    'cancel',
    () => window.api!.cancel(),
    () => mockCancel(),
    ErrorCode.CANCELLED,
  )
}
