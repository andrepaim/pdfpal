import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { notesApi } from '../lib/api'

export default function NoteEditor() {
  const { projectId, noteId } = useParams<{ projectId: string; noteId: string }>()
  const navigate = useNavigate()
  // note state
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(true)
  const [preview, setPreview] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (projectId && noteId) {
      notesApi.get(projectId, noteId).then(n => {
        setTitle(n.title); setContent(n.content || '')
      })
    }
  }, [projectId, noteId])

  const scheduleSave = (newTitle: string, newContent: string) => {
    setSaved(false)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      if (!projectId || !noteId) return
      setSaving(true)
      await notesApi.update(projectId, noteId, { title: newTitle, content: newContent })
      setSaving(false); setSaved(true)
    }, 1000)
  }

  const updateTitle = (v: string) => { setTitle(v); scheduleSave(v, content) }
  const updateContent = (v: string) => { setContent(v); scheduleSave(title, v) }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--bg)' }}>
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

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Editor */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', borderRight: preview ? '1px solid var(--border)' : 'none' }}>
          <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', background: 'var(--panel)' }}>
            <input
              value={title}
              onChange={e => updateTitle(e.target.value)}
              placeholder="Note title…"
              style={{ width: '100%', background: 'none', border: 'none', color: '#fff', fontSize: 16, fontWeight: 700, outline: 'none', fontFamily: 'inherit' }}
            />
          </div>
          <textarea
            value={content}
            onChange={e => updateContent(e.target.value)}
            placeholder="Write your notes here… (Markdown supported)"
            style={{ flex: 1, background: 'var(--bg)', border: 'none', color: '#e5e7eb', padding: '16px 20px', fontSize: 13, resize: 'none', fontFamily: "'SF Mono', 'Fira Code', monospace", lineHeight: 1.7, outline: 'none' }}
          />
        </div>

        {/* Preview */}
        {preview && (
          <div style={{ flex: 1, overflow: 'auto', padding: '20px 28px', background: 'var(--panel)' }}>
            <h1 style={{ color: '#fff', fontSize: 20, fontWeight: 800, marginBottom: 20 }}>{title || 'Untitled'}</h1>
            <div className="prose">
              <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{content || '*Nothing here yet…*'}</ReactMarkdown>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
