import type { VisualRecord } from '../../../src/shared/visual'
import type { VisualTransport } from '../components/VisualExplanation'

async function request<T>(url: string, body?: object): Promise<T> {
  const response = await fetch(url, { method: body ? 'POST' : 'GET', credentials: 'include', signal: AbortSignal.timeout(15_000),
    ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) })
  const result = await response.json()
  if (!response.ok) throw new Error(result.detail || 'The visual explanation request failed.')
  return result
}
export function webVisualTransport(projectId: string): VisualTransport {
  const base = `/api/projects/${encodeURIComponent(projectId)}/visuals`
  return { get: id => request(`${base}/${id}`), save: id => request(`${base}/${id}/save`, {}),
    retry: (id, requestId) => request(`${base}/${id}/retry`, { request_id: requestId }),
    noteUrl: id => `/projects/${projectId}/notes/${id}` }
}
export type WebVisualRequest = { question: string; source_id?: string; active_source_ids?: string[]; selection?: string; answer?: string; agent?: string }
export async function startWebVisual(projectId: string, input: WebVisualRequest): Promise<VisualRecord> {
  const key = `pdfpal:visual-request:${projectId}:${input.source_id || 'project'}`
  const serialized = JSON.stringify(input)
  let pending: { serialized: string; request_id: string } | undefined
  try { pending = JSON.parse(sessionStorage.getItem(key) || 'null') } catch { /* Replace an invalid local draft. */ }
  if (!pending || pending.serialized !== serialized) pending = { serialized, request_id: crypto.randomUUID() }
  sessionStorage.setItem(key, JSON.stringify(pending))
  const result = await request<VisualRecord>(`/api/projects/${encodeURIComponent(projectId)}/visuals`, { ...input, request_id: pending.request_id })
  sessionStorage.removeItem(key)
  return result
}
