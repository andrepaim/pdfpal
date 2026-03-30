import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { projectsApi, sourcesApi, notesApi, artifactsApi, chatApi, type Project, type Source, type Note, type Artifact, type ChatSession } from '../lib/api'
import SearchPaperModal from '../components/SearchPaperModal'

type Tab = 'sources' | 'notes' | 'artifacts' | 'chats'

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso + 'Z').getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

// ── Add URL modal ─────────────────────────────────────────────────────────────

// ── Sources tab ───────────────────────────────────────────────────────────────
function SourcesTab({ projectId }: { projectId: string }) {
  const navigate = useNavigate()
  const [sources, setSources] = useState<Source[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')

  useEffect(() => { sourcesApi.list(projectId).then(setSources).finally(() => setLoading(false)) }, [projectId])

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    if (!confirm('Remove this source?')) return
    await sourcesApi.delete(projectId, id)
    setSources(s => s.filter(x => x.id !== id))
  }

  const startEdit = (e: React.MouseEvent, s: Source) => {
    e.stopPropagation()
    setEditingId(s.id)
    setEditingTitle(s.title || s.url || '')
  }

  const commitEdit = async (id: string) => {
    const title = editingTitle.trim()
    if (title) {
      await sourcesApi.updateTitle(projectId, id, title)
      setSources(prev => prev.map(s => s.id === id ? { ...s, title } : s))
    }
    setEditingId(null)
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--panel)', flexShrink: 0 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>Sources</span>
        <button onClick={() => setShowAdd(true)} style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>＋ Add Source</button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {loading && <div style={{ color: '#4b5563', textAlign: 'center', paddingTop: 40 }}><div className="spinner" style={{ margin: '0 auto 12px' }} /></div>}
        {!loading && sources.length === 0 && (
          <div style={{ textAlign: 'center', paddingTop: 60, color: '#4b5563' }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>📄</div>
            <div>No sources yet. Add a PDF URL to get started.</div>
          </div>
        )}
        {sources.map(s => (
          <div key={s.id}
            onClick={() => editingId !== s.id && navigate(`/projects/${projectId}/sources/${s.id}`)}
            style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 14, cursor: editingId === s.id ? 'default' : 'pointer', position: 'relative' }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = '#3a3a3a')}
            onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
          >
            <div style={{ fontSize: 20, flexShrink: 0 }}>📄</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              {editingId === s.id ? (
                <input
                  autoFocus
                  value={editingTitle}
                  onChange={e => setEditingTitle(e.target.value)}
                  onBlur={() => commitEdit(s.id)}
                  onKeyDown={e => { if (e.key === 'Enter') commitEdit(s.id); if (e.key === 'Escape') setEditingId(null) }}
                  onClick={e => e.stopPropagation()}
                  style={{ width: '100%', background: '#0f0f0f', border: '1px solid var(--accent)', borderRadius: 6, padding: '4px 8px', color: '#fff', fontSize: 13, fontWeight: 600, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
                />
              ) : (
                <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 3 }}>
                  {s.title || s.url || 'Untitled'}
                </div>
              )}
              <div style={{ fontSize: 11, color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.url}</div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexShrink: 0, alignItems: 'center' }}>
              {s.pages > 0 && <span style={{ background: '#212121', border: '1px solid var(--border)', borderRadius: 6, padding: '2px 8px', fontSize: 10, color: '#6b7280' }}>{s.pages}p</span>}
              {s.pages === 0
                ? <span style={{ background: '#7f1d1d', border: '1px solid #991b1b', borderRadius: 6, padding: '2px 8px', fontSize: 10, color: '#fca5a5' }}>⚠ Failed</span>
                : <span style={{ background: '#1e1b4b', border: '1px solid #312e81', borderRadius: 6, padding: '2px 8px', fontSize: 10, color: '#818cf8' }}>PDF</span>
              }
              <button
                onClick={e => startEdit(e, s)}
                title="Rename"
                style={{ background: 'none', border: '1px solid #3a3a3a', color: '#6b7280', cursor: 'pointer', fontSize: 11, padding: '2px 7px', borderRadius: 6 }}
                onMouseEnter={e => { e.currentTarget.style.color = '#e5e7eb'; e.currentTarget.style.borderColor = '#555' }}
                onMouseLeave={e => { e.currentTarget.style.color = '#6b7280'; e.currentTarget.style.borderColor = '#3a3a3a' }}
              >✏️</button>
              <button
                onClick={e => handleDelete(e, s.id)}
                title="Remove source"
                style={{ background: 'none', border: '1px solid #3a3a3a', color: '#6b7280', cursor: 'pointer', fontSize: 11, padding: '2px 7px', borderRadius: 6 }}
                onMouseEnter={e => { e.currentTarget.style.color = '#f87171'; e.currentTarget.style.borderColor = '#f87171' }}
                onMouseLeave={e => { e.currentTarget.style.color = '#6b7280'; e.currentTarget.style.borderColor = '#3a3a3a' }}
              >✕</button>
            </div>
          </div>
        ))}
        <div onClick={() => setShowAdd(true)} style={{ border: '2px dashed #333', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: '#4b5563', cursor: 'pointer', padding: '14px 0', fontSize: 12 }}>
          <span>🔍</span><span>Search or paste a URL to add a source…</span>
        </div>
      </div>
      {showAdd && <SearchPaperModal projectId={projectId} onClose={() => setShowAdd(false)} onAdded={s => { setSources(prev => [s, ...prev]); setShowAdd(false) }} />}
    </div>
  )
}

// ── Notes tab ─────────────────────────────────────────────────────────────────
function NotesTab({ projectId }: { projectId: string }) {
  const navigate = useNavigate()
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { notesApi.list(projectId).then(setNotes).finally(() => setLoading(false)) }, [projectId])

  const handleCreate = async () => {
    const { id } = await notesApi.create(projectId, { title: 'Untitled Note', content: '' })
    navigate(`/projects/${projectId}/notes/${id}`)
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--panel)', flexShrink: 0 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>Notes</span>
        <button onClick={handleCreate} style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>＋ New Note</button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {loading ? <div style={{ textAlign: 'center', paddingTop: 40, color: '#4b5563' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
          : notes.length === 0 ? <div style={{ textAlign: 'center', paddingTop: 60, color: '#4b5563' }}><div style={{ fontSize: 36, marginBottom: 12 }}>📝</div>No notes yet.</div>
          : notes.map(n => (
            <div key={n.id} onClick={() => navigate(`/projects/${projectId}/notes/${n.id}`)}
              style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 16px', cursor: 'pointer' }}>
              <div style={{ fontWeight: 600, color: '#fff', fontSize: 13, marginBottom: 4 }}>{n.title}</div>
              <div style={{ color: '#6b7280', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.preview || 'Empty note'}</div>
              <div style={{ color: '#4b5563', fontSize: 10, marginTop: 6 }}>{timeAgo(n.updated_at)}</div>
            </div>
          ))
        }
      </div>
    </div>
  )
}

// ── Artifacts tab ─────────────────────────────────────────────────────────────
function ArtifactsTab({ projectId }: { projectId: string }) {
  const navigate = useNavigate()
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { artifactsApi.list(projectId).then(setArtifacts).finally(() => setLoading(false)) }, [projectId])

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', background: 'var(--panel)', flexShrink: 0 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>Artifacts</span>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        {loading ? <div style={{ textAlign: 'center', paddingTop: 40, color: '#4b5563' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
          : artifacts.length === 0 ? <div style={{ textAlign: 'center', paddingTop: 60, color: '#4b5563' }}><div style={{ fontSize: 36, marginBottom: 12 }}>✨</div>No artifacts yet. Generate one from Project Chat.</div>
          : artifacts.map(a => (
            <div key={a.id} onClick={() => navigate(`/projects/${projectId}/artifacts/${a.id}`)}
              style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 16px', cursor: 'pointer', marginBottom: 10 }}>
              <div style={{ fontWeight: 600, color: '#fff', fontSize: 13, marginBottom: 4 }}>✨ {a.title}</div>
              <div style={{ color: '#6b7280', fontSize: 11 }}>{timeAgo(a.updated_at)}</div>
            </div>
          ))
        }
      </div>
    </div>
  )
}

// ── Chats tab ─────────────────────────────────────────────────────────────────
function ChatsTab({ projectId }: { projectId: string }) {
  const navigate = useNavigate()
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { chatApi.listSessions(projectId).then(setSessions).finally(() => setLoading(false)) }, [projectId])

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', background: 'var(--panel)', flexShrink: 0 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>Chat History</span>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {loading ? (
          <div style={{ textAlign: 'center', paddingTop: 40, color: '#4b5563' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
        ) : sessions.length === 0 ? (
          <div style={{ textAlign: 'center', paddingTop: 60, color: '#4b5563' }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>💬</div>
            <div>No chats yet. Start a conversation from a source or Project Chat.</div>
          </div>
        ) : sessions.map(session => {
          const isProjectChat = !session.source_id
          const target = isProjectChat
            ? `/projects/${projectId}/chat`
            : `/projects/${projectId}/sources/${session.source_id}`
          return (
            <div key={session.id}
              onClick={() => navigate(target)}
              style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 16px', cursor: 'pointer' }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = '#3a3a3a')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 14 }}>{isProjectChat ? '💬' : '📄'}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#fff', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {isProjectChat ? 'Project Chat' : (session.source_title || 'Source Chat')}
                </span>
                <span style={{ fontSize: 10, color: '#4b5563', flexShrink: 0 }}>
                  {session.message_count} msg{session.message_count !== 1 ? 's' : ''}
                </span>
              </div>
              {session.first_message && (
                <div style={{ fontSize: 11, color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingLeft: 22 }}>
                  {session.first_message}
                </div>
              )}
              <div style={{ fontSize: 10, color: '#4b5563', marginTop: 4, paddingLeft: 22 }}>
                {timeAgo(session.accessed_at)}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Main ProjectView ──────────────────────────────────────────────────────────
export default function ProjectView() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const [project, setProject] = useState<Project | null>(null)
  const [tab, setTab] = useState<Tab>('sources')
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')

  useEffect(() => {
    if (projectId) projectsApi.get(projectId).then(setProject)
  }, [projectId])

  const startTitleEdit = () => {
    setTitleDraft(project?.title || '')
    setEditingTitle(true)
  }

  const commitTitleEdit = async () => {
    const title = titleDraft.trim()
    if (title && title !== project?.title && projectId) {
      await projectsApi.update(projectId, { title })
      setProject(prev => prev ? { ...prev, title } : prev)
    }
    setEditingTitle(false)
  }

  if (!projectId) return null

  const navItem = (t: Tab, icon: string, label: string, count?: number) => (
    <div onClick={() => setTab(t)} style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
      borderRadius: 8, cursor: 'pointer', fontSize: 13, marginBottom: 2,
      background: tab === t ? '#1e1b4b' : 'transparent',
      color: tab === t ? '#a5b4fc' : '#9ca3af',
      fontWeight: tab === t ? 600 : 400,
    }}>
      <span>{icon}</span>
      <span style={{ flex: 1 }}>{label}</span>
      {count !== undefined && count > 0 && (
        <span style={{ background: 'var(--border)', borderRadius: 10, padding: '1px 7px', fontSize: 10, color: '#6b7280' }}>{count}</span>
      )}
    </div>
  )

  return (
    <div style={{ display: 'flex', height: '100vh', background: 'var(--bg)' }}>
      {/* Sidebar */}
      <div style={{ width: 220, flexShrink: 0, background: '#111', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '12px 12px 8px', borderBottom: '1px solid var(--border)' }}>
          <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 11, padding: 0, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 4 }}>← All projects</button>
          {editingTitle ? (
            <input
              autoFocus
              value={titleDraft}
              onChange={e => setTitleDraft(e.target.value)}
              onBlur={commitTitleEdit}
              onKeyDown={e => { if (e.key === 'Enter') commitTitleEdit(); if (e.key === 'Escape') setEditingTitle(false) }}
              style={{ width: '100%', background: '#0f0f0f', border: '1px solid var(--accent)', borderRadius: 6, padding: '4px 8px', color: '#fff', fontSize: 14, fontWeight: 700, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
            />
          ) : (
            <div
              onClick={startTitleEdit}
              title="Click to rename"
              style={{ fontSize: 14, fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'text', borderRadius: 4, padding: '2px 4px', margin: '-2px -4px' }}
              onMouseEnter={e => (e.currentTarget.style.background = '#1a1a1a')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              {project?.title || '…'}
            </div>
          )}
          {project?.description && (
            <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{project.description}</div>
          )}
        </div>
        <div style={{ flex: 1, padding: 8 }}>
          {navItem('sources', '📄', 'Sources', project?.source_count)}
          {navItem('notes', '📝', 'Notes', project?.note_count)}
          {navItem('artifacts', '✨', 'Artifacts', project?.artifact_count)}
          {navItem('chats', '💬', 'Chats', project?.chat_count || undefined)}
        </div>
        <div style={{ padding: 12, borderTop: '1px solid var(--border)' }}>
          <button
            onClick={() => navigate(`/projects/${projectId}/chat`)}
            style={{ width: '100%', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '10px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
          >💬 Project Chat</button>
        </div>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {tab === 'sources' && <SourcesTab projectId={projectId} />}
        {tab === 'notes' && <NotesTab projectId={projectId} />}
        {tab === 'artifacts' && <ArtifactsTab projectId={projectId} />}
        {tab === 'chats' && <ChatsTab projectId={projectId} />}
      </div>
    </div>
  )
}
