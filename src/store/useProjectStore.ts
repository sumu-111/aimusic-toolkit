import { create } from 'zustand'
import { analyze, cancel, executePlan, parseIntent } from '../ipc/client'
import {
  ErrorCode,
  type AnalysisResult,
  type ApiError,
  type Bar,
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

export type CanvasNodeId = 'audio-import' | 'analysis' | 'pitch-fix'

export type NodePosition = {
  x: number
  y: number
}

export type InspectorNode = {
  id: CanvasNodeId
  label: string
  metadata: unknown
}

type ProjectStateSlice = {
  track: TrackSummary | null
  analysis: AnalysisResult | null
  selectedBarIndex: number | null
  plan: Plan | null
  render: RenderResult | null
  history: HistoryItem[]
  nodePositions: Record<CanvasNodeId, NodePosition>
  inspectorNode: InspectorNode | null
  status: ProjectStatus
  error: ApiError | null
  elapsedMs: number
  playbackSource: PlaybackSource
  setNodePosition: (id: CanvasNodeId, position: NodePosition) => void
  selectInspectorNode: (node: InspectorNode | null) => void
  setTrack: (track: TrackSummary) => void
  runAnalyze: () => Promise<void>
  selectBar: (index: number | null) => void
  updateBarRange: (
    index: number,
    range: Pick<Bar, 'start_sec' | 'end_sec'>,
  ) => void
  selectWholeTrackRange: () => void
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
  nodePositions: {
    'audio-import': { x: 48, y: 36 },
    analysis: { x: 48, y: 180 },
    'pitch-fix': { x: 48, y: 324 },
  },
  inspectorNode: null,
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
    nodes: Object.entries(state.nodePositions).map(([id, position]) => ({
      id,
      position,
    })),
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

  setNodePosition: (id, position) => {
    set((state) => ({
      nodePositions: {
        ...state.nodePositions,
        [id]: position,
      },
    }))
  },

  selectInspectorNode: (node) => {
    set({ inspectorNode: node })
  },

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

  updateBarRange: (index, range) => {
    const state = get()

    if (!state.analysis) {
      warnIllegal('updateBarRange', state.status)
      return
    }

    const fallbackEnd = state.analysis.bars.reduce(
      (max, bar) => Math.max(max, bar.end_sec),
      0,
    )
    const maxEnd =
      (state.track?.duration_sec ?? fallbackEnd) || Math.max(range.end_sec, 0.01)
    const start = Math.max(0, Math.min(range.start_sec, maxEnd - 0.01))
    const end = Math.max(start + 0.01, Math.min(range.end_sec, maxEnd))
    const analysis = {
      ...state.analysis,
      bars: state.analysis.bars.map((bar) =>
        bar.index === index
          ? {
              ...bar,
              start_sec: start,
              end_sec: end,
            }
          : bar,
      ),
    }
    let plan = state.plan

    if (
      plan &&
      state.selectedBarIndex === index &&
      (state.status === 'plan_pending' || state.status === 'reverted')
    ) {
      plan = {
        ...plan,
        start_sec: start,
        end_sec: end,
      }
    }

    set({ analysis, selectedBarIndex: index, plan })
  },

  selectWholeTrackRange: () => {
    const state = get()

    if (!state.track) {
      warnIllegal('selectWholeTrackRange', state.status)
      return
    }

    const analysisEnd =
      state.analysis?.bars.reduce(
        (max, bar) => Math.max(max, bar.end_sec),
        0,
      ) ?? 0
    const end = (state.track.duration_sec ?? analysisEnd) || 30

    set({
      analysis: {
        bars: [
          {
            index: 0,
            start_sec: 0,
            end_sec: end,
          },
        ],
        pitch: state.analysis?.pitch ?? [],
      },
      selectedBarIndex: 0,
      plan: null,
      render: null,
      error: null,
      status: 'analyzed',
      playbackSource: 'original',
      elapsedMs: 0,
    })
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
    set({ ...initialState })
  },
}))
