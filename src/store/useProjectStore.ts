import { create } from 'zustand'
import { analyze, cancel, executePlan, parseIntent } from '../ipc/client'
import {
  ErrorCode,
  type AnalysisResult,
  type ApiError,
  type HistoryItem,
  type Plan,
  type ProjectState,
  type RenderResult,
  type TrackSummary,
} from '../types/contract'

export type ProjectStatus =
  | 'idle'
  | 'analyzing'
  | 'analyzed'
  | 'parsing'
  | 'plan_pending'
  | 'executing'
  | 'rendered'
  | 'reverted'

type PlaybackSource = 'original' | 'rendered'

type ProjectStateSlice = {
  track: TrackSummary | null
  analysis: AnalysisResult | null
  selectedBarIndex: number | null
  plan: Plan | null
  render: RenderResult | null
  history: HistoryItem[]
  status: ProjectStatus
  error: ApiError | null
  elapsedMs: number
  playbackSource: PlaybackSource
  setTrack: (track: TrackSummary) => void
  runAnalyze: () => Promise<void>
  selectBar: (index: number | null) => void
  runParseIntent: (text: string) => Promise<void>
  updatePlanParam: <K extends keyof Plan>(key: K, value: Plan[K]) => void
  confirmPlan: () => Promise<void>
  cancelExecute: () => Promise<void>
  revert: () => void
  reset: () => void
}

const initialState = {
  track: null,
  analysis: null,
  selectedBarIndex: null,
  plan: null,
  render: null,
  history: [],
  status: 'idle' as ProjectStatus,
  error: null,
  elapsedMs: 0,
  playbackSource: 'original' as PlaybackSource,
}

let analyzeRunId = 0
let parseRunId = 0
let executeRunId = 0

function warnIllegal(action: string, status: ProjectStatus) {
  console.warn(`[store] illegal transition action=${action} status=${status}`)
}

function elapsedSince(start: number) {
  return Math.round(performance.now() - start)
}

function createProjectState(state: ProjectStateSlice): ProjectState {
  return {
    track: state.track,
    analysis: state.analysis,
    selectedBarIndex: state.selectedBarIndex,
    plan: state.plan,
    render: state.render,
    history: state.history,
    nodes: [],
  }
}

function createHistoryItem(
  text: string,
  plan: Plan,
  render: RenderResult | null,
  status: HistoryItem['status'],
  error?: ApiError,
): HistoryItem {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `history-${Date.now()}`,
    created_at: new Date().toISOString(),
    text,
    plan,
    render,
    status,
    error,
  }
}

export const useProjectStore = create<ProjectStateSlice>((set, get) => ({
  ...initialState,

  setTrack: (track) => {
    set({
      track,
      analysis: null,
      selectedBarIndex: null,
      plan: null,
      render: null,
      error: null,
      elapsedMs: 0,
      playbackSource: 'original',
      status: 'idle',
    })
  },

  runAnalyze: async () => {
    const state = get()

    if (!state.track) {
      console.warn('[store] runAnalyze ignored: no track')
      return
    }

    if (state.status !== 'idle' && state.status !== 'reverted') {
      warnIllegal('runAnalyze', state.status)
      return
    }

    const runId = ++analyzeRunId
    const start = performance.now()

    set({
      status: 'analyzing',
      error: null,
      elapsedMs: 0,
      analysis: null,
      plan: null,
      render: null,
      playbackSource: 'original',
    })

    const result = await analyze({
      track_id: state.track.track_id,
      file_path: state.track.file_path,
    })

    if (runId !== analyzeRunId) {
      return
    }

    if (result.ok) {
      set({
        analysis: result.data,
        selectedBarIndex: result.data.bars[2]?.index ?? result.data.bars[0]?.index ?? null,
        status: 'analyzed',
        error: null,
        elapsedMs: elapsedSince(start),
      })
      return
    }

    set({
      status: 'idle',
      error: result.error,
      elapsedMs: elapsedSince(start),
    })
  },

  selectBar: (index) => {
    const state = get()

    if (!state.analysis && index !== null) {
      warnIllegal('selectBar', state.status)
      return
    }

    set({ selectedBarIndex: index })
  },

  runParseIntent: async (text) => {
    const state = get()

    if (state.status !== 'analyzed' && state.status !== 'plan_pending') {
      warnIllegal('runParseIntent', state.status)
      return
    }

    const runId = ++parseRunId
    const start = performance.now()

    set({ status: 'parsing', error: null, elapsedMs: 0 })

    const result = await parseIntent({
      text,
      project_state: createProjectState(state),
    })

    if (runId !== parseRunId) {
      return
    }

    if (result.ok) {
      set({
        plan: result.data,
        status: 'plan_pending',
        error: null,
        elapsedMs: elapsedSince(start),
      })
      return
    }

    set({
      status: 'analyzed',
      error: result.error,
      elapsedMs: elapsedSince(start),
    })
  },

  updatePlanParam: (key, value) => {
    const state = get()

    if (!state.plan) {
      warnIllegal('updatePlanParam', state.status)
      return
    }

    if (state.status !== 'plan_pending' && state.status !== 'reverted') {
      warnIllegal('updatePlanParam', state.status)
      return
    }

    set({ plan: { ...state.plan, [key]: value } })
  },

  confirmPlan: async () => {
    const state = get()

    if (!state.plan) {
      warnIllegal('confirmPlan', state.status)
      return
    }

    if (state.status !== 'plan_pending' && state.status !== 'reverted') {
      warnIllegal('confirmPlan', state.status)
      return
    }

    const runId = ++executeRunId
    const start = performance.now()

    set({
      status: 'executing',
      error: null,
      elapsedMs: 0,
      render: null,
    })

    const result = await executePlan({
      plan_id: state.plan.plan_id,
      parameters: state.plan,
    })

    if (runId !== executeRunId) {
      return
    }

    if (result.ok) {
      set({
        render: result.data,
        status: 'rendered',
        playbackSource: 'rendered',
        elapsedMs: elapsedSince(start),
        history: [
          ...get().history,
          createHistoryItem('confirm plan', state.plan, result.data, 'rendered'),
        ],
      })
      return
    }

    set({
      status: 'plan_pending',
      error: result.error,
      elapsedMs: elapsedSince(start),
      history: [
        ...get().history,
        createHistoryItem('confirm plan', state.plan, null, 'failed', result.error),
      ],
    })
  },

  cancelExecute: async () => {
    const state = get()

    if (state.status !== 'executing') {
      warnIllegal('cancelExecute', state.status)
      return
    }

    executeRunId += 1
    const result = await cancel()

    set({
      status: 'plan_pending',
      error: result.ok
        ? {
            error_code: ErrorCode.CANCELLED,
            message: 'Execution cancelled',
          }
        : result.error,
      playbackSource: 'original',
    })
  },

  revert: () => {
    const state = get()

    if (state.status !== 'rendered' && state.status !== 'reverted') {
      warnIllegal('revert', state.status)
      return
    }

    set({
      status: 'plan_pending',
      playbackSource: 'original',
      error: null,
    })
  },

  reset: () => {
    analyzeRunId += 1
    parseRunId += 1
    executeRunId += 1
    set(initialState)
  },
}))
