import analysisFixture from '../mock/analysis.json'
import planFixture from '../mock/plan.json'
import renderFixture from '../mock/render.json'
import sfxAssetsFixture from '../mock/sfx-assets.json'
import {
  CHANNELS,
  ErrorCode,
  type AnalysisResult,
  type AnalyzeReq,
  type CancelResult,
  type ExecutePlanReq,
  type ParseIntentReq,
  type PitchPlan,
  type Plan,
  type RenderResult,
  type Result,
  type SfxAsset,
  type SfxDeleteReq,
  type SfxDeleteResult,
  type SfxImportReq,
  type SfxImportResult,
  type SfxListResult,
} from '../types/contract'

const DELAYS = {
  [CHANNELS.analyze]: 1200,
  [CHANNELS.parse_intent]: 800,
  [CHANNELS.execute_plan]: 2500,
  [CHANNELS.sfx_list]: 400,
  [CHANNELS.sfx_import]: 600,
  [CHANNELS.sfx_delete]: 250,
  cancel: 120,
} as const

const ERROR_BY_CHANNEL = {
  [CHANNELS.analyze]: ErrorCode.ANALYZE_FAILED,
  [CHANNELS.parse_intent]: ErrorCode.PARSE_FAILED,
  [CHANNELS.execute_plan]: ErrorCode.RENDER_FAILED,
  [CHANNELS.sfx_list]: ErrorCode.SFX_LIST_FAILED,
  [CHANNELS.sfx_import]: ErrorCode.SFX_IMPORT_FAILED,
  [CHANNELS.sfx_delete]: ErrorCode.SFX_DELETE_FAILED,
  cancel: ErrorCode.CANCELLED,
} as const

function delay(ms: number) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms))
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function ok<T>(data: T): Result<T> {
  return { ok: true, data }
}

function fail<T>(
  channel: keyof typeof ERROR_BY_CHANNEL,
  message: string,
): Result<T> {
  return {
    ok: false,
    error: {
      error_code: ERROR_BY_CHANNEL[channel],
      message,
    },
  }
}

function readMockFail() {
  if (typeof window === 'undefined') {
    return ''
  }

  try {
    return window.localStorage.getItem('MOCK_FAIL') ?? ''
  } catch {
    return ''
  }
}

function shouldFail(channel: keyof typeof ERROR_BY_CHANNEL) {
  const value = readMockFail().trim()

  if (!value) {
    return false
  }

  const targets = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

  return value === '1' || value === 'all' || targets.includes(channel)
}

export async function mockAnalyze(_req: AnalyzeReq): Promise<Result<AnalysisResult>> {
  await delay(DELAYS[CHANNELS.analyze])

  if (shouldFail(CHANNELS.analyze)) {
    return fail(CHANNELS.analyze, 'Mock analyze failed')
  }

  return ok(clone(analysisFixture as AnalysisResult))
}

export async function mockParseIntent(
  req: ParseIntentReq,
): Promise<Result<Plan>> {
  await delay(DELAYS[CHANNELS.parse_intent])

  if (shouldFail(CHANNELS.parse_intent)) {
    return fail(CHANNELS.parse_intent, 'Mock parse intent failed')
  }

  // fixture 是修音计划；音效 mock 走 mockSfx* 系列，不复用这条路径
  const plan = clone(planFixture as PitchPlan)
  const selectedBar = req.project_state.analysis?.bars.find(
    (bar) => bar.index === req.project_state.selectedBarIndex,
  )

  return ok({
    ...plan,
    track: req.project_state.track?.track_id ?? plan.track,
    start_sec: selectedBar?.start_sec ?? plan.start_sec,
    end_sec: selectedBar?.end_sec ?? plan.end_sec,
  })
}

export async function mockExecutePlan(
  _req: ExecutePlanReq,
): Promise<Result<RenderResult>> {
  await delay(DELAYS[CHANNELS.execute_plan])

  if (shouldFail(CHANNELS.execute_plan)) {
    return fail(CHANNELS.execute_plan, 'Mock execute plan failed')
  }

  return ok(clone(renderFixture as RenderResult))
}

export async function mockCancel(): Promise<Result<CancelResult>> {
  await delay(DELAYS.cancel)

  if (shouldFail('cancel')) {
    return fail('cancel', 'Mock execution cancelled')
  }

  return ok({ cancelled: true })
}

// ───────────────────────── v2 · SFX 库 mock（F1/F3 离线开发用）─────────────────

/**
 * 用户导入库的 mock 存储。真实实现由后端 user_library.json 持有（B2），
 * 这里只为让 F3 的「导入 / 删除」在 VITE_MOCK=1 下能走完整交互。
 */
let mockUserAssets: SfxAsset[] = []

function fileNameOf(filePath: string) {
  const parts = filePath.split(/[\\/]/)
  return parts[parts.length - 1] || filePath
}

export async function mockSfxList(): Promise<Result<SfxListResult>> {
  await delay(DELAYS[CHANNELS.sfx_list])

  if (shouldFail(CHANNELS.sfx_list)) {
    return fail(CHANNELS.sfx_list, 'Mock sfx list failed')
  }

  const builtin = clone(sfxAssetsFixture as SfxAsset[])
  return ok({ assets: [...builtin, ...clone(mockUserAssets)] })
}

export async function mockSfxImport(
  req: SfxImportReq,
): Promise<Result<SfxImportResult>> {
  await delay(DELAYS[CHANNELS.sfx_import])

  if (shouldFail(CHANNELS.sfx_import)) {
    return fail(CHANNELS.sfx_import, 'Mock sfx import failed')
  }

  const name = req.name ?? fileNameOf(req.file_path).replace(/\.[^.]+$/, '')
  const asset: SfxAsset = {
    sfx_id: `user_${globalThis.crypto?.randomUUID?.() ?? Date.now()}`,
    name,
    // 导入默认归入「其他」+ 文件名关键词，这是 PPT 页 24 登记过的预期边界
    category: req.category ?? 'other',
    keywords: name.split(/[\s_\-]+/).filter(Boolean),
    duration_sec: 5,
    source: 'user',
    license: 'user-provided',
    source_name: '用户导入',
  }

  mockUserAssets = [...mockUserAssets, asset]
  return ok({ asset })
}

export async function mockSfxDelete(
  req: SfxDeleteReq,
): Promise<Result<SfxDeleteResult>> {
  await delay(DELAYS[CHANNELS.sfx_delete])

  if (shouldFail(CHANNELS.sfx_delete)) {
    return fail(CHANNELS.sfx_delete, 'Mock sfx delete failed')
  }

  const before = mockUserAssets.length
  mockUserAssets = mockUserAssets.filter((a) => a.sfx_id !== req.sfx_id)

  if (mockUserAssets.length === before) {
    // 只允许删用户库条目，内置库删不掉（后端 B2 同约束）
    return {
      ok: false,
      error: {
        error_code: ErrorCode.SFX_DELETE_FAILED,
        message: '只能删除用户导入的音效',
      },
    }
  }

  return ok({ deleted: true, sfx_id: req.sfx_id })
}
