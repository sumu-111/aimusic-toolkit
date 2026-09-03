import { useProjectStore } from '../../store/useProjectStore'
import {
  isAddSfxPlan,
  isRemoveSfxPlan,
  isSfxPlan,
  type SfxLocate,
} from '../../types/contract'
import './SfxPanels.css'

const COPY = {
  title: '音效计划',
  confirm: '确认执行',
  cancel: '取消',
  executing: '执行中',
  addSfx: '添加音效',
  removeSfx: '删除音效',
  asset: '素材',
  query: '描述',
  placement: '位置',
  gain: '音量',
  target: '目标',
  scope: '范围',
  matches: '将删除',
  noMatches: '无匹配',
  allMatching: '全部匹配',
  first: '仅第一个',
}

const LOCATE_OPTIONS: { value: SfxLocate; label: string }[] = [
  { value: 'intro', label: '开头' },
  { value: 'verse', label: '主歌' },
  { value: 'chorus', label: '副歌' },
  { value: 'outro', label: '结尾' },
]

export function SfxPlanCard() {
  const plan = useProjectStore((s) => s.plan)
  const status = useProjectStore((s) => s.status)
  const confirmPlan = useProjectStore((s) => s.confirmPlan)
  const cancelPlan = useProjectStore((s) => s.cancelPlan)
  const updateSfxPlanLocate = useProjectStore((s) => s.updateSfxPlanLocate)
  const updateSfxPlanGain = useProjectStore((s) => s.updateSfxPlanGain)

  if (!plan || !isSfxPlan(plan)) return null

  const canEdit = status === 'plan_pending' || status === 'reverted'
  const canConfirm = canEdit

  if (isAddSfxPlan(plan)) {
    return (
      <section className="side-section sfx-plan-card">
        <div className="sfx-plan-header">
          <span>{COPY.addSfx}</span>
          <small>{plan.plan_id.slice(0, 8)}</small>
        </div>

        <dl className="sfx-plan-detail">
          <dt>{COPY.query}</dt>
          <dd>{plan.query}</dd>
          <dt>{COPY.asset}</dt>
          <dd>{plan.asset.sfx_id}</dd>
        </dl>

        <div className="sfx-plan-controls">
          <label>
            <span>{COPY.placement}</span>
            <select
              disabled={!canEdit}
              value={plan.placement.locate}
              onChange={(e) =>
                updateSfxPlanLocate(e.target.value as SfxLocate)
              }
            >
              {LOCATE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{COPY.gain}</span>
            <input
              type="range"
              disabled={!canEdit}
              min={-30}
              max={0}
              step={1}
              value={plan.mix.gain_db}
              onChange={(e) => updateSfxPlanGain(Number(e.target.value))}
            />
            <output>{plan.mix.gain_db} dB</output>
          </label>
        </div>

        <div className="sfx-plan-actions">
          <button
            type="button"
            onClick={() => void confirmPlan()}
            disabled={!canConfirm}
          >
            {status === 'executing' ? COPY.executing : COPY.confirm}
          </button>
          <button type="button" onClick={cancelPlan} disabled={!canEdit}>
            {COPY.cancel}
          </button>
        </div>
      </section>
    )
  }

  if (isRemoveSfxPlan(plan)) {
    const matches = plan.matches ?? []
    const targetLabel =
      plan.target.by === 'query' ? plan.target.query : plan.target.clip_id

    return (
      <section className="side-section sfx-plan-card">
        <div className="sfx-plan-header">
          <span>{COPY.removeSfx}</span>
          <small>{plan.plan_id.slice(0, 8)}</small>
        </div>

        <dl className="sfx-plan-detail">
          <dt>{COPY.target}</dt>
          <dd>{targetLabel}</dd>
          <dt>{COPY.scope}</dt>
          <dd>
            {plan.scope === 'all_matching' ? COPY.allMatching : COPY.first}
          </dd>
        </dl>

        <div className="sfx-match-list">
          <strong>
            {COPY.matches} ({matches.length})
          </strong>
          {matches.length === 0 ? (
            <small>{COPY.noMatches}</small>
          ) : (
            matches.map((clip) => (
              <label key={clip.clip_id}>
                <input type="checkbox" checked disabled />
                {clip.sfx_id} @ {clip.start_sec.toFixed(1)}s ({clip.gain_db}{' '}
                dB)
              </label>
            ))
          )}
        </div>

        <div className="sfx-plan-actions">
          <button
            type="button"
            onClick={() => void confirmPlan()}
            disabled={!canConfirm || matches.length === 0}
          >
            {status === 'executing' ? COPY.executing : COPY.confirm}
          </button>
          <button type="button" onClick={cancelPlan} disabled={!canEdit}>
            {COPY.cancel}
          </button>
        </div>
      </section>
    )
  }

  return null
}
