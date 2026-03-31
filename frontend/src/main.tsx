import { StrictMode, useState, useEffect, Component, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import './index.css'
import 'katex/dist/katex.min.css'

import ProjectsPage from './pages/ProjectsPage'
import ProjectView from './pages/ProjectView'
import NoteEditor from './pages/NoteEditor'
import ArtifactViewer from './pages/ArtifactViewer'
import App from './App'  // legacy reader (now used as PaperReader)
import ProjectChat from './pages/ProjectChat'
import LoginPage from './components/LoginPage'

// ── Error boundary ────────────────────────────────────────────────────────────
class ErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  constructor(props: any) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(e: Error) { return { error: e.message } }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, color: '#f87171', background: '#111', minHeight: '100vh', fontFamily: 'monospace' }}>
          <div style={{ fontSize: 24, marginBottom: 16 }}>⚠️ App Error</div>
          <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 16 }}>{this.state.error}</div>
          <button onClick={() => { localStorage.clear(); location.reload() }}
            style={{ background: '#6366f1', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: 8, cursor: 'pointer', fontWeight: 'bold' }}>
            Clear cache &amp; reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

// ── Auth gate ────────────────────────────────────────────────────────────────
interface User { email: string; name: string; picture: string }

function Root() {
  const [user, setUser] = useState<User | null | undefined>(undefined)

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (user === undefined) setUser(null)
    }, 5000)

    fetch('/api/auth/me', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(data => { clearTimeout(timeout); setUser(data) })
      .catch(() => { clearTimeout(timeout); setUser(null) })

    return () => clearTimeout(timeout)
  }, [])

  if (user === undefined) {
    return <div style={{ height: '100vh', background: '#0f0f0f', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span className="spinner" />
    </div>
  }

  if (!user) return <LoginPage />

  return (
    <BrowserRouter>
      <Routes>
        {/* Projects list — home */}
        <Route path="/" element={<ProjectsPage user={user} />} />

        {/* Project view */}
        <Route path="/projects/:projectId" element={<ProjectView />} />

        {/* Paper reader (source inside project) */}
        <Route path="/projects/:projectId/sources/:sourceId" element={<App user={user} />} />

        {/* Project chat */}
        <Route path="/projects/:projectId/chat" element={<ProjectChat />} />

        {/* Note editor */}
        <Route path="/projects/:projectId/notes/:noteId" element={<NoteEditor />} />

        {/* Artifact viewer */}
        <Route path="/projects/:projectId/artifacts/:artifactId" element={<ArtifactViewer />} />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
  </StrictMode>,
)
