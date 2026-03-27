/**
 * App.tsx — PaperReader (v2)
 * Opened from ProjectView when a source is clicked.
 * Reads project_id + source_id from URL params.
 */
import { useState, useRef, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import PdfViewer from './components/PdfViewer'
import ChatPanel from './components/ChatPanel'
import { sourcesApi, type Source } from './lib/api'

interface User { email: string; name: string; picture: string }

export default function App({ user }: { user: User }) {
  const { projectId, sourceId } = useParams<{ projectId: string; sourceId: string }>()
  const navigate = useNavigate()

  const [source, setSource] = useState<Source | null>(null)
  const [pdfText, setPdfText] = useState('')
  const [pdfPages, setPdfPages] = useState(0)
  const [pdfLabel, setPdfLabel] = useState('')
  const [selectedText, setSelectedText] = useState('')
  const [splitPct, setSplitPct] = useState(55)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const splitRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  // Load source data
  useEffect(() => {
    if (!projectId || !sourceId) return
    setLoading(true)
    sourcesApi.get(projectId, sourceId)
      .then(s => {
        setSource(s)
        setPdfText(s.pdf_text || '')
        setPdfPages(s.pages || 0)
        setPdfLabel(s.title || s.url || 'PDF')
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [projectId, sourceId])

  // Drag-to-resize
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current || !splitRef.current) return
      const container = splitRef.current.parentElement!
      const rect = container.getBoundingClientRect()
      const pct = Math.min(75, Math.max(25, ((e.clientX - rect.left) / rect.width) * 100))
      setSplitPct(pct)
    }
    const onUp = () => { dragging.current = false; document.body.style.cursor = '' }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [])

  const viewerUrl = source?.url ? `/api/proxy-pdf?url=${encodeURIComponent(source.url)}` : ''

  if (loading) {
    return (
      <div style={{ height: '100vh', background: '#0f0f0f', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, color: '#6b7280' }}>
        <span className="spinner" />
        Loading source…
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ height: '100vh', background: '#0f0f0f', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, color: '#f87171' }}>
        ⚠️ {error}
        <button onClick={() => navigate(`/projects/${projectId}`)} style={{ marginTop: 8, background: '#1a1a1a', border: '1px solid #2a2a2a', color: '#9ca3af', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 13 }}>
          ← Back to project
        </button>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--bg)' }}>
      {/* Header */}
      <div style={{
        padding: '0 16px', height: 44, borderBottom: '1px solid var(--border)',
        background: 'var(--panel)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
      }}>
        <button
          onClick={() => navigate(`/projects/${projectId}`)}
          style={{ background: 'none', border: '1px solid var(--border)', color: '#9ca3af', borderRadius: 8, padding: '4px 10px', fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap' }}
        >
          ← Project
        </button>

        <div style={{ fontSize: 13, fontWeight: 600, color: '#e5e7eb', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'center' }}>
          {pdfLabel}{pdfPages > 0 ? ` · ${pdfPages}p` : ''}
        </div>

        {user.picture && <img src={user.picture} alt="" style={{ width: 24, height: 24, borderRadius: '50%', flexShrink: 0 }} />}
      </div>

      {/* Body */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* PDF panel */}
        <div style={{ width: `${splitPct}%`, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <PdfViewer url={viewerUrl} pages={pdfPages} onTextSelected={setSelectedText} />
        </div>

        {/* Drag handle */}
        <div
          ref={splitRef}
          onMouseDown={() => { dragging.current = true; document.body.style.cursor = 'col-resize' }}
          style={{ width: 5, flexShrink: 0, background: 'var(--border)', cursor: 'col-resize', userSelect: 'none' }}
          onMouseEnter={e => (e.currentTarget.style.background = '#4a4a4a')}
          onMouseLeave={e => { if (!dragging.current) e.currentTarget.style.background = 'var(--border)' }}
        />

        {/* Chat panel */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <ChatPanel
            pdfText={pdfText}
            pdfUrl={source?.url || ''}
            disabled={!pdfText}
            selectedText={selectedText}
            onSelectedTextUsed={() => setSelectedText('')}
            projectId={projectId || null}
            sourceId={sourceId || null}
          />
        </div>
      </div>
    </div>
  )
}
