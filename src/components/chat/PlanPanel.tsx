import { forwardRef, useMemo } from 'react'
import { useProjectStore } from '../../store/useProjectStore'
import './ChatPanels.css'

const COPY = {
  title: '\u8ba1\u5212',
  empty: '\u5f85\u751f\u6210\u8ba1\u5212',
  operation: '\u64cd\u4f5c',
  start: 'start_sec',
  end: 'end_sec',
  mode: 'mode',
  scale: 'scale',
  strength: 'strength',
  semitones: 'semitones(\u534a\u97f3)',
  confirm: '\u786e\u8ba4\u6267\u884c',
  cancel: '\u53d6\u6d88',
  executing: '\u6267\u884c\u4e2d',
  invalidOrder:
    '\u7ed3\u675f\u65f6\u95f4\u5fc5\u987b\u5927\u4e8e\u5f00\u59cb\u65f6\u95f4',
  invalidBounds:
    '\u533a\u95f4\u4e0d\u80fd\u8d85\u51fa\u97f3\u9891\u65f6\u957f',
  invalidLength:
    '\u533a\u95f4\u957f\u5ea6\u4e0d\u80fd\u8d85\u8fc7 15 \u79d2',
}

export const PlanPanel = forwardRef<HTMLElement>(function PlanPanel(_, ref) {
  const track = useProjectStore((state) => state.track)
  const analysis = useProjectStore((state) => state.analysis)
  const plan = useProjectStore((state) => state.plan)
  const status = useProjectStore((state) => state.status)
  const updatePlanParam = useProjectStore((state) => state.updatePlanParam)
  const confirmPlan = useProjectStore((state) => state.confirmPlan)
  const cancelPlan = useProjectStore((state) => state.cancelPlan)
  const duration =
    track?.duration_sec ??
    analysis?.bars.reduce((max, bar) => Math.max(max, bar.end_sec), 0) ??
    0
  const violations = useMemo(() => {
    if (!plan) {
      return []
    }

    const nextViolations: string[] = []
    const length = plan.end_sec - plan.start_sec

    if (plan.end_sec <= plan.start_sec) {
      nextViolations.push(COPY.invalidOrder)
    }

    if (
      plan.start_sec < 0 ||
      (duration > 0 && plan.end_sec > duration)
    ) {
      nextViolations.push(COPY.invalidBounds)
    }

    // transpose（移调）天然面向整首/大段，不设 15s 窗口上限；
    // correct_pitch 修音窗口保留 demo 长度限制。
    if (plan.op !== 'transpose' && length > 15) {
      nextViolations.push(COPY.invalidLength)
    }

    return nextViolations
  }, [duration, plan])
  const canEdit =
    Boolean(plan) && (status === 'plan_pending' || status === 'reverted')
  const canConfirm = canEdit && violations.length === 0

  function updateNumber(
    key: 'start_sec' | 'end_sec' | 'strength' | 'semitones',
    rawValue: string,
  ) {
    const value = Number(rawValue)

    if (!Number.isFinite(value)) {
      return
    }

    updatePlanParam(key, value)
  }

  if (!plan) {
    return (
      <section className="side-section plan-panel empty" ref={ref}>
        <span>{COPY.title}</span>
        <small>{COPY.empty}</small>
      </section>
    )
  }

  return (
    <section className="side-section plan-panel" ref={ref}>
      <div className="panel-title-row">
        <span>{COPY.title}</span>
        <small>{plan.plan_id}</small>
      </div>

      <div className="operation-row">
        <span>{COPY.operation}</span>
        <strong>{plan.op}</strong>
      </div>

      <div className="plan-fields">
        <label>
          <span>{COPY.start}</span>
          <input
            disabled={!canEdit}
            onChange={(event) => updateNumber('start_sec', event.target.value)}
            step="0.01"
            type="number"
            value={plan.start_sec}
          />
        </label>
        <label>
          <span>{COPY.end}</span>
          <input
            disabled={!canEdit}
            onChange={(event) => updateNumber('end_sec', event.target.value)}
            step="0.01"
            type="number"
            value={plan.end_sec}
          />
        </label>
        {plan.op === 'transpose' ? (
          <label>
            <span>{COPY.semitones}</span>
            <input
              disabled={!canEdit}
              max="12"
              min="-12"
              onChange={(event) => updateNumber('semitones', event.target.value)}
              step="1"
              type="number"
              value={plan.semitones ?? 0}
            />
          </label>
        ) : (
          <>
            <label>
              <span>{COPY.mode}</span>
              <select
                disabled={!canEdit}
                onChange={(event) => updatePlanParam('mode', event.target.value)}
                value={plan.mode}
              >
                <option value="scale">scale</option>
                <option value="fixed">fixed</option>
                <option value="auto">auto</option>
              </select>
            </label>
            <label>
              <span>{COPY.scale}</span>
              <select
                disabled={!canEdit}
                onChange={(event) => updatePlanParam('scale', event.target.value)}
                value={plan.scale}
              >
                <option value="C_major">C_major</option>
                <option value="A_minor">A_minor</option>
                <option value="chromatic">chromatic</option>
              </select>
            </label>
          </>
        )}
      </div>

      {plan.op !== 'transpose' && (
        <label className="strength-field">
          <span>{COPY.strength}</span>
          <input
            disabled={!canEdit}
            max="1"
            min="0"
            onChange={(event) => updateNumber('strength', event.target.value)}
            step="0.05"
            type="range"
            value={plan.strength}
          />
          <output>{plan.strength.toFixed(2)}</output>
        </label>
      )}

      {violations.length > 0 && (
        <div className="plan-violations">
          {violations.map((violation) => (
            <p key={violation}>{violation}</p>
          ))}
        </div>
      )}

      <div className="plan-actions">
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
})
