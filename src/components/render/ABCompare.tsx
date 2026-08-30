import { type ChangeEvent, useEffect, useMemo, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'
import { useProjectStore } from '../../store/useProjectStore'
import type { Bar } from '../../types/contract'
import './RenderPanels.css'

type CompareSource = 'original' | 'rendered'

const COPY = {
  title: 'A/B',
  original: '\u539f\u58f0',
  rendered: '\u4fee\u97f3\u540e',
  empty: '\u5f85\u6e32\u67d3\u7ed3\u679c',
  play: '\u64ad\u653e',
  pause: '\u6682\u505c',
  loopBar: '\u5faa\u73af\u5f53\u524d\u5c0f\u8282',
}

function isMockRuntime() {
  return (
    import.meta.env.VITE_MOCK === '1' ||
    typeof window === 'undefined' ||
    !window.api
  )
}

function formatTime(value: number) {
  const safeValue = Math.max(0, value)
  const minutes = Math.floor(safeValue / 60)
  const seconds = Math.floor(safeValue % 60)
  const milliseconds = Math.floor((safeValue % 1) * 1000)

  return `${minutes}:${seconds.toString().padStart(2, '0')}.${milliseconds
    .toString()
    .padStart(3, '0')}`
}

function createWaveSurfer(
  container: HTMLDivElement,
  waveColor: string,
  progressColor: string,
) {
  return WaveSurfer.create({
    barGap: 1,
    barRadius: 2,
    barWidth: 2,
    container,
    cursorColor: '#f5f7fb',
    cursorWidth: 2,
    dragToSeek: true,
    height: 76,
    normalize: true,
    progressColor,
    waveColor,
  })
}

function getSelectedBar(bars: Bar[], selectedBarIndex: number | null) {
  return bars.find((bar) => bar.index === selectedBarIndex) ?? null
}

export function ABCompare() {
  const originalContainerRef = useRef<HTMLDivElement>(null)
  const renderedContainerRef = useRef<HTMLDivElement>(null)
  const originalWaveRef = useRef<WaveSurfer | null>(null)
  const renderedWaveRef = useRef<WaveSurfer | null>(null)
  const activeSourceRef = useRef<CompareSource>('original')
  const selectedBarRef = useRef<Bar | null>(null)
  const loopSelectedRef = useRef(false)
  const [activeSource, setActiveSource] =
    useState<CompareSource>('original')
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [loopSelected, setLoopSelected] = useState(false)
  const [ready, setReady] = useState({
    original: false,
    rendered: false,
  })
  const [loadError, setLoadError] = useState<string | null>(null)
  const track = useProjectStore((state) => state.track)
  const render = useProjectStore((state) => state.render)
  const analysis = useProjectStore((state) => state.analysis)
  const selectedBarIndex = useProjectStore((state) => state.selectedBarIndex)
  const selectedBar = getSelectedBar(analysis?.bars ?? [], selectedBarIndex)
  const renderedUrl = useMemo(() => {
    if (!render || !track?.url) {
      return null
    }

    return isMockRuntime() ? track.url : render.output_path
  }, [render, track?.url])
  const hasCompare = Boolean(track?.url && render)
  const seekMax = Math.max(duration, track?.duration_sec ?? 0, 0.001)

  useEffect(() => {
    activeSourceRef.current = activeSource
  }, [activeSource])

  useEffect(() => {
    selectedBarRef.current = selectedBar
  }, [selectedBar])

  useEffect(() => {
    loopSelectedRef.current = loopSelected
  }, [loopSelected])

  useEffect(() => {
    if (!originalContainerRef.current || !renderedContainerRef.current) {
      return
    }

    const original = createWaveSurfer(
      originalContainerRef.current,
      '#3d465a',
      '#7c5cff',
    )
    const rendered = createWaveSurfer(
      renderedContainerRef.current,
      '#2f4c58',
      '#35d2b6',
    )

    originalWaveRef.current = original
    renderedWaveRef.current = rendered

    const syncInactiveWave = (source: CompareSource, nextTime: number) => {
      const inactive =
        source === 'original' ? renderedWaveRef.current : originalWaveRef.current

      if (
        inactive &&
        Math.abs(inactive.getCurrentTime() - nextTime) > 0.15
      ) {
        inactive.setTime(nextTime)
      }
    }

    const syncActiveTime = (source: CompareSource, nextTime: number) => {
      if (activeSourceRef.current !== source) {
        return
      }

      const bar = selectedBarRef.current
      const activeWave =
        source === 'original' ? originalWaveRef.current : renderedWaveRef.current

      if (
        loopSelectedRef.current &&
        bar &&
        nextTime >= bar.end_sec &&
        activeWave
      ) {
        originalWaveRef.current?.setTime(bar.start_sec)
        renderedWaveRef.current?.setTime(bar.start_sec)
        setCurrentTime(bar.start_sec)

        if (activeWave.isPlaying()) {
          void activeWave.play(bar.start_sec, bar.end_sec).catch((error: unknown) => {
            setLoadError(
              error instanceof Error ? error.message : 'Playback failed',
            )
          })
        }
        return
      }

      setCurrentTime(nextTime)
      syncInactiveWave(source, nextTime)
    }

    const subscriptions = [
      original.on('ready', (nextDuration) => {
        setDuration((current) => Math.max(current, nextDuration))
        setReady((current) => ({ ...current, original: true }))
        setLoadError(null)
      }),
      rendered.on('ready', (nextDuration) => {
        setDuration((current) => Math.max(current, nextDuration))
        setReady((current) => ({ ...current, rendered: true }))
        setLoadError(null)
      }),
      original.on('timeupdate', (nextTime) => {
        syncActiveTime('original', nextTime)
      }),
      rendered.on('timeupdate', (nextTime) => {
        syncActiveTime('rendered', nextTime)
      }),
      original.on('seeking', (nextTime) => {
        syncActiveTime('original', nextTime)
      }),
      rendered.on('seeking', (nextTime) => {
        syncActiveTime('rendered', nextTime)
      }),
      original.on('play', () => {
        if (activeSourceRef.current === 'original') {
          setIsPlaying(true)
        }
      }),
      rendered.on('play', () => {
        if (activeSourceRef.current === 'rendered') {
          setIsPlaying(true)
        }
      }),
      original.on('pause', () => {
        if (activeSourceRef.current === 'original') {
          setIsPlaying(false)
        }
      }),
      rendered.on('pause', () => {
        if (activeSourceRef.current === 'rendered') {
          setIsPlaying(false)
        }
      }),
      original.on('finish', () => setIsPlaying(false)),
      rendered.on('finish', () => setIsPlaying(false)),
      original.on('error', (error) => setLoadError(error.message)),
      rendered.on('error', (error) => setLoadError(error.message)),
    ]

    return () => {
      subscriptions.forEach((unsubscribe) => unsubscribe())
      original.destroy()
      rendered.destroy()
      originalWaveRef.current = null
      renderedWaveRef.current = null
    }
  }, [])

  useEffect(() => {
    const original = originalWaveRef.current
    const rendered = renderedWaveRef.current

    setCurrentTime(0)
    setDuration(track?.duration_sec ?? 0)
    setIsPlaying(false)
    setReady({ original: false, rendered: false })
    setLoadError(null)
    setActiveSource('original')

    if (!track?.url) {
      original?.empty()
      rendered?.empty()
      return
    }

    void original?.load(track.url).catch((error: unknown) => {
      setLoadError(error instanceof Error ? error.message : 'Original load failed')
    })

    if (!renderedUrl) {
      rendered?.empty()
      return
    }

    void rendered?.load(renderedUrl).catch((error: unknown) => {
      setLoadError(error instanceof Error ? error.message : 'Rendered load failed')
    })
  }, [renderedUrl, track?.duration_sec, track?.url])

  function getWave(source: CompareSource) {
    return source === 'original'
      ? originalWaveRef.current
      : renderedWaveRef.current
  }

  function syncBothToTime(nextTime: number) {
    originalWaveRef.current?.setTime(nextTime)
    renderedWaveRef.current?.setTime(nextTime)
    setCurrentTime(nextTime)
  }

  function switchSource(source: CompareSource) {
    if (source === activeSource) {
      return
    }

    const from = getWave(activeSource)
    const to = getWave(source)
    const wasPlaying = from?.isPlaying() ?? false
    const nextTime = from?.getCurrentTime() ?? currentTime

    from?.pause()
    to?.setTime(nextTime)
    setActiveSource(source)
    setCurrentTime(nextTime)
    setIsPlaying(wasPlaying)

    if (wasPlaying) {
      const bar = selectedBarRef.current
      const playStart =
        loopSelectedRef.current &&
        bar &&
        (nextTime < bar.start_sec || nextTime >= bar.end_sec)
          ? bar.start_sec
          : nextTime

      if (playStart !== nextTime) {
        syncBothToTime(playStart)
      }

      const playEnd =
        loopSelectedRef.current && bar ? bar.end_sec : undefined

      void to?.play(playStart, playEnd).catch((error: unknown) => {
        setLoadError(error instanceof Error ? error.message : 'Playback failed')
        setIsPlaying(false)
      })
    }
  }

  function handleSeek(event: ChangeEvent<HTMLInputElement>) {
    syncBothToTime(Number(event.target.value))
  }

  async function handlePlayPause() {
    const active = getWave(activeSource)

    if (!active || !ready[activeSource]) {
      return
    }

    try {
      if (loopSelected && selectedBar && !active.isPlaying()) {
        const playStart =
          currentTime >= selectedBar.start_sec &&
          currentTime < selectedBar.end_sec
            ? currentTime
            : selectedBar.start_sec

        syncBothToTime(playStart)
        await active.play(playStart, selectedBar.end_sec)
        return
      }

      await active.playPause()
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Playback failed')
    }
  }

  function handleLoopChange(event: ChangeEvent<HTMLInputElement>) {
    const checked = event.target.checked

    setLoopSelected(checked)

    if (checked && selectedBar) {
      syncBothToTime(selectedBar.start_sec)
    }
  }

  return (
    <section className={`ab-compare ${hasCompare ? '' : 'empty'}`}>
      <div className="ab-header">
        <span>{COPY.title}</span>
        <div className="ab-switch" role="group" aria-label={COPY.title}>
          <button
            className={activeSource === 'original' ? 'active' : ''}
            type="button"
            onClick={() => switchSource('original')}
            disabled={!ready.original}
          >
            A
          </button>
          <button
            className={activeSource === 'rendered' ? 'active' : ''}
            type="button"
            onClick={() => switchSource('rendered')}
            disabled={!ready.rendered}
          >
            B
          </button>
        </div>
      </div>

      <div className="ab-wave-stack">
        <div className={activeSource === 'original' ? 'ab-row active' : 'ab-row'}>
          <span>{COPY.original}</span>
          <div ref={originalContainerRef} />
        </div>
        <div className={activeSource === 'rendered' ? 'ab-row active' : 'ab-row'}>
          <span>{COPY.rendered}</span>
          <div ref={renderedContainerRef} />
        </div>
      </div>

      <div className="ab-controls">
        <button
          type="button"
          onClick={handlePlayPause}
          disabled={!hasCompare || !ready[activeSource]}
        >
          {isPlaying ? COPY.pause : COPY.play}
        </button>
        <input
          aria-label="A/B seek"
          disabled={!hasCompare}
          max={seekMax}
          min="0"
          onChange={handleSeek}
          step="0.001"
          type="range"
          value={Math.min(currentTime, seekMax)}
        />
        <span>{formatTime(currentTime)}</span>
        <label>
          <input
            checked={loopSelected}
            disabled={!selectedBar}
            onChange={handleLoopChange}
            type="checkbox"
          />
          {COPY.loopBar}
        </label>
      </div>

      {!hasCompare && <small>{COPY.empty}</small>}
      {loadError && <p className="ab-error">{loadError}</p>}
    </section>
  )
}
