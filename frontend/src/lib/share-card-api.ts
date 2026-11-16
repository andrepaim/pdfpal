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

/** What a carousel starts from: highlights of one PDF, in the order of their slides. */
export type SetStart = { sourceId: string; annotationIds: string[] }
/** One carousel slide's words: `index` names a point, and only a point. */
export type SetTextEdit = { field: 'study' | 'takeaway' | 'limitations' | 'point'; index?: number; text: string }

/** What a region or first-page post starts from: the box as page fractions and the text read inside it. */
export type RegionStart = { sourceId: string; page: number; region: PageRect; text: string; kind: 'region' | 'paper' }

/**
 * Sends a start with a request ID kept in sessionStorage under `key` until the server answers, so a reload while the
 * request is in flight sends the same ID and cannot start a second generation.
 */
async function startOnce(projectId: string, key: string, body: object, options: { destination?: Destination; take?: string }): Promise<ShareCardRecord> {
  const stored = `pdfpal:share-card-request:${key}`
  const destination = options.destination ?? lastDestination(), take = options.take?.trim() || undefined
  let requestId: string | undefined
  try { requestId = sessionStorage.getItem(stored) || undefined } catch { /* Storage may be unavailable; a fresh ID still works. */ }
  if (!requestId) {
    requestId = crypto.randomUUID()
    try { sessionStorage.setItem(stored, requestId) } catch { /* As above. */ }
  }
  const record = await request<ShareCardRecord>(base(projectId), { body: { request_id: requestId, ...body, destination, ...(take ? { take } : {}) } })
  try { sessionStorage.removeItem(stored) } catch { /* As above. */ }
  return record
}

export const shareCardApi = {
  /**
   * Starts the post for a highlight, or returns the one it has, written for `destination` (by default the one the
   * reader chose last on this device) around `take`. The request ID is kept in sessionStorage until the server
   * answers, so a reload while the request is in flight cannot start a second generation.
   */
  start(projectId: string, annotationId: string, options: { destination?: Destination; take?: string } = {}): Promise<ShareCardRecord> {
    return startOnce(projectId, `${projectId}:${annotationId}`, { annotation_id: annotationId }, options)
  },
  /**
   * Starts a post from a region the reader chose on a page (`kind` 'region') or from the first page ('paper'), with
   * the text the browser read inside it. Destination, take and the reload-safe request ID work as in start(); a region
   * has no annotation ID, so the request is known by its source, page, kind and region.
   */
  startRegion(projectId: string, input: RegionStart, options: { destination?: Destination; take?: string } = {}): Promise<ShareCardRecord> {
    const { sourceId, page, region, text, kind } = input
    const box = [region.x1, region.y1, region.x2, region.y2].map(value => value.toFixed(4)).join(',')
    return startOnce(projectId, `${projectId}:${kind}:${sourceId}:${page}:${box}`, { source_id: sourceId, page, region, text, kind }, options)
  },
  /**
   * Starts a carousel from 2 to SET.maxItems highlights of one PDF, in the reader's order. Destination, take and the
   * reload-safe request ID work as in start(); a set is known by its source and its highlights in order.
   */
  startSet(projectId: string, input: SetStart, options: { destination?: Destination; take?: string } = {}): Promise<ShareCardRecord> {
    const { sourceId, annotationIds } = input
    return startOnce(projectId, `${projectId}:set:${sourceId}:${annotationIds.join(',')}`, { source_id: sourceId, annotation_ids: annotationIds, kind: 'set' }, options)
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
  /** One carousel highlight slide's crop, by the index of its highlight (SlideSpec's `item`); null is automatic. */
  cropSlide: (projectId: string, id: string, slide: number, crop: PageRect | null) => patch(projectId, id, { crop, slide }),
  /** One carousel slide's words; an empty study or limitations removes that slide. The cover uses editHeadline. */
  editSetText: (projectId: string, id: string, edit: SetTextEdit) => patch(projectId, id, { set_text: edit }),
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
