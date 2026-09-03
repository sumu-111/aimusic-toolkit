import { useCallback, useEffect, useRef, useState } from 'react'
import { sfxDelete, sfxImport, sfxList } from '../../ipc/client'
import { useProjectStore } from '../../store/useProjectStore'
import type { SfxAsset, SfxCategory } from '../../types/contract'
import './SfxPanels.css'

const COPY = {
  title: '音效库',
  search: '搜索音效…',
  import: '导入',
  add: '添加',
  delete: '删',
  empty: '暂无音效',
  loading: '加载中…',
  all: '全部',
}

const CATEGORY_LABELS: Record<string, string> = {
  all: COPY.all,
  ambience: '氛围',
  transition: '过渡',
  emotion: '情绪',
  percussion: '打击',
  other: '其他',
}

const CATEGORIES: Array<'all' | SfxCategory> = [
  'all',
  'ambience',
  'transition',
  'emotion',
  'percussion',
  'other',
]

export function SfxLibraryPanel() {
  const [assets, setAssets] = useState<SfxAsset[]>([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<'all' | SfxCategory>('all')
  const [search, setSearch] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const createAddSfxPlan = useProjectStore((s) => s.createAddSfxPlan)
  const track = useProjectStore((s) => s.track)

  const refresh = useCallback(async () => {
    setLoading(true)
    const result = await sfxList()
    if (result.ok) {
      setAssets(result.data.assets)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const filtered = assets.filter((a) => {
    if (filter !== 'all' && a.category !== filter) return false
    if (search) {
      const q = search.toLowerCase()
      return (
        a.name.toLowerCase().includes(q) ||
        a.keywords.some((k) => k.toLowerCase().includes(q))
      )
    }
    return true
  })

  async function handleImport() {
    const input = fileInputRef.current
    if (!input) return
    input.click()
  }

  async function handleFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    event.target.value = ''

    const filePath = window.api?.getPathForFile?.(file) ?? file.name
    const result = await sfxImport({ file_path: filePath, name: file.name.replace(/\.[^.]+$/, '') })
    if (result.ok) {
      await refresh()
    }
  }

  async function handleDelete(sfxId: string) {
    const result = await sfxDelete({ sfx_id: sfxId })
    if (result.ok) {
      setAssets((prev) => prev.filter((a) => a.sfx_id !== sfxId))
    }
  }

  return (
    <section className="side-section sfx-library-panel">
      <input
        ref={fileInputRef}
        type="file"
        accept=".wav,.mp3,audio/wav,audio/mpeg"
        style={{ display: 'none' }}
        onChange={handleFileSelected}
      />
      <div className="panel-title-row">
        <span>{COPY.title}</span>
        <small>{assets.length}</small>
      </div>

      <div className="sfx-toolbar">
        <input
          className="sfx-search"
          type="text"
          placeholder={COPY.search}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button type="button" className="sfx-import-btn" onClick={handleImport}>
          {COPY.import}
        </button>
      </div>

      <div className="sfx-category-tabs">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            type="button"
            className={filter === cat ? 'active' : ''}
            onClick={() => setFilter(cat)}
          >
            {CATEGORY_LABELS[cat] ?? cat}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="sfx-empty">{COPY.loading}</div>
      ) : filtered.length === 0 ? (
        <div className="sfx-empty">{COPY.empty}</div>
      ) : (
        <div className="sfx-asset-list">
          {filtered.map((asset) => (
            <div key={asset.sfx_id} className="sfx-asset-row">
              <div className="sfx-asset-info">
                <span className="sfx-asset-name">{asset.name}</span>
                <span className="sfx-asset-meta">
                  {CATEGORY_LABELS[asset.category] ?? asset.category}
                  {' · '}
                  {asset.duration_sec.toFixed(1)}s
                  {' · '}
                  {asset.license}
                </span>
              </div>
              <button
                type="button"
                onClick={() => createAddSfxPlan(asset)}
                disabled={!track}
              >
                {COPY.add}
              </button>
              {asset.source === 'user' && (
                <button
                  type="button"
                  className="sfx-delete-btn"
                  onClick={() => void handleDelete(asset.sfx_id)}
                >
                  {COPY.delete}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
