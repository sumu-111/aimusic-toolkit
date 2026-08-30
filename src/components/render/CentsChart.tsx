import { useMemo } from 'react'
import { useProjectStore } from '../../store/useProjectStore'
import './RenderPanels.css'

const COPY = {
  title: '\u504f\u5dee\u66f2\u7ebf',
  empty: '\u5f85\u6e32\u67d3\u7ed3\u679c',
  before: '\u4fee\u6b63\u524d',
  after: '\u4fee\u6b63\u540e',
  reduction: '\u4e0b\u964d',
  seconds: 's',
}

const WIDTH = 340
const HEIGHT = 150
const PADDING_X = 20
const PADDING_Y = 18

function formatCents(value: number) {
  return `${Math.round(value)}`
}

function createPath(
  points: Array<{ t: number; value: number }>,
  scaleX: (value: number) => number,
  scaleY: (value: number) => number,
) {
  return points
    .map((point, index) => {
      const command = index === 0 ? 'M' : 'L'

      return `${command} ${scaleX(point.t).toFixed(2)} ${scaleY(
        point.value,
      ).toFixed(2)}`
    })
    .join(' ')
}

export function CentsChart() {
  const render = useProjectStore((state) => state.render)
  const chart = useMemo(() => {
    if (!render?.curve.length) {
      return null
    }

    const times = render.curve.map((point) => point.t)
    const values = render.curve.flatMap((point) => [point.before, point.after, 0])
    const minTime = Math.min(...times)
    const maxTime = Math.max(...times)
    const minValue = Math.min(...values) - 4
    const maxValue = Math.max(...values) + 4
    const timeRange = Math.max(0.001, maxTime - minTime)
    const valueRange = Math.max(1, maxValue - minValue)
    const scaleX = (value: number) =>
      PADDING_X +
      ((value - minTime) / timeRange) * (WIDTH - PADDING_X * 2)
    const scaleY = (value: number) =>
      PADDING_Y +
      (1 - (value - minValue) / valueRange) * (HEIGHT - PADDING_Y * 2)
    const beforePath = createPath(
      render.curve.map((point) => ({ t: point.t, value: point.before })),
      scaleX,
      scaleY,
    )
    const afterPath = createPath(
      render.curve.map((point) => ({ t: point.t, value: point.after })),
      scaleX,
      scaleY,
    )

    return {
      afterPath,
      beforePath,
      maxTime,
      minTime,
      zeroY: scaleY(0),
    }
  }, [render])

  if (!render || !chart) {
    return (
      <section className="side-section cents-panel empty">
        <span>{COPY.title}</span>
        <small>{COPY.empty}</small>
      </section>
    )
  }

  const delta = render.before_cents - render.after_cents
  const reduction =
    render.before_cents === 0
      ? 0
      : (delta / Math.abs(render.before_cents)) * 100

  return (
    <section className="side-section cents-panel">
      <div className="panel-title-row">
        <span>{COPY.title}</span>
        <small>
          {chart.minTime.toFixed(2)}
          {COPY.seconds}-{chart.maxTime.toFixed(2)}
          {COPY.seconds}
        </small>
      </div>

      <div className="cents-metrics">
        <div>
          <span>{COPY.before}</span>
          <strong>{formatCents(render.before_cents)}</strong>
        </div>
        <b>{' -> '}</b>
        <div>
          <span>{COPY.after}</span>
          <strong>{formatCents(render.after_cents)}</strong>
        </div>
      </div>

      {delta > 0 && (
        <p className="cents-reduction">
          {COPY.reduction} {reduction.toFixed(0)}%
        </p>
      )}

      <svg
        className="cents-svg"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
      >
        <line
          className="cents-zero"
          x1="0"
          x2={WIDTH}
          y1={chart.zeroY}
          y2={chart.zeroY}
        />
        <path className="cents-before" d={chart.beforePath} />
        <path className="cents-after" d={chart.afterPath} />
      </svg>
    </section>
  )
}
