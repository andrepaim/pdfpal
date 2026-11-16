// The Post tab: one post, or the list of this source's posts with "Share a region" and "Share the paper". A post
// starts from a highlight, a region of a page, or the paper as a whole. Its image is the PDF's own page with the reader's
// highlights, and its text is built around the reader's take, written for one destination.
// Top to bottom: destination, image, take, text, actions. Only the destination, the take and "Ask for a change"
// call the assistant; everything else is drawn locally or saved as a setting. See docs/share-posts-plan.md.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  ANGLES, ANGLE_NAMES, CARD, DESTINATIONS, DESTINATION_DEFAULTS, DESTINATION_NAMES, LOOKS, LOOK_NAMES, STYLE_NAMES, TAKE_MAX, TEXT_CARD_STYLES,
  captionText, cardDescription, collapse, firstCommentText, isActive,
  type Angle, type CardSize, type Destination, type PageMark, type PageRect, type ShareCardRecord, type ShareCardSummary, type ShareLook, type ShareStyle,
} from '../../../src/shared/share-card'
import { rememberDestination, shareCardApi, watchShareCard, type ShareCardChange } from '../lib/share-card-api'
import { cardSheetSpace, canvasPng, renderCard, palette } from '../lib/share-card'
import { PAGE_UNAVAILABLE, pageCrop, type PageCrop, type PageUnavailable } from '../lib/share-card/page-crop'
import { cropBox } from '../lib/share-card/crop-box'
import CropEditor from './CropEditor'
import RegionPicker, { readFirstPage, type RegionChoice } from './RegionPicker'
import HighlightChooser, { eligibleHighlights, type ChooserHighlight } from './HighlightChooser'
import { SlideEditDialog, SlideViewer, slideName, useSlides } from './SlideViewer'
import { carouselFileName, slideFileName, slidesPdf, slidesZip } from '../lib/share-card/export'
import { ChoiceRow, Modal, PostMenu, Switch, alert, button, faded, field, heading, muted, primary } from './SharePostParts'

export const IMAGE_COPIED = 'Image copied. Paste it into your post.'
export const CAPTION_COPIED = 'Caption copied.'
export const FIRST_COMMENT_COPIED = 'First comment copied. Paste it under your post.'
export const COPY_UNAVAILABLE = "Copying isn't available here. Use Save image."
export const SLIDE_COPIED = 'Slide copied. Paste it into your post.'
export const TOO_TALL_HINT = 'This highlight is too tall for an automatic crop. Adjust the crop to show part of it.'
export const PDF_HINT = 'LinkedIn takes the PDF as a document post: one page per slide.'
/** What X allows in one post, and what it counts any link as. */
export const X_LIMIT = 280
const X_LINK = 23

type Props = {
  projectId: string
  /** The open post, or null for the list of posts. */
  postId: string | null
  /** Lists this source's posts when no post is open; otherwise the project's. */
  sourceId?: string
  /** A message from starting a post that did not begin, such as a passage that is too short. */
  notice?: string | null
  /** The page being read. With `sourceId`, the post list offers "Share a region" on it and "Share the paper". */
  currentPage?: number
  /** The reader's highlights on a page, shown while choosing a region. */
  marksOn?: (page: number) => PageMark[]
  /** The open PDF's highlights. With two or more that can make a post, the list offers "Share several highlights". */
  highlights?: ChooserHighlight[]
  onOpen: (id: string | null) => void
  /** Called when a post is created, finishes, changes its headline or is deleted, so lists and marks refresh. */
  onChanged?: () => void
}

type Dialog = 'change' | 'caption' | 'headline' | 'quote' | 'credit' | 'delete'
type Shown = { key: string; url: string; alt: string; style: ShareStyle; look: ShareLook; width: number; height: number; crop?: PageCrop }
type Message = { text: string; undo?: boolean }

const slug = (text: string) => text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '') || 'post'
export const cardFileName = (title: string, page: number, style: ShareStyle, size: CardSize) => `pdfpal-${slug(title)}-p${page}-${style}${size === 'story' ? '-story' : ''}.png`

/** The length X counts: characters, with every link as 23. */
export const xLength = (text: string) => [...text.replace(/https?:\/\/\S+/giu, 'x'.repeat(X_LINK))].length

const PICTURED: ReadonlySet<ShareStyle> = new Set(['page', 'headline'])
const WHOLE_PAGE: PageRect = { x1: 0, y1: 0, x2: 1, y2: 1 }
/** The empty takeaway slide "Add a takeaway" edits, for a post made before posts had one. */
const NEW_TAKEAWAY = { kind: 'takeaway', kicker: 'The takeaway', text: '' } as const
/** Where the crop editor starts when there is no crop to start from: the highlight's own lines, else the whole page. */
const startingCrop = (rects: PageRect[]) => rects.length ? cropBox(rects, 0) : WHOLE_PAGE
/** True for a post made from a region or the first page; a stored source without a kind is a highlight's. */
const fromRegion = (kind: string | undefined) => kind === 'region' || kind === 'paper'
/** What a post without a highlight started from, in the post lists. */
export const KIND_LABELS: Record<'region' | 'paper' | 'set', string> = { region: 'Region', paper: 'Paper', set: 'Carousel' }
/** The label a post list shows for what a post started from, or '' for a highlight. */
export const kindLabel = (kind: string | undefined) => kind === 'region' || kind === 'paper' || kind === 'set' ? KIND_LABELS[kind] : ''
/** What Page and Headline are drawn as without the PDF page. */
const FALLBACK: Partial<Record<ShareStyle, ShareStyle>> = { page: 'quote', headline: 'idea' }

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a'); link.href = url; link.download = name
  document.body.appendChild(link); link.click(); link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return }
  catch { /* Fall back to a selection copy, which needs no clipboard permission. */ }
  const area = document.createElement('textarea')
  area.value = text; area.setAttribute('readonly', ''); area.style.position = 'fixed'; area.style.opacity = '0'
  document.body.appendChild(area); area.select()
  const copied = document.execCommand('copy')
  area.remove()
  if (!copied) throw new Error(COPY_UNAVAILABLE)
}

/** The card's words without its style and look: one rendered picture per version, style, look and size. */
const versionKey = (record: ShareCardRecord) => {
  const { style: _style, look: _look, ...words } = record.card!
  return JSON.stringify([words, record.source.title, record.source.credit, record.source.page, record.source.color])
}

/** Whether two boxes are the same to four decimals, as the browser tests and the crop attribute compare them. */
const sameBox = (a: PageRect | null, b: PageRect | null) => !!a && !!b && cropText(a) === cropText(b)
const cropText = (box: PageRect) => [box.x1, box.y1, box.x2, box.y2].map(value => value.toFixed(4)).join(',')

type ListProps = {
  projectId: string; sourceId?: string; notice?: string | null; currentPage?: number; marksOn?: (page: number) => PageMark[]; highlights?: ChooserHighlight[]
  onOpen: (id: string) => void; onChanged?: () => void
}

function PostList({ projectId, sourceId, notice, currentPage, marksOn, highlights = [], onOpen, onChanged }: ListProps) {
  const [posts, setPosts] = useState<ShareCardSummary[] | null>(null)
  const [error, setError] = useState('')
  const [choosing, setChoosing] = useState(false)
  // Set at once on a click, before React re-renders, so a double click starts one post.
  const startingRef = useRef(false)
  const [choosingSet, setChoosingSet] = useState(false)
  const [chosen, setChosen] = useState<string[]>([])
  const [starting, setStarting] = useState(false)
  const [failure, setFailure] = useState('')
  useEffect(() => {
    let live = true
    shareCardApi.list(projectId, sourceId).then(list => { if (live) setPosts(list) }).catch(e => { if (live) setError((e as Error).message) })
    return () => { live = false }
  }, [projectId, sourceId])
  const fileUrl = sourceId ? `/api/projects/${encodeURIComponent(projectId)}/sources/${encodeURIComponent(sourceId)}/file` : null
  const canChoose = !!fileUrl && !!sourceId && !!currentPage
  const eligible = useMemo(() => eligibleHighlights(highlights), [highlights])
  const canSet = !!fileUrl && !!sourceId && eligible.length >= 2
  const busy = starting || choosing
  const chooseRegion = () => { if (!busy && !startingRef.current) { setFailure(''); setChoosing(true) } }
  const createSet = async (ids: string[]) => {
    if (startingRef.current) return
    startingRef.current = true
    setChoosingSet(false); setStarting(true); setFailure('')
    try {
      const record = await shareCardApi.startSet(projectId, { sourceId: sourceId!, annotationIds: ids })
      setChosen([])
      onChanged?.()
      onOpen(record.id)
    } catch (e) { setFailure((e as Error).message) }
    finally { startingRef.current = false; setStarting(false) }
  }
  /** Starts a region post from the chosen box, or a paper post from the first page's box, worked out with no modal. */
  const create = async (kind: 'region' | 'paper', choice?: RegionChoice) => {
    if (startingRef.current) return
    startingRef.current = true
    setChoosing(false); setStarting(true); setFailure('')
    try {
      const from = choice ?? await readFirstPage(fileUrl!)
      const record = await shareCardApi.startRegion(projectId, { sourceId: sourceId!, kind, ...from })
      onChanged?.()
      onOpen(record.id)
    } catch (e) { setFailure((e as Error).message) }
    finally { startingRef.current = false; setStarting(false) }
  }
  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <h2 style={{ fontSize: 14, margin: 0, color: '#e5e7eb' }}>Posts</h2>
      {(canChoose || canSet) && (
        <div role="group" aria-label="Start a post" aria-describedby="share-region-hint" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {canChoose && <button type="button" onClick={chooseRegion} aria-disabled={busy} style={faded({ ...button, flex: '1 1 140px' }, busy)}>Share a region</button>}
            {canChoose && <button type="button" onClick={() => { if (!busy) void create('paper') }} aria-disabled={busy} aria-busy={starting}
              style={faded({ ...button, flex: '1 1 140px' }, busy)}>Share the paper</button>}
            {canSet && <button type="button" onClick={() => { if (!busy && !startingRef.current) { setFailure(''); setChoosingSet(true) } }} aria-disabled={busy}
              style={faded({ ...button, flex: '1 1 140px' }, busy)}>Share several highlights</button>}
          </div>
          <span id="share-region-hint" style={muted}>{[
            canChoose ? `A figure or passage on page ${currentPage}` : '',
            canChoose ? 'the paper: its question, method and results' : '',
            canSet ? 'a carousel of your highlights' : '',
          ].filter(Boolean).map((part, index, parts) => index && index === parts.length - 1 ? `or ${part}` : part).join('; ').replace(/^a/u, 'A')}.</span>
          {canSet && <HighlightChooser open={choosingSet} highlights={eligible} chosen={chosen} onChange={setChosen}
            onCancel={() => setChoosingSet(false)} onCreate={ids => void createSet(ids)} />}
          {starting && <span role="status" style={{ ...muted, display: 'flex', alignItems: 'center', gap: 8 }}><span className="spinner" aria-hidden="true" /> Starting your post…</span>}
          {choosing && fileUrl && (
            <RegionPicker fileUrl={fileUrl} page={currentPage!} marks={marksOn?.(currentPage!)}
              onCancel={() => setChoosing(false)} onError={message => { setChoosing(false); setFailure(message) }}
              onCreate={choice => void create('region', choice)} />
          )}
          {failure && <p role="alert" style={alert}>{failure}</p>}
        </div>
      )}
      {notice && <p role="alert" style={alert}>{notice}</p>}
      {error && <p role="alert" style={alert}>{error}</p>}
      {posts === null && !error ? <span className="spinner" /> : posts?.length === 0
        ? <p style={{ ...muted, fontSize: 12 }}>Or click a highlight and choose Create post to share the page with your highlights and a text built around your take.</p>
        : posts?.map(post => (
          <button key={post.id} onClick={() => onOpen(post.id)} style={{ ...button, textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 3, padding: '9px 12px' }}>
            <span style={{ fontSize: 13, color: '#e5e7eb', fontWeight: 600, overflowWrap: 'anywhere' }}>{post.title}</span>
            <span style={muted}>{[
              `p. ${post.page}`,
              kindLabel(post.kind),
              post.status === 'complete' ? '' : post.status === 'failed' ? 'Couldn’t finish' : post.status === 'cancelled' ? 'Paused' : 'Writing…',
              kindLabel(post.kind) || post.annotation_id ? '' : 'Highlight deleted',
            ].filter(Boolean).join(' · ')}</span>
          </button>
        ))}
    </div>
  )
}

export default function SharePostPanel({ projectId, postId, sourceId, notice, currentPage, marksOn, highlights, onOpen, onChanged }: Props) {
  if (!postId) return <PostList projectId={projectId} sourceId={sourceId} notice={notice} currentPage={currentPage} marksOn={marksOn} highlights={highlights} onOpen={onOpen} onChanged={onChanged} />
  return <PostView key={postId} projectId={projectId} postId={postId} onOpen={onOpen} onChanged={onChanged} />
}

const section: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }

function PostView({ projectId, postId, onOpen, onChanged }: { projectId: string; postId: string; onOpen: (id: string | null) => void; onChanged?: () => void }) {
  const [record, setRecord] = useState<ShareCardRecord | null>(null)
  /** The latest failed check of the post: still being retried, or given up (offer Check again). */
  const [watchError, setWatchError] = useState<{ message: string; retrying: boolean; status?: number } | null>(null)
  const [poll, setPoll] = useState(0)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  const [message, setMessage] = useState<Message | null>(null)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [draft, setDraft] = useState('')
  const [desired, setDesired] = useState<{ style: ShareStyle; look: ShareLook } | null>(null)
  const [restyleFailure, setRestyleFailure] = useState('')
  const [shown, setShown] = useState<Shown | null>(null)
  const [drawError, setDrawError] = useState('')
  const [crop, setCrop] = useState<{ key: string; crop?: PageCrop; reason?: PageUnavailable } | null>(null)
  const [editingCrop, setEditingCrop] = useState(false)
  const [take, setTake] = useState('')
  const [cardsOpen, setCardsOpen] = useState(false)
  const changedRef = useRef(onChanged)
  changedRef.current = onChanged
  const last = useRef<{ status?: string; headline?: string; card?: boolean }>({})
  const cache = useRef(new Map<string, Shown>())
  const syncedTake = useRef<string | null>(null)

  // Polls while a generation runs; reports finished generations and new headlines to the lists.
  useEffect(() => watchShareCard(projectId, postId, next => {
    setRecord(next); setWatchError(null)
    const previous = last.current
    if (previous.status !== undefined && (previous.status !== next.status || previous.headline !== next.card?.headline)) changedRef.current?.()
    if (previous.status && isActive(previous.status as ShareCardRecord['status']) && next.status === 'complete')
      setMessage({ text: previous.card ? 'Your post was rewritten.' : 'Your post is ready.' })
    last.current = { status: next.status, headline: next.card?.headline, card: !!next.card }
  }, (error, state) => setWatchError({ message: error.message, ...state })), [projectId, postId, poll])
  const checkAgain = () => { setWatchError(null); setPoll(value => value + 1) }
  const watchNotice = watchError && (
    <div role="alert" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
      <span style={alert}>{watchError.retrying ? 'Couldn’t reach pdfpal to check on this post. Trying again…' : `pdfpal stopped checking on this post: ${watchError.message}`}</span>
      {!watchError.retrying && watchError.status !== 422 && watchError.status !== 404 && <button type="button" onClick={checkAgain} style={{ ...button, padding: '3px 10px' }}>Check again</button>}
    </div>
  )

  // Revoke cached pictures when the post closes. A picture finished after that is never given a URL (see renderJob).
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; for (const item of cache.current.values()) URL.revokeObjectURL(item.url); cache.current.clear() }
  }, [])

  const act = useCallback(async (action: () => Promise<ShareCardRecord | void>, options: { regenerates?: boolean; done?: Message } = {}) => {
    if (busy) return
    setBusy(true); setFailure(''); setMessage(null)
    try {
      const next = await action()
      if (next) { setRecord(next); last.current = { status: next.status, headline: next.card?.headline, card: !!next.card } }
      if (options.regenerates) setPoll(value => value + 1)
      if (options.done) setMessage(options.done)
      changedRef.current?.()
    } catch (error) { setFailure((error as Error).message) }
    finally { setBusy(false) }
  }, [busy])

  const card = record?.card ?? null
  const caption = record?.caption ?? null
  const active = record ? isActive(record.status) : false
  // The shown version's destination; while a rewrite runs, the picker shows the one asked for.
  const destination: Destination = caption?.destination ?? record?.destination ?? 'linkedin'
  const requested: Destination = record && (active || !caption) ? record.destination : destination
  const defaults = DESTINATION_DEFAULTS[destination]
  const version = record && card ? versionKey(record) : ''
  const fileUrl = record?.source_id ? `/api/projects/${encodeURIComponent(projectId)}/sources/${encodeURIComponent(record.source_id)}/file` : null
  const style: ShareStyle = desired?.style ?? card?.style ?? defaults.style
  const look: ShareLook = desired?.look ?? card?.look ?? 'ink'
  const pictured = PICTURED.has(style)
  const size: CardSize = style === 'page' ? defaults.size : 'feed'
  // A region or first-page post has only a headline and a topic: no quote, no takeaways, no text cards.
  const regionPost = fromRegion(record?.source.kind)
  // A carousel: its slides replace the single card, with their own crops and words.
  const isSet = record?.source.kind === 'set'
  // A single post in the Carousel style: its three cards (two without a takeaway) in the same viewer as a set's slides.
  const postCarousel = !isSet && style === 'carousel'
  const slideMode = isSet || postCarousel
  const carousel = useSlides(isSet || postCarousel ? record : null, look, fileUrl, postCarousel)
  const [addingTakeaway, setAddingTakeaway] = useState(false)
  const [editingSlide, setEditingSlide] = useState(false)
  const [slideCrop, setSlideCrop] = useState<{ item: number; page: number; value: PageRect } | null>(null)
  const [exporting, setExporting] = useState<{ what: string; done: number; total: number } | null>(null)

  // The stored choice has arrived: the shown choice no longer needs to lead it.
  useEffect(() => { if (desired && card && desired.style === card.style && desired.look === card.look) setDesired(null) }, [card, desired])

  // The take field follows the take of the shown version whenever that changes (a rewrite finished, or Undo).
  const shownTake = caption ? caption.take : record ? record.take : null
  useEffect(() => {
    if (shownTake === null || shownTake === syncedTake.current) return
    syncedTake.current = shownTake
    setTake(shownTake)
  }, [shownTake])

  // The page crop for Page and Headline. Its key is everything it is made from: the card's words (for the room the
  // sheet has), style, look and size, the reader's crop, the marks, the post's page and boxes, and the file. A check of
  // the post makes a new record object every second while a version is written, so the work is keyed by this, not by
  // the record: a crop in flight is never thrown away and started again, and each key's crop is made once.
  const cropKey = record && card && pictured && !isSet
    ? JSON.stringify([version, style, look, size, card.crop, record.marks, defaults.extraLines, fileUrl, record.source.page, record.source.rects, record.source.region]) : ''
  const cropJobs = useRef(new Map<string, Promise<{ crop?: PageCrop; reason?: PageUnavailable }>>())
  const makeCrop = useRef<() => Promise<PageCrop>>(() => Promise.reject(new Error('no-file')))
  if (record && card) {
    const content = { card, source: record.source }, extraLines = defaults.extraLines
    makeCrop.current = () => cardSheetSpace(content, { style, look, size })
      .then(sheet => pageCrop(fileUrl, record.source, { sheet, crop: card.crop, marks: record.marks, extraLines }))
  }
  useEffect(() => {
    if (!cropKey || crop?.key === cropKey) return
    let job = cropJobs.current.get(cropKey)
    if (!job) {
      job = makeCrop.current().then(result => ({ crop: result }), error => ({ reason: ((error as Error).message in PAGE_UNAVAILABLE ? (error as Error).message : 'no-file') as PageUnavailable }))
      cropJobs.current.set(cropKey, job)
      // Each crop holds a rendered page: keep the latest few.
      while (cropJobs.current.size > 6) cropJobs.current.delete(cropJobs.current.keys().next().value!)
    }
    let live = true
    void job.then(result => { if (live) setCrop({ key: cropKey, ...result }) })
    return () => { live = false }
  }, [cropKey, crop?.key])

  const cropReady = pictured && crop?.key === cropKey ? crop : null
  const unavailable: PageUnavailable | null = !record ? null : !fileUrl ? 'no-source' : cropReady?.reason ?? null
  // The style drawn: Page and Headline fall back to Quote and Big idea without the page. A region post has no quote,
  // so both fall back to Big idea, drawn from its headline.
  const drawn: ShareStyle = pictured && (unavailable === 'no-source' || cropReady?.reason) ? (regionPost ? 'idea' : FALLBACK[style]!) : style
  // Only an automatic crop can be too tall: the reader can still choose one, starting from the highlight's own lines.
  const tooTall = cropReady?.reason === 'too-tall' && !!fileUrl

  // Draws the preview, keeping the previous picture on screen while the next one renders. Keyed as the crop is, and
  // for the same reason; a picture finished after the post closed gets no URL, so nothing is left unrevoked.
  const renderKey = record && card && !slideMode && (!pictured || cropReady) ? (pictured ? cropKey : JSON.stringify([version, style, look, size])) : ''
  const renderJobs = useRef(new Map<string, Promise<Shown | null>>())
  const renderJob = useRef<(key: string) => Promise<Shown | null>>(() => Promise.resolve(null))
  if (record && card) {
    const content = { card, source: record.source }, pageImage = cropReady?.crop, drawnNow = drawn
    renderJob.current = key => renderCard(content, { style: drawnNow, look, size, crop: pageImage }).then(async canvas => {
      const drawnStyle = (canvas.dataset.style as ShareStyle | undefined) ?? drawnNow, { width, height } = canvas
      const blob = await canvasPng(canvas)
      canvas.width = 0
      if (!mounted.current) return null
      return { key, url: URL.createObjectURL(blob), alt: cardDescription(card, drawnStyle, record.source), style: drawnStyle, look, width, height,
        crop: PICTURED.has(drawnStyle) ? pageImage : undefined }
    })
  }
  useEffect(() => {
    if (!renderKey) return
    const cached = cache.current.get(renderKey)
    if (cached) { setShown(cached); return }
    let job = renderJobs.current.get(renderKey)
    if (!job) {
      const key = renderKey
      job = renderJob.current(key).then(item => {
        renderJobs.current.delete(key)
        if (!item) return null
        cache.current.set(key, item)
        // Full-size pictures are large: keep a few per post.
        while (cache.current.size > 8) {
          const oldest = cache.current.keys().next().value!
          if (oldest === key) break
          URL.revokeObjectURL(cache.current.get(oldest)!.url); cache.current.delete(oldest)
        }
        return item
      }, error => { renderJobs.current.delete(key); throw error })
      renderJobs.current.set(key, job)
    }
    let live = true
    job.then(item => { if (live && item) { setShown(item); setDrawError('') } }, error => { if (live) setDrawError((error as Error).message) })
    return () => { live = false }
  }, [renderKey])

  // A text card in use opens its disclosure.
  useEffect(() => { if ((TEXT_CARD_STYLES as readonly string[]).includes(drawn)) setCardsOpen(true) }, [drawn])

  const choose = async (next: { style: ShareStyle; look: ShareLook }) => {
    if (!record || active) return
    setDesired(next); setRestyleFailure('')
    try {
      const saved = await shareCardApi.restyle(projectId, record.id, next.style, next.look)
      setRecord(current => current && saved.updated_at >= current.updated_at ? saved : current)
    } catch (error) {
      setRestyleFailure((error as Error).message)
      setDesired(current => current && current.style === next.style && current.look === next.look ? null : current)
    }
  }

  /** The picture at `exportSize`, as drawn now: the preview's crop at its own size, a new crop for another. */
  const image = async (exportSize: CardSize): Promise<{ blob: Blob; style: ShareStyle }> => {
    if (!record || !card) throw new Error('This post has no completed version yet.')
    let pageImage: PageCrop | undefined
    if (pictured && !unavailable) {
      pageImage = exportSize === size && cropReady?.crop ? cropReady.crop
        : await cardSheetSpace({ card, source: record.source }, { style, look, size: exportSize })
          .then(sheet => pageCrop(fileUrl, record.source, { sheet, crop: card.crop, marks: record.marks, extraLines: defaults.extraLines }))
          .catch(() => undefined)
    }
    const canvas = await renderCard({ card, source: record.source }, { style: pageImage ? style : drawn, look, size: exportSize, crop: pageImage })
    return { blob: await canvasPng(canvas), style: (canvas.dataset.style as ShareStyle | undefined) ?? drawn }
  }

  /** The picture that Copy copies: the card at the destination's size, or the carousel's slide in view. */
  const picture = async () => slideMode ? canvasPng((await carousel.draw(carousel.index)).canvas) : (await image(size)).blob
  const copyImage = () => act(async () => {
    const desktop = window.pdfpalDesktop?.copyImage
    if (desktop) {
      const blob = await picture()
      await desktop(new Uint8Array(await blob.arrayBuffer())).catch(() => { throw new Error(COPY_UNAVAILABLE) })
      return
    }
    if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) throw new Error(COPY_UNAVAILABLE)
    // A promise keeps the click's permission to write while the card renders.
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': picture() })]).catch(() => { throw new Error(COPY_UNAVAILABLE) })
  }, { done: { text: slideMode ? SLIDE_COPIED : IMAGE_COPIED } })

  const carouselTitle = record?.source.title || 'post'
  const saveSlide = () => act(async () => {
    const blob = await picture()
    download(blob, slideFileName(carouselTitle, carousel.index + 1, carousel.slides.length))
  }, { done: { text: 'Slide saved.' } })
  /** Every slide, drawn afresh, as one ZIP of PNG files or one PDF. */
  const saveAll = (kind: 'zip' | 'pdf') => act(async () => {
    const what = kind === 'zip' ? 'ZIP' : 'PDF'
    let canvases: HTMLCanvasElement[] = []
    setExporting({ what, done: 0, total: carousel.slides.length })
    try {
      canvases = await carousel.drawAll((done, total) => setExporting({ what, done, total }))
      const blob = kind === 'zip' ? await slidesZip(canvases, carouselTitle) : await slidesPdf(canvases)
      download(blob, carouselFileName(carouselTitle, kind))
    } catch (error) {
      throw new Error(`The ${what} could not be made: ${(error as Error).message}`)
    } finally {
      for (const canvas of canvases) canvas.width = 0
      setExporting(null)
    }
  }, { done: { text: kind === 'zip' ? 'All slides saved as a ZIP.' : 'Carousel saved as a PDF.' } })

  /** Saves the words of the slide in view: the cover's headline, or one slide's text; an empty study or limits removes it. */
  const saveSlideText = (text: string) => {
    const slide = carousel.slide
    setEditingSlide(false)
    if (!record || !slide) return
    const removed = !text && (slide.kind === 'study' || slide.kind === 'limitations')
    const done = removed ? { text: `The ${slideName(slide).toLowerCase().replace(/^the /u, '')} slide was removed.`, undo: true } : { text: 'Slide saved.' }
    if (slide.kind === 'cover' || slide.kind === 'lead') void act(() => shareCardApi.editHeadline(projectId, record.id, text), { done })
    else if (slide.kind === 'page') return
    else if (slide.kind === 'question' || slide.kind === 'method') void act(() => shareCardApi.editPaperText(projectId, record.id, { field: slide.kind, text }), { done })
    else if (slide.kind === 'result') void act(() => shareCardApi.editPaperText(projectId, record.id, { field: 'result', index: slide.item ?? 0, text }), { done })
    else if (!isSet && slide.kind === 'takeaway') void act(() => shareCardApi.editTakeaway(projectId, record.id, text), { done })
    else if (slide.kind === 'point') void act(() => shareCardApi.editSetText(projectId, record.id, { field: 'point', index: slide.item, text }), { done })
    else if (slide.kind === 'study' || slide.kind === 'takeaway' || slide.kind === 'limitations') {
      const field = slide.kind
      void act(() => shareCardApi.editSetText(projectId, record.id, { field, text }), { done })
    }
  }

  const saveImage = (exportSize: CardSize) => act(async () => {
    const { blob, style: saved } = await image(exportSize)
    download(blob, cardFileName(record!.source.title || 'post', record!.source.page, saved, exportSize))
  }, { done: { text: exportSize === 'story' ? 'Story image saved.' : 'Image saved.' } })

  const text = record && caption ? captionText(record.source, caption) : ''
  const firstComment = record && caption && destination === 'linkedin' && caption.link === 'comment' ? firstCommentText(record.source) : ''
  const angles = caption ? ANGLES.filter(angle => caption.drafts[angle].trim()) : []
  const angle: Angle = caption && caption.drafts[caption.angle].trim() ? caption.angle : 'finding'
  const edited = caption?.edited !== null && caption?.edited !== undefined

  /** One request for new text. The shown version's destination and take are sent unless the change replaces them. */
  const rewrite = (change: ShareCardChange) => {
    if (!record) return
    void act(() => shareCardApi.change(projectId, record.id, { destination, take: caption?.take ?? record.take, ...change }), { regenerates: true })
  }
  const pickDestination = (next: Destination) => {
    if (!record || active || next === requested) return
    rememberDestination(next)
    rewrite({ destination: next, take: collapse(take) })
  }
  const takeChanged = collapse(take) !== (caption?.take ?? '')
  const pickAngle = (next: Angle) => {
    if (!record) return
    void act(() => shareCardApi.angle(projectId, record.id, next), edited ? { done: { text: 'Your edited text was replaced by the draft.', undo: true } } : {})
  }

  const open = (kind: Dialog) => {
    setDraft(kind === 'caption' ? text : kind === 'headline' ? card?.headline ?? '' : kind === 'quote' ? card?.quote ?? '' : kind === 'credit' ? record?.source.credit ?? '' : '')
    setDialog(kind)
  }
  const close = () => setDialog(null)
  const submit = () => {
    if (!record) return
    const kind = dialog, value = draft
    close()
    if (kind === 'change') rewrite({ instruction: value })
    else if (kind === 'caption') void act(() => shareCardApi.editCaption(projectId, record.id, value))
    else if (kind === 'headline') void act(() => shareCardApi.editHeadline(projectId, record.id, value))
    else if (kind === 'quote') void act(() => shareCardApi.editQuote(projectId, record.id, value))
    else if (kind === 'credit') void act(() => shareCardApi.editCredit(projectId, record.id, value))
    else if (kind === 'delete') void act(async () => { await shareCardApi.delete(projectId, record.id); onOpen(null) })
  }
  const undo = () => { if (record) void act(() => shareCardApi.undo(projectId, record.id), { done: { text: 'Back to the earlier version.' } }) }

  // Each look's swatch: its ground, with a dot in its accent.
  const swatches = useMemo(() => Object.fromEntries(LOOKS.map(option => {
    const colors = palette(option, record?.source.color ?? 'yellow', 1080, 1350)
    const ground = typeof colors.ground === 'string' ? colors.ground
      : `radial-gradient(circle at top right, ${colors.ground.stops.map(([at, tone]) => `${tone} ${at * 100}%`).join(', ')})`
    return [option, { ground, accent: colors.accent }]
  })) as Record<ShareLook, { ground: string; accent: string }>, [record?.source.color])

  if (!record) {
    // Not loaded yet, or it cannot be: a post an earlier build saved (422) can only be deleted.
    const unreadable = watchError?.status === 422
    return (
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start' }}>
        <button onClick={() => onOpen(null)} style={button}>← All posts</button>
        {!watchError ? <span className="spinner" /> : unreadable ? <p role="alert" style={alert}>{watchError.message}</p> : watchNotice}
        {unreadable && <button type="button" onClick={() => setDialog('delete')} disabled={busy} style={faded({ ...button, color: '#fca5a5' }, busy)}>Delete post</button>}
        {failure && <p role="alert" style={alert}>{failure}</p>}
        <Modal open={dialog === 'delete'} title="Delete this post?" onClose={() => setDialog(null)} actions={<>
          <button onClick={() => setDialog(null)} style={button}>Cancel</button>
          <button onClick={() => { setDialog(null); void act(async () => { await shareCardApi.delete(projectId, postId); onOpen(null) }) }} style={{ ...primary, background: '#b91c1c', borderColor: '#b91c1c' }}>Delete</button>
        </>}>
          <p style={{ fontSize: 13, margin: 0, color: '#d1d5db' }}>The PDF and your highlights will remain.</p>
        </Modal>
      </div>
    )
  }

  const working = !card ? 'Writing your post…'
    : record.destination !== destination ? `Rewriting for ${DESTINATION_NAMES[record.destination]}…`
    : record.take !== (caption?.take ?? '') ? (record.take ? 'Rewriting around your take…' : 'Rewriting without your take…')
    : 'Rewriting your post…'
  const pageTitle = unavailable ? PAGE_UNAVAILABLE[unavailable] : undefined
  const styleChoice = (option: ShareStyle) => ({
    value: option, label: STYLE_NAMES[option],
    disabled: PICTURED.has(option) && (unavailable === 'no-source' || (option === style && !!cropReady?.reason)),
    title: PICTURED.has(option) && (unavailable === 'no-source' || option === style) ? pageTitle : undefined,
  })
  const canAdjust = (PICTURED.has(drawn) && !!cropReady?.crop || tooTall) && !active
  const cropStart = card ? card.crop ?? cropReady?.crop?.box ?? startingCrop(record.source.rects) : WHOLE_PAGE
  const hasHeadline = drawn === 'headline' || drawn === 'idea'
  const ratio = shown ? `${shown.width} / ${shown.height}` : '1080 / 1350'
  const looksRow = (
      <div role="radiogroup" aria-label="Card look" style={{ display: 'flex', gap: 8 }}>
        {LOOKS.map(option => {
          const colors = swatches[option]!, selected = option === look
          return (
            <button key={option} type="button" role="radio" aria-checked={selected} aria-label={`${LOOK_NAMES[option]} look`} title={LOOK_NAMES[option]} disabled={active}
              onClick={() => void choose({ style: isSet ? 'headline' : style, look: option })}
              style={{ width: 32, height: 32, borderRadius: '50%', padding: 3, cursor: active ? 'default' : 'pointer', background: 'none', border: `${selected ? 2.5 : 1}px solid ${selected ? 'var(--accent)' : 'var(--border)'}`, opacity: active ? 0.45 : 1 }}>
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', borderRadius: '50%', background: colors.ground }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: colors.accent }} />
              </span>
            </button>
          )
        })}
      </div>
  )

  // ── A carousel's image area and export ──
  const slide = carousel.slide
  const slideShown = carousel.shown && carousel.shown.index === carousel.index ? carousel.shown : null
  const slideItem = slide?.kind === 'point' ? slide.item : null
  const slideTooTall = slideItem !== null && carousel.reason === 'too-tall'
  const canAdjustSlide = slideItem !== null && !!fileUrl && (!!slideShown?.crop || slideTooTall) && !active
  const slideCropIsYours = slideItem !== null && !!card?.set?.crops[slideItem]
  const carouselImage = isSet && card?.set ? (
    <div style={section}>
      {(active || record.status === 'failed' || record.status === 'cancelled') && <div style={{ ...muted, fontWeight: 600 }}>Your last completed version</div>}
      <SlideViewer slides={carousel.slides} index={carousel.index} onIndex={carousel.setIndex} shown={carousel.shown} />
      {carousel.drawError && <p role="alert" style={alert}>{carousel.drawError}</p>}
      {!fileUrl && <div style={{ ...muted, textAlign: 'center' }}>{PAGE_UNAVAILABLE['no-source']} Highlight slides show their claim without the page.</div>}
      {fileUrl && carousel.reason && <div style={{ ...muted, textAlign: 'center' }}>{carousel.reason === 'too-tall' ? TOO_TALL_HINT : `${PAGE_UNAVAILABLE[carousel.reason]} This slide shows its claim without the page.`}</div>}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          {!active && slide && <button type="button" onClick={() => setEditingSlide(true)} style={button}>Edit slide</button>}
          {canAdjustSlide && <button type="button" onClick={() => setSlideCrop({ item: slideItem!, page: record.source.items[slideItem!]!.page, value: card.set!.crops[slideItem!] ?? slideShown?.crop?.box ?? startingCrop(record.source.items[slideItem!]!.rects) })} style={button}>Adjust crop</button>}
          {canAdjustSlide && !slideTooTall && <span style={muted}>{slideCropIsYours ? 'Your crop' : 'Automatic crop'}</span>}
        </div>
        {looksRow}
      </div>
      {restyleFailure && <p role="alert" style={alert}>{restyleFailure}</p>}
    </div>
  ) : null
  const carouselExport = slideMode ? (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => void copyImage()} disabled={busy} style={{ ...primary, flex: 1, minWidth: 120 }}>Copy slide</button>
        <button type="button" onClick={() => void act(() => copyText(text), { done: { text: CAPTION_COPIED } })} disabled={busy || !text} style={{ ...primary, flex: 1, minWidth: 120 }}>Copy caption</button>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => void saveSlide()} disabled={busy} style={faded({ ...button, flex: 1, minWidth: 120 }, busy)}>Save slide</button>
        <button type="button" onClick={() => void saveAll('zip')} disabled={busy} style={faded({ ...button, flex: 1, minWidth: 120 }, busy)}>Save all slides (ZIP)</button>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" onClick={() => void saveAll('pdf')} disabled={busy} aria-describedby="share-pdf-hint" style={faded({ ...button, flex: '1 1 120px' }, busy)}>Save as PDF</button>
        <span id="share-pdf-hint" style={{ ...muted, flex: '2 1 160px' }}>{PDF_HINT}</span>
      </div>
      {exporting && (
        <span role="status" style={{ ...muted, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="spinner" aria-hidden="true" /> Drawing slides for the {exporting.what}… {exporting.done} of {exporting.total}
        </span>
      )}
    </div>
  ) : null

  // ── A single post in the Carousel style: the hook, the page, the takeaway ──
  // The page card, or a paper's lead (its headline above the first page), shows the post's own crop.
  const onPage = slide?.kind === 'page' || slide?.kind === 'lead'
  const pageShown = postCarousel && onPage && slideShown ? slideShown : null
  const pageReason = postCarousel && onPage ? carousel.reason : null
  const canAdjustPage = postCarousel && onPage && !!fileUrl && (!!pageShown?.crop || pageReason === 'too-tall') && !active
  const pageStart = card ? card.crop ?? pageShown?.crop?.box ?? startingCrop(record.source.rects) : WHOLE_PAGE
  const paperSlides = carousel.slides.some(each => each.kind === 'lead')
  const instead = paperSlides ? 'The first slide shows the headline without the page.' : `The page slide shows ${card?.quote ? 'the quote' : 'the headline'} instead.`
  const regionLabel = record.source.kind === 'paper' ? 'The title and abstract' : 'The region you chose'
  // A paper post stored before papers had their own slides: three cards, and one request to write them.
  const olderPaper = postCarousel && record.source.kind === 'paper' && !!card && !card.paper
  const postCarouselView = postCarousel && card ? <>
    <SlideViewer slides={carousel.slides} index={carousel.index} onIndex={carousel.setIndex} shown={carousel.shown} label={cardDescription(card, 'carousel', record.source)} />
    {carousel.drawError && <p role="alert" style={alert}>{carousel.drawError}</p>}
    {!fileUrl && <div style={{ ...muted, textAlign: 'center' }}>{PAGE_UNAVAILABLE['no-source']} {instead}</div>}
    {fileUrl && pageReason && <div style={{ ...muted, textAlign: 'center' }}>{pageReason === 'too-tall' ? TOO_TALL_HINT : `${PAGE_UNAVAILABLE[pageReason]} ${instead}`}</div>}
    {olderPaper && !active && (
      <div data-older-paper style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <span style={{ ...muted, flex: '1 1 200px' }}>This post was made before papers got their own slides. Rewrite it to add the question, method and results.</span>
        <button type="button" onClick={() => rewrite({})} disabled={busy} style={faded({ ...button, padding: '3px 10px' }, busy)}>Rewrite</button>
      </div>
    )}
  </> : null
  const postCarouselButtons = postCarousel && card && !active ? (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
      {slide && slide.kind !== 'page' && <button type="button" onClick={() => setEditingSlide(true)} style={button}>Edit slide</button>}
      {canAdjustPage && <button type="button" onClick={() => setEditingCrop(true)} style={button}>Adjust crop</button>}
      {canAdjustPage && pageReason !== 'too-tall' && <span style={muted}>{regionPost ? (sameBox(card.crop, record.source.region) ? regionLabel : 'Your crop') : card.crop ? 'Your crop' : 'Automatic crop'}</span>}
      {!card.takeaway && <button type="button" onClick={() => setAddingTakeaway(true)}
        style={{ background: 'none', border: 'none', padding: '4px 0', color: '#a5b4fc', fontSize: 12, cursor: 'pointer', textDecoration: 'underline' }}>Add a takeaway</button>}
    </div>
  ) : null
  const canEditCrop = postCarousel ? canAdjustPage : canAdjust
  const editorStart = postCarousel ? pageStart : cropStart

  return (
    <div data-share-post style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <button onClick={() => onOpen(null)} style={{ ...button, padding: '4px 10px' }} aria-label="All posts">←</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ fontSize: 14, margin: 0, color: '#e5e7eb', overflowWrap: 'anywhere' }}>{card?.headline || 'Post'}</h2>
          <div style={{ ...muted, overflowWrap: 'anywhere' }}>{[record.source.title, isSet ? `Carousel of ${record.source.items.length} highlights` : `p. ${record.source.page}`].filter(Boolean).join(' · ')}</div>
        </div>
        {record.can_undo && !active && <button onClick={undo} disabled={busy} aria-label="Undo last change" title="Undo last change" style={faded({ ...button, padding: '4px 10px' }, busy)}>↶ Undo</button>}
        <PostMenu items={[
          { label: 'Ask for a change…', onSelect: () => open('change'), disabled: busy || active },
          !!card && !regionPost && !isSet && { label: 'Edit quote', onSelect: () => open('quote'), disabled: active },
          { label: 'Edit credit', onSelect: () => open('credit') },
          { label: 'Delete post', onSelect: () => open('delete'), danger: true },
        ]} />
      </div>

      <div style={section}>
        <span aria-hidden="true" style={heading}>Destination</span>
        <ChoiceRow label="Destination" chooseOnArrow={false} disabled={active || busy} value={requested} onChoose={pickDestination}
          options={DESTINATIONS.map(option => ({ value: option, label: DESTINATION_NAMES[option] }))} />
      </div>

      {active && (
        <div role="status" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div className="share-progress" aria-hidden="true" style={{ height: 3, borderRadius: 2, background: '#26263a', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: '40%', background: 'var(--accent)', animation: 'share-progress 1.4s ease-in-out infinite' }} />
          </div>
          <style>{'@keyframes share-progress { 0% { margin-left: -40% } 100% { margin-left: 100% } }'}</style>
          <span style={{ fontSize: 13, color: '#e5e7eb' }}>{working}</span>
          <span style={muted}>You can keep reading. Your post will stay here.</span>
          <div><button onClick={() => void act(() => shareCardApi.cancel(projectId, record.id))} disabled={busy} style={faded(button, busy)}>Cancel</button></div>
        </div>
      )}
      {(record.status === 'failed' || record.status === 'cancelled') && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
          <p role="alert" style={alert}>{record.error || 'Creation paused. Your previous version is safe.'}</p>
          <button onClick={() => void act(() => shareCardApi.retry(projectId, record.id), { regenerates: true })} disabled={busy} style={faded(button, busy)}>Try again</button>
        </div>
      )}
      {failure && <p role="alert" style={alert}>{failure}</p>}
      {watchNotice}

      {card && caption && <>
        {isSet ? carouselImage : <div style={section}>
          {(active || record.status === 'failed' || record.status === 'cancelled') && <div style={{ ...muted, fontWeight: 600 }}>Your last completed version</div>}
          {postCarousel ? postCarouselView : <>
            <div style={{ width: '100%', maxWidth: 440, alignSelf: 'center', aspectRatio: ratio, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)', background: '#111114' }}>
              {shown && <img src={shown.url} alt={shown.alt} data-share-card={`${shown.style}/${shown.look}`} data-share-size={`${shown.width}x${shown.height}`}
                data-share-marks={shown.crop ? shown.crop.marks.length : undefined} data-share-crop={shown.crop ? cropText(shown.crop.box) : undefined}
                style={{ width: '100%', height: '100%', display: 'block' }} />}
            </div>
            {drawError && <p role="alert" style={alert}>{drawError}</p>}
            {tooTall && <div style={{ ...muted, textAlign: 'center' }}>{TOO_TALL_HINT}</div>}
            {unavailable && !tooTall && <div style={{ ...muted, textAlign: 'center' }}>{unavailable === 'no-source' ? 'Page and Headline aren’t available' : `${STYLE_NAMES[style]} isn’t available`}: {PAGE_UNAVAILABLE[unavailable]}</div>}
          </>}

          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <ChoiceRow label="Card style" disabled={active} value={drawn} onChoose={option => void choose({ style: option, look })}
              options={(['page', 'headline', 'carousel'] as ShareStyle[]).map(styleChoice)} />
            {looksRow}
          </div>
          {postCarousel ? postCarouselButtons : (canAdjust || (hasHeadline && !active)) && (
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
              {hasHeadline && !active && <button type="button" onClick={() => open('headline')} style={button}>Edit headline</button>}
              {canAdjust && <button type="button" onClick={() => setEditingCrop(true)} style={button}>Adjust crop</button>}
              {canAdjust && !tooTall && <span style={muted}>{regionPost ? (sameBox(card.crop, record.source.region) ? regionLabel : 'Your crop') : card.crop ? 'Your crop' : 'Automatic crop'}</span>}
            </div>
          )}
          {!regionPost && (
            <details open={cardsOpen} onToggle={event => setCardsOpen(event.currentTarget.open)} style={{ fontSize: 12, color: '#d1d5db' }}>
              <summary style={{ cursor: 'pointer', color: '#9ca3af', fontSize: 12 }}>Text cards</summary>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                <span style={muted}>Typeset words instead of the page.</span>
                <ChoiceRow label="Text card style" disabled={active} value={drawn} onChoose={option => void choose({ style: option, look })} compact
                  options={TEXT_CARD_STYLES.map(styleChoice)} />
              </div>
            </details>
          )}
          {restyleFailure && <p role="alert" style={alert}>{restyleFailure}</p>}
        </div>}

        <div style={section}>
          <label htmlFor="share-take" style={heading}>Your take</label>
          <textarea id="share-take" value={take} onChange={event => setTake(event.target.value.slice(0, TAKE_MAX))} rows={2} maxLength={TAKE_MAX} disabled={active}
            aria-describedby="share-take-hint" placeholder="What you think, in one line" style={{ ...field, resize: 'vertical', padding: 8 }} />
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <span id="share-take-hint" style={{ ...muted, flex: 1 }}>The drafts are built around your take, and it is quoted word for word.</span>
            <span style={{ ...muted, flexShrink: 0 }} aria-hidden="true">{take.length}/{TAKE_MAX}</span>
          </div>
          <div>
            <button type="button" onClick={() => rewrite({ take: collapse(take) })} disabled={busy || active || !takeChanged} style={faded(button, busy || active || !takeChanged)}>
              {!collapse(take) && caption.take ? 'Rewrite without a take' : 'Rewrite around my take'}
            </button>
          </div>
        </div>

        <div style={section}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h3 style={{ ...heading, flex: 1 }}>Caption</h3>
            {edited && <span style={muted}>Edited by you</span>}
            <button type="button" onClick={() => open('caption')} disabled={active} style={faded({ ...button, padding: '3px 10px' }, active)} aria-label="Edit caption">Edit</button>
          </div>
          {angles.length > 1 && (
            <ChoiceRow label="Draft angle" compact disabled={active || busy} value={edited ? null : angle} rechoose onChoose={pickAngle}
              options={angles.map(option => ({ value: option, label: ANGLE_NAMES[option] }))} />
          )}
          {edited && !active && (
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
              <span style={muted}>{angles.length > 1 ? 'Picking an angle replaces your edited text.' : 'You edited this text.'}</span>
              {angles.length <= 1 && <button type="button" onClick={() => pickAngle(angle)} disabled={busy} style={{ ...button, padding: '3px 10px' }}>Back to the draft</button>}
            </div>
          )}
          <p data-share-caption style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 13, lineHeight: 1.55, color: '#d1d5db', margin: 0, userSelect: 'text' }}>{text}</p>
          {destination === 'x' && (() => {
            const count = xLength(text), over = count > X_LIMIT
            return (
              <div data-x-count={count} role="note" aria-label={`${count} of ${X_LIMIT} characters, as X counts them`}
                style={{ ...muted, textAlign: 'right', color: over ? '#f87171' : '#9ca3af' }}>
                {count}/{X_LIMIT}{over ? ' · longer than X allows without a subscription' : ''}
              </div>
            )
          })()}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
            {destination !== 'x' && (
              <Switch label="Hashtags" checked={caption.showTags} disabled={active || busy || edited}
                onChange={value => void act(() => shareCardApi.showTags(projectId, record.id, value))} />
            )}
            {destination === 'linkedin' && record.source.url && (
              <ChoiceRow label="Where the link goes" compact disabled={active || busy || edited} value={caption.link}
                onChoose={value => void act(() => shareCardApi.link(projectId, record.id, value))}
                options={[{ value: 'post', label: 'Link in the post' }, { value: 'comment', label: 'Link in the first comment' }]} />
            )}
            {firstComment && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%', boxSizing: 'border-box', border: '1px dashed var(--border)', borderRadius: 8, padding: 10 }}>
                <span style={muted}>First comment</span>
                <p data-share-first-comment style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 12, color: '#d1d5db', margin: 0 }}>{firstComment}</p>
                <div><button type="button" onClick={() => void act(() => copyText(firstComment), { done: { text: FIRST_COMMENT_COPIED } })} disabled={busy} style={button}>Copy first comment</button></div>
              </div>
            )}
          </div>
        </div>

        {slideMode ? carouselExport : <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" onClick={() => void copyImage()} disabled={busy} style={{ ...primary, flex: 1, minWidth: 120 }}>Copy image</button>
            <button type="button" onClick={() => void act(() => copyText(text), { done: { text: CAPTION_COPIED } })} disabled={busy || !text} style={{ ...primary, flex: 1, minWidth: 120 }}>Copy caption</button>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" onClick={() => void saveImage(size)} disabled={busy} style={{ ...button, flex: 1, minWidth: 120 }}>Save image</button>
            {destination === 'instagram' && <button type="button" onClick={() => void saveImage('story')} disabled={busy} style={{ ...button, flex: 1, minWidth: 120 }}>Save Story (9:16)</button>}
          </div>
        </div>}
      </>}
      {!card && !active && record.status === 'complete' && <p style={muted}>This post has no card yet.</p>}

      <div aria-live="polite">
        {message && (
          <p style={{ color: '#86efac', fontSize: 12, margin: 0, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
            <span>{message.text}</span>
            {message.undo && record.can_undo && !active && <button type="button" onClick={undo} disabled={busy} style={{ ...button, padding: '2px 10px' }}>Undo</button>}
          </p>
        )}
      </div>

      {slideCrop && fileUrl && (
        <CropEditor fileUrl={fileUrl} page={slideCrop.page} value={slideCrop.value} marks={record.set_marks[slideCrop.item] ?? []}
          title={`Adjust crop: highlight ${slideCrop.item + 1}`}
          onCancel={() => setSlideCrop(null)}
          onApply={next => {
            const item = slideCrop.item
            setSlideCrop(null)
            void act(() => shareCardApi.cropSlide(projectId, record.id, item, next), { done: { text: next ? 'Crop saved.' : 'Back to the automatic crop.' } })
          }} />
      )}
      {slideMode && <SlideEditDialog open={editingSlide} slide={carousel.slide} index={carousel.index} count={carousel.slides.length}
        onCancel={() => setEditingSlide(false)} onSave={saveSlideText} />}
      {postCarousel && <SlideEditDialog open={addingTakeaway} slide={NEW_TAKEAWAY} index={carousel.slides.length} count={carousel.slides.length + 1} title="Add a takeaway"
        onCancel={() => setAddingTakeaway(false)}
        onSave={text => { setAddingTakeaway(false); void act(() => shareCardApi.editTakeaway(projectId, record.id, text), { done: { text: 'Takeaway added.' } }) }} />}
      {editingCrop && fileUrl && card && canEditCrop && (
        <CropEditor fileUrl={fileUrl} page={record.source.page} value={editorStart} marks={record.marks}
          resetLabel={regionPost ? 'Back to the original region' : undefined}
          onCancel={() => setEditingCrop(false)}
          onApply={next => {
            setEditingCrop(false)
            const done = next ? 'Crop saved.' : regionPost ? 'Back to the original region.' : 'Back to the automatic crop.'
            void act(() => shareCardApi.crop(projectId, record.id, next), { done: { text: done } })
          }} />
      )}

      <Modal open={dialog === 'change'} title="What should change?" onClose={close} actions={<>
        <button onClick={close} style={button}>Cancel</button>
        <button onClick={submit} disabled={!draft.trim()} style={primary}>Update</button>
      </>}>
        <textarea value={draft} onChange={event => setDraft(event.target.value.slice(0, 2000))} placeholder="Make it shorter…" rows={4} autoFocus aria-label="What should change?" style={field} />
      </Modal>
      <Modal open={dialog === 'caption'} title="Edit caption" onClose={close} actions={<>
        <button onClick={close} style={button}>Cancel</button>
        <button onClick={submit} disabled={!draft.trim()} style={primary}>Save</button>
      </>}>
        <textarea value={draft} onChange={event => setDraft(event.target.value.slice(0, 16_000))} rows={12} autoFocus aria-label="Caption" style={field} />
        {destination === 'x' && <div style={{ ...muted, textAlign: 'right', color: xLength(draft) > X_LIMIT ? '#f87171' : '#9ca3af' }}>{xLength(draft)}/{X_LIMIT}</div>}
      </Modal>
      <Modal open={dialog === 'headline'} title="Edit headline" onClose={close} actions={<>
        <button onClick={close} style={button}>Cancel</button>
        <button onClick={submit} disabled={!collapse(draft)} style={primary}>Save</button>
      </>}>
        <p style={{ ...muted, margin: '0 0 8px' }}>Your words above the page. Up to {CARD.headlineMax} characters.</p>
        <input value={draft} onChange={event => setDraft(event.target.value.slice(0, CARD.headlineMax))} maxLength={CARD.headlineMax} autoFocus aria-label="Headline" style={field} />
        <div style={{ ...muted, textAlign: 'right' }}>{draft.length}/{CARD.headlineMax}</div>
      </Modal>
      <Modal open={dialog === 'quote'} title="Edit quote" onClose={close} actions={<>
        <button onClick={close} style={button}>Cancel</button>
        <button onClick={submit} disabled={!draft.trim()} style={primary}>Save</button>
      </>}>
        <p style={{ ...muted, margin: '0 0 8px' }}>Fix words the PDF text got wrong. Keep the author’s meaning; the page is beside you to check.</p>
        <textarea value={draft} onChange={event => setDraft(event.target.value.slice(0, CARD.quoteMax))} rows={4} autoFocus aria-label="Quote" style={field} />
        <div style={{ ...muted, textAlign: 'right' }}>{draft.length}/{CARD.quoteMax}</div>
      </Modal>
      <Modal open={dialog === 'credit'} title="Edit credit" onClose={close} actions={<>
        <button onClick={close} style={button}>Cancel</button>
        <button onClick={submit} style={primary}>Save</button>
      </>}>
        <p style={{ ...muted, margin: '0 0 8px' }}>For example “Vaswani et al., 2017”. Later posts from this PDF start with it.</p>
        <input value={draft} onChange={event => setDraft(event.target.value.slice(0, CARD.creditMax))} autoFocus aria-label="Credit" style={field} />
      </Modal>
      <Modal open={dialog === 'delete'} title="Delete this post?" onClose={close} actions={<>
        <button onClick={close} style={button}>Cancel</button>
        <button onClick={submit} style={{ ...primary, background: '#b91c1c', borderColor: '#b91c1c' }}>Delete</button>
      </>}>
        <p style={{ fontSize: 13, margin: 0, color: '#d1d5db' }}>{regionPost || isSet ? 'The PDF and your highlights will remain.' : 'Your highlight will remain.'}</p>
      </Modal>
    </div>
  )
}
