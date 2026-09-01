import type { Bar, PitchPoint } from '../../types/contract'

/**
 * 把后端分析数据（bars + pitch）转化为「风格 / 结构」自然语言摘要，
 * 替代右侧 Inspector 面板里突兀的 JSON 代码。
 */

type AnalysisInsightProps = {
  bars: Bar[]
  pitch: PitchPoint[]
  durationSec?: number
}

function hzToNoteName(hz: number): string {
  if (hz <= 0) {
    return '--'
  }
  const midi = 69 + 12 * Math.log2(hz / 440)
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  const octave = Math.floor(midi / 12) - 1
  const name = names[Math.round(midi) % 12]
  return `${name}${octave}`
}

function mean(values: number[]): number {
  if (!values.length) {
    return 0
  }
  return values.reduce((a, b) => a + b, 0) / values.length
}

function describeStructure(bars: Bar[], durationSec?: number) {
  const totalBars = bars.length
  const dur = durationSec ?? (bars.length ? bars[bars.length - 1].end_sec : 0)
  const avgBarDur = totalBars > 0 ? dur / totalBars : 0

  const sections: string[] = []
  const sectionSize = 4
  for (let i = 0; i < totalBars; i += sectionSize) {
    const start = bars[i]?.start_sec ?? 0
    const endIdx = Math.min(i + sectionSize - 1, totalBars - 1)
    const end = bars[endIdx]?.end_sec ?? start
    sections.push(`第${i + 1}-${endIdx + 1}小节（${start.toFixed(1)}-${end.toFixed(1)}s）`)
  }

  return {
    totalBars,
    dur,
    avgBarDur,
    sections,
  }
}

function describeStyle(pitch: PitchPoint[]) {
  if (!pitch.length) {
    return {
      rangeHz: '--',
      rangeNote: '--',
      avgConfidence: 0,
      voiceQuality: '未检测到音高',
      trend: '—',
    }
  }

  const validPitch = pitch.filter((p) => p.pitch > 0 && !Number.isNaN(p.pitch))
  const pitches = validPitch.map((p) => p.pitch)
  const confidences = pitch.map((p) => p.confidence)

  const minHz = pitches.length ? Math.min(...pitches) : 0
  const maxHz = pitches.length ? Math.max(...pitches) : 0
  const avgConfidence = mean(confidences)

  let voiceQuality = '人声清晰度一般'
  if (avgConfidence >= 0.75) {
    voiceQuality = '人声清晰，适合自动修音'
  } else if (avgConfidence >= 0.5) {
    voiceQuality = '人声可辨，建议小幅修正'
  } else {
    voiceQuality = '背景较杂或气息音多，建议人工复核'
  }

  const firstHalf = validPitch.slice(0, Math.floor(validPitch.length / 2))
  const secondHalf = validPitch.slice(Math.floor(validPitch.length / 2))
  const firstMean = mean(firstHalf.map((p) => p.pitch))
  const secondMean = mean(secondHalf.map((p) => p.pitch))
  const diffCents = 1200 * Math.log2((secondMean || 1) / (firstMean || 1))

  let trend = '整体音高平稳'
  if (diffCents > 80) {
    trend = '后半段音高明显上扬'
  } else if (diffCents < -80) {
    trend = '后半段音高明显下行'
  } else if (Math.abs(diffCents) > 30) {
    trend = diffCents > 0 ? '后半段略有上扬' : '后半段略有下行'
  }

  // 用 pitch 标准差判断平稳/起伏
  const avgPitch = mean(pitches)
  const variance = mean(pitches.map((p) => (p - avgPitch) ** 2))
  const sd = Math.sqrt(variance)
  const stability = sd > avgPitch * 0.12 ? '旋律起伏较大' : '旋律相对平稳'

  return {
    rangeHz: `${Math.round(minHz)}-${Math.round(maxHz)} Hz`,
    rangeNote: `${hzToNoteName(minHz)}-${hzToNoteName(maxHz)}`,
    avgConfidence,
    voiceQuality,
    trend,
    stability,
  }
}

export function AnalysisInsight({ bars, pitch, durationSec }: AnalysisInsightProps) {
  const structure = describeStructure(bars, durationSec)
  const style = describeStyle(pitch)

  return (
    <div className="analysis-insight">
      <section>
        <h4>结构</h4>
        <p>
          全曲约 <strong>{structure.dur.toFixed(1)}s</strong>，共{' '}
          <strong>{structure.totalBars} 个小节</strong>，平均小节长度约{' '}
          {structure.avgBarDur.toFixed(2)}s。按 4 小节一段可划分为：
        </p>
        <ul>
          {structure.sections.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </section>

      <section>
        <h4>风格 / 人声特征</h4>
        <p>
          音域 <strong>{style.rangeHz}</strong>（约 {style.rangeNote}），
          {style.stability}，{style.trend}。
        </p>
        <p>
          音高检测平均置信度 <strong>{(style.avgConfidence * 100).toFixed(0)}%</strong>：
          {style.voiceQuality}。
        </p>
      </section>
    </div>
  )
}
