import { useProjectStore } from '../../../store/useProjectStore'
import { NodeShell } from './NodeShell'

const COPY = {
  title: '\u4fee\u97f3',
  waiting: '\u5f85\u751f\u6210\u8ba1\u5212',
  range: '\u533a\u95f4',
  mode: 'mode',
  strength: 'strength',
  result: 'cents',
}

export function PitchFixNode() {
  const plan = useProjectStore((state) => state.plan)
  const render = useProjectStore((state) => state.render)
  const status = useProjectStore((state) => state.status)
  const error = useProjectStore((state) => state.error)
  const tone =
    error && status === 'plan_pending'
      ? 'failed'
      : status === 'executing'
        ? 'busy'
        : render
          ? 'done'
          : plan
            ? 'done'
            : 'todo'

  return (
    <NodeShell title={COPY.title} tone={tone} source={false}>
      <strong className="node-primary">{plan?.op ?? COPY.waiting}</strong>
      <dl>
        <div>
          <dt>{COPY.range}</dt>
          <dd>
            {plan ? `${plan.start_sec.toFixed(2)}-${plan.end_sec.toFixed(2)}s` : '--'}
          </dd>
        </div>
        <div>
          <dt>{COPY.mode}</dt>
          <dd>{plan?.mode ?? '--'}</dd>
        </div>
        <div>
          <dt>{COPY.strength}</dt>
          <dd>{plan ? plan.strength.toFixed(2) : '--'}</dd>
        </div>
      </dl>
      {render && (
        <p className="node-result">
          {COPY.result} {render.before_cents}
          {' -> '}
          {render.after_cents}
        </p>
      )}
    </NodeShell>
  )
}
