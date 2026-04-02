/**
 * App.tsx — PaperReader (v2)
 * Opened from ProjectView when a source is clicked.
 * Reads project_id + source_id from URL params.
 */
import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import PdfViewer from './components/PdfViewer'
import ChatPanel from './components/ChatPanel'
import { sourcesApi, notesApi, annotationsApi, type Source, type Note, type Annotation } from './lib/api'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import RelatedPanel from './components/RelatedPanel'

interface User { email: string; name: string; picture: string }

type RightPanel = 'chat' | 'notes' | 'related'

// ── Inline source note editor ─────────────────────────────────────────────────
function SourceNotePanel({ projectId, sourceId }: { projectId: string; sourceId: string }) {
  const navigate = useNavigate()
  const [notes, setNotes] = useState<Note[]>([])
  const [activeNote, setActiveNote] = useState<Note | null>(null)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [preview, setPreview] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(true)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    notesApi.listBySource(projectId, sourceId).then(ns => {
      setNotes(ns)
      if (ns.length > 0) openNote(ns[0])
    })
  }, [projectId, sourceId])

  const openNote = (n: Note) => {
    setActiveNote(n)
    setTitle(n.title)
    setContent(n.content || '')
    setSaved(true)
    setPreview(false)
  }

  const scheduleSave = (newTitle: string, newContent: string) => {
    if (!activeNote) return
    setSaved(false)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      setSaving(true)
      await notesApi.update(projectId, activeNote.id, { title: newTitle, content: newContent })
      setSaving(false); setSaved(true)
    }, 1000)
  }

  const handleNew = async () => {
    const { id } = await notesApi.create(projectId, { title: 'Untitled Note', content: '', source_id: sourceId })
    const n: Note = { id, project_id: projectId, source_id: sourceId, title: 'Untitled Note', content: '', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
    setNotes(prev => [n, ...prev])
    openNote(n)
  }

  const handleDelete = async (id: string) => {
    await notesApi.delete(projectId, id)
    const remaining = notes.filter(n => n.id !== id)
    setNotes(remaining)
    if (activeNote?.id === id) {
      if (remaining.length > 0) openNote(remaining[0])
      else { setActiveNote(null); setTitle(''); setContent('') }
    }
  }

  if (!activeNote && notes.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--panel)' }}>
        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#d1d5db' }}>Notes</span>
          <button onClick={handleNew} style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>＋ New</button>
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 10, color: '#4b5563' }}>
          <div style={{ fontSize: 32 }}>📝</div>
          <div style={{ fontSize: 13 }}>No notes yet for this source</div>
          <button onClick={handleNew} style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, cursor: 'pointer', marginTop: 4 }}>Create a note</button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--panel)' }}>
      {/* Header */}
      <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        {notes.length > 1 && (
          <select
            value={activeNote?.id || ''}
            onChange={e => { const n = notes.find(x => x.id === e.target.value); if (n) openNote(n) }}
            style={{ flex: 1, background: '#0f0f0f', border: '1px solid var(--border)', color: '#e5e7eb', borderRadius: 6, padding: '4px 8px', fontSize: 12, outline: 'none' }}
          >
            {notes.map(n => <option key={n.id} value={n.id}>{n.title}</option>)}
          </select>
        )}
        {notes.length <= 1 && <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: '#d1d5db', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activeNote?.title || 'Notes'}</span>}
        <span style={{ fontSize: 10, color: saving ? '#6366f1' : saved ? '#4b5563' : '#f59e0b' }}>
          {saving ? '●' : saved ? '✓' : '●'}
        </span>
        <button onClick={() => setPreview(p => !p)} style={{ background: preview ? '#1e1b4b' : 'none', border: '1px solid var(--border)', color: preview ? '#a5b4fc' : '#6b7280', borderRadius: 6, padding: '3px 8px', fontSize: 10, cursor: 'pointer' }}>
          {preview ? '✏️' : '👁'}
        </button>
        {activeNote && <button onClick={() => handleDelete(activeNote.id)} style={{ background: 'none', border: 'none', color: '#4b5563', fontSize: 13, cursor: 'pointer', padding: 2 }}>✕</button>}
        <button onClick={handleNew} style={{ background: 'none', border: '1px solid var(--border)', color: '#6b7280', borderRadius: 6, padding: '3px 8px', fontSize: 10, cursor: 'pointer' }}>＋</button>
        <button onClick={() => navigate(`/projects/${projectId}/notes/${activeNote?.id}`)} title="Open full editor" style={{ background: 'none', border: '1px solid var(--border)', color: '#6b7280', borderRadius: 6, padding: '3px 8px', fontSize: 10, cursor: 'pointer' }}>⤢</button>
      </div>

      {/* Title */}
      <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg)', flexShrink: 0 }}>
        <input
          value={title}
          onChange={e => { setTitle(e.target.value); scheduleSave(e.target.value, content) }}
          style={{ width: '100%', background: 'none', border: 'none', color: '#fff', fontSize: 13, fontWeight: 700, outline: 'none', fontFamily: 'inherit' }}
        />
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
        {!preview ? (
          <textarea
            value={content}
            onChange={e => { setContent(e.target.value); scheduleSave(title, e.target.value) }}
            placeholder="Write notes… (Markdown supported)"
            style={{ flex: 1, background: 'var(--bg)', border: 'none', color: '#e5e7eb', padding: '12px 16px', fontSize: 12, resize: 'none', fontFamily: "'SF Mono', 'Fira Code', monospace", lineHeight: 1.7, outline: 'none' }}
          />
        ) : (
          <div style={{ flex: 1, overflow: 'auto', padding: '12px 16px', background: 'var(--panel)' }}>
            <div className="prose" style={{ fontSize: 13 }}>
              <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{content || '*Nothing here yet…*'}</ReactMarkdown>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main PaperReader ──────────────────────────────────────────────────────────
export default function App({ user }: { user: User }) {
  const { projectId, sourceId } = useParams<{ projectId: string; sourceId: string }>()
  const navigate = useNavigate()

  const [source, setSource] = useState<Source | null>(null)
  const [pdfText, setPdfText] = useState('')
  const [pdfPages, setPdfPages] = useState(0)
  const [pdfLabel, setPdfLabel] = useState('')
  const [selectedText, setSelectedText] = useState('')
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [splitPct, setSplitPct] = useState(55)
  const [loading, setLoading] = useState(true)
  const [retrying, setRetrying] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')
  const [rightPanel, setRightPanel] = useState<RightPanel>('chat')
  const [isResizing, setIsResizing] = useState(false)

  const splitRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  const loadSource = useCallback(() => {
    if (!projectId || !sourceId) return
    setLoading(true)
    setError('')
    Promise.all([
      sourcesApi.get(projectId, sourceId),
      annotationsApi.list(projectId, sourceId),
    ])
      .then(([s, anns]) => {
        setSource(s)
        setPdfText(s.pdf_text || '')
        setPdfPages(s.pages || 0)
        setPdfLabel(s.title || s.url || 'PDF')
        setAnnotations(anns)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [projectId, sourceId])

  useEffect(() => { loadSource() }, [loadSource])

  const handleRetry = async () => {
    if (!source?.url || !projectId || !sourceId) return
    setRetrying(true)
    try {
      await fetch('/api/extract', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: source.url, project_id: projectId, source_id: sourceId }),
      })
      await loadSource()
    } catch { /* ignore */ }
    finally { setRetrying(false) }
  }

  // Drag-to-resize
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current || !splitRef.current) return
      const container = splitRef.current.parentElement
      if (!container) return
      const rect = container.getBoundingClientRect()
      const pct = Math.min(75, Math.max(25, ((e.clientX - rect.left) / rect.width) * 100))
      setSplitPct(pct)
    }
    const onUp = () => {
      if (dragging.current) {
        dragging.current = false
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        setIsResizing(false)
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [])

  const handleHighlightCreate = async (data: Omit<Annotation, 'id' | 'source_id' | 'project_id' | 'created_at'>) => {
    if (!projectId || !sourceId) return
    const ann = await annotationsApi.create(projectId, sourceId, data)
    setAnnotations(prev => [...prev, ann])
  }

  const handleHighlightClick = (ann: Annotation) => {
    setSelectedText(ann.text)
    setRightPanel('chat')
  }

  const viewerUrl = source?.url ? `/api/proxy-pdf?url=${encodeURIComponent(source.url)}` : ''
  const hasPdfText = !!pdfText.trim()

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

  const tabBtn = (panel: RightPanel, label: string) => (
    <button
      onClick={() => setRightPanel(panel)}
      style={{
        background: 'none', border: 'none', borderBottom: `2px solid ${rightPanel === panel ? 'var(--accent)' : 'transparent'}`,
        color: rightPanel === panel ? '#e5e7eb' : '#6b7280',
        fontSize: 12, fontWeight: rightPanel === panel ? 600 : 400,
        padding: '0 10px', height: '100%', cursor: 'pointer', transition: 'all 0.15s',
      }}
    >{label}</button>
  )

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
          {!hasPdfText && source && (
            <span style={{ marginLeft: 8, background: '#7f1d1d', color: '#fca5a5', borderRadius: 4, padding: '1px 6px', fontSize: 10, fontWeight: 600 }}>
              ⚠ No text extracted
            </span>
          )}
        </div>

        <button
          onClick={async () => {
            if (!confirm('Remove this source from the project?')) return
            setDeleting(true)
            try {
              await sourcesApi.delete(projectId!, sourceId!)
              navigate(`/projects/${projectId}`)
            } catch { setDeleting(false) }
          }}
          disabled={deleting}
          title="Remove source"
          style={{ background: 'none', border: '1px solid #3a3a3a', color: '#6b7280', borderRadius: 8, padding: '4px 10px', fontSize: 11, cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' }}
        >
          {deleting ? '…' : '🗑 Remove'}
        </button>

        {user.picture && <img src={user.picture} alt="" style={{ width: 24, height: 24, borderRadius: '50%', flexShrink: 0 }} />}
      </div>

      {/* Failed source banner */}
      {!hasPdfText && source && (
        <div style={{ background: '#1c1917', borderBottom: '1px solid #44403c', padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: '#d6d3d1', flexShrink: 0 }}>
          <span>⚠️</span>
          <span style={{ flex: 1 }}>
            No text was extracted from this source. The PDF may be scanned, protected, or failed to load.
          </span>
          <button
            onClick={handleRetry}
            disabled={retrying}
            style={{ background: '#292524', border: '1px solid #57534e', color: '#d6d3d1', borderRadius: 6, padding: '4px 12px', fontSize: 11, cursor: retrying ? 'not-allowed' : 'pointer', flexShrink: 0 }}
          >
            {retrying ? <><span className="spinner" style={{ width: 10, height: 10, marginRight: 6 }} />Retrying…</> : '↺ Retry'}
          </button>
        </div>
      )}

      {/* Body */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* PDF panel */}
        <div style={{ width: `${splitPct}%`, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <PdfViewer
            url={viewerUrl}
            pages={pdfPages}
            isResizing={isResizing}
            onTextSelected={setSelectedText}
            annotations={annotations}
            onHighlightCreate={handleHighlightCreate}
            onHighlightClick={handleHighlightClick}
          />
        </div>

        {/* Drag handle */}
        <div
          ref={splitRef}
          onMouseDown={() => { dragging.current = true; setIsResizing(true); document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none' }}
          style={{ width: 5, flexShrink: 0, background: 'var(--border)', cursor: 'col-resize', userSelect: 'none' }}
          onMouseEnter={e => (e.currentTarget.style.background = '#4a4a4a')}
          onMouseLeave={e => { if (!dragging.current) e.currentTarget.style.background = 'var(--border)' }}
        />

        {/* Right panel */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {/* Tab bar */}
          <div style={{ height: 36, borderBottom: '1px solid var(--border)', background: 'var(--panel)', display: 'flex', alignItems: 'stretch', flexShrink: 0, paddingLeft: 4 }}>
            {tabBtn('chat', '💬 Chat')}
            {tabBtn('notes', '📝 Notes')}
            {tabBtn('related', '🔗 Related')}
          </div>

          {rightPanel === 'chat' && (
            <ChatPanel
              pdfText={pdfText}
              pdfUrl={source?.url || ''}
              disabled={!hasPdfText}
              selectedText={selectedText}
              onSelectedTextUsed={() => setSelectedText('')}
              projectId={projectId || null}
              sourceId={sourceId || null}
            />
          )}
          {rightPanel === 'notes' && projectId && sourceId && (
            <SourceNotePanel projectId={projectId} sourceId={sourceId} />
          )}
          {rightPanel === 'related' && projectId && sourceId && source && (
            <RelatedPanel projectId={projectId} sourceId={sourceId} sourceUrl={source.url || ''} />
          )}
        </div>
      </div>
    </div>
  )
}
