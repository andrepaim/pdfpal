import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { projectsApi, type Project } from '../lib/api'

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso + 'Z').getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

interface NewProjectModalProps {
  onClose: () => void
  onCreate: (project: Project) => void
}

function NewProjectModal({ onClose, onCreate }: NewProjectModalProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleCreate = async () => {
    if (!title.trim()) return
    setLoading(true)
    setError('')
    try {
      const project = await projectsApi.create(title.trim(), description.trim())
      onCreate(project)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }} onClick={onClose}>
      <div style={{
        background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 16,
        padding: 28, width: 420, boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
      }} onClick={e => e.stopPropagation()}>
        <h2 style={{ color: '#fff', fontSize: 17, fontWeight: 700, margin: '0 0 4px' }}>Create a new project</h2>
        <p style={{ color: '#6b7280', fontSize: 12, margin: '0 0 20px' }}>
          A project is your research workspace — add PDFs, chat, take notes.
        </p>

        <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Project name</div>
        <input
          autoFocus
          value={title}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleCreate()}
          placeholder="e.g. LLM Scaling Laws"
          style={{
            width: '100%', background: '#0f0f0f', border: '1px solid var(--border)',
            borderRadius: 8, padding: '10px 14px', color: '#e5e7eb', fontSize: 13,
            marginBottom: 14, fontFamily: 'inherit', boxSizing: 'border-box',
            outline: 'none',
          }}
        />

        <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Description (optional)</div>
        <input
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="What are you researching?"
          style={{
            width: '100%', background: '#0f0f0f', border: '1px solid var(--border)',
            borderRadius: 8, padding: '10px 14px', color: '#e5e7eb', fontSize: 13,
            marginBottom: 20, fontFamily: 'inherit', boxSizing: 'border-box',
            outline: 'none',
          }}
        />

        {error && <div style={{ color: '#f87171', fontSize: 12, marginBottom: 12 }}>⚠️ {error}</div>}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ background: 'none', border: '1px solid var(--border)', color: '#9ca3af', borderRadius: 8, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={loading || !title.trim()}
            style={{
              background: loading || !title.trim() ? '#3a3a3a' : 'var(--accent)',
              color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px',
              fontSize: 13, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? 'Creating…' : 'Create Project'}
          </button>
        </div>
      </div>
    </div>
  )
}

interface ProjectCardProps {
  project: Project
  onDelete: (id: string) => void
}

function ProjectCard({ project, onDelete }: ProjectCardProps) {
  const navigate = useNavigate()
  const [hovered, setHovered] = useState(false)

  return (
    <div
      onClick={() => navigate(`/projects/${project.id}`)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: 'var(--panel)',
        border: `1px solid ${hovered ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius: 12, padding: 20, cursor: 'pointer',
        transition: 'border-color 0.15s', position: 'relative',
      }}
    >
      <div style={{ fontSize: 24, marginBottom: 12 }}>📂</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: '#fff', marginBottom: 4 }}>{project.title}</div>
      {project.description && (
        <div style={{ color: '#9ca3af', fontSize: 12, marginBottom: 16, lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {project.description}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {project.source_count > 0 && <span style={pillStyle}><b>{project.source_count}</b> source{project.source_count !== 1 ? 's' : ''}</span>}
        {project.note_count > 0 && <span style={pillStyle}><b>{project.note_count}</b> note{project.note_count !== 1 ? 's' : ''}</span>}
        {project.artifact_count > 0 && <span style={pillStyle}><b>{project.artifact_count}</b> artifact{project.artifact_count !== 1 ? 's' : ''}</span>}
        <span style={pillStyle}>{timeAgo(project.accessed_at)}</span>
      </div>
      {hovered && (
        <button
          onClick={e => { e.stopPropagation(); if (confirm('Delete this project and all its sources?')) onDelete(project.id) }}
          style={{
            position: 'absolute', top: 12, right: 12,
            background: 'none', border: 'none', color: '#4b5563', cursor: 'pointer', fontSize: 14, padding: 4,
          }}
        >✕</button>
      )}
    </div>
  )
}

const pillStyle: React.CSSProperties = {
  background: '#212121', border: '1px solid var(--border)', borderRadius: 20,
  padding: '3px 10px', fontSize: 11, color: '#9ca3af',
}

interface User { email: string; name: string; picture: string }

export default function ProjectsPage({ user }: { user: User }) {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)

  useEffect(() => {
    projectsApi.list().then(setProjects).finally(() => setLoading(false))
  }, [])

  const filtered = projects.filter(p =>
    p.title.toLowerCase().includes(search.toLowerCase()) ||
    p.description?.toLowerCase().includes(search.toLowerCase())
  )

  const handleCreate = (project: Project) => {
    setShowModal(false)
    setProjects(prev => [project, ...prev])
  }

  const handleDelete = async (id: string) => {
    await projectsApi.delete(id)
    setProjects(prev => prev.filter(p => p.id !== id))
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ background: '#111', borderBottom: '1px solid var(--border)', padding: '0 24px', height: 48, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <img src="/logo.png" alt="pdfpal" style={{ width: 32, height: 32 }} />
          <span style={{ fontWeight: 800, fontSize: 16, color: '#fff', letterSpacing: '-0.5px' }}>pdfpal</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {user.picture && <img src={user.picture} style={{ width: 28, height: 28, borderRadius: '50%' }} alt="" />}
          <span style={{ fontSize: 12, color: '#6b7280' }}>{user.email}</span>
          <button
            onClick={async () => { await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }); location.reload() }}
            style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: 12, cursor: 'pointer' }}
          >Sign out</button>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, padding: '32px 40px', maxWidth: 1100, margin: '0 auto', width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: '#fff', margin: 0 }}>My Projects</h1>
            <p style={{ color: '#6b7280', fontSize: 13, margin: '4px 0 0' }}>Your research workspaces</p>
          </div>
          <button
            onClick={() => setShowModal(true)}
            style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >＋ New Project</button>
        </div>

        <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10, color: '#4b5563', marginBottom: 24 }}>
          <span>🔍</span>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search projects…"
            style={{ flex: 1, background: 'none', border: 'none', color: '#e5e7eb', fontSize: 14, outline: 'none', fontFamily: 'inherit' }}
          />
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', paddingTop: 60, color: '#4b5563' }}>
            <div className="spinner" style={{ margin: '0 auto 12px' }} />
            Loading projects…
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
            {filtered.map(p => <ProjectCard key={p.id} project={p} onDelete={handleDelete} />)}
            <div
              onClick={() => setShowModal(true)}
              style={{
                border: '2px dashed #333', borderRadius: 12, display: 'flex',
                flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                minHeight: 160, color: '#4b5563', gap: 8, cursor: 'pointer',
              }}
            >
              <div style={{ fontSize: 28 }}>＋</div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>New Project</div>
            </div>
          </div>
        )}

        {!loading && projects.length === 0 && (
          <div style={{ textAlign: 'center', paddingTop: 60, color: '#4b5563' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>📂</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#6b7280' }}>No projects yet</div>
            <div style={{ fontSize: 13, marginTop: 8 }}>Create a project to start researching</div>
          </div>
        )}
      </div>

      {showModal && <NewProjectModal onClose={() => setShowModal(false)} onCreate={handleCreate} />}
    </div>
  )
}
