import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { artifactsApi, type Artifact } from '../lib/api'

export default function ArtifactViewer() {
  const { projectId, artifactId } = useParams<{ projectId: string; artifactId: string }>()
  const navigate = useNavigate()
  const [artifact, setArtifact] = useState<Artifact | null>(null)
  const [editing, setEditing] = useState(false)
  const [content, setContent] = useState('')
  const [title, setTitle] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (projectId && artifactId) {
      artifactsApi.get(projectId, artifactId).then(a => {
        setArtifact(a); setContent(a.content || ''); setTitle(a.title)
      })
    }
  }, [projectId, artifactId])

  const handleSave = async () => {
    if (!projectId || !artifactId) return
    setSaving(true)
    await artifactsApi.update(projectId, artifactId, { title, content })
    setSaving(false); setEditing(false)
  }

  const handleCopy = () => { navigator.clipboard.writeText(content); }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--bg)' }}>
      <div style={{ height: 44, background: 'var(--panel)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px', flexShrink: 0 }}>
        <button onClick={() => navigate(`/projects/${projectId}`)} style={{ background: 'none', border: '1px solid var(--border)', color: '#9ca3af', borderRadius: 8, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}>← Project</button>
        <div style={{ flex: 1, textAlign: 'center', fontSize: 13, fontWeight: 600, color: '#fff' }}>✨ {title}</div>
        {editing ? (
          <>
            <button onClick={() => setEditing(false)} style={{ background: 'none', border: '1px solid var(--border)', color: '#9ca3af', borderRadius: 8, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}>Cancel</button>
            <button onClick={handleSave} style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}>{saving ? 'Saving…' : 'Save'}</button>
          </>
        ) : (
          <>
            <button onClick={() => setEditing(true)} style={{ background: 'var(--panel)', border: '1px solid var(--border)', color: '#9ca3af', borderRadius: 8, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}>✏️ Edit</button>
            <button onClick={handleCopy} style={{ background: 'none', border: '1px solid var(--border)', color: '#9ca3af', borderRadius: 8, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}>Copy</button>
          </>
        )}
      </div>

      {editing ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <input value={title} onChange={e => setTitle(e.target.value)} style={{ padding: '12px 20px', background: 'var(--panel)', border: 'none', borderBottom: '1px solid var(--border)', color: '#fff', fontSize: 15, fontWeight: 700, fontFamily: 'inherit', outline: 'none' }} />
          <textarea value={content} onChange={e => setContent(e.target.value)} style={{ flex: 1, background: 'var(--bg)', border: 'none', color: '#e5e7eb', padding: '16px 20px', fontSize: 13, resize: 'none', fontFamily: 'monospace', lineHeight: 1.7, outline: 'none' }} />
        </div>
      ) : (
        <div style={{ flex: 1, overflow: 'auto', padding: '32px 48px', maxWidth: 760, margin: '0 auto', width: '100%' }}>
          <h1 style={{ color: '#fff', fontSize: 22, fontWeight: 800, marginBottom: 8 }}>{title}</h1>
          <div style={{ color: '#4b5563', fontSize: 12, marginBottom: 28 }}>
            Generated {artifact ? new Date(artifact.created_at + 'Z').toLocaleDateString() : ''}
          </div>
          <div className="prose">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  )
}
