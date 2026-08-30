import { useProjectStore } from '../../../store/useProjectStore'
import { NodeShell } from './NodeShell'

const COPY = {
  title: '\u5bfc\u5165',
  waiting: '\u5f85\u5bfc\u5165',
  duration: '\u65f6\u957f',
  sampleRate: '\u91c7\u6837\u7387',
}

function formatDuration(durationSec?: number) {
  if (!Number.isFinite(durationSec)) {
    return '--'
  }

  return `${(durationSec ?? 0).toFixed(1)}s`
}

export function AudioImportNode() {
  const track = useProjectStore((state) => state.track)

  return (
    <NodeShell title={COPY.title} tone={track ? 'done' : 'todo'} target={false}>
      <strong className="node-primary">{track?.file_name ?? COPY.waiting}</strong>
      <dl>
        <div>
          <dt>{COPY.duration}</dt>
          <dd>{formatDuration(track?.duration_sec)}</dd>
        </div>
        <div>
          <dt>{COPY.sampleRate}</dt>
          <dd>{track?.sample_rate ? `${track.sample_rate} Hz` : '--'}</dd>
        </div>
      </dl>
    </NodeShell>
  )
}
