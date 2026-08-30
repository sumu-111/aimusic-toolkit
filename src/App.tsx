import {
  type ChangeEvent,
  type DragEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import './App.css'
import { FlowCanvas } from './components/canvas/FlowCanvas'
import { ChatInput } from './components/chat/ChatInput'
import { PlanPanel } from './components/chat/PlanPanel'
import { WaveformPanel } from './components/waveform/WaveformPanel'
import { useProjectStore, type ProjectStatus } from './store/useProjectStore'

const COPY = {
  appName: 'AI Music Workbench',
  importWav: '\u5bfc\u5165 WAV',
  save: '\u4fdd\u5b58',
  revert: '\u56de\u9000',
  browserFallback: '\u6d4f\u89c8\u5668\u515c\u5e95',
  electronHost: 'Electron Host',
  canvas: '\u753b\u5e03',
  waveform: '\u6ce2\u5f62\u533a',
  dropHint: '\u70b9\u51fb\u6216\u62d6\u5165 WAV',
  waitingTrack: '\u5f85\u5bfc\u5165\u97f3\u9891',
  currentTrack: '\u5f53\u524d\u97f3\u9891',
  fileName: '\u6587\u4ef6\u540d',
  duration: '\u65f6\u957f',
  sampleRate: '\u91c7\u6837\u7387',
  selectedBar: '\u9009\u4e2d\u5c0f\u8282',
  error: '\u9519\u8bef',
  chat: '\u5bf9\u8bdd',
  plan: '\u8ba1\u5212',
  curve: '\u66f2\u7ebf',
  history: '\u5386\u53f2',
  placeholder: '\u5360\u4f4d',
  flowImport: '\u5bfc\u5165',
  flowAnalyze: '\u5206\u6790',
  flowFix: '\u4fee\u97f3',
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

function App() {
  const hasHostApi = typeof window !== 'undefined' && Boolean(window.api)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const objectUrlRef = useRef<string | null>(null)
  const planPanelRef = useRef<HTMLElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [importMessage, setImportMessage] = useState<string | null>(null)
  const status = useProjectStore((state) => state.status)
  const inspectorNode = useProjectStore((state) => state.inspectorNode)
  const setTrack = useProjectStore((state) => state.setTrack)
  const revert = useProjectStore((state) => state.revert)

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current)
      }
    }
  }, [])

  async function importFile(file: File) {
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

    setTrack({
      track_id: makeTrackId(file),
      file_path: file.name,
      file_name: file.name,
      duration_sec: durationSec,
      sample_rate: 44100,
      url,
    })

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
          <button
            type="button"
            onClick={() => console.info('[app] save placeholder')}
          >
            {COPY.save}
          </button>
          <button type="button" onClick={revert}>
            {COPY.revert}
          </button>
        </div>

        <div className="runtime">
          <span>{hasHostApi ? COPY.electronHost : COPY.browserFallback}</span>
          <span>Mock {import.meta.env.VITE_MOCK ?? 'unset'}</span>
        </div>
      </header>

      <section className="workspace">
        <aside className="pane pane-left" aria-label={COPY.canvas}>
          <div className="pane-heading">
            <span>{COPY.canvas}</span>
            <small>320 px</small>
          </div>
          <FlowCanvas />
        </aside>

        <section
          className={`pane pane-center ${isDragging ? 'is-dragging' : ''}`}
          aria-label={COPY.waveform}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          <div className="pane-heading">
            <span>{COPY.waveform}</span>
            <small>{COPY.minViewport}</small>
          </div>

          <WaveformPanel
            importMessage={importMessage}
            onImportClick={() => fileInputRef.current?.click()}
          />
        </section>

        <aside
          className={`pane pane-right ${inspectorNode ? 'has-inspector' : ''}`}
          aria-label="Side panels"
        >
          {inspectorNode && (
            <details className="inspector-panel" open>
              <summary>Inspector · {inspectorNode.label}</summary>
              <pre>{JSON.stringify(inspectorNode.metadata, null, 2)}</pre>
            </details>
          )}
          <ChatInput onPlanReady={scrollToPlan} />
          <PlanPanel ref={planPanelRef} />
          <div className="side-section">
            <span>{COPY.curve}</span>
            <small>{COPY.placeholder}</small>
          </div>
          <div className="side-section">
            <span>{COPY.history}</span>
            <small>{COPY.placeholder}</small>
          </div>
        </aside>
      </section>
    </main>
  )
}

export default App
