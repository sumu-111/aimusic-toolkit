import { useState } from 'react'
import './App.css'
import { analyze, executePlan, parseIntent } from './ipc/client'
import {
  CHANNELS,
  type AnalysisResult,
  type Plan,
  type ProjectState,
  type RenderResult,
  type Result,
} from './types/contract'

type ChainStep = {
  channel: string
  cost: number
  ok: boolean
}

type ChainLog = {
  steps: ChainStep[]
  analyze?: Result<AnalysisResult>
  plan?: Result<Plan>
  render?: Result<RenderResult>
}

const mockTrack = {
  track_id: 'mock-track-001',
  file_path: 'mock/demo.wav',
  file_name: 'demo.wav',
  duration_sec: 16,
  sample_rate: 44100,
}

async function measure<T>(
  channel: string,
  call: () => Promise<Result<T>>,
): Promise<[Result<T>, ChainStep]> {
  const start = performance.now()
  const result = await call()

  return [
    result,
    {
      channel,
      cost: Math.round(performance.now() - start),
      ok: result.ok,
    },
  ]
}

function App() {
  const hasHostApi = typeof window !== 'undefined' && Boolean(window.api)
  const [running, setRunning] = useState(false)
  const [log, setLog] = useState<ChainLog | null>(null)

  async function runMockChain() {
    if (running) {
      return
    }

    setRunning(true)
    const steps: ChainStep[] = []
    const nextLog: ChainLog = { steps }

    try {
      const [analysisResult, analysisStep] = await measure(
        CHANNELS.analyze,
        () =>
          analyze({
            track_id: mockTrack.track_id,
            file_path: mockTrack.file_path,
          }),
      )
      steps.push(analysisStep)
      nextLog.analyze = analysisResult
      console.log('[prompt1] analyze', analysisResult)

      if (!analysisResult.ok) {
        setLog({ ...nextLog })
        return
      }

      const projectState: ProjectState = {
        track: mockTrack,
        analysis: analysisResult.data,
        selectedBarIndex: 2,
        history: [],
        nodes: [],
      }

      const [planResult, planStep] = await measure(CHANNELS.parse_intent, () =>
        parseIntent({
          text: '只把人声第 3 小节高音修准',
          project_state: projectState,
        }),
      )
      steps.push(planStep)
      nextLog.plan = planResult
      console.log('[prompt1] parseIntent', planResult)

      if (!planResult.ok) {
        setLog({ ...nextLog })
        return
      }

      const [renderResult, renderStep] = await measure(
        CHANNELS.execute_plan,
        () =>
          executePlan({
            plan_id: planResult.data.plan_id,
            parameters: planResult.data,
          }),
      )
      steps.push(renderStep)
      nextLog.render = renderResult
      console.log('[prompt1] executePlan', renderResult)
      setLog({ ...nextLog })
    } finally {
      setRunning(false)
    }
  }

  return (
    <main className="app-shell">
      <section className="status-panel" aria-label="Project shell status">
        <div>
          <p className="eyebrow">Frontend A</p>
          <h1>AI Music Workbench</h1>
          <p className="summary">
            Vite, React 18, TypeScript, Electron, React Flow, WaveSurfer, and
            Zustand are ready.
          </p>
        </div>

        <div className="runtime-grid">
          <span>Renderer</span>
          <strong>{hasHostApi ? 'Electron host' : 'Browser fallback'}</strong>
          <span>Mock flag</span>
          <strong>{import.meta.env.VITE_MOCK ?? 'unset'}</strong>
        </div>

        <button className="chain-button" type="button" onClick={runMockChain}>
          {running ? '运行中...' : '运行 mock 全链路'}
        </button>

        {log && (
          <div className="chain-log" aria-live="polite">
            {log.steps.map((step) => (
              <div className="chain-row" key={step.channel}>
                <span>{step.channel}</span>
                <strong>{step.cost} ms</strong>
                <em>{step.ok ? 'ok' : 'failed'}</em>
              </div>
            ))}
          </div>
        )}

        <div className="stack-list" aria-label="Locked stack">
          <span>Vite</span>
          <span>React 18</span>
          <span>TypeScript</span>
          <span>Electron</span>
          <span>React Flow</span>
          <span>WaveSurfer v7</span>
          <span>Zustand</span>
        </div>
      </section>
    </main>
  )
}

export default App
