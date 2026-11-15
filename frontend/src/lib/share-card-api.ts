import type { ShareCardRecord, ShareCardSummary, ShareLook, ShareStyle } from '../../../src/shared/share-card'

async function request<T>(url: string, init: { method?: string; body?: object } = {}): Promise<T> {
  const method = init.method ?? (init.body ? 'POST' : 'GET')
  const response = await fetch(url, { method, credentials: 'include', signal: AbortSignal.timeout(15_000),
    ...(init.body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(init.body) } : {}) })
  if (response.status === 204) return undefined as T
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw Object.assign(new Error(result.detail || 'The post request failed.'), { status: response.status })
  return result
}

const base = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/share-cards`

export const shareCardApi = {
  /**
   * Starts the post for a highlight, or returns the one it has. The request ID is kept in sessionStorage until the
   * server answers, so a reload while the request is in flight cannot start a second generation.
   */
  async start(projectId: string, annotationId: string): Promise<ShareCardRecord> {
    const key = `pdfpal:share-card-request:${projectId}:${annotationId}`
    let requestId: string | undefined
    try { requestId = sessionStorage.getItem(key) || undefined } catch { /* Storage may be unavailable; a fresh ID still works. */ }
    if (!requestId) {
      requestId = crypto.randomUUID()
      try { sessionStorage.setItem(key, requestId) } catch { /* As above. */ }
    }
    const record = await request<ShareCardRecord>(base(projectId), { body: { request_id: requestId, annotation_id: annotationId } })
    try { sessionStorage.removeItem(key) } catch { /* As above. */ }
    return record
  },
  list: (projectId: string, sourceId?: string) =>
    request<ShareCardSummary[]>(`${base(projectId)}${sourceId ? `?source_id=${encodeURIComponent(sourceId)}` : ''}`),
  get: (projectId: string, id: string) => request<ShareCardRecord>(`${base(projectId)}/${id}`),
  change: (projectId: string, id: string, instruction: string) => request<ShareCardRecord>(`${base(projectId)}/${id}/change`, { body: { instruction } }),
  retry: (projectId: string, id: string) => request<ShareCardRecord>(`${base(projectId)}/${id}/retry`, { body: {} }),
  cancel: (projectId: string, id: string) => request<ShareCardRecord>(`${base(projectId)}/${id}/cancel`, { body: {} }),
  undo: (projectId: string, id: string) => request<ShareCardRecord>(`${base(projectId)}/${id}/undo`, { body: {} }),
  restyle: (projectId: string, id: string, style: ShareStyle, look: ShareLook) =>
    request<ShareCardRecord>(`${base(projectId)}/${id}`, { method: 'PATCH', body: { style, look } }),
  editCaption: (projectId: string, id: string, caption: string) => request<ShareCardRecord>(`${base(projectId)}/${id}`, { method: 'PATCH', body: { caption } }),
  editQuote: (projectId: string, id: string, quote: string) => request<ShareCardRecord>(`${base(projectId)}/${id}`, { method: 'PATCH', body: { quote } }),
  editCredit: (projectId: string, id: string, credit: string) => request<ShareCardRecord>(`${base(projectId)}/${id}`, { method: 'PATCH', body: { credit } }),
  delete: (projectId: string, id: string) => request<void>(`${base(projectId)}/${id}`, { method: 'DELETE' }),
}

/** Polls a post once a second while a generation runs. Returns a function that stops polling. */
export function watchShareCard(projectId: string, id: string, onRecord: (record: ShareCardRecord) => void, onError: (error: Error) => void): () => void {
  let stopped = false, timer: ReturnType<typeof setTimeout> | undefined
  const tick = async () => {
    try {
      const record = await shareCardApi.get(projectId, id)
      if (stopped) return
      onRecord(record)
      if (record.status === 'pending' || record.status === 'running') timer = setTimeout(tick, 1000)
    } catch (error) { if (!stopped) onError(error as Error) }
  }
  void tick()
  return () => { stopped = true; if (timer) clearTimeout(timer) }
}
