import {
  type ChangeEvent,
  type DragEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import './App.css'
import { ErrorBoundary } from './components/ErrorBoundary'
import { FlowCanvas } from './components/canvas/FlowCanvas'
import { ChatInput } from './components/chat/ChatInput'
import { PlanPanel } from './components/chat/PlanPanel'
import { HistoryPanel } from './components/history/HistoryPanel'
import { AnalysisInsight } from './components/inspector/AnalysisInsight'
import './components/inspector/AnalysisInsight.css'
import { CentsChart } from './components/render/CentsChart'
import { ProgressBar } from './components/render/ProgressBar'
import { WaveformPanel } from './components/waveform/WaveformPanel'
import { loadProject, saveProject } from './ipc/client'
import {
  getProjectFileSnapshot,
  useProjectStore,
  type ProjectStatus,
} from './store/useProjectStore'

const COPY = {
  appName: 'AI Music Workbench',
  importWav: '\u5bfc\u5165 WAV',
  save: '\u4fdd\u5b58',
  revert: '\u56de\u9000',
  browserFallbackMode:
    '\u6d4f\u89c8\u5668\u515c\u5e95\u6a21\u5f0f\uff08mock\uff09',
  electronHost: 'Electron Host',
  canvas: '\u753b\u5e03',
  waveform: '\u6ce2\u5f62\u533a',
  fullRun: '\u672c\u6b21\u5168\u94fe\u8def',
  minViewport: '1400 px',
}

const STATUS_LABELS: Record<ProjectStatus, string> = {
  idle: 'idle',
  analyzing: 'analyzing',
  analyzed: 'analyzed',
  parsing: 'parsing',
  plan_pending: 'plan_pending',
  executing: 'executing',
  rendered: 'rendered',
  reverted: 'reverted',
}

const STATUS_TONE: Record<ProjectStatus, string> = {
  idle: 'neutral',
  analyzing: 'busy',
  analyzed: 'done',
  parsing: 'busy',
  plan_pending: 'pending',
  executing: 'busy',
  rendered: 'done',
  reverted: 'pending',
}

function makeTrackId(file: File) {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${file.name}-${file.lastModified}-${Date.now()}`
  )
}

function isWavFile(file: File) {
  return (
    file.name.toLowerCase().endsWith('.wav') ||
    file.type === 'audio/wav' ||
    file.type === 'audio/x-wav'
  )
}

function readDurationSec(url: string) {
  return new Promise<number | undefined>((resolve) => {
    const audio = document.createElement('audio')
    let settled = false

    const finish = (duration?: number) => {
      if (settled) {
        return
      }

      settled = true
      audio.removeAttribute('src')
      audio.load()
      resolve(Number.isFinite(duration) ? duration : undefined)
    }

    const timer = window.setTimeout(() => finish(), 1500)

    audio.addEventListener('loadedmetadata', () => {
      window.clearTimeout(timer)
      finish(audio.duration)
    })

    audio.addEventListener('error', () => {
      window.clearTimeout(timer)
      finish()
    })

    audio.preload = 'metadata'
    audio.src = url
  })
}

function formatFullRun(elapsedMs: number) {
  return elapsedMs ? `${(elapsedMs / 1000).toFixed(1)} \u79d2` : '--'
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index))
  }
}

function createDemoWavUrl() {
  const sampleRate = 44100
  const durationSec = 30
  const samples = sampleRate * durationSec
  const dataSize = samples * 2
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, dataSize, true)

  for (let index = 0; index < samples; index += 1) {
    const t = index / sampleRate
    const envelope = 0.32 + 0.18 * Math.sin(2 * Math.PI * 0.35 * t)
    const tone =
      Math.sin(2 * Math.PI * 220 * t) +
      0.45 * Math.sin(2 * Math.PI * 440 * t)
    const sample = Math.max(-1, Math.min(1, tone * envelope * 0.45))

    view.setInt16(44 + index * 2, sample * 0x7fff, true)
  }

  return {
    durationSec,
    sampleRate,
    url: URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' })),
  }
}

function App() {
  const hasHostApi = typeof window !== 'undefined' && Boolean(window.api)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const objectUrlRef = useRef<string | null>(null)
  const planPanelRef = useRef<HTMLElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [importMessage, setImportMessage] = useState<string | null>(null)
  const status = useProjectStore((state) => state.status)
  const lastFullRunMs = useProjectStore((state) => state.lastFullRunMs)
  const restoreNotice = useProjectStore((state) => state.restoreNotice)
  const inspectorNode = useProjectStore((state) => state.inspectorNode)
  const setTrack = useProjectStore((state) => state.setTrack)
  const revert = useProjectStore((state) => state.revert)
  const reset = useProjectStore((state) => state.reset)

  useEffect(() => {
    let cancelled = false

    void loadProject().then((result) => {
      if (cancelled) {
        return
      }

      if (result.ok && result.data) {
        useProjectStore.getState().restoreProject(result.data)
        return
      }

      if (!result.ok) {
        console.warn('[project] load failed', result.error)
      }
    })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let timer: number | undefined

    const unsubscribe = useProjectStore.subscribe((state, previousState) => {
      const shouldSave =
        state.status !== previousState.status ||
        state.analysis !== previousState.analysis ||
        state.history !== previousState.history ||
        state.nodePositions !== previousState.nodePositions ||
        state.plan !== previousState.plan ||
        state.render !== previousState.render ||
        state.selectedBarIndex !== previousState.selectedBarIndex

      if (!shouldSave) {
        return
      }

      if (timer) {
        window.clearTimeout(timer)
      }

      timer = window.setTimeout(() => {
        void saveProject(getProjectFileSnapshot()).then((result) => {
          if (result.ok) {
            console.info('[project] autosaved', result.data.path ?? 'localStorage')
            return
          }

          console.warn('[project] autosave failed', result.error)
        })
      }, 1000)
    })

    return () => {
      if (timer) {
        window.clearTimeout(timer)
      }

      unsubscribe()
    }
  }, [])

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current)
      }
    }
  }, [])

  useEffect(() => {
    function handleDemoShortcut(event: KeyboardEvent) {
      if (!event.ctrlKey || !event.shiftKey || event.key.toLowerCase() !== 'd') {
        return
      }

      event.preventDefault()

      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current)
      }

      const importStart = performance.now()
      const demo = createDemoWavUrl()

      objectUrlRef.current = demo.url
      reset()
      setImportMessage(null)
      setTrack(
        {
          track_id: `demo-${Date.now()}`,
          file_path: 'demo-vocal-30s.wav',
          file_name: 'demo-vocal-30s.wav',
          duration_sec: demo.durationSec,
          sample_rate: demo.sampleRate,
          url: demo.url,
        },
        Math.round(performance.now() - importStart),
      )
    }

    window.addEventListener('keydown', handleDemoShortcut)

    return () => window.removeEventListener('keydown', handleDemoShortcut)
  }, [reset, setTrack])

  async function importFile(file: File) {
    const importStart = performance.now()

    if (!isWavFile(file)) {
      setImportMessage('WAV only')
      console.warn('[app] import ignored: file is not wav', file)
      return
    }

    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
    }

    const url = URL.createObjectURL(file)
    objectUrlRef.current = url
    const durationSec = await readDurationSec(url)
    // Electron：webUtils 取磁盘真实路径给 worker（否则 worker os.path.exists 404）；
    // 浏览器兜底（无 host API）：退化为文件名，mock 模式不依赖磁盘路径。
    const filePath =
      window.api?.getPathForFile?.(file) ?? file.name

    setTrack(
      {
        track_id: makeTrackId(file),
        file_path: filePath,
        file_name: file.name,
        duration_sec: durationSec,
        sample_rate: 44100,
        url,
      },
      Math.round(performance.now() - importStart),
    )

    setImportMessage(null)
  }

  function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]

    if (file) {
      void importFile(file)
    }

    event.target.value = ''
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault()
    setIsDragging(false)

    const file = event.dataTransfer.files[0]

    if (file) {
      void importFile(file)
    }
  }

  function handleDragOver(event: DragEvent<HTMLElement>) {
    event.preventDefault()
    setIsDragging(true)
  }

  function handleDragLeave(event: DragEvent<HTMLElement>) {
    const relatedTarget = event.relatedTarget

    if (
      relatedTarget instanceof Node &&
      event.currentTarget.contains(relatedTarget)
    ) {
      return
    }

    setIsDragging(false)
  }

  const scrollToPlan = useCallback(() => {
    planPanelRef.current?.scrollIntoView({
      block: 'nearest',
      behavior: 'smooth',
    })
  }, [])

  function handleSave() {
    void saveProject(getProjectFileSnapshot()).then((result) => {
      if (result.ok) {
        console.info('[project] saved', result.data.path ?? 'localStorage')
        return
      }

      console.warn('[project] save failed', result.error)
    })
  }

  return (
    <main className="app-shell">
      <input
        ref={fileInputRef}
        className="file-input"
        type="file"
        accept=".wav,audio/wav,audio/x-wav"
        onChange={handleInputChange}
      />

      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">A</span>
          <strong>{COPY.appName}</strong>
        </div>

        <div className="toolbar">
          <button type="button" onClick={() => fileInputRef.current?.click()}>
            {COPY.importWav}
          </button>
          <span className={`status-badge ${STATUS_TONE[status]}`}>
            {STATUS_LABELS[status]}
          </span>
          <button type="button" onClick={handleSave}>
            {COPY.save}
          </button>
          <button type="button" onClick={revert}>
            {COPY.revert}
          </button>
        </div>

        <div className="runtime">
          <span className={`runtime-pill ${hasHostApi ? '' : 'fallback'}`}>
            {hasHostApi ? COPY.electronHost : COPY.browserFallbackMode}
          </span>
          <span className="runtime-pill">
            Mock {import.meta.env.VITE_MOCK ?? 'unset'}
          </span>
          <span className="runtime-pill">
            {COPY.fullRun} {formatFullRun(lastFullRunMs)}
          </span>
          {restoreNotice && <span className="runtime-pill warn">{restoreNotice}</span>}
        </div>
      </header>

      <section className="workspace">
        <aside className="pane pane-left" aria-label={COPY.canvas}>
          <ErrorBoundary label={COPY.canvas}>
            <div className="pane-heading">
              <span>{COPY.canvas}</span>
              <small>320 px</small>
            </div>
            <FlowCanvas />
          </ErrorBoundary>
        </aside>

        <section
          className={`pane pane-center ${isDragging ? 'is-dragging' : ''}`}
          aria-label={COPY.waveform}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          <ErrorBoundary label={COPY.waveform}>
            <div className="pane-heading">
              <span>{COPY.waveform}</span>
              <small>{COPY.minViewport}</small>
            </div>

            <WaveformPanel
              importMessage={importMessage}
              onImportClick={() => fileInputRef.current?.click()}
            />
          </ErrorBoundary>
        </section>

        <aside
          className={`pane pane-right ${inspectorNode ? 'has-inspector' : ''} ${
            status === 'rendered' ? 'is-rendered' : ''
          }`}
          aria-label="Side panels"
        >
          <ErrorBoundary label="Side panels">
            {inspectorNode && (
              <details className="inspector-panel" open>
                <summary>{inspectorNode.label}详情</summary>
                {(() => {
                  const meta = inspectorNode.metadata as {
                    data?: {
                      analysis?: { bars: { index: number; start_sec: number; end_sec: number }[]; pitch: { t: number; pitch: number; confidence: number }[] }
                      track?: { file_name?: string; duration_sec?: number; sample_rate?: number }
                      plan?: { op: string; start_sec: number; end_sec: number; mode: string; strength: number }
                    }
                  }
                  if (inspectorNode.id === 'analysis') {
                    const analysis = meta.data?.analysis
                    return (
                      <AnalysisInsight
                        bars={analysis?.bars ?? []}
                        pitch={analysis?.pitch ?? []}
                        durationSec={analysis?.bars[analysis.bars.length - 1]?.end_sec}
                      />
                    )
                  }
                  return (
                    <div className="inspector-simple">
                      {inspectorNode.id === 'audio-import' ? (
                        <>
                          <p>
                            文件名：
                            <strong>{meta.data?.track?.file_name ?? '--'}</strong>
                          </p>
                          <p>
                            时长：
                            {meta.data?.track?.duration_sec
                              ? `${meta.data.track.duration_sec.toFixed(1)}s`
                              : '--'}
                          </p>
                          <p>
                            采样率：
                            {meta.data?.track?.sample_rate
                              ? `${meta.data.track.sample_rate} Hz`
                              : '--'}
                          </p>
                        </>
                      ) : (
                        <>
                          <p>
                            操作：
                            <strong>{meta.data?.plan?.op ?? 'correct_pitch'}</strong>
                          </p>
                          <p>
                            区间：
                            {meta.data?.plan
                              ? `${meta.data.plan.start_sec}s - ${meta.data.plan.end_sec}s`
                              : '--'}
                          </p>
                          <p>
                            模式 / 强度：
                            {meta.data?.plan
                              ? `${meta.data.plan.mode} / ${meta.data.plan.strength.toFixed(2)}`
                              : '--'}
                          </p>
                        </>
                      )}
                    </div>
                  )
                })()}
              </details>
            )}
            <ChatInput onPlanReady={scrollToPlan} />
            <PlanPanel ref={planPanelRef} />
            <ProgressBar />
            <CentsChart />
            <HistoryPanel />
          </ErrorBoundary>
        </aside>
      </section>
    </main>
  )
}

export default App
