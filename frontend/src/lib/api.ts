// Centralized API client for pdfpal v2

const BASE = '/api'

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...opts,
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
  artifact_count: number
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
  created_at: string
  accessed_at: string
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

export interface Artifact {
  id: string
  project_id: string
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
  addUrl: async (projectId: string, url: string) => {
    const res = await fetch(`${BASE}/extract`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, project_id: projectId }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }))
      throw new Error(err.detail || `Failed to add source`)
    }
    return res.json()
  },
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

export const artifactsApi = {
  list: (projectId: string) => apiFetch<Artifact[]>(`/projects/${projectId}/artifacts`),
  create: (projectId: string, data: { title?: string; content: string }) =>
    apiFetch<{ id: string }>(`/projects/${projectId}/artifacts`, { method: 'POST', body: JSON.stringify(data) }),
  get: (projectId: string, artifactId: string) =>
    apiFetch<Artifact>(`/projects/${projectId}/artifacts/${artifactId}`),
  update: (projectId: string, artifactId: string, data: { title?: string; content?: string }) =>
    apiFetch(`/projects/${projectId}/artifacts/${artifactId}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (projectId: string, artifactId: string) =>
    apiFetch(`/projects/${projectId}/artifacts/${artifactId}`, { method: 'DELETE' }),
}
