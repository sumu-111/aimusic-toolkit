import {
  type ChangeEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import WaveSurfer from 'wavesurfer.js'
import RegionsPlugin, { type Region } from 'wavesurfer.js/plugins/regions'
import { ABCompare } from '../render/ABCompare'
import { useProjectStore } from '../../store/useProjectStore'
import type { Bar, PitchPoint } from '../../types/contract'
import './WaveformPanel.css'

type WaveformPanelProps = {
  importMessage: string | null
  onImportClick: () => void
}

const COPY = {
  analyze: '\u5206\u6790',
  bars: 'bars',
  confidence: '\u7f6e\u4fe1\u5ea6',
  currentTrack: '\u5f53\u524d\u97f3\u9891',
  duration: '\u65f6\u957f',
  error: '\u5206\u6790\u5931\u8d25',
  fallback: '\u964d\u7ea7\u4e3a\u6574\u6bb5\u4fee\u97f3',
  fileName: '\u6587\u4ef6\u540d',
  importWav: '\u70b9\u51fb\u6216\u62d6\u5165 WAV',
  loadingWaveform: '\u52a0\u8f7d\u6ce2\u5f62',
  pause: '\u6682\u505c',
  pitch: 'pitch',
  play: '\u64ad\u653e',
  retry: '\u91cd\u8bd5',
  sampleRate: '\u91c7\u6837\u7387',
  selectedBar: '\u9009\u4e2d\u5c0f\u8282',
  waitingTrack: '\u5f85\u5bfc\u5165\u97f3\u9891',
  waveformError: 'WAVEFORM_LOAD_FAILED',
}

const REGION_PREFIX = 'bar-'
const PITCH_WIDTH = 1000
const PITCH_HEIGHT = 148
const PITCH_PADDING = 16

function formatTime(value?: number) {
  const safeValue = Math.max(0, value ?? 0)
  const minutes = Math.floor(safeValue / 60)
  const seconds = Math.floor(safeValue % 60)
  const milliseconds = Math.floor((safeValue % 1) * 1000)

  return `${minutes}:${seconds.toString().padStart(2, '0')}.${milliseconds
    .toString()
    .padStart(3, '0')}`
}

function formatShortTime(value?: number) {
  const safeValue = Math.max(0, value ?? 0)
  const minutes = Math.floor(safeValue / 60)
  const seconds = Math.floor(safeValue % 60)

  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

function formatRange(bar: Bar | null) {
  if (!bar) {
    return '--'
  }

  return `#${bar.index + 1} ${formatTime(bar.start_sec)}-${formatTime(
    bar.end_sec,
  )}`
}

function averageConfidence(points: PitchPoint[]) {
  if (!points.length) {
    return null
  }

  return (
    points.reduce((sum, point) => sum + point.confidence, 0) / points.length
  )
}

function getRegionBarIndex(region: Region) {
  if (!region.id.startsWith(REGION_PREFIX)) {
    return null
  }

  const index = Number(region.id.slice(REGION_PREFIX.length))
  return Number.isFinite(index) ? index : null
}

function createRegionLabel(bar: Bar) {
  const label = document.createElement('span')

  label.textContent = `#${bar.index + 1}`
  Object.assign(label.style, {
    color: '#f5f7fb',
    display: 'inline-block',
    fontSize: '11px',
    fontWeight: '800',
    lineHeight: '18px',
    padding: '1px 7px',
    pointerEvents: 'none',
    textShadow: '0 1px 2px rgba(0, 0, 0, 0.4)',
  })

  return label
}

function applyRegionChrome(region: Region, isSelected: boolean) {
  if (!region.element) {
    return
  }

  region.element.style.border = isSelected
    ? '1px solid rgba(245, 247, 251, 0.96)'
    : '1px solid rgba(124, 148, 177, 0.34)'
  region.element.style.boxShadow = isSelected
    ? 'inset 0 0 0 1px rgba(124, 92, 255, 0.74)'
    : 'none'
}

function pointToSvg(
  point: PitchPoint,
  duration: number,
  minPitch: number,
  maxPitch: number,
) {
  const usableHeight = PITCH_HEIGHT - PITCH_PADDING * 2
  const pitchRange = Math.max(1, maxPitch - minPitch)
  const x = (Math.min(point.t, duration) / duration) * PITCH_WIDTH
  const y =
    PITCH_PADDING +
    usableHeight -
    ((point.pitch - minPitch) / pitchRange) * usableHeight

  return { x, y }
}

type PitchTrackProps = {
  bars: Bar[]
  currentTime: number
  duration: number
  points: PitchPoint[]
  selectedBar: Bar | null
}

function PitchTrack({
  bars,
  currentTime,
  duration,
  points,
  selectedBar,
}: PitchTrackProps) {
  const chart = useMemo(() => {
    if (!points.length) {
      return null
    }

    const maxTime =
      duration ||
      Math.max(points[points.length - 1]?.t ?? 0, bars[bars.length - 1]?.end_sec ?? 0) ||
      1
    const pitches = points.map((point) => point.pitch)
    const minPitch = Math.min(...pitches) - 2
    const maxPitch = Math.max(...pitches) + 2
    const segments = points.slice(1).map((point, index) => ({
      from: pointToSvg(points[index], maxTime, minPitch, maxPitch),
      lowConfidence:
        point.confidence < 0.5 || points[index].confidence < 0.5,
      to: pointToSvg(point, maxTime, minPitch, maxPitch),
    }))

    return {
      currentX: (Math.min(currentTime, maxTime) / maxTime) * PITCH_WIDTH,
      maxPitch,
      maxTime,
      minPitch,
      segments,
    }
  }, [bars, currentTime, duration, points])

  if (!chart) {
    return (
      <div className="pitch-track empty">
        <span>{COPY.pitch} --</span>
      </div>
    )
  }

  const selectedX = selectedBar
    ? (selectedBar.start_sec / chart.maxTime) * PITCH_WIDTH
    : 0
  const selectedWidth = selectedBar
    ? ((selectedBar.end_sec - selectedBar.start_sec) / chart.maxTime) *
      PITCH_WIDTH
    : 0

  return (
    <div className="pitch-track">
      <div className="pitch-track-head">
        <span>{COPY.pitch}</span>
        <span>
          {Math.round(chart.minPitch)}-{Math.round(chart.maxPitch)} Hz
        </span>
      </div>
      <svg viewBox={`0 0 ${PITCH_WIDTH} ${PITCH_HEIGHT}`} role="img">
        <line
          className="pitch-grid-line"
          x1="0"
          x2={PITCH_WIDTH}
          y1={PITCH_HEIGHT / 2}
          y2={PITCH_HEIGHT / 2}
        />
        {selectedBar && (
          <rect
            className="pitch-selected-range"
            x={selectedX}
            y="0"
            width={selectedWidth}
            height={PITCH_HEIGHT}
          />
        )}
        {chart.segments.map((segment, index) => (
          <line
            className={segment.lowConfidence ? 'pitch-line low' : 'pitch-line'}
            key={`${segment.from.x}-${index}`}
            x1={segment.from.x}
            x2={segment.to.x}
            y1={segment.from.y}
            y2={segment.to.y}
          />
        ))}
        <line
          className="pitch-cursor"
          x1={chart.currentX}
          x2={chart.currentX}
          y1="0"
          y2={PITCH_HEIGHT}
        />
      </svg>
    </div>
  )
}

export function WaveformPanel({
  importMessage,
  onImportClick,
}: WaveformPanelProps) {
  const waveformRef = useRef<HTMLDivElement>(null)
  const wavesurferRef = useRef<WaveSurfer | null>(null)
  const regionsRef = useRef<RegionsPlugin | null>(null)
  const selectBarRef = useRef(useProjectStore.getState().selectBar)
  const updateBarRangeRef = useRef(useProjectStore.getState().updateBarRange)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isReady, setIsReady] = useState(false)
  const [loadingProgress, setLoadingProgress] = useState(0)
  const [loadError, setLoadError] = useState<string | null>(null)
  const track = useProjectStore((state) => state.track)
  const analysis = useProjectStore((state) => state.analysis)
  const selectedBarIndex = useProjectStore((state) => state.selectedBarIndex)
  const status = useProjectStore((state) => state.status)
  const error = useProjectStore((state) => state.error)
  const elapsedMs = useProjectStore((state) => state.elapsedMs)
  const selectBar = useProjectStore((state) => state.selectBar)
  const updateBarRange = useProjectStore((state) => state.updateBarRange)
  const runAnalyze = useProjectStore((state) => state.runAnalyze)
  const selectWholeTrackRange = useProjectStore(
    (state) => state.selectWholeTrackRange,
  )
  const bars = analysis?.bars ?? []
  const pitchPoints = analysis?.pitch ?? []
  const selectedBar =
    bars.find((bar) => bar.index === selectedBarIndex) ?? null
  const displayDuration = duration || track?.duration_sec || 0
  const seekMax = Math.max(displayDuration, currentTime, 0.001)
  const confidence = averageConfidence(pitchPoints)
  const isAnalyzing = status === 'analyzing'
  const canAnalyze =
    Boolean(track) && (status === 'idle' || status === 'reverted')
  const analyzeError = error?.source === 'analyze' ? error : null
  const visibleError = analyzeError
    ? analyzeError
    : loadError
      ? {
          error_code: COPY.waveformError,
          message: loadError,
        }
      : null

  useEffect(() => {
    selectBarRef.current = selectBar
  }, [selectBar])

  useEffect(() => {
    updateBarRangeRef.current = updateBarRange
  }, [updateBarRange])

  useEffect(() => {
    if (!waveformRef.current) {
      return
    }

    const regions = RegionsPlugin.create()
    const wavesurfer = WaveSurfer.create({
      barGap: 1,
      barRadius: 2,
      barWidth: 2,
      container: waveformRef.current,
      cursorColor: '#f5f7fb',
      cursorWidth: 2,
      dragToSeek: true,
      height: 296,
      normalize: true,
      plugins: [regions],
      progressColor: '#7c5cff',
      waveColor: '#3d465a',
    })

    regionsRef.current = regions
    wavesurferRef.current = wavesurfer

    const subscriptions = [
      wavesurfer.on('ready', (nextDuration) => {
        setCurrentTime(wavesurfer.getCurrentTime())
        setDuration(nextDuration)
        setIsReady(true)
        setLoadError(null)
        setLoadingProgress(100)
      }),
      wavesurfer.on('loading', (progress) => {
        setLoadingProgress(progress)
      }),
      wavesurfer.on('timeupdate', (nextTime) => {
        setCurrentTime(nextTime)
      }),
      wavesurfer.on('seeking', (nextTime) => {
        setCurrentTime(nextTime)
      }),
      wavesurfer.on('play', () => {
        setIsPlaying(true)
      }),
      wavesurfer.on('pause', () => {
        setIsPlaying(false)
      }),
      wavesurfer.on('finish', () => {
        setIsPlaying(false)
      }),
      wavesurfer.on('error', (nextError) => {
        setIsReady(false)
        setIsPlaying(false)
        setLoadError(nextError.message)
      }),
      regions.on('region-clicked', (region, event) => {
        const index = getRegionBarIndex(region)

        event.stopPropagation()

        if (index === null) {
          return
        }

        selectBarRef.current(index)
        wavesurfer.setTime(region.start)
      }),
      regions.on('region-updated', (region) => {
        const index = getRegionBarIndex(region)

        if (index === null) {
          return
        }

        updateBarRangeRef.current(index, {
          start_sec: region.start,
          end_sec: region.end,
        })
      }),
    ]

    return () => {
      subscriptions.forEach((unsubscribe) => unsubscribe())
      wavesurfer.destroy()
      wavesurferRef.current = null
      regionsRef.current = null
    }
  }, [])

  useEffect(() => {
    const wavesurfer = wavesurferRef.current

    if (!wavesurfer) {
      return
    }

    regionsRef.current?.clearRegions()
    setCurrentTime(0)
    setDuration(track?.duration_sec ?? 0)
    setIsPlaying(false)
    setIsReady(false)
    setLoadError(null)
    setLoadingProgress(track?.url ? 1 : 0)

    if (!track?.url) {
      wavesurfer.empty()
      return
    }

    let isStale = false

    void wavesurfer.load(track.url).catch((nextError: unknown) => {
      if (isStale) {
        return
      }

      setIsReady(false)
      setLoadError(
        nextError instanceof Error
          ? nextError.message
          : 'Waveform load failed',
      )
    })

    return () => {
      isStale = true
    }
  }, [track?.duration_sec, track?.url])

  useEffect(() => {
    const regions = regionsRef.current

    if (!regions) {
      return
    }

    regions.clearRegions()

    for (const bar of bars) {
      const isSelected = bar.index === selectedBarIndex
      const region = regions.addRegion({
        color: isSelected
          ? 'rgba(124, 92, 255, 0.38)'
          : 'rgba(61, 167, 214, 0.16)',
        content: createRegionLabel(bar),
        drag: false,
        end: bar.end_sec,
        id: `${REGION_PREFIX}${bar.index}`,
        minLength: 0.05,
        resize: true,
        resizeEnd: true,
        resizeStart: true,
        start: bar.start_sec,
      })

      applyRegionChrome(region, isSelected)
    }
  }, [bars, selectedBarIndex])

  function handleSeek(event: ChangeEvent<HTMLInputElement>) {
    const nextTime = Number(event.target.value)

    wavesurferRef.current?.setTime(nextTime)
    setCurrentTime(nextTime)
  }

  async function handlePlayPause() {
    const wavesurfer = wavesurferRef.current

    if (!wavesurfer || !track?.url) {
      return
    }

    try {
      await wavesurfer.playPause()
    } catch (nextError) {
      setLoadError(
        nextError instanceof Error ? nextError.message : 'Playback failed',
      )
    }
  }

  function handleFallback() {
    selectWholeTrackRange()
    wavesurferRef.current?.setTime(0)
    setCurrentTime(0)
  }

  return (
    <div className="waveform-panel">
      <button
        className={`import-target${track ? ' has-track' : ''}`}
        type="button"
        onClick={onImportClick}
      >
        <strong>{track ? COPY.currentTrack : COPY.importWav}</strong>
        <span>{track?.file_name ?? COPY.waitingTrack}</span>
      </button>

      <div className="track-grid waveform-track-grid">
        <div>
          <span>{COPY.fileName}</span>
          <strong>{track?.file_name ?? '--'}</strong>
        </div>
        <div>
          <span>{COPY.duration}</span>
          <strong>{formatShortTime(track?.duration_sec)}</strong>
        </div>
        <div>
          <span>{COPY.sampleRate}</span>
          <strong>{track?.sample_rate ? `${track.sample_rate} Hz` : '--'}</strong>
        </div>
        <div>
          <span>{COPY.selectedBar}</span>
          <strong>{formatRange(selectedBar)}</strong>
        </div>
      </div>

      <div className="transport">
        <button
          type="button"
          onClick={handlePlayPause}
          disabled={!track?.url || !isReady}
        >
          {isPlaying ? COPY.pause : COPY.play}
        </button>
        <input
          aria-label="Waveform seek"
          disabled={!track?.url}
          max={seekMax}
          min="0"
          onChange={handleSeek}
          step="0.001"
          type="range"
          value={Math.min(currentTime, seekMax)}
        />
        <span>
          {formatTime(currentTime)} / {formatTime(displayDuration)}
        </span>
        <button type="button" onClick={() => void runAnalyze()} disabled={!canAnalyze}>
          {COPY.analyze}
        </button>
      </div>

      <div className="waveform-stage">
        <div className="wave-host" ref={waveformRef} />
        {!track && <div className="waveform-empty">{COPY.waitingTrack}</div>}
        {track?.url && loadingProgress > 0 && loadingProgress < 100 && (
          <span className="waveform-loading">
            {COPY.loadingWaveform} {Math.round(loadingProgress)}%
          </span>
        )}
        {isAnalyzing && (
          <div className="analysis-overlay">
            <div className="analysis-loader" />
            <strong>{COPY.analyze}</strong>
          </div>
        )}
      </div>

      <PitchTrack
        bars={bars}
        currentTime={currentTime}
        duration={displayDuration}
        points={pitchPoints}
        selectedBar={selectedBar}
      />

      <ABCompare />

      <div className="analysis-strip waveform-analysis-strip">
        <span>
          {COPY.bars} {bars.length}
        </span>
        <span>
          {COPY.pitch} {pitchPoints.length}
        </span>
        <span>
          {COPY.confidence} {confidence === null ? '--' : confidence.toFixed(2)}
        </span>
        <span>{elapsedMs ? `${elapsedMs} ms` : '--'}</span>
      </div>

      {(visibleError || importMessage) && (
        <div className="analysis-error">
          <div>
            <span>{COPY.error}</span>
            <strong>{visibleError?.error_code ?? importMessage}</strong>
            <p>{visibleError?.message ?? ''}</p>
          </div>
          <button type="button" onClick={() => void runAnalyze()} disabled={!track}>
            {COPY.retry}
          </button>
          <button type="button" onClick={handleFallback} disabled={!track}>
            {COPY.fallback}
          </button>
        </div>
      )}
    </div>
  )
}
