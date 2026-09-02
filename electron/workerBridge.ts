/**
 * Electron main 进程 → Python Flask worker（http://127.0.0.1:8787）的 HTTP 桥接。
 *
 * 前端契约（src/types/contract.ts）与后端 worker.py 的响应存在三处差异，在此收敛：
 *  1. plan 字段名：后端 correction_strength ↔ 前端 strength（双向互换）
 *  2. 偏差曲线：后端 {times[], before[], after[]} 分离数组 → 前端 [{t, before, after}]
 *  3. execute_plan：后端必填 file_path，前端 ExecutePlanReq 未携带 → analyze 时缓存补充
 *
 * 后端错误码同时映射到前端 ErrorCode，保证 store 的按 source 分流逻辑可用。
 */

import {
  ErrorCode,
  type AnalysisResult,
  type AnalyzeReq,
  type ApiError,
  type ErrorCodeValue,
  type ExecutePlanReq,
  type ParseIntentReq,
  type Plan,
  type RenderResult,
  type Result,
} from '../src/types/contract.js'

const WORKER_BASE_URL = process.env.WORKER_URL ?? 'http://127.0.0.1:8787'

/** track_id → file_path，execute_plan 时按 plan.track 回填后端必填的 file_path。 */
const trackFilePaths = new Map<string, string>()
/** 最近一次 analyze 的文件，作为 track 查不到时的兜底。 */
let lastFilePath: string | null = null

function ok<T>(data: T): Result<T> {
  return { ok: true, data }
}

function toError(errorCode: ErrorCodeValue, message: string): ApiError {
  return { error_code: errorCode, message }
}

/** 后端 error_code → 前端 ErrorCode，保证前端 store 分流与按钮逻辑命中。 */
function mapErrorCode(backendCode: string, fallback: ErrorCodeValue): ErrorCodeValue {
  switch (backendCode) {
    case 'ANALYZE_FAILED':
      return ErrorCode.ANALYZE_FAILED
    case 'INTENT_PARSE_FAILED':
      return ErrorCode.PARSE_FAILED
    case 'PREFLIGHT_FAILED':
      return ErrorCode.PRECHECK_FAILED
    case 'RENDER_FAILED':
      return ErrorCode.RENDER_FAILED
    case 'FILE_NOT_FOUND':
    case 'INVALID_REQUEST':
    case 'PITCH_GUARD':
      // 参数/文件类错误归入 PRECHECK，前端按 precheck 路径提示
      return ErrorCode.PRECHECK_FAILED
    default:
      return fallback
  }
}

/** 后端 plan 对象（LLM/规则输出，可能含 source/correction_strength）的宽松视图。 */
type BackendPlan = {
  op?: string
  track?: string
  start_sec?: number
  end_sec?: number
  mode?: string
  scale?: string
  correction_strength?: number
  strength?: number
  /** transpose（移调）专用：正数升调、负数降调，单位半音 */
  semitones?: number
  source?: string
}

/** 后端 /analyze 响应：{track_id, bars, pitch, duration_sec, sr}。 */
type BackendAnalysis = {
  track_id?: string
  bars: AnalysisResult['bars']
  pitch: AnalysisResult['pitch']
  duration_sec?: number
  sr?: number
}

/** 后端 /parse_intent 响应：{plan_id, plan, status}。 */
type BackendParseResult = {
  plan_id: string
  plan: BackendPlan
  status?: string
}

/** 后端 /execute_plan 响应（verify + output_path + render_ms + sr）。 */
type BackendRenderResult = {
  output_path: string
  before_cents: number | null
  after_cents: number | null
  curve: { times: number[]; before: (number | null)[]; after: (number | null)[] }
  render_ms?: number
  sr?: number
  plan_id?: string
  /** transpose 专用：verify 透传的操作标识与实际位移 */
  op?: 'correct_pitch' | 'transpose'
  applied_shifts?: number[]
  semitones?: number
}

type BackendErrorBody = { error_code?: string; message?: string }

async function callWorker<T>(
  path: string,
  body: unknown,
  fallbackErrorCode: ErrorCodeValue,
): Promise<Result<T>> {
  let resp: Response
  try {
    resp = await fetch(`${WORKER_BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (error) {
    // 网络层失败（worker 未启动 / 端口不通）
    return {
      ok: false,
      error: toError(
        ErrorCode.WORKER_DOWN,
        `无法连接 Python worker（${WORKER_BASE_URL}）：${
          error instanceof Error ? error.message : String(error)
        }`,
      ),
    }
  }

  let data: unknown
  try {
    data = await resp.json()
  } catch {
    return {
      ok: false,
      error: toError(fallbackErrorCode, `worker 返回了非 JSON 响应（HTTP ${resp.status}）`),
    }
  }

  if (!resp.ok) {
    const errBody = (data ?? {}) as BackendErrorBody
    const code = mapErrorCode(errBody.error_code ?? '', fallbackErrorCode)
    return {
      ok: false,
      error: toError(code, errBody.message ?? `worker HTTP ${resp.status}`),
    }
  }

  return ok(data as T)
}

/** 后端 plan → 前端 Plan：扁平化 plan_id、correction_strength → strength。 */
function toFrontendPlan(backend: BackendParseResult): Plan {
  const plan = backend.plan ?? {}
  const op = plan.op === 'transpose' ? 'transpose' : 'correct_pitch'
  return {
    plan_id: backend.plan_id,
    op,
    track: plan.track ?? 'vocals',
    start_sec: plan.start_sec ?? 0,
    end_sec: plan.end_sec ?? 0,
    mode: plan.mode ?? 'auto',
    scale: plan.scale ?? 'C_major',
    strength: plan.correction_strength ?? plan.strength ?? 0.8,
    semitones: plan.semitones ?? 0,
  }
}

/** 前端 parameters（含 strength）→ 后端 plan 参数（correction_strength）。 */
function toBackendParameters(params: ExecutePlanReq['parameters']): Record<string, unknown> {
  const base: Record<string, unknown> = {
    start_sec: params.start_sec,
    end_sec: params.end_sec,
    track: params.track,
  }
  if (params.op === 'transpose') {
    return {
      ...base,
      op: 'transpose',
      semitones: params.semitones ?? 0,
    }
  }
  return {
    ...base,
    mode: params.mode,
    scale: params.scale,
    correction_strength: params.strength ?? 0.8,
  }
}

/** 后端分离数组 curve → 前端对象数组 [{t, before, after}]。 */
function toFrontendCurve(curve: BackendRenderResult['curve']): RenderResult['curve'] {
  if (!curve || !Array.isArray(curve.times)) {
    return []
  }
  const { times, before, after } = curve
  const out: RenderResult['curve'] = []
  for (let i = 0; i < times.length; i += 1) {
    out.push({
      t: times[i],
      before: (before?.[i] ?? null) as number,
      after: (after?.[i] ?? null) as number,
    })
  }
  return out
}

export async function analyzeTrack(payload: AnalyzeReq): Promise<Result<AnalysisResult>> {
  const result = await callWorker<BackendAnalysis>('/analyze', payload, ErrorCode.ANALYZE_FAILED)

  if (!result.ok) {
    return result
  }

  // 缓存 track_id → file_path，供 execute_plan 回填
  trackFilePaths.set(payload.track_id, payload.file_path)
  lastFilePath = payload.file_path

  // 保留 bars/pitch 之外的 duration_sec/sr：parse_intent 的 preflight 需要 duration_sec。
  const { bars, pitch, duration_sec, sr } = result.data
  const analysis = { bars, pitch, duration_sec, sr } as AnalysisResult
  return ok(analysis)
}

export async function parseIntentTrack(payload: ParseIntentReq): Promise<Result<Plan>> {
  const result = await callWorker<BackendParseResult>('/parse_intent', payload, ErrorCode.PARSE_FAILED)

  if (!result.ok) {
    return result
  }

  return ok(toFrontendPlan(result.data))
}

export async function executePlanTrack(payload: ExecutePlanReq): Promise<Result<RenderResult>> {
  const params = payload.parameters ?? {}
  const filePath =
    (params.track ? trackFilePaths.get(params.track) : undefined) ?? lastFilePath

  if (!filePath) {
    return {
      ok: false,
      error: toError(
        ErrorCode.PRECHECK_FAILED,
        '缺少音频文件路径：请先导入并分析音频再执行渲染',
      ),
    }
  }

  const body = {
    plan_id: payload.plan_id,
    parameters: toBackendParameters(params),
    file_path: filePath,
  }

  const result = await callWorker<BackendRenderResult>('/execute_plan', body, ErrorCode.RENDER_FAILED)

  if (!result.ok) {
    return result
  }

  const render: RenderResult = {
    output_path: result.data.output_path,
    before_cents: (result.data.before_cents ?? 0) as number,
    after_cents: (result.data.after_cents ?? 0) as number,
    curve: toFrontendCurve(result.data.curve),
    op: result.data.op === 'transpose' ? 'transpose' : 'correct_pitch',
    applied_shifts: result.data.applied_shifts,
    semitones: result.data.semitones,
  }
  return ok(render)
}

/** 后端渲染为毫秒级，无需真取消；返回成功以复位前端状态机。 */
export function cancelExecution(): Result<{ cancelled: true }> {
  return ok({ cancelled: true })
}
