// The Post tab: one post made from a highlight, or the list of this source's posts. Ported from PostResult and
// CardSection in DistillPod's PostEditorUi.kt. Styles and looks are drawn locally and never call the assistant.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import {
  CARD, LOOKS, LOOK_NAMES, STYLES, STYLE_NAMES, captionText, cardDescription, isActive,
  type CardSize, type ShareCardRecord, type ShareCardSummary, type ShareLook, type ShareStyle,
} from '../../../src/shared/share-card'
import { shareCardApi, watchShareCard } from '../lib/share-card-api'
import { cardSheetSpace, canvasPng, renderCard, palette } from '../lib/share-card'
import { PAGE_UNAVAILABLE, pageCrop, type PageCrop, type PageUnavailable } from '../lib/share-card/page-crop'

export const IMAGE_COPIED = 'Image copied. Paste it into your post.'
export const CAPTION_COPIED = 'Caption copied.'
export const COPY_UNAVAILABLE = "Copying isn't available here. Use Save image."

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

type Dialog = 'change' | 'caption' | 'quote' | 'credit' | 'delete'
type Shown = { key: string; url: string; alt: string }

const button: CSSProperties = { background: 'none', border: '1px solid var(--border)', color: '#d1d5db', borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }
const primary: CSSProperties = { ...button, background: 'var(--accent)', borderColor: 'var(--accent)', color: '#fff', fontWeight: 600 }
const muted: CSSProperties = { fontSize: 11, color: '#9ca3af' }

const slug = (text: string) => text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '') || 'post'
export const cardFileName = (title: string, page: number, style: ShareStyle, size: CardSize) => `pdfpal-${slug(title)}-p${page}-${style}${size === 'story' ? '-story' : ''}.png`

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

/** The card's words without its style and look: one rendered picture per version, style and look. */
const versionKey = (record: ShareCardRecord) => {
  const { style: _style, look: _look, ...words } = record.card!
  return JSON.stringify([words, record.source.title, record.source.credit, record.source.page, record.source.color])
}

function Modal({ open, title, onClose, children, actions }: { open: boolean; title: string; onClose: () => void; children?: ReactNode; actions: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])
  return (
    <dialog ref={ref} aria-label={title} onClose={onClose} onCancel={onClose} className="share-dialog"
      style={{ margin: 'auto', background: 'var(--panel)', color: '#e5e7eb', border: '1px solid var(--border)', borderRadius: 12, padding: 20, width: 'min(520px, 90vw)' }}>
      {open && <>
        <h2 style={{ fontSize: 15, margin: '0 0 12px' }}>{title}</h2>
        {children}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>{actions}</div>
      </>}
    </dialog>
  )
}

function PostMenu({ items }: { items: Array<{ label: string; onSelect: () => void; disabled?: boolean } | false> }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    root.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled])')?.focus()
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  const entries = items.filter((item): item is Exclude<typeof item, false> => !!item)
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); return }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const buttons = [...(root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ?? [])]
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    buttons[(index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus()
  }
  return (
    <div ref={root} style={{ position: 'relative' }} onKeyDown={onKeyDown}>
      <button ref={trigger} aria-haspopup="menu" aria-expanded={open} aria-label="More post actions" onClick={() => setOpen(value => !value)} style={{ ...button, padding: '4px 10px' }}>⋯</button>
      {open && (
        <div role="menu" style={{ position: 'absolute', right: 0, top: '100%', marginTop: 4, zIndex: 20, background: '#111114', border: '1px solid var(--border)', borderRadius: 8, padding: 4, minWidth: 200, boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
          {entries.map(item => (
            <button key={item.label} role="menuitem" disabled={item.disabled} onClick={() => { setOpen(false); trigger.current?.focus(); item.onSelect() }}
              style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', color: item.disabled ? '#4b5563' : '#e5e7eb', padding: '7px 10px', fontSize: 12, borderRadius: 6, cursor: item.disabled ? 'default' : 'pointer' }}
              onMouseEnter={event => { if (!item.disabled) event.currentTarget.style.background = '#1f1f27' }} onMouseLeave={event => { event.currentTarget.style.background = 'none' }}>
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

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
      {notice && <p role="alert" style={{ color: '#f87171', fontSize: 12, margin: 0 }}>{notice}</p>}
      {error && <p role="alert" style={{ color: '#f87171', fontSize: 12, margin: 0 }}>{error}</p>}
      {posts === null && !error ? <span className="spinner" /> : posts?.length === 0
        ? <p style={{ ...muted, fontSize: 12 }}>Click a highlight and choose Create post to make a card and caption to share.</p>
        : posts?.map(post => (
          <button key={post.id} onClick={() => onOpen(post.id)} style={{ ...button, textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 3, padding: '9px 12px' }}>
            <span style={{ fontSize: 13, color: '#e5e7eb', fontWeight: 600 }}>{post.title}</span>
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

function PostView({ projectId, postId, onOpen, onChanged }: { projectId: string; postId: string; onOpen: (id: string | null) => void; onChanged?: () => void }) {
  const [record, setRecord] = useState<ShareCardRecord | null>(null)
  const [loadError, setLoadError] = useState('')
  const [poll, setPoll] = useState(0)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  const [message, setMessage] = useState('')
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [draft, setDraft] = useState('')
  const [desired, setDesired] = useState<{ style: ShareStyle; look: ShareLook } | null>(null)
  const [restyleFailure, setRestyleFailure] = useState('')
  const [shown, setShown] = useState<Shown | null>(null)
  const [drawError, setDrawError] = useState('')
  const [page, setPage] = useState<{ key: string; crop?: PageCrop; reason?: PageUnavailable } | null>(null)
  const changedRef = useRef(onChanged)
  changedRef.current = onChanged
  const last = useRef<{ status?: string; headline?: string }>({})
  const cache = useRef(new Map<string, Shown>())

  // Polls while a generation runs; reports finished generations and new headlines to the lists.
  useEffect(() => watchShareCard(projectId, postId, next => {
    setRecord(next); setLoadError('')
    const previous = last.current
    if (previous.status !== undefined && (previous.status !== next.status || previous.headline !== next.card?.headline)) changedRef.current?.()
    last.current = { status: next.status, headline: next.card?.headline }
  }, error => setLoadError(error.message)), [projectId, postId, poll])

  // Revoke cached pictures when the post closes.
  useEffect(() => () => { for (const item of cache.current.values()) URL.revokeObjectURL(item.url); cache.current.clear() }, [])

  const act = useCallback(async (action: () => Promise<ShareCardRecord | void>, options: { regenerates?: boolean; done?: string } = {}) => {
    if (busy) return
    setBusy(true); setFailure(''); setMessage('')
    try {
      const next = await action()
      if (next) { setRecord(next); last.current = { status: next.status, headline: next.card?.headline } }
      if (options.regenerates) setPoll(value => value + 1)
      if (options.done) setMessage(options.done)
      changedRef.current?.()
    } catch (error) { setFailure((error as Error).message) }
    finally { setBusy(false) }
  }, [busy])

  const card = record?.card ?? null
  const active = record ? isActive(record.status) : false
  const version = record && card ? versionKey(record) : ''
  const fileUrl = record?.source_id ? `/api/projects/${encodeURIComponent(projectId)}/sources/${encodeURIComponent(record.source_id)}/file` : null
  const style: ShareStyle = desired?.style ?? card?.style ?? 'quote'
  const look: ShareLook = desired?.look ?? card?.look ?? 'ink'

  // The stored choice has arrived: the shown choice no longer needs to lead it.
  useEffect(() => { if (desired && card && desired.style === card.style && desired.look === card.look) setDesired(null) }, [card, desired])

  // Whether this post can have a Page card, and its crop for the feed size and current look.
  const pageKey = `${version}|${look}`
  useEffect(() => {
    if (!record || !card || page?.key === pageKey) return
    let live = true
    const content = { card, source: record.source }
    cardSheetSpace(content, { look, size: 'feed' })
      .then(sheet => pageCrop(fileUrl, record.source, sheet))
      .then(crop => { if (live) setPage({ key: pageKey, crop }) })
      .catch(error => { if (live) setPage({ key: pageKey, reason: ((error as Error).message in PAGE_UNAVAILABLE ? (error as Error).message : 'no-file') as PageUnavailable }) })
    return () => { live = false }
  }, [record, card, fileUrl, look, pageKey, page?.key])

  const pageReady = page?.key === pageKey ? page : null
  // A stored card that asks for Page is drawn as Quote while Page is unavailable.
  const drawn: ShareStyle = style === 'page' && (!pageReady || pageReady.reason) ? 'quote' : style

  // Draws the preview, keeping the previous picture on screen while the next one renders.
  useEffect(() => {
    if (!record || !card) return
    if (style === 'page' && !pageReady) return
    const key = `${version}|${drawn}|${look}`
    const cached = cache.current.get(key)
    if (cached) { setShown(cached); return }
    let live = true
    renderCard({ card, source: record.source }, { style: drawn, look, size: 'feed', crop: drawn === 'page' ? pageReady?.crop : undefined })
      .then(canvas => canvasPng(canvas))
      .then(blob => {
        const item = { key, url: URL.createObjectURL(blob), alt: cardDescription(card, drawn) }
        cache.current.set(key, item)
        // Feed-size pictures are large: keep a few per post.
        while (cache.current.size > 8) {
          const oldest = cache.current.keys().next().value!
          if (oldest === key) break
          URL.revokeObjectURL(cache.current.get(oldest)!.url); cache.current.delete(oldest)
        }
        if (live) { setShown(item); setDrawError('') }
      })
      .catch(error => { if (live) setDrawError((error as Error).message) })
    return () => { live = false }
  }, [record, card, version, drawn, look, style, pageReady])

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

  const image = async (size: CardSize): Promise<{ blob: Blob; style: ShareStyle }> => {
    if (!record || !card) throw new Error('This post has no completed version yet.')
    let crop: PageCrop | undefined
    if (drawn === 'page') crop = size === 'feed' && pageReady?.crop ? pageReady.crop
      : await pageCrop(fileUrl, record.source, await cardSheetSpace({ card, source: record.source }, { look, size })).catch(() => undefined)
    const content = { card, source: record.source }
    const canvas = await renderCard(content, { style: drawn, look, size, crop })
    return { blob: await canvasPng(canvas), style: (canvas.dataset.style as ShareStyle | undefined) ?? drawn }
  }

  const copyImage = () => act(async () => {
    const desktop = window.pdfpalDesktop?.copyImage
    if (desktop) {
      const { blob } = await image('feed')
      await desktop(new Uint8Array(await blob.arrayBuffer())).catch(() => { throw new Error(COPY_UNAVAILABLE) })
      return
    }
    if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) throw new Error(COPY_UNAVAILABLE)
    // A promise keeps the click's permission to write while the card renders.
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': image('feed').then(result => result.blob) })]).catch(() => { throw new Error(COPY_UNAVAILABLE) })
  }, { done: IMAGE_COPIED })

  const saveImage = (size: CardSize) => act(async () => {
    const { blob, style: saved } = await image(size)
    download(blob, cardFileName(record!.source.title || 'post', record!.source.page, saved, size))
  }, { done: size === 'story' ? 'Story image saved.' : 'Image saved.' })

  const caption = record?.caption ? captionText(record.source, record.caption) : ''
  const open = (kind: Dialog) => {
    setDraft(kind === 'caption' ? caption : kind === 'quote' ? card?.quote ?? '' : kind === 'credit' ? record?.source.credit ?? '' : '')
    setDialog(kind)
  }
  const close = () => setDialog(null)
  const submit = () => {
    if (!record) return
    const kind = dialog, text = draft
    close()
    if (kind === 'change') void act(() => shareCardApi.change(projectId, record.id, text), { regenerates: true })
    else if (kind === 'caption') void act(() => shareCardApi.editCaption(projectId, record.id, text))
    else if (kind === 'quote') void act(() => shareCardApi.editQuote(projectId, record.id, text))
    else if (kind === 'credit') void act(() => shareCardApi.editCredit(projectId, record.id, text))
    else if (kind === 'delete') void act(async () => { await shareCardApi.delete(projectId, record.id); onOpen(null) })
  }

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
        {loadError ? <p role="alert" style={{ color: '#f87171', fontSize: 12 }}>{loadError}</p> : <span className="spinner" />}
      </div>
    )
  }

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <button onClick={() => onOpen(null)} style={{ ...button, padding: '4px 10px' }} aria-label="All posts">←</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ fontSize: 14, margin: 0, color: '#e5e7eb', overflow: 'hidden', textOverflow: 'ellipsis' }}>{card?.headline || 'Post'}</h2>
          <div style={muted}>{[record.source.title, `p. ${record.source.page}`].filter(Boolean).join(' · ')}</div>
        </div>
        <PostMenu items={[
          !!card && { label: 'Save image', onSelect: () => void saveImage('feed'), disabled: busy },
          !!card && { label: 'Save as Story (9:16)', onSelect: () => void saveImage('story'), disabled: busy },
          !!card && { label: 'Edit caption', onSelect: () => open('caption'), disabled: active },
          !!card && { label: 'Edit quote', onSelect: () => open('quote'), disabled: active },
          { label: 'Edit credit', onSelect: () => open('credit') },
          record.can_undo && !active && { label: 'Undo last change', onSelect: () => void act(() => shareCardApi.undo(projectId, record.id)) },
          { label: 'Delete post', onSelect: () => open('delete') },
        ]} />
      </div>

      {active && (
        <div role="status" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div className="share-progress" aria-hidden="true" style={{ height: 3, borderRadius: 2, background: '#26263a', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: '40%', background: 'var(--accent)', animation: 'share-progress 1.4s ease-in-out infinite' }} />
          </div>
          <style>{'@keyframes share-progress { 0% { margin-left: -40% } 100% { margin-left: 100% } }'}</style>
          <span style={{ fontSize: 13, color: '#e5e7eb' }}>Writing your post…</span>
          <span style={muted}>You can keep reading. Your post will stay here.</span>
          <div><button onClick={() => void act(() => shareCardApi.cancel(projectId, record.id))} disabled={busy} style={button}>Cancel</button></div>
        </div>
      )}
      {(record.status === 'failed' || record.status === 'cancelled') && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
          <p role="alert" style={{ color: '#f87171', fontSize: 12, margin: 0 }}>{record.error || 'Creation paused. Your previous version is safe.'}</p>
          <button onClick={() => void act(() => shareCardApi.retry(projectId, record.id), { regenerates: true })} disabled={busy} style={button}>Try again</button>
        </div>
      )}
      {failure && <p role="alert" style={{ color: '#f87171', fontSize: 12, margin: 0 }}>{failure}</p>}

      {card && (
        <>
          {(active || record.status === 'failed') && <div style={{ ...muted, fontWeight: 600 }}>Your last completed version</div>}
          <div style={{ width: '100%', maxWidth: 440, flexShrink: 0, alignSelf: 'center', aspectRatio: '1080 / 1350', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)', background: '#111114' }}>
            {shown && <img src={shown.url} alt={shown.alt} data-share-card={shown.key.split('|').slice(-2).join('/')} style={{ width: '100%', height: '100%', display: 'block' }} />}
          </div>
          {drawError && <p role="alert" style={{ color: '#f87171', fontSize: 12, margin: 0 }}>{drawError}</p>}

          <div role="radiogroup" aria-label="Card style" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
            {STYLES.map(option => {
              const unavailable = option === 'page' && !!pageReady?.reason
              const selected = option === drawn
              return (
                <button key={option} role="radio" aria-checked={selected} disabled={active || unavailable || (option === 'page' && !pageReady)}
                  title={unavailable ? PAGE_UNAVAILABLE[pageReady!.reason!] : undefined}
                  onClick={() => void choose({ style: option, look })}
                  style={{ ...button, borderRadius: 16, padding: '5px 12px', background: selected ? '#1e1b4b' : 'none', borderColor: selected ? 'var(--accent)' : 'var(--border)', color: selected ? '#c7d2fe' : '#d1d5db', opacity: active || unavailable ? 0.45 : 1 }}>
                  {STYLE_NAMES[option]}
                </button>
              )
            })}
          </div>
          {pageReady?.reason && <div style={{ ...muted, textAlign: 'center' }}>Page isn’t available: {PAGE_UNAVAILABLE[pageReady.reason]}</div>}
          <div role="radiogroup" aria-label="Card look" style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            {LOOKS.map(option => {
              const colors = swatches[option]!, selected = option === look
              return (
                <button key={option} role="radio" aria-checked={selected} aria-label={`${LOOK_NAMES[option]} look`} title={LOOK_NAMES[option]} disabled={active}
                  onClick={() => void choose({ style, look: option })}
                  style={{ width: 40, height: 40, borderRadius: '50%', padding: 4, cursor: active ? 'default' : 'pointer', background: 'none', border: `${selected ? 2.5 : 1}px solid ${selected ? 'var(--accent)' : 'var(--border)'}`, opacity: active ? 0.45 : 1 }}>
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', borderRadius: '50%', background: colors.ground }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: colors.accent }} />
                  </span>
                </button>
              )
            })}
          </div>
          {restyleFailure && <p role="alert" style={{ color: '#f87171', fontSize: 12, margin: 0, textAlign: 'center' }}>{restyleFailure}</p>}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={() => void copyImage()} disabled={busy} style={{ ...primary, flex: 1 }}>Copy image</button>
            <button onClick={() => void act(() => copyText(caption), { done: CAPTION_COPIED })} disabled={busy || !caption} style={{ ...primary, flex: 1 }}>Copy caption</button>
            <button onClick={() => open('change')} disabled={busy || active} style={button}>Change</button>
          </div>
          {message && <p role="status" style={{ color: '#86efac', fontSize: 12, margin: 0 }}>{message}</p>}

          <h3 style={{ fontSize: 13, margin: '4px 0 0', color: '#e5e7eb' }}>Caption</h3>
          <p data-share-caption style={{ whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.55, color: '#d1d5db', margin: 0, userSelect: 'text' }}>{caption}</p>
        </>
      )}
      {!card && !active && record.status === 'complete' && <p style={muted}>This post has no card yet.</p>}

      <Modal open={dialog === 'change'} title="What should change?" onClose={close} actions={<>
        <button onClick={close} style={button}>Cancel</button>
        <button onClick={submit} disabled={!draft.trim()} style={primary}>Update</button>
      </>}>
        <textarea value={draft} onChange={event => setDraft(event.target.value.slice(0, 2000))} placeholder="Make it shorter…" rows={4} autoFocus aria-label="What should change?"
          style={{ width: '100%', boxSizing: 'border-box', background: 'var(--bg)', color: '#e5e7eb', border: '1px solid var(--border)', borderRadius: 8, padding: 10, fontSize: 13, fontFamily: 'inherit' }} />
      </Modal>
      <Modal open={dialog === 'caption'} title="Edit caption" onClose={close} actions={<>
        <button onClick={close} style={button}>Cancel</button>
        <button onClick={submit} disabled={!draft.trim()} style={primary}>Save</button>
      </>}>
        <textarea value={draft} onChange={event => setDraft(event.target.value.slice(0, 16_000))} rows={12} autoFocus aria-label="Caption"
          style={{ width: '100%', boxSizing: 'border-box', background: 'var(--bg)', color: '#e5e7eb', border: '1px solid var(--border)', borderRadius: 8, padding: 10, fontSize: 13, fontFamily: 'inherit' }} />
      </Modal>
      <Modal open={dialog === 'quote'} title="Edit quote" onClose={close} actions={<>
        <button onClick={close} style={button}>Cancel</button>
        <button onClick={submit} disabled={!draft.trim()} style={primary}>Save</button>
      </>}>
        <p style={{ ...muted, margin: '0 0 8px' }}>Fix words the PDF text got wrong. Keep the author’s meaning; the page is beside you to check.</p>
        <textarea value={draft} onChange={event => setDraft(event.target.value.slice(0, CARD.quoteMax))} rows={4} autoFocus aria-label="Quote"
          style={{ width: '100%', boxSizing: 'border-box', background: 'var(--bg)', color: '#e5e7eb', border: '1px solid var(--border)', borderRadius: 8, padding: 10, fontSize: 13, fontFamily: 'inherit' }} />
        <div style={{ ...muted, textAlign: 'right' }}>{draft.length}/{CARD.quoteMax}</div>
      </Modal>
      <Modal open={dialog === 'credit'} title="Edit credit" onClose={close} actions={<>
        <button onClick={close} style={button}>Cancel</button>
        <button onClick={submit} style={primary}>Save</button>
      </>}>
        <p style={{ ...muted, margin: '0 0 8px' }}>For example “Vaswani et al., 2017”. Later posts from this PDF start with it.</p>
        <input value={draft} onChange={event => setDraft(event.target.value.slice(0, CARD.creditMax))} autoFocus aria-label="Credit"
          style={{ width: '100%', boxSizing: 'border-box', background: 'var(--bg)', color: '#e5e7eb', border: '1px solid var(--border)', borderRadius: 8, padding: 10, fontSize: 13, fontFamily: 'inherit' }} />
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
