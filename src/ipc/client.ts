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
  type ProjectFile,
  type RenderResult,
  type Result,
  type SaveProjectResult,
  type SfxDeleteReq,
  type SfxDeleteResult,
  type SfxImportReq,
  type SfxImportResult,
  type SfxListResult,
} from '../types/contract'
import {
  mockAnalyze,
  mockCancel,
  mockExecutePlan,
  mockParseIntent,
  mockSfxDelete,
  mockSfxImport,
  mockSfxList,
} from './mock'

const PROJECT_STORAGE_KEY = 'ai-music-workbench.project'

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

function hasHostApi() {
  return typeof window !== 'undefined' && Boolean(window.api)
}

function toError(errorCode: ErrorCodeValue, cause: unknown) {
  return {
    error_code: errorCode,
    message: cause instanceof Error ? cause.message : String(cause),
  }
}

function ok<T>(data: T): Result<T> {
  return { ok: true, data }
}

function readProjectFromStorage(): Result<ProjectFile | null> {
  if (typeof window === 'undefined') {
    return ok(null)
  }

  try {
    const rawProject = window.localStorage.getItem(PROJECT_STORAGE_KEY)

    return ok(rawProject ? (JSON.parse(rawProject) as ProjectFile) : null)
  } catch (error) {
    return {
      ok: false,
      error: toError(ErrorCode.PRECHECK_FAILED, error),
    }
  }
}

function saveProjectToStorage(project: ProjectFile): Result<SaveProjectResult> {
  if (typeof window === 'undefined') {
    return ok({ saved: true })
  }

  try {
    window.localStorage.setItem(PROJECT_STORAGE_KEY, JSON.stringify(project))

    return ok({ saved: true })
  } catch (error) {
    return {
      ok: false,
      error: toError(ErrorCode.PRECHECK_FAILED, error),
    }
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

export async function saveProject(
  project: ProjectFile,
): Promise<Result<SaveProjectResult>> {
  const start = performance.now()

  try {
    const result = hasHostApi()
      ? await window.api!.saveProject(project)
      : saveProjectToStorage(project)

    return isResult<SaveProjectResult>(result)
      ? result
      : {
          ok: false,
          error: {
            error_code: ErrorCode.PRECHECK_FAILED,
            message: 'Invalid response from save_project',
          },
        }
  } catch (error) {
    return {
      ok: false,
      error: toError(ErrorCode.PRECHECK_FAILED, error),
    }
  } finally {
    const cost = Math.round(performance.now() - start)
    console.info(`[ipc] channel=${CHANNELS.save_project} cost=${cost}ms`)
  }
}

// ───────────────────────── v2 · SFX 库管理（F2）──────────────────────────────

export async function sfxList(): Promise<Result<SfxListResult>> {
  return invoke(
    CHANNELS.sfx_list,
    () => window.api!.sfxList(),
    () => mockSfxList(),
    ErrorCode.SFX_LIST_FAILED,
  )
}

export async function sfxImport(req: SfxImportReq): Promise<Result<SfxImportResult>> {
  return invoke(
    CHANNELS.sfx_import,
    () => window.api!.sfxImport(req),
    () => mockSfxImport(req),
    ErrorCode.SFX_IMPORT_FAILED,
  )
}

export async function sfxDelete(req: SfxDeleteReq): Promise<Result<SfxDeleteResult>> {
  return invoke(
    CHANNELS.sfx_delete,
    () => window.api!.sfxDelete(req),
    () => mockSfxDelete(req),
    ErrorCode.SFX_DELETE_FAILED,
  )
}

export async function loadProject(): Promise<Result<ProjectFile | null>> {
  const start = performance.now()

  try {
    const result = hasHostApi()
      ? await window.api!.loadProject()
      : readProjectFromStorage()

    return isResult<ProjectFile | null>(result)
      ? result
      : {
          ok: false,
          error: {
            error_code: ErrorCode.PRECHECK_FAILED,
            message: 'Invalid response from load_project',
          },
        }
  } catch (error) {
    return {
      ok: false,
      error: toError(ErrorCode.PRECHECK_FAILED, error),
    }
  } finally {
    const cost = Math.round(performance.now() - start)
    console.info(`[ipc] channel=${CHANNELS.load_project} cost=${cost}ms`)
  }
}
