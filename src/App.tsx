import './App.css'

function App() {
  const hasHostApi = typeof window !== 'undefined' && Boolean(window.api)

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
