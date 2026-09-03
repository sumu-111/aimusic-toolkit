import { create } from 'zustand'
import { analyze, cancel, executePlan, parseIntent } from '../ipc/client'
import {
  ErrorCode,
  SFX_DEFAULTS,
  isAddSfxPlan,
  isPitchPlan,
  isRemoveSfxPlan,
  type AddSfxPlan,
  type AnalysisResult,
  type ApiError,
  type Bar,
  type ExecuteParameters,
  type HistoryItem,
  type PitchPlan,
  type Plan,
  type ProjectFile,
  type ProjectState,
  type RenderResult,
  type SfxAsset,
  type SfxClip,
  type SfxLocate,
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

/**
 * 错误来源。面板只渲染自己那一路的失败，避免 parse/render 的错误
 * 被当成「分析失败」显示在波形区。
 */
export type ErrorSource = 'analyze' | 'parse' | 'execute'

export type ProjectError = ApiError & { source: ErrorSource }

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
  error: ProjectError | null
  elapsedMs: number
  lastFullRunMs: number
  lastIntentText: string
  restoreNotice: string | null
  workflowElapsedMs: number
  playbackSource: PlaybackSource
  /** v2/F6：工程内全部音效，渲染的唯一事实源 */
  sfxClips: SfxClip[]
  setNodePosition: (id: CanvasNodeId, position: NodePosition) => void
  selectInspectorNode: (node: InspectorNode | null) => void
  setTrack: (track: TrackSummary, importElapsedMs?: number) => void
  restoreProject: (project: ProjectFile) => void
  restoreHistoryItem: (id: string) => void
  runAnalyze: () => Promise<void>
  selectBar: (index: number | null) => void
  updateBarRange: (
    index: number,
    range: Pick<Bar, 'start_sec' | 'end_sec'>,
  ) => void
  selectWholeTrackRange: () => void
  applyRuleTemplatePlan: (text: string) => void
  runParseIntent: (text: string) => Promise<void>
  /** 只编辑修音/移调参数。音效的 gain/fade 编辑走 F4 的独立 action。 */
  updatePlanParam: <K extends keyof PitchPlan>(
    key: K,
    value: PitchPlan[K],
  ) => void
  confirmPlan: () => Promise<void>
  cancelExecute: () => Promise<void>
  cancelPlan: () => void
  revert: () => void
  reset: () => void
  addSfxClip: (clip: SfxClip) => void
  removeSfxClip: (clipId: string) => void
  toggleMuteClip: (clipId: string) => void
  createAddSfxPlan: (asset: SfxAsset) => void
  updateSfxPlanLocate: (locate: SfxLocate) => void
  updateSfxPlanGain: (gainDb: number) => void
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
  lastFullRunMs: 0,
  lastIntentText: '',
  restoreNotice: null,
  workflowElapsedMs: 0,
  playbackSource: 'original' as PlaybackSource,
  /**
   * v2/F6：工程内全部音效。渲染的唯一事实源——execute 时全量下发，
   * 后端无状态。F6 会补上增删改 actions 与 project.json 持久化。
   */
  sfxClips: [] as SfxClip[],
}

const PROJECT_FILE_VERSION = '1.0'
const RESTORE_NOTICE = '\u8bf7\u91cd\u65b0\u5bfc\u5165\u97f3\u9891'
const CANVAS_NODE_IDS: CanvasNodeId[] = [
  'audio-import',
  'analysis',
  'pitch-fix',
]

let analyzeRunId = 0
let parseRunId = 0
let executeRunId = 0

function warnIllegal(action: string, status: ProjectStatus) {
  console.warn(`[store] illegal transition action=${action} status=${status}`)
}

function elapsedSince(start: number) {
  return Math.round(performance.now() - start)
}

function logTiming(label: string, elapsedMs: number) {
  console.info(`[timing] ${label}=${elapsedMs}ms`)
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
    sfxClips: state.sfxClips,
  }
}

function createProjectFile(state: ProjectStateSlice): ProjectFile {
  return {
    nodes: Object.entries(state.nodePositions).map(([id, position]) => ({
      id,
      position,
    })),
    analysis: state.analysis,
    history: state.history,
    version: PROJECT_FILE_VERSION,
    sfxClips: state.sfxClips.length > 0 ? state.sfxClips : undefined,
  }
}

function isCanvasNodeId(value: unknown): value is CanvasNodeId {
  return (
    typeof value === 'string' &&
    CANVAS_NODE_IDS.includes(value as CanvasNodeId)
  )
}

function isNodePosition(value: unknown): value is NodePosition {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { x?: unknown }).x === 'number' &&
    typeof (value as { y?: unknown }).y === 'number'
  )
}

function readNodePositions(nodes: unknown[]): Record<CanvasNodeId, NodePosition> {
  const positions = { ...initialState.nodePositions }

  for (const node of nodes) {
    if (typeof node !== 'object' || node === null) {
      continue
    }

    const { id, position } = node as {
      id?: unknown
      position?: unknown
    }

    if (isCanvasNodeId(id) && isNodePosition(position)) {
      positions[id] = position
    }
  }

  return positions
}

function markLatestRenderedHistoryReverted(history: HistoryItem[]) {
  let marked = false

  return [...history]
    .reverse()
    .map((item) => {
      if (!marked && item.status === 'rendered') {
        marked = true

        return { ...item, status: 'reverted' as const }
      }

      return item
    })
    .reverse()
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

function getSelectedBar(state: ProjectStateSlice) {
  return (
    state.analysis?.bars.find((bar) => bar.index === state.selectedBarIndex) ??
    state.analysis?.bars[2] ??
    state.analysis?.bars[0] ??
    null
  )
}

function createLocalPlan(state: ProjectStateSlice): Plan | null {
  if (!state.track) {
    return null
  }

  const selectedBar = getSelectedBar(state)
  const fallbackEnd = state.track.duration_sec ?? selectedBar?.end_sec ?? 15

  return {
    plan_id:
      globalThis.crypto?.randomUUID?.() ?? `local-plan-${Date.now()}`,
    op: 'correct_pitch',
    track: state.track.track_id,
    start_sec: selectedBar?.start_sec ?? 0,
    end_sec: selectedBar?.end_sec ?? fallbackEnd,
    mode: 'scale',
    scale: 'C_major',
    strength: 0.8,
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

  setTrack: (track, importElapsedMs = 0) => {
    logTiming('import', importElapsedMs)

    set({
      track,
      analysis: null,
      selectedBarIndex: null,
      plan: null,
      render: null,
      error: null,
      elapsedMs: 0,
      lastFullRunMs: 0,
      restoreNotice: null,
      workflowElapsedMs: importElapsedMs,
      playbackSource: 'original',
      status: 'idle',
    })
  },

  restoreProject: (project) => {
    const analysis = project.analysis

    set({
      track: null,
      analysis,
      selectedBarIndex:
        analysis?.bars[2]?.index ?? analysis?.bars[0]?.index ?? null,
      plan: null,
      render: null,
      history: project.history,
      nodePositions: readNodePositions(project.nodes),
      error: null,
      elapsedMs: 0,
      lastFullRunMs: 0,
      restoreNotice: analysis || project.history.length ? RESTORE_NOTICE : null,
      workflowElapsedMs: 0,
      playbackSource: 'original',
      sfxClips: project.sfxClips ?? [],
      status: analysis ? 'analyzed' : 'idle',
    })
  },

  restoreHistoryItem: (id) => {
    const state = get()
    const item = state.history.find((historyItem) => historyItem.id === id)

    if (!item) {
      warnIllegal('restoreHistoryItem', state.status)
      return
    }

    // 只有修音/移调计划带秒级区间；音效计划的坐标在 placement 里，不参与选中小节回填
    const restoredPitchPlan = isPitchPlan(item.plan) ? item.plan : null
    const selectedBarIndex =
      (restoredPitchPlan
        ? state.analysis?.bars.find(
            (bar) =>
              restoredPitchPlan.start_sec >= bar.start_sec &&
              restoredPitchPlan.end_sec <= bar.end_sec,
          )?.index
        : undefined) ?? state.selectedBarIndex

    set({
      plan: item.plan,
      render: null,
      selectedBarIndex,
      error: null,
      elapsedMs: 0,
      workflowElapsedMs: 0,
      playbackSource: 'original',
      status: 'plan_pending',
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

    const elapsedMs = elapsedSince(start)
    const workflowElapsedMs = state.workflowElapsedMs + elapsedMs
    logTiming('analyze', elapsedMs)

    if (result.ok) {
      // 用 librosa 精确时长回填 track.duration_sec（HTML5 audio.duration 会舍入，
      // 导致整首区间 end_sec 误报「超出音频时长」）
      const track =
        result.data.duration_sec && state.track
          ? { ...state.track, duration_sec: result.data.duration_sec }
          : state.track

      set({
        analysis: result.data,
        track,
        selectedBarIndex: result.data.bars[2]?.index ?? result.data.bars[0]?.index ?? null,
        status: 'analyzed',
        error: null,
        elapsedMs,
        workflowElapsedMs,
      })
      return
    }

    set({
      status: 'idle',
      error: { ...result.error, source: 'analyze' },
      elapsedMs,
      workflowElapsedMs,
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
      isPitchPlan(plan) &&
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
      workflowElapsedMs: 0,
    })
  },

  applyRuleTemplatePlan: (text) => {
    const state = get()
    const plan = createLocalPlan(state)

    parseRunId += 1

    if (!plan) {
      warnIllegal('applyRuleTemplatePlan', state.status)
      return
    }

    set({
      plan,
      render: null,
      error: null,
      status: 'plan_pending',
      playbackSource: 'original',
      elapsedMs: 0,
      lastIntentText: text,
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

    set({ status: 'parsing', error: null, elapsedMs: 0, lastIntentText: text })

    const result = await parseIntent({
      text,
      project_state: createProjectState(state),
    })

    if (runId !== parseRunId) {
      return
    }

    const elapsedMs = elapsedSince(start)
    const workflowElapsedMs = state.workflowElapsedMs + elapsedMs
    logTiming('parse', elapsedMs)

    if (result.ok) {
      set({
        plan: result.data,
        status: 'plan_pending',
        error: null,
        elapsedMs,
        workflowElapsedMs,
      })
      return
    }

    set({
      status: 'analyzed',
      error: { ...result.error, source: 'parse' },
      elapsedMs,
      workflowElapsedMs,
    })
  },

  updatePlanParam: (key, value) => {
    const state = get()

    if (!state.plan || !isPitchPlan(state.plan)) {
      warnIllegal('updatePlanParam', state.status)
      return
    }

    if (state.status !== 'plan_pending' && state.status !== 'reverted') {
      warnIllegal('updatePlanParam', state.status)
      return
    }

    const plan: PitchPlan = { ...state.plan, [key]: value }
    let analysis = state.analysis

    if (
      analysis &&
      state.selectedBarIndex !== null &&
      (key === 'start_sec' || key === 'end_sec') &&
      plan.end_sec > plan.start_sec
    ) {
      analysis = {
        ...analysis,
        bars: analysis.bars.map((bar) =>
          bar.index === state.selectedBarIndex
            ? {
                ...bar,
                start_sec: plan.start_sec,
                end_sec: plan.end_sec,
              }
            : bar,
        ),
      }
    }

    set({ analysis, plan })
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

    let updatedClips = state.sfxClips
    if (isAddSfxPlan(state.plan)) {
      const newClip: SfxClip = {
        clip_id: globalThis.crypto?.randomUUID?.() ?? `clip-${Date.now()}`,
        sfx_id: state.plan.asset.sfx_id,
        start_sec: state.plan.placement.start_sec ?? 0,
        end_sec: state.plan.placement.end_sec,
        gain_db: state.plan.mix.gain_db,
        fade_in_ms: state.plan.mix.fade_in_ms,
        fade_out_ms: state.plan.mix.fade_out_ms,
        loop: state.plan.mix.loop,
      }
      updatedClips = [...state.sfxClips, newClip]
    } else if (isRemoveSfxPlan(state.plan)) {
      const matchIds = new Set(state.plan.matches?.map((c) => c.clip_id) ?? [])
      if (matchIds.size > 0) {
        updatedClips = state.sfxClips.filter((c) => !matchIds.has(c.clip_id))
      }
    }

    set({
      status: 'executing',
      error: null,
      elapsedMs: 0,
      render: null,
      sfxClips: updatedClips,
    })

    const parameters: ExecuteParameters = isPitchPlan(state.plan)
      ? state.plan
      : { op: state.plan.op, track: state.plan.track, clips: updatedClips }

    const result = await executePlan({
      plan_id: state.plan.plan_id,
      parameters,
    })

    if (runId !== executeRunId) {
      return
    }

    const elapsedMs = elapsedSince(start)
    const totalMs = state.workflowElapsedMs + elapsedMs
    logTiming('render', elapsedMs)

    if (result.ok) {
      logTiming('total', totalMs)

      set({
        render: result.data,
        status: 'rendered',
        playbackSource: 'rendered',
        elapsedMs,
        lastFullRunMs: totalMs,
        workflowElapsedMs: totalMs,
        history: [
          ...get().history,
          createHistoryItem(
            state.lastIntentText || 'confirm plan',
            state.plan,
            result.data,
            'rendered',
          ),
        ],
      })
      return
    }

    set({
      status: 'plan_pending',
      error: { ...result.error, source: 'execute' },
      elapsedMs,
      workflowElapsedMs: totalMs,
      history: [
        ...get().history,
        createHistoryItem(
          state.lastIntentText || 'confirm plan',
          state.plan,
          null,
          'failed',
          result.error,
        ),
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
            source: 'execute',
          }
        : { ...result.error, source: 'execute' },
      playbackSource: 'original',
    })
  },

  cancelPlan: () => {
    const state = get()

    if (state.status !== 'plan_pending' && state.status !== 'reverted') {
      warnIllegal('cancelPlan', state.status)
      return
    }

    set({
      plan: null,
      render: null,
      error: null,
      status: 'idle',
      playbackSource: 'original',
      elapsedMs: 0,
      workflowElapsedMs: 0,
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
      history: markLatestRenderedHistoryReverted(state.history),
    })
  },

  reset: () => {
    analyzeRunId += 1
    parseRunId += 1
    executeRunId += 1
    set({ ...initialState })
  },

  addSfxClip: (clip) => {
    set((state) => ({ sfxClips: [...state.sfxClips, clip] }))
  },

  removeSfxClip: (clipId) => {
    set((state) => ({
      sfxClips: state.sfxClips.filter((c) => c.clip_id !== clipId),
    }))
  },

  toggleMuteClip: (clipId) => {
    set((state) => ({
      sfxClips: state.sfxClips.map((c) =>
        c.clip_id === clipId ? { ...c, muted: !c.muted } : c,
      ),
    }))
  },

  createAddSfxPlan: (asset) => {
    const state = get()
    if (!state.track) {
      warnIllegal('createAddSfxPlan', state.status)
      return
    }

    const plan: AddSfxPlan = {
      plan_id: globalThis.crypto?.randomUUID?.() ?? `sfx-plan-${Date.now()}`,
      op: 'add_sfx',
      track: state.track.track_id,
      query: asset.name,
      asset: { sfx_id: asset.sfx_id },
      placement: { locate: 'intro' },
      mix: {
        gain_db: SFX_DEFAULTS.gain_db,
        fade_in_ms: SFX_DEFAULTS.fade_in_ms,
        fade_out_ms: SFX_DEFAULTS.fade_out_ms,
        loop: SFX_DEFAULTS.loop,
      },
    }

    parseRunId += 1
    set({
      plan,
      render: null,
      error: null,
      status: 'plan_pending',
      playbackSource: 'original',
      elapsedMs: 0,
      lastIntentText: `添加音效: ${asset.name}`,
    })
  },

  updateSfxPlanLocate: (locate) => {
    const state = get()
    if (!state.plan || !isAddSfxPlan(state.plan)) return
    set({
      plan: {
        ...state.plan,
        placement: { ...state.plan.placement, locate },
      },
    })
  },

  updateSfxPlanGain: (gainDb) => {
    const state = get()
    if (!state.plan || !isAddSfxPlan(state.plan)) return
    set({
      plan: {
        ...state.plan,
        mix: { ...state.plan.mix, gain_db: gainDb },
      },
    })
  },
}))

export function getProjectFileSnapshot() {
  return createProjectFile(useProjectStore.getState())
}
