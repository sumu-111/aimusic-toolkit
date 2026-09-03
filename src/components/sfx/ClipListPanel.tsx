import { useProjectStore } from '../../store/useProjectStore'
import './SfxPanels.css'

const COPY = {
  title: '音效编排',
  empty: '暂无音效',
  mute: '静音',
  unmute: '恢复',
  delete: '删',
}

export function ClipListPanel() {
  const sfxClips = useProjectStore((s) => s.sfxClips)
  const toggleMuteClip = useProjectStore((s) => s.toggleMuteClip)
  const removeSfxClip = useProjectStore((s) => s.removeSfxClip)

  return (
    <section className="side-section clip-list-panel">
      <div className="panel-title-row">
        <span>{COPY.title}</span>
        <small>{sfxClips.length}</small>
      </div>

      {sfxClips.length === 0 ? (
        <small>{COPY.empty}</small>
      ) : (
        <div className="clip-list">
          {sfxClips.map((clip) => (
            <div
              key={clip.clip_id}
              className={`clip-row${clip.muted ? ' muted' : ''}`}
            >
              <div className="clip-info">
                <span className="clip-id">{clip.sfx_id}</span>
                <span className="clip-meta">
                  {clip.start_sec.toFixed(1)}s
                  {clip.end_sec != null ? ` - ${clip.end_sec.toFixed(1)}s` : ''}
                  {' · '}
                  {clip.gain_db} dB
                </span>
              </div>
              <button
                type="button"
                onClick={() => toggleMuteClip(clip.clip_id)}
              >
                {clip.muted ? COPY.unmute : COPY.mute}
              </button>
              <button
                type="button"
                className="clip-delete"
                onClick={() => removeSfxClip(clip.clip_id)}
              >
                {COPY.delete}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
