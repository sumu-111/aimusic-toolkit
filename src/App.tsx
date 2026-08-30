import {
  type ChangeEvent,
  type DragEvent,
  useEffect,
  useRef,
  useState,
} from 'react'
import './App.css'
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

function formatDuration(durationSec?: number) {
  if (!Number.isFinite(durationSec)) {
    return '--'
  }

  const safeDuration = durationSec ?? 0
  const minutes = Math.floor(safeDuration / 60)
  const seconds = Math.floor(safeDuration % 60)

  return `${minutes}:${seconds.toString().padStart(2, '0')}`
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
  const [isDragging, setIsDragging] = useState(false)
  const [importMessage, setImportMessage] = useState<string | null>(null)
  const track = useProjectStore((state) => state.track)
  const analysis = useProjectStore((state) => state.analysis)
  const selectedBarIndex = useProjectStore((state) => state.selectedBarIndex)
  const status = useProjectStore((state) => state.status)
  const error = useProjectStore((state) => state.error)
  const elapsedMs = useProjectStore((state) => state.elapsedMs)
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
    void useProjectStore.getState().runAnalyze()
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
          <div className="flow-placeholder">
            <div>{COPY.flowImport}</div>
            <div>{COPY.flowAnalyze}</div>
            <div>{COPY.flowFix}</div>
          </div>
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

          <button
            className="drop-zone"
            type="button"
            onClick={() => fileInputRef.current?.click()}
          >
            <strong>{track ? COPY.currentTrack : COPY.dropHint}</strong>
            <span>{track?.file_name ?? COPY.waitingTrack}</span>
          </button>

          <div className="track-grid">
            <div>
              <span>{COPY.fileName}</span>
              <strong>{track?.file_name ?? '--'}</strong>
            </div>
            <div>
              <span>{COPY.duration}</span>
              <strong>{formatDuration(track?.duration_sec)}</strong>
            </div>
            <div>
              <span>{COPY.sampleRate}</span>
              <strong>
                {track?.sample_rate ? `${track.sample_rate} Hz` : '--'}
              </strong>
            </div>
            <div>
              <span>{COPY.selectedBar}</span>
              <strong>{selectedBarIndex ?? '--'}</strong>
            </div>
          </div>

          <div className="waveform-placeholder">
            <div className="wave-line" />
            <div className="wave-line short" />
            <div className="wave-line" />
          </div>

          <div className="analysis-strip">
            <span>bars {analysis?.bars.length ?? 0}</span>
            <span>pitch {analysis?.pitch.length ?? 0}</span>
            <span>{elapsedMs ? `${elapsedMs} ms` : '--'}</span>
          </div>

          {(error || importMessage) && (
            <div className="error-line">
              <span>{COPY.error}</span>
              <strong>{error?.error_code ?? importMessage}</strong>
              <span>{error?.message ?? ''}</span>
            </div>
          )}
        </section>

        <aside className="pane pane-right" aria-label="Side panels">
          <div className="side-section">
            <span>{COPY.chat}</span>
            <small>{COPY.placeholder}</small>
          </div>
          <div className="side-section">
            <span>{COPY.plan}</span>
            <small>{COPY.placeholder}</small>
          </div>
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
