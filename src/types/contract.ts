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

/** 段落标签：按分小节能量粗分（README §7 Q1）。 */
export type SectionLabel = 'intro' | 'verse' | 'chorus' | 'outro'

/**
 * 能量粗分段落。add_sfx 的 `placement.locate`（"副歌/开头/结尾"）由后端
 * 依据它换算成秒——AI 只出语义定位，不造秒数（沿用 v1 铁律）。
 */
export type Section = {
  label: SectionLabel
  start_sec: number
  end_sec: number
}

export type AnalysisResult = {
  bars: Bar[]
  pitch: PitchPoint[]
  /** librosa 精确时长（秒），分析后用于回填 track.duration_sec 校准前端区间校验 */
  duration_sec?: number
  sr?: number
  /** v2/B3 新增：能量粗分段落。后端未实现时为 undefined，前端须按缺省降级。 */
  sections?: Section[]
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
  /**
   * v2：当前工程已有的音效。remove_sfx 要按 query 匹配出"将删清单"，
   * 后端无状态，所以匹配所需的 clips 必须随请求一起给过去。
   */
  sfxClips?: SfxClip[]
}

export type ParseIntentReq = {
  text: string
  project_state: ProjectState
}

// ───────────────────────── v2 · SFX（音效设计师）────────────────────────────

/** 素材来源：内置捆绑库 / 用户本地导入。P1 的在线库另行扩展。 */
export type SfxSource = 'builtin' | 'user'

/** 内置库四类（PPT 页 20：氛围/过渡/情绪/打击）。 */
export type SfxCategory = 'ambience' | 'transition' | 'emotion' | 'percussion' | 'other'

/**
 * 音效素材条目（GET /sfx/list 返回）。
 *
 * ⛔ `license` 与 `source_name` 是**必填**，不是可选：PPT 页 09/24 把版权划为红线
 * （BBC 音效库禁商用、生成模型权重 CC-BY-NC），要求每条素材携带授权来源元数据。
 * 设成必填后，漏填在类型层就报错，不依赖人工 review。
 */
export type SfxAsset = {
  sfx_id: string
  /** 中文显示名 */
  name: string
  category: SfxCategory
  /** 检索关键词（P0 命中方式：关键词/分类，非语义检索） */
  keywords: string[]
  duration_sec: number
  source: SfxSource
  /** 授权协议，如 'CC0' / 'Sonniss-GDC' / 'user-provided' */
  license: string
  /** 授权来源标注，答辩与公开发布时需要 */
  source_name: string
}

/**
 * 编排层的一条音效。**渲染的唯一事实源**：
 * `mixdown = 原始音频 + 全部 clips`，后端无状态，同一组 clips 永远同输出。
 * 删/改音效 = 改这个数组后整体重渲，所以"反悔"是免费的。
 */
export type SfxClip = {
  clip_id: string
  sfx_id: string
  start_sec: number
  /** 缺省时取素材自身时长；loop 为 true 时按此裁剪 */
  end_sec?: number
  gain_db: number
  fade_in_ms: number
  fade_out_ms: number
  loop?: boolean
  /** 本地静音（不参与渲染但保留在工程里），F5 的静音开关用 */
  muted?: boolean
}

/**
 * 混音默认值。
 * ⚠ `gain_db` / `fade_in_ms` 取自 README §5；`fade_out_ms` README 未给，
 * 暂取 PPT 页 13 示例里的 800——**以任务书 §2.1 为准，收到后核对**。
 */
export const SFX_DEFAULTS = {
  gain_db: -12,
  fade_in_ms: 200,
  fade_out_ms: 800,
  loop: false,
} as const

/** 语义定位：段落标签，或 `bar:3` 这样的第 N 小节。坐标一律由后端换算。 */
export type SfxLocate = SectionLabel | `bar:${number}`

export type SfxPlacement = {
  locate: SfxLocate
  /** 后端换算后回填；前端不自行推算 */
  start_sec?: number
  end_sec?: number
}

export type SfxMix = {
  gain_db: number
  fade_in_ms: number
  fade_out_ms: number
  loop?: boolean
}

// ───────────────────────────────── Plan ─────────────────────────────────────

export type PlanOp = 'correct_pitch' | 'transpose' | 'add_sfx' | 'remove_sfx'

/** v1 修音/移调计划。字段与 v1 完全一致，未做任何改动。 */
export type PitchPlan = {
  plan_id: string
  op: 'correct_pitch' | 'transpose'
  track: string
  start_sec: number
  end_sec: number
  mode: string
  scale: string
  strength: number
  /** transpose（移调）专用：正数升调、负数降调，单位半音 */
  semitones?: number
}

/** 「副歌进来时加一点雨声氛围」（PPT 页 13）。 */
export type AddSfxPlan = {
  plan_id: string
  op: 'add_sfx'
  track: string
  /** 用户原话里的素材描述，用于展示"AI 理解成了什么" */
  query: string
  /** ⛔ 只能命中库内条目，AI 不许编 sfx_id（PPT 页 13/24） */
  asset: { sfx_id: string }
  placement: SfxPlacement
  mix: SfxMix
  /** 未命中时后端返回候选让用户挑，禁止硬猜（README §7 Q2） */
  candidates?: SfxAsset[]
}

/** 「刚才的掌声太假，去掉」（PPT 页 13）。 */
export type RemoveSfxPlan = {
  plan_id: string
  op: 'remove_sfx'
  track: string
  target:
    | { by: 'query'; query: string }
    | { by: 'clip_id'; clip_id: string }
  scope: 'all_matching' | 'first'
  /**
   * 将被移除的 clip 清单。PPT 页 14 要求"执行前展示将删清单"，
   * 所以 remove 不是一条确定动作，而是一份待用户勾选确认的候选。
   */
  matches?: SfxClip[]
}

export type Plan = PitchPlan | AddSfxPlan | RemoveSfxPlan

export function isPitchPlan(plan: Plan): plan is PitchPlan {
  return plan.op === 'correct_pitch' || plan.op === 'transpose'
}

export function isAddSfxPlan(plan: Plan): plan is AddSfxPlan {
  return plan.op === 'add_sfx'
}

export function isRemoveSfxPlan(plan: Plan): plan is RemoveSfxPlan {
  return plan.op === 'remove_sfx'
}

export function isSfxPlan(plan: Plan): plan is AddSfxPlan | RemoveSfxPlan {
  return plan.op === 'add_sfx' || plan.op === 'remove_sfx'
}

/**
 * execute_plan 的参数体。
 *
 * 修音/移调沿用 PitchPlan 的部分字段；音效走 `clips` 全量下发——
 * PPT 页 14「后端无状态，不记忆删过什么，只看这一次传入的 clips」，
 * 所以幂等渲染的事实源在前端手里。
 */
// ⚠ 必须 Omit<'op'>：Partial<PitchPlan> 的 op 与 PlanOp 求交集会把
// add_sfx / remove_sfx 消掉，导致音效参数无法赋值。
export type ExecuteParameters = Partial<Omit<PitchPlan, 'op'>> & {
  op?: PlanOp
  /** 音效渲染唯一事实源：工程内全部 clips，每次执行全量下发 */
  clips?: SfxClip[]
}

export type ExecutePlanReq = {
  plan_id: string
  parameters: ExecuteParameters
}

// ─────────────────────── v2 · SFX 库管理接口（F1/F2）─────────────────────────

/** GET /sfx/list：内置 manifest + 用户库合并返回 */
export type SfxListResult = {
  assets: SfxAsset[]
}

/**
 * POST /sfx/import：导入个人音效。
 * ⚠ 传的是**本地绝对路径**（Electron 下 renderer 能拿到），不是文件内容。
 * 若后端按 multipart 上传设计，这里要改成读文件再传——**待与 B 确认**。
 */
export type SfxImportReq = {
  file_path: string
  /** 缺省时后端按文件名归入 'other'（README §7 Q2 的预期边界） */
  category?: SfxCategory
  name?: string
}

export type SfxImportResult = {
  asset: SfxAsset
}

/** POST /sfx/delete：仅允许删除 source === 'user' 的条目 */
export type SfxDeleteReq = {
  sfx_id: string
}

export type SfxDeleteResult = {
  deleted: true
  sfx_id: string
}

export type RenderResult = {
  output_path: string
  before_cents: number
  after_cents: number
  curve: { t: number; before: number; after: number }[]
  /** transpose 专用：操作类型与实际位移（applied_shifts 单位半音） */
  op?: 'correct_pitch' | 'transpose'
  applied_shifts?: number[]
  semitones?: number
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
  /**
   * v2/F6：工程持久化的音效编排。跨会话可继续编辑、可回滚，
   * 是"可逆"这个产品基石的落点（PPT 页 14）。
   * 素材库不持久化（每次从 /sfx/list 拉），只存 clips。
   */
  sfxClips?: SfxClip[]
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: ApiError }

export type SaveProjectResult = {
  saved: true
  path?: string
}

export type CancelResult = {
  cancelled: true
}

/** 渲染产物本地路径 → data URL（渲染进程不能直接加载 file://，经 main 读取）。 */
export type ReadFileDataUrlResult = {
  dataUrl: string
  sizeBytes: number
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
  save_project: 'save_project',
  load_project: 'load_project',
  read_file_data_url: 'read_file_data_url',
  // v2 · SFX 库管理（F1）。IPC 通道名；workerBridge 映射到 HTTP 路由。
  sfx_list: 'sfx_list',
  sfx_import: 'sfx_import',
  sfx_delete: 'sfx_delete',
} as const

export const ErrorCode = {
  ANALYZE_FAILED: 'ANALYZE_FAILED',
  PARSE_FAILED: 'PARSE_FAILED',
  PRECHECK_FAILED: 'PRECHECK_FAILED',
  RENDER_FAILED: 'RENDER_FAILED',
  RENDER_TIMEOUT: 'RENDER_TIMEOUT',
  CANCELLED: 'CANCELLED',
  WORKER_DOWN: 'WORKER_DOWN',
  // v2 · SFX
  SFX_LIST_FAILED: 'SFX_LIST_FAILED',
  SFX_IMPORT_FAILED: 'SFX_IMPORT_FAILED',
  SFX_DELETE_FAILED: 'SFX_DELETE_FAILED',
  /** 关键词未命中任何素材：不硬猜，返回候选让用户挑（README §7 Q2） */
  SFX_NOT_FOUND: 'SFX_NOT_FOUND',
} as const

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode]
