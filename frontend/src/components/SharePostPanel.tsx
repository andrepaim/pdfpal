// The Post tab: one post made from a highlight, or the list of this source's posts. A post is an image of the PDF's
// own page with the reader's highlights, and a text built around the reader's take, written for one destination.
// Top to bottom: destination, image, take, text, actions. Only the destination, the take and "Ask for a change"
// call the assistant; everything else is drawn locally or saved as a setting. See docs/share-posts-plan.md.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  ANGLES, ANGLE_NAMES, CARD, DESTINATIONS, DESTINATION_DEFAULTS, DESTINATION_NAMES, LOOKS, LOOK_NAMES, STYLE_NAMES, TAKE_MAX, TEXT_CARD_STYLES,
  captionText, cardDescription, collapse, firstCommentText, isActive,
  type Angle, type CardSize, type Destination, type PageRect, type ShareCardRecord, type ShareCardSummary, type ShareLook, type ShareStyle,
} from '../../../src/shared/share-card'
import { rememberDestination, shareCardApi, watchShareCard, type ShareCardChange } from '../lib/share-card-api'
import { cardSheetSpace, canvasPng, renderCard, palette } from '../lib/share-card'
import { PAGE_UNAVAILABLE, pageCrop, type PageCrop, type PageUnavailable } from '../lib/share-card/page-crop'
import CropEditor from './CropEditor'
import { ChoiceRow, Modal, PostMenu, Switch, alert, button, faded, field, heading, muted, primary } from './SharePostParts'

export const IMAGE_COPIED = 'Image copied. Paste it into your post.'
export const CAPTION_COPIED = 'Caption copied.'
export const FIRST_COMMENT_COPIED = 'First comment copied. Paste it under your post.'
export const COPY_UNAVAILABLE = "Copying isn't available here. Use Save image."
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

const cropText = (box: PageRect) => [box.x1, box.y1, box.x2, box.y2].map(value => value.toFixed(4)).join(',')

function PostList({ projectId, sourceId, notice, onOpen }: { projectId: string; sourceId?: string; notice?: string | null; onOpen: (id: string) => void }) {
  const [posts, setPosts] = useState<ShareCardSummary[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    shareCardApi.list(projectId, sourceId).then(list => { if (live) setPosts(list) }).catch(e => { if (live) setError((e as Error).message) })
    return () => { live = false }
  }, [projectId, sourceId])
  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <h2 style={{ fontSize: 14, margin: 0, color: '#e5e7eb' }}>Posts</h2>
      {notice && <p role="alert" style={alert}>{notice}</p>}
      {error && <p role="alert" style={alert}>{error}</p>}
      {posts === null && !error ? <span className="spinner" /> : posts?.length === 0
        ? <p style={{ ...muted, fontSize: 12 }}>Click a highlight and choose Create post to share the page with your highlights and a text built around your take.</p>
        : posts?.map(post => (
          <button key={post.id} onClick={() => onOpen(post.id)} style={{ ...button, textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 3, padding: '9px 12px' }}>
            <span style={{ fontSize: 13, color: '#e5e7eb', fontWeight: 600, overflowWrap: 'anywhere' }}>{post.title}</span>
            <span style={muted}>p. {post.page}{post.status === 'complete' ? '' : post.status === 'failed' ? ' · Couldn’t finish' : post.status === 'cancelled' ? ' · Paused' : ' · Writing…'}{post.annotation_id ? '' : ' · Highlight deleted'}</span>
          </button>
        ))}
    </div>
  )
}

export default function SharePostPanel({ projectId, postId, sourceId, notice, onOpen, onChanged }: Props) {
  if (!postId) return <PostList projectId={projectId} sourceId={sourceId} notice={notice} onOpen={onOpen} />
  return <PostView key={postId} projectId={projectId} postId={postId} onOpen={onOpen} onChanged={onChanged} />
}

const section: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }

function PostView({ projectId, postId, onOpen, onChanged }: { projectId: string; postId: string; onOpen: (id: string | null) => void; onChanged?: () => void }) {
  const [record, setRecord] = useState<ShareCardRecord | null>(null)
  const [loadError, setLoadError] = useState('')
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
    setRecord(next); setLoadError('')
    const previous = last.current
    if (previous.status !== undefined && (previous.status !== next.status || previous.headline !== next.card?.headline)) changedRef.current?.()
    if (previous.status && isActive(previous.status as ShareCardRecord['status']) && next.status === 'complete')
      setMessage({ text: previous.card ? 'Your post was rewritten.' : 'Your post is ready.' })
    last.current = { status: next.status, headline: next.card?.headline, card: !!next.card }
  }, error => setLoadError(error.message)), [projectId, postId, poll])

  // Revoke cached pictures when the post closes.
  useEffect(() => () => { for (const item of cache.current.values()) URL.revokeObjectURL(item.url); cache.current.clear() }, [])

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

  // The stored choice has arrived: the shown choice no longer needs to lead it.
  useEffect(() => { if (desired && card && desired.style === card.style && desired.look === card.look) setDesired(null) }, [card, desired])

  // The take field follows the take of the shown version whenever that changes (a rewrite finished, or Undo).
  const shownTake = caption ? caption.take : record ? record.take : null
  useEffect(() => {
    if (shownTake === null || shownTake === syncedTake.current) return
    syncedTake.current = shownTake
    setTake(shownTake)
  }, [shownTake])

  // The page crop for Page and Headline: it depends on the style, look and size, the reader's crop and the marks.
  const cropKey = record && card ? JSON.stringify([version, style, look, size, card.crop, record.marks, defaults.extraLines, fileUrl]) : ''
  useEffect(() => {
    if (!record || !card || !pictured || crop?.key === cropKey) return
    let live = true
    const content = { card, source: record.source }
    cardSheetSpace(content, { style, look, size })
      .then(sheet => pageCrop(fileUrl, record.source, { sheet, crop: card.crop, marks: record.marks, extraLines: defaults.extraLines }))
      .then(result => { if (live) setCrop({ key: cropKey, crop: result }) })
      .catch(error => { if (live) setCrop({ key: cropKey, reason: ((error as Error).message in PAGE_UNAVAILABLE ? (error as Error).message : 'no-file') as PageUnavailable }) })
    return () => { live = false }
  }, [record, card, pictured, style, look, size, cropKey, crop?.key, fileUrl, defaults.extraLines])

  const cropReady = pictured && crop?.key === cropKey ? crop : null
  const unavailable: PageUnavailable | null = !record ? null : !fileUrl ? 'no-source' : cropReady?.reason ?? null
  // The style drawn: Page and Headline fall back to Quote and Big idea without the page.
  const drawn: ShareStyle = pictured && (unavailable === 'no-source' || cropReady?.reason) ? FALLBACK[style]! : style

  // Draws the preview, keeping the previous picture on screen while the next one renders.
  useEffect(() => {
    if (!record || !card) return
    if (pictured && !cropReady) return
    const key = pictured ? cropKey : JSON.stringify([version, style, look, size])
    const cached = cache.current.get(key)
    if (cached) { setShown(cached); return }
    let live = true
    renderCard({ card, source: record.source }, { style, look, size, crop: cropReady?.crop })
      .then(async canvas => {
        const drawnStyle = (canvas.dataset.style as ShareStyle | undefined) ?? style
        const blob = await canvasPng(canvas)
        const item: Shown = { key, url: URL.createObjectURL(blob), alt: cardDescription(card, drawnStyle), style: drawnStyle, look, width: canvas.width, height: canvas.height,
          crop: PICTURED.has(drawnStyle) ? cropReady?.crop : undefined }
        cache.current.set(key, item)
        // Full-size pictures are large: keep a few per post.
        while (cache.current.size > 8) {
          const oldest = cache.current.keys().next().value!
          if (oldest === key) break
          URL.revokeObjectURL(cache.current.get(oldest)!.url); cache.current.delete(oldest)
        }
        if (live) { setShown(item); setDrawError('') }
      })
      .catch(error => { if (live) setDrawError((error as Error).message) })
    return () => { live = false }
  }, [record, card, version, style, look, size, pictured, cropReady, cropKey])

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
    const canvas = await renderCard({ card, source: record.source }, { style, look, size: exportSize, crop: pageImage })
    return { blob: await canvasPng(canvas), style: (canvas.dataset.style as ShareStyle | undefined) ?? drawn }
  }

  const copyImage = () => act(async () => {
    const desktop = window.pdfpalDesktop?.copyImage
    if (desktop) {
      const { blob } = await image(size)
      await desktop(new Uint8Array(await blob.arrayBuffer())).catch(() => { throw new Error(COPY_UNAVAILABLE) })
      return
    }
    if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) throw new Error(COPY_UNAVAILABLE)
    // A promise keeps the click's permission to write while the card renders.
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': image(size).then(result => result.blob) })]).catch(() => { throw new Error(COPY_UNAVAILABLE) })
  }, { done: { text: IMAGE_COPIED } })

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
    return (
      <div style={{ padding: 16 }}>
        <button onClick={() => onOpen(null)} style={{ ...button, marginBottom: 12 }}>← All posts</button>
        {loadError ? <p role="alert" style={alert}>{loadError}</p> : <span className="spinner" />}
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
  const canAdjust = PICTURED.has(drawn) && !!cropReady?.crop && !active
  const hasHeadline = drawn === 'headline' || drawn === 'idea'
  const ratio = shown ? `${shown.width} / ${shown.height}` : '1080 / 1350'

  return (
    <div data-share-post style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <button onClick={() => onOpen(null)} style={{ ...button, padding: '4px 10px' }} aria-label="All posts">←</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ fontSize: 14, margin: 0, color: '#e5e7eb', overflowWrap: 'anywhere' }}>{card?.headline || 'Post'}</h2>
          <div style={{ ...muted, overflowWrap: 'anywhere' }}>{[record.source.title, `p. ${record.source.page}`].filter(Boolean).join(' · ')}</div>
        </div>
        {record.can_undo && !active && <button onClick={undo} disabled={busy} aria-label="Undo last change" title="Undo last change" style={faded({ ...button, padding: '4px 10px' }, busy)}>↶ Undo</button>}
        <PostMenu items={[
          { label: 'Ask for a change…', onSelect: () => open('change'), disabled: busy || active },
          !!card && { label: 'Edit quote', onSelect: () => open('quote'), disabled: active },
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

      {card && caption && <>
        <div style={section}>
          {(active || record.status === 'failed' || record.status === 'cancelled') && <div style={{ ...muted, fontWeight: 600 }}>Your last completed version</div>}
          <div style={{ width: '100%', maxWidth: 440, alignSelf: 'center', aspectRatio: ratio, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)', background: '#111114' }}>
            {shown && <img src={shown.url} alt={shown.alt} data-share-card={`${shown.style}/${shown.look}`} data-share-size={`${shown.width}x${shown.height}`}
              data-share-marks={shown.crop ? shown.crop.marks.length : undefined} data-share-crop={shown.crop ? cropText(shown.crop.box) : undefined}
              style={{ width: '100%', height: '100%', display: 'block' }} />}
          </div>
          {drawError && <p role="alert" style={alert}>{drawError}</p>}
          {unavailable && <div style={{ ...muted, textAlign: 'center' }}>{unavailable === 'no-source' ? 'Page and Headline aren’t available' : `${STYLE_NAMES[style]} isn’t available`}: {PAGE_UNAVAILABLE[unavailable]}</div>}

          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <ChoiceRow label="Card style" disabled={active} value={drawn} onChoose={option => void choose({ style: option, look })}
              options={(['page', 'headline'] as ShareStyle[]).map(styleChoice)} />
            <div role="radiogroup" aria-label="Card look" style={{ display: 'flex', gap: 8 }}>
              {LOOKS.map(option => {
                const colors = swatches[option]!, selected = option === look
                return (
                  <button key={option} type="button" role="radio" aria-checked={selected} aria-label={`${LOOK_NAMES[option]} look`} title={LOOK_NAMES[option]} disabled={active}
                    onClick={() => void choose({ style, look: option })}
                    style={{ width: 32, height: 32, borderRadius: '50%', padding: 3, cursor: active ? 'default' : 'pointer', background: 'none', border: `${selected ? 2.5 : 1}px solid ${selected ? 'var(--accent)' : 'var(--border)'}`, opacity: active ? 0.45 : 1 }}>
                    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', borderRadius: '50%', background: colors.ground }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: colors.accent }} />
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
          {(canAdjust || (hasHeadline && !active)) && (
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
              {hasHeadline && !active && <button type="button" onClick={() => open('headline')} style={button}>Edit headline</button>}
              {canAdjust && <button type="button" onClick={() => setEditingCrop(true)} style={button}>Adjust crop</button>}
              {canAdjust && <span style={muted}>{card.crop ? 'Your crop' : 'Automatic crop'}</span>}
            </div>
          )}
          <details open={cardsOpen} onToggle={event => setCardsOpen(event.currentTarget.open)} style={{ fontSize: 12, color: '#d1d5db' }}>
            <summary style={{ cursor: 'pointer', color: '#9ca3af', fontSize: 12 }}>Text cards</summary>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
              <span style={muted}>Typeset words instead of the page.</span>
              <ChoiceRow label="Text card style" disabled={active} value={drawn} onChoose={option => void choose({ style: option, look })} compact
                options={TEXT_CARD_STYLES.map(styleChoice)} />
            </div>
          </details>
          {restyleFailure && <p role="alert" style={alert}>{restyleFailure}</p>}
        </div>

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

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" onClick={() => void copyImage()} disabled={busy} style={{ ...primary, flex: 1, minWidth: 120 }}>Copy image</button>
            <button type="button" onClick={() => void act(() => copyText(text), { done: { text: CAPTION_COPIED } })} disabled={busy || !text} style={{ ...primary, flex: 1, minWidth: 120 }}>Copy caption</button>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" onClick={() => void saveImage(size)} disabled={busy} style={{ ...button, flex: 1, minWidth: 120 }}>Save image</button>
            {destination === 'instagram' && <button type="button" onClick={() => void saveImage('story')} disabled={busy} style={{ ...button, flex: 1, minWidth: 120 }}>Save Story (9:16)</button>}
          </div>
        </div>
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

      {editingCrop && fileUrl && card && cropReady?.crop && (
        <CropEditor fileUrl={fileUrl} page={record.source.page} value={card.crop ?? cropReady.crop.box} marks={record.marks}
          onCancel={() => setEditingCrop(false)}
          onApply={next => { setEditingCrop(false); void act(() => shareCardApi.crop(projectId, record.id, next), { done: { text: next ? 'Crop saved.' : 'Back to the automatic crop.' } }) }} />
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
        <p style={{ fontSize: 13, margin: 0, color: '#d1d5db' }}>Your highlight will remain.</p>
      </Modal>
    </div>
  )
}
