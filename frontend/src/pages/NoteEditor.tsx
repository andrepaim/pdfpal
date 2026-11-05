import { useState, useEffect, useRef, useCallback } from 'react'
import { registerPendingSave } from '../lib/persistence'
import { useNavigate, useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { notesApi } from '../lib/api'
import { useLibraryChanges } from '../lib/library-changes'

export default function NoteEditor() {
  const { projectId, noteId } = useParams<{ projectId: string; noteId: string }>()
  const navigate = useNavigate()
  // note state
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(true)
  const [preview, setPreview] = useState(true)
  const [saveError, setSaveError] = useState('')
  const expectedUpdatedAt = useRef<string | undefined>(undefined)
  const isSaving = useRef(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const draft = useRef<{ title: string; content: string; revision: number } | null>(null)
  const revision = useRef(0)
  const inFlight = useRef<Promise<void>>(Promise.resolve())

  const flushSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = null
    if (!draft.current || !projectId || !noteId) return inFlight.current
    const snapshot = draft.current
    draft.current = null
    isSaving.current = true
    setSaving(true)
    const request = inFlight.current.catch(() => {}).then(async () => {
      isSaving.current = true
      setSaving(true)
      const result = await notesApi.update(projectId, noteId, { title: snapshot.title, content: snapshot.content, expected_updated_at: expectedUpdatedAt.current })
      expectedUpdatedAt.current = result.updated_at
      setSaveError('')
      setSaving(false); setSaved(draft.current === null && revision.current === snapshot.revision)
    }).catch(error => {
      if (revision.current === snapshot.revision) draft.current ??= snapshot
      setSaving(false); setSaved(false)
      setSaveError((error as Error).message)
      throw error
    }).finally(() => { if (inFlight.current === request) isSaving.current = false })
    inFlight.current = request
    return request
  }, [projectId, noteId])

  useEffect(() => {
    const unregister = registerPendingSave(flushSave)
    return () => { void flushSave().catch(() => {}).finally(unregister) }
  }, [flushSave])

  useEffect(() => {
    if (projectId && noteId) {
      notesApi.get(projectId, noteId).then(n => {
        expectedUpdatedAt.current = n.updated_at
        setTitle(n.title); setContent(n.content || '')
      }).catch(error => setSaveError((error as Error).message))
    }
  }, [projectId, noteId])
  useLibraryChanges(async () => {
    if (!projectId || !noteId || draft.current || isSaving.current) return
    const before = revision.current
    const note = await notesApi.get(projectId, noteId)
    if (before !== revision.current || draft.current || isSaving.current) return
    expectedUpdatedAt.current = note.updated_at
    setTitle(note.title); setContent(note.content || '')
  })
  const reloadSaved = async () => {
    if (!projectId || !noteId) return
    try {
      const note = await notesApi.get(projectId, noteId)
      if (saveTimer.current) clearTimeout(saveTimer.current)
      draft.current = null; revision.current++; inFlight.current = Promise.resolve()
      expectedUpdatedAt.current = note.updated_at
      setTitle(note.title); setContent(note.content || ''); setSaved(true); setSaveError('')
    } catch (error) { setSaveError((error as Error).message) }
  }
  const saveCopy = async () => {
    if (!projectId) return
    try {
      const note = await notesApi.create(projectId, { title: title || 'Recovered draft', content })
      if (saveTimer.current) clearTimeout(saveTimer.current)
      draft.current = null; revision.current++; inFlight.current = Promise.resolve()
      setSaveError(''); navigate(`/projects/${projectId}/notes/${note.id}`)
    } catch (error) { setSaveError((error as Error).message) }
  }

  const scheduleSave = (newTitle: string, newContent: string) => {
    setSaved(false)
    draft.current = { title: newTitle, content: newContent, revision: ++revision.current }
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => { void flushSave().catch(() => {}) }, 1000)
  }

  const updateTitle = (v: string) => { setTitle(v); scheduleSave(v, content) }
  const updateContent = (v: string) => { setContent(v); scheduleSave(title, v) }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'var(--app-height, 100vh)', background: 'var(--bg)' }}>
      {/* Topbar */}
      <div style={{ height: 44, background: 'var(--panel)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px', flexShrink: 0 }}>
        <button onClick={() => navigate(`/projects/${projectId}`)} style={{ background: 'none', border: '1px solid var(--border)', color: '#9ca3af', borderRadius: 8, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}>← Project</button>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: saving ? '#6366f1' : saved ? '#4b5563' : '#f59e0b' }}>
          {saving ? 'Saving…' : saved ? 'Saved' : 'Unsaved'}
        </span>
        <button onClick={() => setPreview(p => !p)} style={{ background: preview ? '#1e1b4b' : 'var(--panel)', border: '1px solid var(--border)', color: preview ? '#a5b4fc' : '#9ca3af', borderRadius: 8, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}>
          {preview ? '✏️ Edit' : '👁 Preview'}
        </button>
      </div>

      {saveError&&<div role="alert" style={{padding:'12px 16px',background:'#352821',color:'#f8d6b1',fontSize:12}}>{saveError}<div style={{display:'flex',gap:12,marginTop:8}}><button disabled={saving} onClick={()=>void reloadSaved()}>Reload saved note</button><button disabled={saving} onClick={()=>void saveCopy()}>Save draft as new note</button></div></div>}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', background: 'var(--panel)', flexShrink: 0 }}>
          <input
            value={title}
            onChange={e => updateTitle(e.target.value)}
            placeholder="Note title…"
            style={{ width: '100%', background: 'none', border: 'none', color: '#fff', fontSize: 16, fontWeight: 700, outline: 'none', fontFamily: 'inherit' }}
          />
        </div>

        {!preview ? (
          <textarea
            value={content}
            onChange={e => updateContent(e.target.value)}
            placeholder="Write your notes here… (Markdown supported)"
            style={{ flex: 1, background: 'var(--bg)', border: 'none', color: '#e5e7eb', padding: '16px 20px', fontSize: 13, resize: 'none', fontFamily: "'SF Mono', 'Fira Code', monospace", lineHeight: 1.7, outline: 'none' }}
          />
        ) : (
          <div style={{ flex: 1, overflow: 'auto', padding: '20px 28px', background: 'var(--bg)' }}>
            <div className="prose">
              <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{content || '*Nothing here yet…*'}</ReactMarkdown>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
