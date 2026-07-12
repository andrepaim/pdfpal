// Centralized API client for pdfpal v2

const BASE = '/api'

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  // Only set a JSON content-type when there's actually a body — Fastify's
  // JSON body parser rejects bodyless requests (e.g. DELETE) that declare
  // one, which used to 500 on every source/project/note removal.
  const res = await fetch(BASE + path, {
    credentials: 'include',
    ...opts,
    headers: { ...(opts?.body ? { 'Content-Type': 'application/json' } : {}), ...opts?.headers },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || `API error ${res.status}`)
  }
  return res.json()
}

// ── Projects ─────────────────────────────────────────────────────────────────

export interface Project {
  id: string
  title: string
  description: string
  created_at: string
  accessed_at: string
  source_count: number
  note_count: number
  chat_count: number
}

export interface Source {
  id: string
  project_id: string
  type: 'pdf' | 'url' | 'text'
  url?: string
  title?: string
  pages: number
  pdf_text?: string
  collection_id?: string | null
  created_at: string
  accessed_at: string
}

export interface Collection {
  id: string
  project_id: string
  parent_id: string | null
  name: string
  position: number
  created_at: string
  source_count: number
}

export interface Note {
  id: string
  project_id: string
  source_id?: string
  title: string
  content?: string
  preview?: string
  created_at: string
  updated_at: string
}

export const projectsApi = {
  list: () => apiFetch<Project[]>('/projects'),
  create: (title: string, description?: string) =>
    apiFetch<Project>('/projects', { method: 'POST', body: JSON.stringify({ title, description }) }),
  get: (id: string) => apiFetch<Project>(`/projects/${id}`),
  update: (id: string, data: Partial<{ title: string; description: string }>) =>
    apiFetch(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: (id: string) => apiFetch(`/projects/${id}`, { method: 'DELETE' }),
}

export const sourcesApi = {
  list: (projectId: string) => apiFetch<Source[]>(`/projects/${projectId}/sources`),
  get: (projectId: string, sourceId: string) =>
    apiFetch<Source>(`/projects/${projectId}/sources/${sourceId}`),
  delete: (projectId: string, sourceId: string) =>
    apiFetch(`/projects/${projectId}/sources/${sourceId}`, { method: 'DELETE' }),
  updateTitle: (projectId: string, sourceId: string, title: string) =>
    apiFetch(`/projects/${projectId}/sources/${sourceId}`, { method: 'PATCH', body: JSON.stringify({ title }) }),
  setCollection: (projectId: string, sourceId: string, collectionId: string | null) =>
    apiFetch(`/projects/${projectId}/sources/${sourceId}`, { method: 'PATCH', body: JSON.stringify({ collection_id: collectionId }) }),
  addUrl: async (projectId: string, url: string, collectionId?: string | null) => {
    const res = await fetch(`${BASE}/extract`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, project_id: projectId, collection_id: collectionId ?? undefined }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }))
      throw new Error(err.detail || `Failed to add source`)
    }
    return res.json()
  },
}

export const collectionsApi = {
  list: (projectId: string) => apiFetch<Collection[]>(`/projects/${projectId}/collections`),
  create: (projectId: string, name: string, parentId?: string | null) =>
    apiFetch<Collection>(`/projects/${projectId}/collections`, { method: 'POST', body: JSON.stringify({ name, parent_id: parentId ?? undefined }) }),
  rename: (projectId: string, id: string, name: string) =>
    apiFetch(`/projects/${projectId}/collections/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  move: (projectId: string, id: string, parentId: string | null) =>
    apiFetch(`/projects/${projectId}/collections/${id}`, { method: 'PATCH', body: JSON.stringify({ parent_id: parentId }) }),
  delete: (projectId: string, id: string) =>
    apiFetch(`/projects/${projectId}/collections/${id}`, { method: 'DELETE' }),
}

export const notesApi = {
  list: (projectId: string) => apiFetch<Note[]>(`/projects/${projectId}/notes`),
  listBySource: (projectId: string, sourceId: string) =>
    apiFetch<Note[]>(`/projects/${projectId}/sources/${sourceId}/notes`),
  create: (projectId: string, data: { title?: string; content?: string; source_id?: string }) =>
    apiFetch<{ id: string }>(`/projects/${projectId}/notes`, { method: 'POST', body: JSON.stringify(data) }),
  get: (projectId: string, noteId: string) =>
    apiFetch<Note>(`/projects/${projectId}/notes/${noteId}`),
  update: (projectId: string, noteId: string, data: { title?: string; content?: string }) =>
    apiFetch(`/projects/${projectId}/notes/${noteId}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (projectId: string, noteId: string) =>
    apiFetch(`/projects/${projectId}/notes/${noteId}`, { method: 'DELETE' }),
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  sources_used?: string[]
  created_at?: string
}

export interface ChatSession {
  id: string
  source_id: string | null
  title: string
  source_title?: string
  message_count: number
  first_message?: string
  created_at: string
  accessed_at: string
}

export interface RelatedPaper {
  id?: number
  s2_paper_id?: string
  title: string
  authors: string
  year?: number
  arxiv_url?: string
  pdf_url?: string
  relation: 'reference' | 'citation'
}

export interface RelatedResult {
  references: RelatedPaper[]
  citations: RelatedPaper[]
  cached: boolean
  paper_id?: string
  error?: string
}

export interface SearchResult {
  s2_paper_id?: string
  title: string
  authors: string
  year?: number
  venue?: string
  citation_count?: number
  arxiv_url?: string
  pdf_url?: string
}

export interface SearchPassage {
  source_id: string
  source_title: string
  page_number: number
  content: string
  score: number
}

export interface Highlight {
  id: string
  source_id: string
  source_title: string
  collection_id: string | null
  collection_name: string | null
  page_number: number
  text: string
  color: string
  created_at: string
}

export const searchApi = {
  papers: (q: string) => apiFetch<{ results: SearchResult[]; error?: string }>(`/search/papers?q=${encodeURIComponent(q)}`),
  inProject: (projectId: string, q: string) => apiFetch<{ results: SearchPassage[] }>(`/projects/${projectId}/search?q=${encodeURIComponent(q)}`),
}

export const highlightsApi = {
  list: (projectId: string) => apiFetch<Highlight[]>(`/projects/${projectId}/highlights`),
}

export const relatedApi = {
  get: (projectId: string, sourceId: string, refresh = false) =>
    apiFetch<RelatedResult>(`/projects/${projectId}/sources/${sourceId}/related${refresh ? '?refresh=true' : ''}`),
}

export const chatApi = {
  getProjectChat: (projectId: string) =>
    apiFetch<{ messages: ChatMessage[] }>(`/projects/${projectId}/chat`),
  getSourceChat: (projectId: string, sourceId: string) =>
    apiFetch<{ messages: ChatMessage[] }>(`/projects/${projectId}/sources/${sourceId}/chat`),
  listSessions: (projectId: string) =>
    apiFetch<ChatSession[]>(`/projects/${projectId}/chats`),
  clearProjectChat: (projectId: string) =>
    apiFetch(`/projects/${projectId}/chat`, { method: 'DELETE' }),
  clearSourceChat: (projectId: string, sourceId: string) =>
    apiFetch(`/projects/${projectId}/sources/${sourceId}/chat`, { method: 'DELETE' }),
}

export interface Annotation {
  id: string
  source_id: string
  project_id: string
  page_number: number
  x1: number
  y1: number
  x2: number
  y2: number
  text: string
  color: string
  created_at: string
}

export const annotationsApi = {
  list: (projectId: string, sourceId: string) =>
    apiFetch<Annotation[]>(`/projects/${projectId}/sources/${sourceId}/annotations`),
  create: (projectId: string, sourceId: string, data: Omit<Annotation, 'id' | 'source_id' | 'project_id' | 'created_at'>) =>
    apiFetch<Annotation>(`/projects/${projectId}/sources/${sourceId}/annotations`, {
      method: 'POST', body: JSON.stringify(data),
    }),
  delete: (projectId: string, sourceId: string, annotationId: string) =>
    apiFetch(`/projects/${projectId}/sources/${sourceId}/annotations/${annotationId}`, { method: 'DELETE' }),
  updateColor: (projectId: string, sourceId: string, annotationId: string, color: string) =>
    apiFetch<Annotation>(`/projects/${projectId}/sources/${sourceId}/annotations/${annotationId}`, {
      method: 'PATCH', body: JSON.stringify({ color }),
    }),
}

