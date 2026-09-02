import { useProjectStore } from '../../store/useProjectStore'
import type { HistoryItem } from '../../types/contract'
import './HistoryPanel.css'

const COPY = {
  title: '\u5386\u53f2',
  empty: '\u6682\u65e0\u5386\u53f2',
  range: '\u533a\u95f4',
  result: '\u7ed3\u679c',
  rendered: '\u5df2\u6e32\u67d3',
  reverted: '\u5df2\u56de\u9000',
  failed: '\u5931\u8d25',
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
  return `${item.plan.start_sec.toFixed(2)}-${item.plan.end_sec.toFixed(2)}s`
}

function formatResult(item: HistoryItem) {
  if (!item.render) {
    return item.error?.error_code ?? '--'
  }

  if (item.render.op === 'transpose' || item.plan.op === 'transpose') {
    const semitones = item.render.semitones ?? item.plan.semitones ?? 0
    return `${semitones > 0 ? '+' : ''}${semitones} \u534a\u97f3`
  }

  return `${item.render.before_cents} -> ${item.render.after_cents} cents`
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
                {item.plan.op === 'transpose' ? (
                  <div>
                    <dt>{'\u534a\u97f3\u6570'}</dt>
                    <dd>{item.plan.semitones ?? 0}</dd>
                  </div>
                ) : (
                  <>
                    <div>
                      <dt>mode</dt>
                      <dd>{item.plan.mode}</dd>
                    </div>
                    <div>
                      <dt>strength</dt>
                      <dd>{item.plan.strength.toFixed(2)}</dd>
                    </div>
                  </>
                )}
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
