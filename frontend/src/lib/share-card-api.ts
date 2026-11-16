import {
  DESTINATIONS, type Angle, type Destination, type LinkPlacement, type PageRect, type ShareCardRecord, type ShareCardSummary, type ShareLook, type ShareStyle,
} from '../../../src/shared/share-card'

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
const DESTINATION_KEY = 'pdfpal:share-destination'

/** The destination the reader chose last on this device; LinkedIn when none is stored or storage is unavailable. */
export function lastDestination(): Destination {
  try {
    const stored = localStorage.getItem(DESTINATION_KEY)
    if ((DESTINATIONS as readonly string[]).includes(stored ?? '')) return stored as Destination
  } catch { /* Storage may be unavailable; the default still works. */ }
  return 'linkedin'
}

export function rememberDestination(destination: Destination) {
  try { localStorage.setItem(DESTINATION_KEY, destination) } catch { /* As above. */ }
}

/** One request for new text. At least one field. */
export type ShareCardChange = { instruction?: string; destination?: Destination; take?: string }

/** Exactly one kind of edit per request (see the PATCH route in src/server/share-cards.ts). */
const patch = (projectId: string, id: string, body: object) => request<ShareCardRecord>(`${base(projectId)}/${id}`, { method: 'PATCH', body })

export const shareCardApi = {
  /**
   * Starts the post for a highlight, or returns the one it has, written for `destination` (by default the one the
   * reader chose last on this device) around `take`. The request ID is kept in sessionStorage until the server
   * answers, so a reload while the request is in flight cannot start a second generation.
   */
  async start(projectId: string, annotationId: string, options: { destination?: Destination; take?: string } = {}): Promise<ShareCardRecord> {
    const key = `pdfpal:share-card-request:${projectId}:${annotationId}`
    const destination = options.destination ?? lastDestination(), take = options.take?.trim() || undefined
    let requestId: string | undefined
    try { requestId = sessionStorage.getItem(key) || undefined } catch { /* Storage may be unavailable; a fresh ID still works. */ }
    if (!requestId) {
      requestId = crypto.randomUUID()
      try { sessionStorage.setItem(key, requestId) } catch { /* As above. */ }
    }
    const record = await request<ShareCardRecord>(base(projectId), { body: { request_id: requestId, annotation_id: annotationId, destination, ...(take ? { take } : {}) } })
    try { sessionStorage.removeItem(key) } catch { /* As above. */ }
    return record
  },
  list: (projectId: string, sourceId?: string) =>
    request<ShareCardSummary[]>(`${base(projectId)}${sourceId ? `?source_id=${encodeURIComponent(sourceId)}` : ''}`),
  get: (projectId: string, id: string) => request<ShareCardRecord>(`${base(projectId)}/${id}`),
  /** New text: an instruction, another destination, another take, or several of them, in one request. */
  change: (projectId: string, id: string, change: ShareCardChange) => request<ShareCardRecord>(`${base(projectId)}/${id}/change`, { body: change }),
  retry: (projectId: string, id: string) => request<ShareCardRecord>(`${base(projectId)}/${id}/retry`, { body: {} }),
  cancel: (projectId: string, id: string) => request<ShareCardRecord>(`${base(projectId)}/${id}/cancel`, { body: {} }),
  undo: (projectId: string, id: string) => request<ShareCardRecord>(`${base(projectId)}/${id}/undo`, { body: {} }),
  restyle: (projectId: string, id: string, style: ShareStyle, look: ShareLook) => patch(projectId, id, { style, look }),
  /** The reader's crop as page fractions; null returns to the automatic crop. */
  crop: (projectId: string, id: string, crop: PageRect | null) => patch(projectId, id, { crop }),
  angle: (projectId: string, id: string, angle: Angle) => patch(projectId, id, { angle }),
  showTags: (projectId: string, id: string, showTags: boolean) => patch(projectId, id, { show_tags: showTags }),
  link: (projectId: string, id: string, link: LinkPlacement) => patch(projectId, id, { link }),
  editHeadline: (projectId: string, id: string, headline: string) => patch(projectId, id, { headline }),
  editCaption: (projectId: string, id: string, caption: string) => patch(projectId, id, { caption }),
  editQuote: (projectId: string, id: string, quote: string) => patch(projectId, id, { quote }),
  editCredit: (projectId: string, id: string, credit: string) => patch(projectId, id, { credit }),
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
