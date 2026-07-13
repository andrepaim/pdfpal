import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { projectsApi, sourcesApi, collectionsApi, notesApi, chatApi, searchApi, highlightsApi, type Project, type Source, type Collection, type Note, type ChatSession, type SearchPassage, type Highlight } from '../lib/api'
import SearchPaperModal from '../components/SearchPaperModal'
import { timeAgo } from '../lib/time'

type Tab = 'sources' | 'search' | 'notes' | 'chats' | 'highlights'

// Payload dragged between the tree's rows: either a source being filed, or a
// collection being reparented.
type DragItem = { kind: 'source' | 'collection'; id: string }

// ── Sources tab: a drag-and-drop collection tree ──────────────────────────────
function SourceRow({ source, projectId, drag }: {
  source: Source
  projectId: string
  drag: { onDragStart: (item: DragItem) => void; onDragEnd: () => void }
}) {
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(source.title || source.url || '')

  const commit = async () => {
    const next = title.trim()
    if (next && next !== source.title) { await sourcesApi.updateTitle(projectId, source.id, next); source.title = next }
    setEditing(false)
  }
  const remove = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm('Remove this source?')) return
    await sourcesApi.delete(projectId, source.id)
    window.dispatchEvent(new CustomEvent('pdfpal:sources-changed'))
  }

  return (
    <div
      draggable={!editing}
      onDragStart={e => { e.stopPropagation(); e.dataTransfer.effectAllowed = 'move'; drag.onDragStart({ kind: 'source', id: source.id }) }}
      onDragEnd={drag.onDragEnd}
      onClick={() => !editing && navigate(`/projects/${projectId}/sources/${source.id}`)}
      style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 12px', display: 'flex', alignItems: 'center', gap: 10, cursor: editing ? 'default' : 'pointer' }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = '#3a3a3a')}
      onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
    >
      <div style={{ fontSize: 16, flexShrink: 0, color: '#6b7280' }}>⠿</div>
      <div style={{ fontSize: 16, flexShrink: 0 }}>📄</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {editing ? (
          <input autoFocus value={title} onChange={e => setTitle(e.target.value)} onBlur={commit}
            onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
            onClick={e => e.stopPropagation()}
            style={{ width: '100%', background: '#0f0f0f', border: '1px solid var(--accent)', borderRadius: 6, padding: '3px 8px', color: '#fff', fontSize: 13, fontWeight: 600, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
        ) : (
          <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{source.title || source.url || 'Untitled'}</div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
        {source.pages > 0
          ? <span style={{ background: '#212121', border: '1px solid var(--border)', borderRadius: 6, padding: '2px 8px', fontSize: 10, color: '#6b7280' }}>{source.pages}p</span>
          : <span style={{ background: '#7f1d1d', border: '1px solid #991b1b', borderRadius: 6, padding: '2px 8px', fontSize: 10, color: '#fca5a5' }}>⚠ Failed</span>}
        <button onClick={e => { e.stopPropagation(); setTitle(source.title || source.url || ''); setEditing(true) }} title="Rename"
          style={{ background: 'none', border: '1px solid #3a3a3a', color: '#6b7280', cursor: 'pointer', fontSize: 11, padding: '2px 7px', borderRadius: 6 }}>✏️</button>
        <button onClick={remove} title="Remove source"
          style={{ background: 'none', border: '1px solid #3a3a3a', color: '#6b7280', cursor: 'pointer', fontSize: 11, padding: '2px 7px', borderRadius: 6 }}
          onMouseEnter={e => { e.currentTarget.style.color = '#f87171'; e.currentTarget.style.borderColor = '#f87171' }}
          onMouseLeave={e => { e.currentTarget.style.color = '#6b7280'; e.currentTarget.style.borderColor = '#3a3a3a' }}>✕</button>
      </div>
    </div>
  )
}

function SourcesTab({ projectId }: { projectId: string }) {
  const navigate = useNavigate()
  const [sources, setSources] = useState<Source[]>([])
  const [collections, setCollections] = useState<Collection[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [dragItem, setDragItem] = useState<DragItem | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null) // collection id or 'root'
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')

  const reload = () => Promise.all([sourcesApi.list(projectId), collectionsApi.list(projectId)])
    .then(([s, c]) => { setSources(s); setCollections(c) })
    .finally(() => setLoading(false))

  useEffect(() => { reload() }, [projectId])
  useEffect(() => {
    const onChange = () => reload()
    window.addEventListener('pdfpal:sources-changed', onChange)
    return () => window.removeEventListener('pdfpal:sources-changed', onChange)
  }, [projectId])

  // Index the flat collection list into a parent → children tree and group
  // sources by their collection (null and dangling ids fall into "Unfiled").
  const { childrenOf, sourcesIn } = useMemo(() => {
    const known = new Set(collections.map(c => c.id))
    const childrenOf = new Map<string | null, Collection[]>()
    for (const c of collections) {
      const key = c.parent_id && known.has(c.parent_id) ? c.parent_id : null
      ;(childrenOf.get(key) ?? childrenOf.set(key, []).get(key)!).push(c)
    }
    const sourcesIn = new Map<string | null, Source[]>()
    for (const s of sources) {
      const key = s.collection_id && known.has(s.collection_id) ? s.collection_id : null
      ;(sourcesIn.get(key) ?? sourcesIn.set(key, []).get(key)!).push(s)
    }
    return { childrenOf, sourcesIn }
  }, [collections, sources])

  const toggle = (id: string) => setExpanded(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })
  const allExpanded = collections.length > 0 && collections.every(c => expanded.has(c.id))
  const toggleAll = () => setExpanded(allExpanded ? new Set() : new Set(collections.map(c => c.id)))

  const drop = async (targetCollectionId: string | null) => {
    const item = dragItem
    setDragItem(null); setDropTarget(null)
    if (!item) return
    try {
      if (item.kind === 'source') await sourcesApi.setCollection(projectId, item.id, targetCollectionId)
      else if (item.id !== targetCollectionId) await collectionsApi.move(projectId, item.id, targetCollectionId)
      await reload()
    } catch (e: any) { alert(e.message || 'Could not move item') }
  }

  const addCollection = async (parentId: string | null) => {
    const name = prompt('New collection name', 'New Collection')
    if (!name?.trim()) return
    const created = await collectionsApi.create(projectId, name.trim(), parentId)
    if (parentId) setExpanded(prev => new Set(prev).add(parentId))
    await reload()
    setEditingId(created.id); setEditingName(created.name)
  }

  const commitRename = async (id: string) => {
    const name = editingName.trim()
    if (name) { await collectionsApi.rename(projectId, id, name); setCollections(prev => prev.map(c => c.id === id ? { ...c, name } : c)) }
    setEditingId(null)
  }

  const deleteCollection = async (c: Collection) => {
    if (!confirm(`Delete collection "${c.name}"? Its sources will become unfiled (not deleted).`)) return
    await collectionsApi.delete(projectId, c.id)
    await reload()
  }

  const dropZoneStyle = (id: string): React.CSSProperties =>
    dropTarget === id ? { outline: '2px dashed var(--accent)', outlineOffset: 2, borderRadius: 8 } : {}

  const dragHandlers = { onDragStart: setDragItem, onDragEnd: () => { setDragItem(null); setDropTarget(null) } }

  // Recursively render a collection and everything filed beneath it.
  const renderCollection = (c: Collection, depth: number): React.ReactNode => {
    const isOpen = expanded.has(c.id)
    const kids = childrenOf.get(c.id) ?? []
    const rows = sourcesIn.get(c.id) ?? []
    const total = (c.source_count ?? rows.length)
    return (
      <div key={c.id} style={{ marginLeft: depth ? 16 : 0 }}>
        <div
          draggable={editingId !== c.id}
          onDragStart={e => { e.stopPropagation(); e.dataTransfer.effectAllowed = 'move'; setDragItem({ kind: 'collection', id: c.id }) }}
          onDragEnd={dragHandlers.onDragEnd}
          onDragOver={e => { if (dragItem) { e.preventDefault(); e.stopPropagation(); setDropTarget(c.id) } }}
          onDragLeave={e => { e.stopPropagation(); setDropTarget(t => t === c.id ? null : t) }}
          onDrop={e => { e.preventDefault(); e.stopPropagation(); drop(c.id) }}
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', background: '#141414', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 6, cursor: 'grab', ...dropZoneStyle(c.id) }}
        >
          <span onClick={() => toggle(c.id)} style={{ cursor: 'pointer', color: '#6b7280', fontSize: 11, width: 12, flexShrink: 0 }}>{isOpen ? '▾' : '▸'}</span>
          <span style={{ fontSize: 15, flexShrink: 0 }}>{isOpen ? '📂' : '📁'}</span>
          {editingId === c.id ? (
            <input autoFocus value={editingName} onChange={e => setEditingName(e.target.value)} onBlur={() => commitRename(c.id)}
              onKeyDown={e => { if (e.key === 'Enter') commitRename(c.id); if (e.key === 'Escape') setEditingId(null) }}
              onClick={e => e.stopPropagation()}
              style={{ flex: 1, background: '#0f0f0f', border: '1px solid var(--accent)', borderRadius: 6, padding: '2px 8px', color: '#fff', fontSize: 13, fontWeight: 700, outline: 'none', fontFamily: 'inherit' }} />
          ) : (
            <span onClick={() => toggle(c.id)} style={{ flex: 1, fontSize: 13, fontWeight: 700, color: '#e5e7eb', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
          )}
          <span style={{ background: 'var(--border)', borderRadius: 10, padding: '1px 7px', fontSize: 10, color: '#9ca3af', flexShrink: 0 }}>{total}</span>
          <button title="Ask this collection" onClick={e => { e.stopPropagation(); navigate(`/projects/${projectId}/chat?collection=${c.id}`) }}
            style={collBtn}>💬</button>
          <button title="New sub-collection" onClick={e => { e.stopPropagation(); addCollection(c.id) }} style={collBtn}>＋</button>
          <button title="Rename" onClick={e => { e.stopPropagation(); setEditingId(c.id); setEditingName(c.name) }} style={collBtn}>✏️</button>
          <button title="Delete collection" onClick={e => { e.stopPropagation(); deleteCollection(c) }} style={collBtn}>🗑</button>
        </div>
        {isOpen && (
          <div style={{ marginLeft: 16, display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 6 }}>
            {kids.map(child => renderCollection(child, depth + 1))}
            {rows.map(s => <SourceRow key={s.id} source={s} projectId={projectId} drag={dragHandlers} />)}
            {kids.length === 0 && rows.length === 0 && <div style={{ fontSize: 11, color: '#4b5563', padding: '4px 8px' }}>Empty — drag sources here</div>}
          </div>
        )}
      </div>
    )
  }

  const rootCollections = childrenOf.get(null) ?? []
  const unfiled = sourcesIn.get(null) ?? []

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--panel)', flexShrink: 0 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>Sources</span>
        <div style={{ display: 'flex', gap: 8 }}>
          {collections.length > 0 && (
            <button onClick={toggleAll} style={{ background: 'none', color: '#9ca3af', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              {allExpanded ? '▾ Collapse All' : '▸ Expand All'}
            </button>
          )}
          <button onClick={() => addCollection(null)} style={{ background: 'none', color: '#a5b4fc', border: '1px solid #312e81', borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>📁 New Collection</button>
          <button onClick={() => setShowAdd(true)} style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>＋ Add Source</button>
        </div>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {loading && <div style={{ color: '#4b5563', textAlign: 'center', paddingTop: 40 }}><div className="spinner" style={{ margin: '0 auto 12px' }} /></div>}
        {!loading && sources.length === 0 && collections.length === 0 && (
          <div style={{ textAlign: 'center', paddingTop: 60, color: '#4b5563' }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>📄</div>
            <div>No sources yet. Add a PDF or create a collection to organize your papers.</div>
          </div>
        )}

        {rootCollections.map(c => renderCollection(c, 0))}

        {/* Unfiled sources double as the "move to top level" drop zone. */}
        {(unfiled.length > 0 || collections.length > 0) && (
          <div
            onDragOver={e => { if (dragItem) { e.preventDefault(); setDropTarget('root') } }}
            onDragLeave={() => setDropTarget(t => t === 'root' ? null : t)}
            onDrop={e => { e.preventDefault(); drop(null) }}
            style={{ marginTop: collections.length ? 8 : 0, padding: 8, ...dropZoneStyle('root') }}
          >
            {collections.length > 0 && (
              <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1, padding: '2px 4px 8px' }}>
                Unfiled{unfiled.length ? ` · ${unfiled.length}` : ''}
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {unfiled.map(s => <SourceRow key={s.id} source={s} projectId={projectId} drag={dragHandlers} />)}
            </div>
          </div>
        )}

        <div onClick={() => setShowAdd(true)} style={{ border: '2px dashed #333', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: '#4b5563', cursor: 'pointer', padding: '14px 0', fontSize: 12, marginTop: 6 }}>
          <span>🔍</span><span>Search or paste a URL to add a source…</span>
        </div>
      </div>
      {showAdd && <SearchPaperModal projectId={projectId} onClose={() => { setShowAdd(false); reload() }} onAdded={s => { setShowAdd(false); setSources(prev => [s, ...prev]) }} />}
    </div>
  )
}

const collBtn: React.CSSProperties = { background: 'none', border: '1px solid #3a3a3a', color: '#6b7280', cursor: 'pointer', fontSize: 11, padding: '2px 6px', borderRadius: 6, flexShrink: 0 }

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

// ── Search tab: full-text search across the project's indexed sources ─────────
function SearchTab({ projectId }: { projectId: string }) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchPassage[] | null>(null)
  const [searching, setSearching] = useState(false)

  const run = async () => {
    const q = query.trim()
    if (q.length < 2) return
    setSearching(true)
    try { setResults((await searchApi.inProject(projectId, q)).results) }
    finally { setSearching(false) }
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', background: 'var(--panel)', flexShrink: 0, display: 'flex', gap: 8 }}>
        <input
          autoFocus value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') run() }}
          placeholder="Search across all source text in this project…"
          style={{ flex: 1, background: '#0f0f0f', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', color: '#e5e7eb', fontSize: 13, outline: 'none', fontFamily: 'inherit' }}
        />
        <button onClick={run} disabled={searching || query.trim().length < 2}
          style={{ background: searching || query.trim().length < 2 ? '#2a2a2a' : 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '0 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          {searching ? <span className="spinner" style={{ width: 14, height: 14 }} /> : 'Search'}
        </button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {results === null && <div style={{ textAlign: 'center', paddingTop: 60, color: '#4b5563', fontSize: 13 }}>Type at least two characters and press Enter.</div>}
        {results !== null && results.length === 0 && <div style={{ textAlign: 'center', paddingTop: 60, color: '#4b5563', fontSize: 13 }}>No matching passages.</div>}
        {results?.map((r, i) => (
          <div key={i} onClick={() => navigate(`/projects/${projectId}/sources/${r.source_id}`)}
            style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 16px', cursor: 'pointer' }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = '#3a3a3a')}
            onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#e5e7eb', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📄 {r.source_title}</span>
              <span style={{ fontSize: 10, color: '#6b7280', flexShrink: 0 }}>page {r.page_number}</span>
            </div>
            <div style={{ fontSize: 12, color: '#9ca3af', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{r.content}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Highlights tab: every annotation in the project, grouped by source ────────
function HighlightsTab({ projectId }: { projectId: string }) {
  const navigate = useNavigate()
  const [highlights, setHighlights] = useState<Highlight[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { highlightsApi.list(projectId).then(setHighlights).finally(() => setLoading(false)) }, [projectId])

  const colors: Record<string, string> = { yellow: '#fde047', green: '#4ade80', blue: '#60a5fa', pink: '#f472b6' }
  const bySource = useMemo(() => {
    const map = new Map<string, { title: string; items: Highlight[] }>()
    for (const h of highlights) (map.get(h.source_id) ?? map.set(h.source_id, { title: h.source_title, items: [] }).get(h.source_id)!).items.push(h)
    return [...map.entries()]
  }, [highlights])

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', background: 'var(--panel)', flexShrink: 0 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>Highlights</span>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        {loading ? <div style={{ textAlign: 'center', paddingTop: 40, color: '#4b5563' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
          : highlights.length === 0 ? <div style={{ textAlign: 'center', paddingTop: 60, color: '#4b5563' }}><div style={{ fontSize: 36, marginBottom: 12 }}>🖊</div>No highlights yet. Select text in a PDF and choose Highlight.</div>
          : bySource.map(([sourceId, group]) => (
            <div key={sourceId} style={{ marginBottom: 18 }}>
              <div onClick={() => navigate(`/projects/${projectId}/sources/${sourceId}`)}
                style={{ fontSize: 13, fontWeight: 700, color: '#e5e7eb', marginBottom: 8, cursor: 'pointer' }}>📄 {group.title}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {group.items.map(h => (
                  <div key={h.id} onClick={() => navigate(`/projects/${projectId}/sources/${sourceId}`)}
                    style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderLeft: `3px solid ${colors[h.color] ?? colors.yellow}`, borderRadius: 8, padding: '8px 12px', cursor: 'pointer', display: 'flex', gap: 10 }}>
                    <span style={{ fontSize: 10, color: '#6b7280', flexShrink: 0, marginTop: 2 }}>p{h.page_number}</span>
                    <span style={{ fontSize: 12, color: '#d1d5db', lineHeight: 1.5 }}>{h.text}</span>
                  </div>
                ))}
              </div>
            </div>
          ))
        }
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
    <div role="tab" aria-selected={tab === t} onClick={() => setTab(t)} style={{
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
          {navItem('search', '🔍', 'Search')}
          {navItem('highlights', '🖊', 'Highlights')}
          {navItem('notes', '📝', 'Notes', project?.note_count)}
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
        {tab === 'search' && <SearchTab projectId={projectId} />}
        {tab === 'highlights' && <HighlightsTab projectId={projectId} />}
        {tab === 'notes' && <NotesTab projectId={projectId} />}
        {tab === 'chats' && <ChatsTab projectId={projectId} />}
      </div>
    </div>
  )
}
