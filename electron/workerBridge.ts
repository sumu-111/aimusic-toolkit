/**
 * Electron main 进程 → Python Flask worker（http://127.0.0.1:8787）的 HTTP 桥接。
 *
 * 前端契约（src/types/contract.ts）与后端 worker.py 的响应存在多处差异，在此收敛：
 *  1. plan 字段名：后端 correction_strength ↔ 前端 strength（双向互换）
 *  2. 偏差曲线：后端 {times[], before[], after[]} 分离数组 → 前端 [{t, before, after}]
 *  3. execute_plan：后端必填 file_path，前端 ExecutePlanReq 未携带 → analyze 时缓存补充
 *  4. v2 plan 分流：后端 add_sfx / remove_sfx plan 必须原样映射到对应前端 Plan，
 *     不得落回 correct_pitch（否则音效指令会走修音管线）
 *  5. v2 一步式执行：add_sfx / remove_sfx 的 parameters（op + clips 全量）透传后端，
 *     后端返回的权威 clips / added_clip / removed 回填 RenderResult
 *
 * 后端错误码同时映射到前端 ErrorCode，保证 store 的按 source 分流逻辑可用。
 */

import {
  ErrorCode,
  SFX_DEFAULTS,
  type AddSfxPlan,
  type AnalysisResult,
  type AnalyzeReq,
  type ApiError,
  type ErrorCodeValue,
  type ExecutePlanReq,
  type ParseIntentReq,
  type Plan,
  type RemoveSfxPlan,
  type RenderResult,
  type Result,
  type SfxAsset,
  type SfxCategory,
  type SfxClip,
  type SfxDeleteReq,
  type SfxDeleteResult,
  type SfxImportReq,
  type SfxImportResult,
  type SfxListResult,
  type SfxLocate,
  type SfxSource,
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
  // ── v2 SFX（backend/agent/intent.py + rules.py 输出）──
  /** add_sfx：用户原话里的素材描述；remove_sfx：要移除的声音描述 */
  query?: string
  /** worker 在 parse 响应里注入的用户指令原文（add_sfx/remove_sfx） */
  from_text?: string
  /** add_sfx：命中的库内素材（只存 sfx_id/name/category） */
  asset?: { sfx_id?: string; name?: string; category?: string }
  /** add_sfx：语义定位（副歌/开头/结尾/第N小节/整首），坐标由后端换算 */
  placement?: { locate?: string }
  /** remove_sfx：parse_intent 已把 clip_ids 解析为工程内真实 clip 对象列表 */
  clips?: SfxClip[]
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
  /** 操作标识：pitch 路径缺省（前端推断），一步式 add_sfx/remove_sfx 显式回填 */
  op?: string
  applied_shifts?: number[]
  semitones?: number
  /** v2 一步式 add_sfx：权威 clips 全量 + 本次新增；remove_sfx：删除后全量 */
  clips?: SfxClip[]
  added_clip?: SfxClip
  removed?: SfxClip[]
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

/** 后端中文语义位置 → 前端英文枚举（F4 确认卡的下拉对齐，仅展示用途）。 */
function toFrontendLocate(locate: string | undefined): SfxLocate {
  const low = (locate ?? '').toLowerCase()
  if (/副歌|高潮|chorus/.test(low)) return 'chorus'
  if (/开头|前奏|intro/.test(low)) return 'intro'
  if (/主歌|verse/.test(low)) return 'verse'
  if (/结尾|尾声|outro/.test(low)) return 'outro'
  const m = low.match(/第\s*(\d+)\s*小节/)
  if (m) return `bar:${Number(m[1])}` as SfxLocate
  // 整首/未知：前端枚举无等价项，保留原值做展示溯源。
  // 真实坐标以后端换算好的 start_sec/end_sec 为准，不改语义（P0-2 再统一枚举）。
  return (locate || 'intro') as SfxLocate
}

/**
 * 后端 plan → 前端 Plan：扁平化 plan_id、correction_strength → strength，
 * 并按 op 分流，避免 SFX plan 被强转 correct_pitch 后走修音管线（P0-1）。
 *
 * - add_sfx：query/asset/placement 透传；后端已按语义 locate 换算好的
 *   start_sec/end_sec 落到 placement.start_sec/end_sec（F4 确认卡从这取坐标）；
 *   mix 用 SFX_DEFAULTS 兜底（与后端 execute 的默认值同源，P0-2 对齐后一致）。
 * - remove_sfx：后端 plan.clips（已把 clip_ids 解析成真实 clip）映射为
 *   matches + target/scope，供「将删清单」展示与确认。
 * - 修音/移调沿用 v1 字段，行为不变。
 */
function toFrontendPlan(backend: BackendParseResult): Plan {
  const plan = backend.plan ?? {}
  const op = plan.op

  if (op === 'add_sfx') {
    return {
      plan_id: backend.plan_id,
      op: 'add_sfx',
      track: plan.track ?? 'vocals',
      query: plan.query ?? plan.from_text ?? '',
      asset: { sfx_id: plan.asset?.sfx_id ?? '' },
      placement: {
        locate: toFrontendLocate(plan.placement?.locate),
        start_sec: plan.start_sec,
        end_sec: plan.end_sec,
      },
      mix: {
        gain_db: SFX_DEFAULTS.gain_db,
        fade_in_ms: SFX_DEFAULTS.fade_in_ms,
        fade_out_ms: SFX_DEFAULTS.fade_out_ms,
        loop: SFX_DEFAULTS.loop,
      },
    } satisfies AddSfxPlan
  }

  if (op === 'remove_sfx') {
    const matched = plan.clips ?? []
    return {
      plan_id: backend.plan_id,
      op: 'remove_sfx',
      track: plan.track ?? 'vocals',
      // 后端 remove 意图恒为 query 驱动（rules/LLM 的 clip_ids 已解析成 plan.clips），
      // 前端 scope 语义与之一致：全部匹配项进入「将删清单」由用户确认。
      target: { by: 'query', query: plan.query ?? '' },
      scope: 'all_matching',
      matches: matched,
    } satisfies RemoveSfxPlan
  }

  const pitchOp = op === 'transpose' ? 'transpose' : 'correct_pitch'
  return {
    plan_id: backend.plan_id,
    op: pitchOp,
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
  if (params.op === 'add_sfx' || params.op === 'remove_sfx') {
    // 一步式：op + clips 全量必须原样到达后端（P0-1）。chat 路径的 asset/坐标
    // 已存服务端 plan（plan_id 关联）；UI 路径 F4 若在 parameters 里带了
    // asset / clip_id / start_sec / gain_db 等覆盖项，一并白名单透传兜底。
    const raw = params as unknown as Record<string, unknown>
    const out: Record<string, unknown> = { op: params.op, track: params.track }
    for (const key of [
      'clips',
      'clip_ids',
      'asset',
      'clip_id',
      'start_sec',
      'end_sec',
      'gain_db',
      'fade_in_ms',
      'fade_out_ms',
      'loop',
      'from_text',
    ]) {
      if (raw[key] !== undefined) {
        out[key] = raw[key]
      }
    }
    return out
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

  const backendOp = result.data.op
  const render: RenderResult = {
    output_path: result.data.output_path,
    before_cents: (result.data.before_cents ?? 0) as number,
    after_cents: (result.data.after_cents ?? 0) as number,
    curve: toFrontendCurve(result.data.curve),
    op:
      backendOp === 'transpose' ||
      backendOp === 'add_sfx' ||
      backendOp === 'remove_sfx'
        ? backendOp
        : 'correct_pitch',
    applied_shifts: result.data.applied_shifts,
    semitones: result.data.semitones,
    // 一步式 add/remove：把后端权威 clips 状态带回 renderer，供 store 覆盖本地
    clips: result.data.clips,
    added_clip: result.data.added_clip,
    removed: result.data.removed,
  }
  return ok(render)
}

/** 后端渲染为毫秒级，无需真取消；返回成功以复位前端状态机。 */
export function cancelExecution(): Result<{ cancelled: true }> {
  return ok({ cancelled: true })
}

// ───────────────────────── v2 · SFX 库管理（F2）──────────────────────────────

/**
 * 资产枚举双向归一化（P0-2）：
 * 后端以中文分类 + `bundle` 来源（sfx.py / sfx_manifest.json），
 * 前端契约以英文分类 + `builtin` 来源（contract.ts SfxAsset），
 * 桥接层负责去程（导入请求）与返程（list/import 响应）双向翻译。
 */
const CATEGORY_CN_TO_EN: Record<string, SfxCategory> = {
  氛围: 'ambience',
  过渡: 'transition',
  情绪: 'emotion',
  打击: 'percussion',
  其他: 'other',
}

const CATEGORY_EN_TO_CN: Record<SfxCategory, string> = {
  ambience: '氛围',
  transition: '过渡',
  emotion: '情绪',
  percussion: '打击',
  other: '其他',
}

/** source_name 兜底：内置库授权来源（Sonniss GDC 2026）/ 用户导入。 */
const SOURCE_NAME_BY_SOURCE: Record<SfxSource, string> = {
  builtin: 'Sonniss GDC 2026',
  user: '用户导入',
}

/** 后端资产条目（bundle/user 原始形状，分类为中文，bundle 无 source_name）。 */
type BackendSfxAsset = {
  sfx_id?: string
  name?: string
  category?: string
  keywords?: unknown
  duration_sec?: number
  source?: string
  license?: string
  source_name?: string
}

/** 后端资产 → 前端 SfxAsset：分类/来源枚举归一 + license/source_name 必填兜底。 */
function toFrontendAsset(raw: unknown): SfxAsset {
  const a = (raw ?? {}) as BackendSfxAsset
  const isUser = a.source === 'user'
  const source: SfxSource = isUser ? 'user' : 'builtin'
  const kws = Array.isArray(a.keywords) ? a.keywords.map((k) => String(k)) : []
  return {
    sfx_id: a.sfx_id ?? '',
    name: a.name ?? a.sfx_id ?? '',
    category: CATEGORY_CN_TO_EN[a.category ?? ''] ?? 'other',
    keywords: kws,
    duration_sec: a.duration_sec ?? 0,
    source,
    license: a.license ?? (isUser ? '用户导入' : 'Sonniss GDC 2026 Bundle (Royalty Free)'),
    source_name: a.source_name ?? SOURCE_NAME_BY_SOURCE[source],
  }
}

function toFrontendAssetList(raw: { assets?: unknown[] }): SfxAsset[] {
  return Array.isArray(raw.assets) ? raw.assets.map(toFrontendAsset) : []
}

export async function sfxListTrack(): Promise<Result<SfxListResult>> {
  let resp: Response
  try {
    resp = await fetch(`${WORKER_BASE_URL}/sfx/list`)
  } catch (error) {
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
      error: toError(ErrorCode.SFX_LIST_FAILED, `worker 返回了非 JSON 响应（HTTP ${resp.status}）`),
    }
  }

  if (!resp.ok) {
    const errBody = (data ?? {}) as BackendErrorBody
    return {
      ok: false,
      error: toError(
        mapErrorCode(errBody.error_code ?? '', ErrorCode.SFX_LIST_FAILED),
        errBody.message ?? `worker HTTP ${resp.status}`,
      ),
    }
  }

  // 返程归一化：bundle→builtin、中文分类→英文枚举、source_name 兜底（P0-2）
  return ok({ assets: toFrontendAssetList(data as { assets?: unknown[] }) })
}

export async function sfxImportTrack(payload: SfxImportReq): Promise<Result<SfxImportResult>> {
  // 去程归一化：前端英文分类 → 后端中文分类（缺失时后端按文件名归 其他）
  const body = {
    file_path: payload.file_path,
    name: payload.name,
    category: payload.category ? CATEGORY_EN_TO_CN[payload.category] : undefined,
  }
  const result = await callWorker<{ asset: unknown }>(
    '/sfx/import',
    body,
    ErrorCode.SFX_IMPORT_FAILED,
  )

  if (!result.ok) {
    return result
  }

  // 返程归一化：与 /sfx/list 同一套映射，保证导入后资产形状一致
  return ok({ asset: toFrontendAsset(result.data.asset) })
}

export async function sfxDeleteTrack(payload: SfxDeleteReq): Promise<Result<SfxDeleteResult>> {
  return callWorker<SfxDeleteResult>('/sfx/delete', payload, ErrorCode.SFX_DELETE_FAILED)
}
