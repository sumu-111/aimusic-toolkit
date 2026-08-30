import analysisFixture from '../mock/analysis.json'
import planFixture from '../mock/plan.json'
import renderFixture from '../mock/render.json'
import {
  CHANNELS,
  ErrorCode,
  type AnalysisResult,
  type AnalyzeReq,
  type CancelResult,
  type ExecutePlanReq,
  type ParseIntentReq,
  type Plan,
  type RenderResult,
  type Result,
} from '../types/contract'

const DELAYS = {
  [CHANNELS.analyze]: 1200,
  [CHANNELS.parse_intent]: 800,
  [CHANNELS.execute_plan]: 2500,
  cancel: 120,
} as const

const ERROR_BY_CHANNEL = {
  [CHANNELS.analyze]: ErrorCode.ANALYZE_FAILED,
  [CHANNELS.parse_intent]: ErrorCode.PARSE_FAILED,
  [CHANNELS.execute_plan]: ErrorCode.RENDER_FAILED,
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

  const plan = clone(planFixture as Plan)
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
