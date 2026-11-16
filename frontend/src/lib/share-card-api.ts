import {
  DESTINATIONS, type Angle, type Row, type Stat, type Destination, type LinkPlacement, type PageRect, type ShareCardRecord, type ShareCardSummary, type ShareLook, type ShareStyle,
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

/**
 * A post as the panel reads it. The server fills the numbers of a stored post leniently, but the panel does not rely
 * on it: a missing key number is none, missing stats or rows are none, and a paper result stored as a plain sentence
 * is that sentence without numbers.
 */
export function readRecord(record: ShareCardRecord): ShareCardRecord {
  const card = record.card as (ShareCardRecord['card'] & Record<string, unknown>) | null
  if (!card) return record
  const paper = card.paper && {
    ...card.paper, methodStats: card.paper.methodStats ?? [],
    results: (card.paper.results ?? []).map(result => typeof result === 'string' ? { text: result, stat: null, rows: [] }
      : { ...result, stat: result.stat ?? null, rows: result.rows ?? [] }),
  }
  const set = card.set && { ...card.set, studyStats: card.set.studyStats ?? [] }
  return { ...record, card: { ...card, stat: card.stat ?? null, paper: paper ?? null, set: set ?? null } }
}
const postRecord = (url: string, init: { method?: string; body?: object } = {}) => request<ShareCardRecord>(url, init).then(readRecord)

/** Exactly one kind of edit per request (see the PATCH route in src/server/share-cards.ts). */
const patch = (projectId: string, id: string, body: object) => postRecord(`${base(projectId)}/${id}`, { method: 'PATCH', body })

/** What a carousel starts from: highlights of one PDF, in the order of their slides. */
export type SetStart = { sourceId: string; annotationIds: string[] }
/** One of a paper post's slides: `index` names a result, and only a result. */
export type PaperTextEdit = { field: 'question' | 'method' | 'result'; index?: number; text?: string; stats?: Stat[]; stat?: Stat | null; rows?: Row[] }
/** One carousel slide's words: `index` names a point, and only a point. */
export type SetTextEdit = { field: 'study' | 'takeaway' | 'limitations' | 'point'; index?: number; text?: string; stats?: Stat[] }

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
  const forget = () => { try { sessionStorage.removeItem(stored) } catch { /* As above. */ } }
  try {
    const record = await postRecord(base(projectId), { body: { request_id: requestId, ...body, destination, ...(take ? { take } : {}) } })
    forget()
    return record
  } catch (error) {
    // A refusal (4xx) is final: nothing started, or the ID is already spent (409), so sending it again is pointless and
    // would keep this start refused for the rest of the session. A lost answer or a server error keeps the ID: the
    // start may have happened, and the same ID returns it.
    if (definite(error)) forget()
    throw error
  }
}

/** True for an answer the server gave on purpose (4xx), as opposed to a lost connection, a timeout or a server error. */
export const definite = (error: unknown) => { const status = (error as { status?: number }).status; return typeof status === 'number' && status >= 400 && status < 500 }

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
  get: (projectId: string, id: string) => postRecord(`${base(projectId)}/${id}`),
  /** New text: an instruction, another destination, another take, or several of them, in one request. */
  change: (projectId: string, id: string, change: ShareCardChange) => postRecord(`${base(projectId)}/${id}/change`, { body: change }),
  retry: (projectId: string, id: string) => postRecord(`${base(projectId)}/${id}/retry`, { body: {} }),
  cancel: (projectId: string, id: string) => postRecord(`${base(projectId)}/${id}/cancel`, { body: {} }),
  undo: (projectId: string, id: string) => postRecord(`${base(projectId)}/${id}/undo`, { body: {} }),
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
  /** The post's key number, or null for none: drawn large on the hook of a highlight, region or set post; behind Undo. */
  editStat: (projectId: string, id: string, stat: Stat | null) => patch(projectId, id, { stat }),
  /** One of a paper post's slides: its question, method, or a result (`index` 0 or 1, for a result only); behind Undo. */
  editPaperText: (projectId: string, id: string, edit: PaperTextEdit) => patch(projectId, id, { paper_text: edit }),
  /** A single post's takeaway, the third card of the Carousel style: 1 to 140 characters, behind Undo. */
  editTakeaway: (projectId: string, id: string, takeaway: string) => patch(projectId, id, { takeaway }),
  editCaption: (projectId: string, id: string, caption: string) => patch(projectId, id, { caption }),
  editQuote: (projectId: string, id: string, quote: string) => patch(projectId, id, { quote }),
  editCredit: (projectId: string, id: string, credit: string) => patch(projectId, id, { credit }),
  delete: (projectId: string, id: string) => request<void>(`${base(projectId)}/${id}`, { method: 'DELETE' }),
}

/** How long to wait before checking again after the 1st, 2nd… failed check of a post; then the watch gives up. */
export const WATCH_RETRY_MS = [500, 1000, 2000, 4000] as const

/**
 * Polls a post once a second while a generation runs. A check that fails for a lost connection, a timeout or a server
 * error is tried again after WATCH_RETRY_MS; `onError` hears each failure with `retrying` true, and once more with
 * false when the watch gives up. A definite answer (404 for a deleted post, 422 for one an earlier build saved) stops
 * the watch at once. Returns a function that stops polling.
 */
export function watchShareCard(projectId: string, id: string, onRecord: (record: ShareCardRecord) => void,
  onError: (error: Error, state: { retrying: boolean; status?: number }) => void): () => void {
  let stopped = false, failures = 0, timer: ReturnType<typeof setTimeout> | undefined
  const tick = async () => {
    try {
      const record = await shareCardApi.get(projectId, id)
      if (stopped) return
      failures = 0
      onRecord(record)
      if (record.status === 'pending' || record.status === 'running') timer = setTimeout(tick, 1000)
    } catch (error) {
      if (stopped) return
      const status = (error as { status?: number }).status
      const delay = definite(error) ? undefined : WATCH_RETRY_MS[failures]
      failures++
      onError(error as Error, { retrying: delay !== undefined, status })
      if (delay !== undefined) timer = setTimeout(tick, delay)
    }
  }
  void tick()
  return () => { stopped = true; if (timer) clearTimeout(timer) }
}
