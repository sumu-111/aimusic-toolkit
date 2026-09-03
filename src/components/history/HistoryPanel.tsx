import { useProjectStore } from '../../store/useProjectStore'
import {
  isPitchPlan,
  type HistoryItem,
  type SfxLocate,
} from '../../types/contract'
import './HistoryPanel.css'

const COPY = {
  title: '\u5386\u53f2',
  empty: '\u6682\u65e0\u5386\u53f2',
  range: '\u533a\u95f4',
  result: '\u7ed3\u679c',
  rendered: '\u5df2\u6e32\u67d3',
  reverted: '\u5df2\u56de\u9000',
  failed: '\u5931\u8d25',
  // v2/F7\uff1a\u65b0 op \u7684\u4e2d\u6587\u6587\u6848
  addSfx: '\u52a0\u97f3\u6548',
  removeSfx: '\u5220\u97f3\u6548',
  wholeTrack: '\u5168\u66f2',
}

/** \u8bed\u4e49\u5b9a\u4f4d \u2192 \u4e2d\u6587\u3002bar:N \u8d70"\u7b2c N \u5c0f\u8282"\u3002 */
const LOCATE_LABELS: Record<string, string> = {
  intro: '\u5f00\u5934',
  verse: '\u4e3b\u6b4c',
  chorus: '\u526f\u6b4c',
  outro: '\u7ed3\u5c3e',
}

function formatLocate(locate: SfxLocate) {
  if (locate.startsWith('bar:')) {
    return `\u7b2c ${locate.slice(4)} \u5c0f\u8282`
  }

  return LOCATE_LABELS[locate] ?? locate
}

const STATUS_LABELS: Record<HistoryItem['status'], string> = {
  rendered: COPY.rendered,
  reverted: COPY.reverted,
  failed: COPY.failed,
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value))
}

function formatRange(item: HistoryItem) {
  const { plan } = item

  if (isPitchPlan(plan)) {
    return `${plan.start_sec.toFixed(2)}-${plan.end_sec.toFixed(2)}s`
  }

  if (plan.op === 'add_sfx') {
    const { start_sec, end_sec } = plan.placement
    // \u540e\u7aef\u6362\u7b97\u8fc7\u5c31\u663e\u793a\u79d2\uff0c\u5426\u5219\u53ea\u663e\u793a\u8bed\u4e49\u5b9a\u4f4d
    return start_sec !== undefined && end_sec !== undefined
      ? `${formatLocate(plan.placement.locate)} ${start_sec.toFixed(2)}-${end_sec.toFixed(2)}s`
      : formatLocate(plan.placement.locate)
  }

  return plan.scope === 'all_matching' ? COPY.wholeTrack : '--'
}

/** 每种 op 展示自己的关键参数，避免用"非 transpose 即修音"这种默认分支。 */
function planDetails(plan: HistoryItem['plan']): { label: string; value: string }[] {
  if (plan.op === 'transpose') {
    return [{ label: '半音数', value: String(plan.semitones ?? 0) }]
  }

  if (plan.op === 'correct_pitch') {
    return [
      { label: 'mode', value: plan.mode },
      { label: 'strength', value: plan.strength.toFixed(2) },
    ]
  }

  if (plan.op === 'add_sfx') {
    return [
      { label: '素材', value: plan.asset.sfx_id },
      { label: '音量', value: `${plan.mix.gain_db} dB` },
    ]
  }

  if (plan.op === 'remove_sfx') {
    return [
      {
        label: '目标',
        value:
          plan.target.by === 'query' ? plan.target.query : plan.target.clip_id,
      },
      { label: '条数', value: String(plan.matches?.length ?? 1) },
    ]
  }

  return []
}

function formatResult(item: HistoryItem) {
  const { plan, render } = item

  if (!render) {
    return item.error?.error_code ?? '--'
  }

  if (plan.op === 'add_sfx') {
    return `${COPY.addSfx}\u300c${plan.query}\u300d${plan.mix.gain_db} dB`
  }

  if (plan.op === 'remove_sfx') {
    const label =
      plan.target.by === 'query' ? `\u300c${plan.target.query}\u300d` : plan.target.clip_id
    return `${COPY.removeSfx}${label} \u00d7${plan.matches?.length ?? 1}`
  }

  if (render.op === 'transpose' || plan.op === 'transpose') {
    const semitones = render.semitones ?? plan.semitones ?? 0
    return `${semitones > 0 ? '+' : ''}${semitones} \u534a\u97f3`
  }

  return `${render.before_cents} -> ${render.after_cents} cents`
}

export function HistoryPanel() {
  const history = useProjectStore((state) => state.history)
  const restoreHistoryItem = useProjectStore((state) => state.restoreHistoryItem)
  const items = [...history].reverse()

  return (
    <section className="side-section history-panel">
      <div className="panel-title-row">
        <span>{COPY.title}</span>
        <small>{items.length}</small>
      </div>

      {items.length === 0 ? (
        <small>{COPY.empty}</small>
      ) : (
        <div className="history-list">
          {items.map((item) => (
            <button
              className="history-item"
              key={item.id}
              type="button"
              onClick={() => restoreHistoryItem(item.id)}
            >
              <div className="history-item-head">
                <time dateTime={item.created_at}>{formatTime(item.created_at)}</time>
                <span className={`history-status ${item.status}`}>
                  {STATUS_LABELS[item.status]}
                </span>
              </div>
              <strong>{item.text}</strong>
              <dl>
                <div>
                  <dt>{COPY.range}</dt>
                  <dd>{formatRange(item)}</dd>
                </div>
                {planDetails(item.plan).map((detail) => (
                  <div key={detail.label}>
                    <dt>{detail.label}</dt>
                    <dd>{detail.value}</dd>
                  </div>
                ))}
                <div>
                  <dt>{COPY.result}</dt>
                  <dd>{formatResult(item)}</dd>
                </div>
              </dl>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
