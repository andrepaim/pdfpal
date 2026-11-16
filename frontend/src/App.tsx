/**
 * App.tsx — PaperReader (v2)
 * Opened from ProjectView when a source is clicked.
 * Reads project_id + source_id from URL params.
 */
import { useState, useRef, useEffect, useCallback } from 'react'
import { registerPendingSave } from './lib/persistence'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import PdfViewer from './components/PdfViewer'
import ChatPanel from './components/ChatPanel'
import { sourcesApi, notesApi, annotationsApi, type Source, type Note, type Annotation } from './lib/api'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import RelatedPanel from './components/RelatedPanel'
import { kindleLaunchUrl } from '../../src/shared/kindle-book'
import SharePostPanel from './components/SharePostPanel'
import HighlightMenu, { type HighlightMenuState } from './components/HighlightMenu'
import { shareCardApi } from './lib/share-card-api'
import { highlightColor, type PageMark, type ShareCardSummary } from '../../src/shared/share-card'

interface User { email: string; name: string; picture: string }

type RightPanel = 'chat' | 'notes' | 'related' | 'post'

// ── Inline source note editor ─────────────────────────────────────────────────
function SourceNotePanel({ projectId, sourceId }: { projectId: string; sourceId: string }) {
  const navigate = useNavigate()
  const [notes, setNotes] = useState<Note[]>([])
  const [activeNote, setActiveNote] = useState<Note | null>(null)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [preview, setPreview] = useState(true)
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
    setPreview(true)
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
  const [searchParams, setSearchParams] = useSearchParams()
  const postParam = searchParams.get('post')

  const [source, setSource] = useState<Source | null>(null)
  const [pdfText, setPdfText] = useState('')
  const [pdfPages, setPdfPages] = useState(0)
  const [pdfLabel, setPdfLabel] = useState('')
  const [selectedText, setSelectedText] = useState('')
  // PDF page the selection came from; lets chat include that page as context.
  const [selectedPage, setSelectedPage] = useState<number | null>(null)
  const [visualSelectionRequest, setVisualSelectionRequest] = useState<{ id: string; text: string; page?: number; scope: string } | null>(null)
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [splitPct, setSplitPct] = useState(55)
  const [loading, setLoading] = useState(true)
  const [retrying, setRetrying] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')
  const [rightPanel, setRightPanel] = useState<RightPanel>('chat')
  const [isResizing, setIsResizing] = useState(false)
  // Share posts: the open post, this source's posts (for marks and Open post), and a start that did not begin.
  const [postId, setPostId] = useState<string | null>(null)
  const [posts, setPosts] = useState<ShareCardSummary[]>([])
  const [postNotice, setPostNotice] = useState<string | null>(null)
  const [postPage, setPostPage] = useState<number | null>(null)
  // The page in view, where "Share a region" starts.
  const [viewedPage, setViewedPage] = useState<number | null>(null)
  const [highlightMenu, setHighlightMenu] = useState<HighlightMenuState | null>(null)
  const [jumpTo, setJumpTo] = useState<{ page: number; key: string } | null>(null)

  const splitRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const progressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingProgress = useRef<number | null>(null)
  const lastSavedProgress = useRef<number | null>(null)
  const progressSave = useRef<Promise<unknown> | null>(null)
  const readingContext = useRef('')

  const loadSource = useCallback(() => {
    if (!projectId || !sourceId) return
    setLoading(true)
    setError('')
    // A link to a post opens it beside its page.
    const linked = new URLSearchParams(window.location.search).get('post')
    Promise.all([
      sourcesApi.get(projectId, sourceId),
      annotationsApi.list(projectId, sourceId),
      // A post that answers but cannot be read (one an earlier build saved) still opens, so the panel can say so and
      // offer to delete it; one that is gone or out of reach leaves the reader as it was.
      linked ? shareCardApi.get(projectId, linked).catch((e: { status?: number }) => e.status === 422 ? { id: linked, unreadable: true as const } : null) : Promise.resolve(null),
    ])
      .then(([s, anns, post]) => {
        if (progressTimer.current) clearTimeout(progressTimer.current)
        progressTimer.current = null
        pendingProgress.current = null
        lastSavedProgress.current = s.last_page_read ?? 1
        readingContext.current = `${projectId}/${sourceId}`
        setSource(s)
        setPdfText(s.pdf_text || '')
        setPdfPages(s.pages || 0)
        setPdfLabel(s.title || s.url || 'PDF')
        setAnnotations(anns)
        const page = post && 'source' in post ? post.source.page : null
        if (post) { setPostId(post.id); setPostPage(page); setRightPanel('post') }
        else setPostPage(null)
        setViewedPage(page ?? s.last_page_read ?? 1)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [projectId, sourceId])

  useEffect(() => { loadSource() }, [loadSource])

  const loadPosts = useCallback(() => {
    if (!projectId || !sourceId) return
    shareCardApi.list(projectId, sourceId).then(setPosts).catch(() => { /* Marks are an extra; reading still works. */ })
  }, [projectId, sourceId])
  useEffect(() => { loadPosts() }, [loadPosts])
  useEffect(() => { setPostId(null); setPostNotice(null); setHighlightMenu(null) }, [projectId, sourceId])

  /** Opens a post in the Post tab, keeps it in the address, and brings its page into view when asked. */
  const openPost = useCallback((id: string | null, page?: number) => {
    setPostId(id)
    setPostNotice(null)
    setRightPanel('post')
    setSearchParams(params => { const next = new URLSearchParams(params); if (id) next.set('post', id); else next.delete('post'); return next }, { replace: true })
    if (id && page) setJumpTo({ page, key: `${id}:${Date.now()}` })
  }, [setSearchParams])
  // Follow a post link opened while this source is already showing; loadSource handles the one it opened with.
  const seenPostParam = useRef(postParam)
  useEffect(() => {
    if (postParam === seenPostParam.current) return
    seenPostParam.current = postParam
    if (!postParam || postParam === postId || !projectId) return
    shareCardApi.get(projectId, postParam).then(post => openPost(post.id, post.source.page)).catch((e: { status?: number }) => { if (e.status === 422) openPost(postParam) })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postParam])

  /** The reader's highlights on a page, as the crop editor draws them. */
  const marksOn = (page: number): PageMark[] => annotations.filter(annotation => annotation.page_number === page)
    .map(annotation => ({ rects: annotation.rects?.length ? annotation.rects : [{ x1: annotation.x1, y1: annotation.y1, x2: annotation.x2, y2: annotation.y2 }], color: highlightColor(annotation.color) }))
  const postsByAnnotation = new Map(posts.filter(post => post.annotation_id).map(post => [post.annotation_id!, post]))

  const createPost = async (annotation: Annotation) => {
    if (!projectId) return
    setRightPanel('post'); setPostId(null); setPostNotice(null)
    try {
      const record = await shareCardApi.start(projectId, annotation.id)
      openPost(record.id)
      loadPosts()
    } catch (error) { setPostNotice((error as Error).message) }
  }
  useEffect(() => { setSelectedText(''); setSelectedPage(null); setVisualSelectionRequest(null) }, [projectId, sourceId])

  const flushReadingProgress = useCallback(() => {
    if (!projectId || !sourceId) return
    const page = pendingProgress.current
    if (page === null || page === lastSavedProgress.current) {
      pendingProgress.current = null
      return progressSave.current
    }
    const context = `${projectId}/${sourceId}`
    pendingProgress.current = null
    lastSavedProgress.current = page
    progressSave.current = sourcesApi.updateLastPageRead(projectId, sourceId, page).catch(() => {
      // Progress is best-effort and must never interrupt reading. Keep a failed
      // page pending so route teardown/pagehide gets one more chance to save it.
      if (readingContext.current === context && lastSavedProgress.current === page) {
        lastSavedProgress.current = null
        pendingProgress.current = page
      }
    })
    return progressSave.current
  }, [projectId, sourceId])
  useEffect(() => registerPendingSave(flushReadingProgress), [flushReadingProgress])

  const handlePageChange = useCallback((page: number) => {
    setViewedPage(page)
    if (page === lastSavedProgress.current || page === pendingProgress.current) return
    pendingProgress.current = page
    if (progressTimer.current) clearTimeout(progressTimer.current)
    progressTimer.current = setTimeout(() => {
      progressTimer.current = null
      flushReadingProgress()
    }, 750)
  }, [flushReadingProgress])

  useEffect(() => {
    const onPageHide = () => {
      if (progressTimer.current) clearTimeout(progressTimer.current)
      progressTimer.current = null
      flushReadingProgress()
    }
    window.addEventListener('pagehide', onPageHide)
    return () => {
      window.removeEventListener('pagehide', onPageHide)
      if (progressTimer.current) clearTimeout(progressTimer.current)
      progressTimer.current = null
      flushReadingProgress()
    }
  }, [flushReadingProgress])

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

  const askAboutHighlight = (ann: Annotation) => {
    setSelectedText(ann.text)
    setSelectedPage(ann.page_number)
    setRightPanel('chat')
  }

  const handleHighlightClick = (annotation: Annotation, point: { x: number; y: number }) => setHighlightMenu({ annotation, x: point.x, y: point.y })

  const recolorHighlight = async (annotation: Annotation, color: string) => {
    if (!projectId || !sourceId) return
    const updated = await annotationsApi.updateColor(projectId, sourceId, annotation.id, color)
    setAnnotations(prev => prev.map(item => item.id === annotation.id ? { ...item, ...updated } : item))
  }

  // Deleted highlights go to Recovery; a post made from one keeps its own copy of the passage.
  const deleteHighlight = async (annotation: Annotation) => {
    if (!projectId || !sourceId) return
    await annotationsApi.delete(projectId, sourceId, annotation.id)
    setAnnotations(prev => prev.filter(item => item.id !== annotation.id))
    loadPosts()
  }

  // New sources are stored under ~/.pdfpal/files and served by source ID.
  // Keep the URL proxy as a compatibility fallback for databases migrated
  // before managed-file storage was introduced.
  const viewerUrl = source && projectId && sourceId
    ? `/api/projects/${projectId}/sources/${sourceId}/file`
    : ''
  const hasPdfText = !!pdfText.trim()

  if (loading) {
    return (
      <div style={{ height: 'var(--app-height, 100vh)', background: '#0f0f0f', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, color: '#6b7280' }}>
        <span className="spinner" />
        Loading source…
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ height: 'var(--app-height, 100vh)', background: '#0f0f0f', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, color: '#f87171' }}>
        ⚠️ {error}
        <button onClick={() => navigate(`/projects/${projectId}`)} style={{ marginTop: 8, background: '#1a1a1a', border: '1px solid #2a2a2a', color: '#9ca3af', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 13 }}>
          ← Back to project
        </button>
      </div>
    )
  }

  if (source?.type === 'kindle' && source.url && projectId) {
    return <main style={{ padding: 32, color: '#e5e7eb', background: 'var(--bg)', minHeight: 'var(--app-height, 100vh)' }}>
      <button onClick={() => navigate(`/projects/${projectId}`)}>← Back to project</button>
      <h1>{source.title}</h1>
      {source.author && <p>{source.author}</p>}
      <p>This book opens in Kindle for Web. Use the pdfpal extension to discuss it and save passages.</p>
      <a href={kindleLaunchUrl(source.url, projectId, window.location.origin)} target="_blank" rel="noreferrer" style={{ color: '#a5b4fc' }}>Open in Kindle ↗</a>
    </main>
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
    <div style={{ display: 'flex', flexDirection: 'column', height: 'var(--app-height, 100vh)', background: 'var(--bg)' }}>
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
            key={viewerUrl}
            url={viewerUrl}
            pages={pdfPages}
            initialPage={postPage ?? source?.last_page_read ?? 1}
            jumpTo={jumpTo}
            postAnnotationIds={postsByAnnotation}
            isResizing={isResizing}
            onPageChange={handlePageChange}
            onTextSelected={(text, page) => { setSelectedText(text); setSelectedPage(page ?? null); setRightPanel('chat') }}
            onExplainVisually={(text, page) => {
              setSelectedText(text); setSelectedPage(page ?? null); setRightPanel('chat'); setVisualSelectionRequest({ id: crypto.randomUUID(), text, page, scope: `${projectId}:${sourceId}` })
            }}
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
            {tabBtn('post', '✦ Post')}
          </div>

          {rightPanel === 'chat' && (
            <ChatPanel
              pdfText={pdfText}
              pdfUrl={source?.url || ''}
              disabled={!hasPdfText}
              selectedText={selectedText}
              selectedPage={selectedPage}
              visualSelectionRequest={visualSelectionRequest}
              onVisualSelectionHandled={() => setVisualSelectionRequest(null)}
              onSelectedTextUsed={() => { setSelectedText(''); setSelectedPage(null) }}
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
          {rightPanel === 'post' && projectId && sourceId && (
            <SharePostPanel projectId={projectId} sourceId={sourceId} postId={postId} notice={postNotice}
              currentPage={source?.type === 'pdf' ? viewedPage ?? 1 : undefined} marksOn={marksOn}
              highlights={source?.type === 'pdf' ? annotations.map(annotation => ({ id: annotation.id, page: annotation.page_number, color: annotation.color, text: annotation.text, y: annotation.y1 })) : undefined}
              onOpen={id => openPost(id, id ? posts.find(post => post.id === id)?.page : undefined)} onChanged={loadPosts} />
          )}
        </div>
      </div>
      {highlightMenu && (
        <HighlightMenu menu={highlightMenu} hasPost={postsByAnnotation.has(highlightMenu.annotation.id)}
          onClose={() => setHighlightMenu(null)}
          onAsk={() => askAboutHighlight(highlightMenu.annotation)}
          onPost={() => {
            const existing = postsByAnnotation.get(highlightMenu.annotation.id)
            if (existing) openPost(existing.id)
            else void createPost(highlightMenu.annotation)
          }}
          onColor={color => void recolorHighlight(highlightMenu.annotation, color)}
          onDelete={() => void deleteHighlight(highlightMenu.annotation)} />
      )}
    </div>
  )
}
