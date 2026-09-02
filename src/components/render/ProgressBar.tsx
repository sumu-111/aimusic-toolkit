import { useEffect, useMemo, useState } from 'react'
import { useProjectStore } from '../../store/useProjectStore'
import './RenderPanels.css'

const COPY = {
  title: '\u6267\u884c\u8fdb\u5ea6',
  idle: '\u5f85\u786e\u8ba4',
  ready: '\u5df2\u6e32\u67d3',
  running: '\u6e32\u67d3\u4e2d',
  elapsed: '\u5df2\u7528\u65f6',
  cancel: '\u53d6\u6d88',
  slow:
    '\u6e32\u67d3\u8f83\u6162\uff0c\u53ef\u53d6\u6d88\u540e\u6539\u7528 16kHz \u515c\u5e95',
}

const ESTIMATED_SECONDS = 30

function formatSeconds(value: number) {
  return `${value.toFixed(1)}s`
}

function progressFromElapsed(elapsedSec: number) {
  return Math.min(
    85,
    85 * (1 - Math.exp(-elapsedSec / (ESTIMATED_SECONDS / 3))),
  )
}

export function ProgressBar() {
  const status = useProjectStore((state) => state.status)
  const elapsedMs = useProjectStore((state) => state.elapsedMs)
  const render = useProjectStore((state) => state.render)
  const cancelExecute = useProjectStore((state) => state.cancelExecute)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [now, setNow] = useState(() => performance.now())
  const isExecuting = status === 'executing'

  useEffect(() => {
    if (!isExecuting) {
      setStartedAt(null)
      return
    }

    const start = performance.now()

    setStartedAt(start)
    setNow(start)

    const timer = window.setInterval(() => {
      setNow(performance.now())
    }, 120)

    return () => window.clearInterval(timer)
  }, [isExecuting])

  const elapsedSec = useMemo(() => {
    if (isExecuting && startedAt !== null) {
      return Math.max(0, (now - startedAt) / 1000)
    }

    return elapsedMs / 1000
  }, [elapsedMs, isExecuting, now, startedAt])
  const progress = render
    ? 100
    : isExecuting
      ? progressFromElapsed(elapsedSec)
      : 0
  const label = render ? COPY.ready : isExecuting ? COPY.running : COPY.idle

  return (
    <section className="side-section progress-panel">
      <div className="panel-title-row">
        <span>{COPY.title}</span>
        <strong>{Math.round(progress)}%</strong>
      </div>

      <div className="progress-track" aria-label={COPY.title}>
        <span style={{ width: `${progress}%` }} />
      </div>

      <div className="progress-meta">
        <span>{label}</span>
        <span>
          {COPY.elapsed} {formatSeconds(elapsedSec)}
        </span>
      </div>

      {elapsedSec > 45 && isExecuting && (
        <p className="progress-slow">{COPY.slow}</p>
      )}

      <button
        type="button"
        onClick={() => void cancelExecute()}
        disabled={!isExecuting}
      >
        {COPY.cancel}
      </button>

      {render &&
        (render.op === 'transpose' ? (
          <small>
            {'\u5df2\u79fb\u8c03 '}
            {(render.semitones ?? 0) > 0 ? '+' : ''}
            {render.semitones ?? 0} {'\u534a\u97f3'}
          </small>
        ) : (
          <small>
            {render.before_cents} {' -> '} {render.after_cents} cents
          </small>
        ))}
    </section>
  )
}
