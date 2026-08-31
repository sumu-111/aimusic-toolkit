import { useProjectStore } from '../../../store/useProjectStore'
import { NodeShell } from './NodeShell'

const COPY = {
  title: '\u5206\u6790',
  bars: 'bars',
  pitch: 'pitch',
  confidence: '\u7f6e\u4fe1\u5ea6',
  waiting: '\u5f85\u5206\u6790',
  analyzed: '\u5df2\u5206\u6790',
}

function averageConfidence(analysis: ReturnType<typeof useProjectStore.getState>['analysis']) {
  if (!analysis?.pitch.length) {
    return null
  }

  return (
    analysis.pitch.reduce((sum, point) => sum + point.confidence, 0) /
    analysis.pitch.length
  )
}

export function AnalysisNode() {
  const analysis = useProjectStore((state) => state.analysis)
  const status = useProjectStore((state) => state.status)
  const error = useProjectStore((state) => state.error)
  const confidence = averageConfidence(analysis)
  const isAnalyzing = status === 'analyzing'
  const tone =
    error?.source === 'analyze' && !analysis
      ? 'failed'
      : isAnalyzing
        ? 'busy'
        : analysis
          ? 'done'
          : 'todo'

  return (
    <NodeShell title={COPY.title} tone={tone}>
      <strong className="node-primary">
        {isAnalyzing ? (
          <span className="node-loading">{COPY.title}</span>
        ) : (
          analysis ? COPY.analyzed : COPY.waiting
        )}
      </strong>
      <dl>
        <div>
          <dt>{COPY.bars}</dt>
          <dd>{analysis?.bars.length ?? 0}</dd>
        </div>
        <div>
          <dt>{COPY.pitch}</dt>
          <dd>{analysis?.pitch.length ?? 0}</dd>
        </div>
        <div>
          <dt>{COPY.confidence}</dt>
          <dd>{confidence === null ? '--' : confidence.toFixed(2)}</dd>
        </div>
      </dl>
    </NodeShell>
  )
}
