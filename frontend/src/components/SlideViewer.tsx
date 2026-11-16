// Slides in the Post tab: a carousel of several highlights (setSlides, "Stage 3" in docs/share-posts-plan.md) or one
// post drawn in the Carousel style (postSlides, "Stage 4"), drawn one at a time with renderSlide, a viewer that steps
// through them, and the dialog that edits one slide's words. Slides are drawn lazily, the one in view first and then
// its neighbours, and kept per slide, look and crop, so stepping through is instant and nothing is drawn twice. A slow
// drawing never replaces a newer one.
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { CARD, PAPER, SET, collapse, postSlides, setSlides, type PageRect, type ShareCardRecord, type ShareLook, type SlideSpec } from '../../../src/shared/share-card'
import { canvasPng } from '../lib/share-card'
import { PAGE_UNAVAILABLE, pageCrop, type PageCrop, type PageUnavailable } from '../lib/share-card/page-crop'
import { itemSource, renderSlide, slideSheetSpace, slideText, type SlideContext } from '../lib/share-card/slides'
import { Modal, button, faded, field, muted, primary } from './SharePostParts'

/** What each kind of slide is called in the viewer and the edit dialog. */
export const SLIDE_NAMES: Record<SlideSpec['kind'], string> = {
  cover: 'Cover', study: 'The study', point: 'Highlight', page: 'The page', takeaway: 'The takeaway', limitations: 'Limits',
  lead: 'The paper', question: 'The question', method: 'The method', result: 'The result',
}

/** A slide's name: "Cover", "Highlight 2", "The study", "Result 1"… A result is named by its kicker ("The result" alone). */
export const slideName = (slide: SlideSpec) => slide.kind === 'point' ? `Highlight ${slide.item + 1}` : slide.kind === 'result' ? slide.kicker || SLIDE_NAMES.result : SLIDE_NAMES[slide.kind]

/** What a screen reader hears for a slide: its place, its kind and its words. */
export const slideAlt = (slide: SlideSpec, index: number, count: number) => `Slide ${index + 1} of ${count}, ${slideName(slide).toLowerCase()}: ${slideText(slide)}`

/** The longest text a slide holds, and whether emptying it removes the slide. A page slide's words are not edited here. */
export const SLIDE_FIELDS: Record<Exclude<SlideSpec['kind'], 'page'>, { label: string; max: number; removable: boolean; required?: string }> = {
  cover: { label: 'Headline', max: CARD.headlineMax, removable: false },
  lead: { label: 'Headline', max: CARD.headlineMax, removable: false },
  question: { label: 'The question', max: PAPER.questionMax, removable: false },
  method: { label: 'The method', max: PAPER.methodMax, removable: false },
  result: { label: 'The result', max: PAPER.resultMax, removable: false, required: 'A result cannot be empty: a paper post keeps at least one.' },
  study: { label: 'The study', max: SET.studyMax, removable: true },
  point: { label: 'Claim', max: SET.pointMax, removable: false },
  takeaway: { label: 'The takeaway', max: Math.min(SET.takeawayMax, CARD.takeawayMax), removable: false },
  limitations: { label: 'Limits', max: SET.limitationsMax, removable: true },
}

export type DrawnSlide = { key: string; url: string; alt: string; style: string; look: ShareLook; index: number; crop?: PageCrop }
type CropResult = { crop?: PageCrop; reason?: PageUnavailable }

const reasonOf = (error: unknown): PageUnavailable => ((error as Error).message in PAGE_UNAVAILABLE ? (error as Error).message : 'no-file') as PageUnavailable
const cropText = (box: PageRect) => [box.x1, box.y1, box.x2, box.y2].map(value => value.toFixed(4)).join(',')

/**
 * A post's slides and their pictures: a set's always, any other post's when `carousel` (its style is Carousel). For
 * every other post, or no record, there are no slides and nothing is drawn.
 */
export function useSlides(record: ShareCardRecord | null, look: ShareLook, fileUrl: string | null, carousel = false) {
  const isSet = record?.source.kind === 'set' && !!record.card?.set
  const card = record?.card && (isSet || carousel) ? record.card : null
  const source = record?.source ?? null
  const slides = useMemo<SlideSpec[]>(() => !card || !source ? [] : isSet ? setSlides(card, source) : postSlides(card, source), [card, source, isSet])
  const [index, setIndex] = useState(0)
  const [shown, setShown] = useState<DrawnSlide | null>(null)
  const [drawError, setDrawError] = useState('')
  const [reasons, setReasons] = useState<Record<string, PageUnavailable>>({})
  const crops = useRef(new Map<string, Promise<CropResult>>())
  const pictures = useRef(new Map<string, DrawnSlide>())
  const wanted = useRef('')
  const count = slides.length
  const current = Math.min(index, Math.max(0, count - 1))

  // A removed slide can leave the index past the end: show the last one.
  useEffect(() => { if (count && index >= count) setIndex(count - 1) }, [count, index])
  // Revoke the pictures when the post closes. A picture finished after that is never given a URL (see picture).
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; for (const item of pictures.current.values()) URL.revokeObjectURL(item.url); pictures.current.clear() }
  }, [])

  const context = useCallback((at: number): SlideContext => ({
    source: { title: source!.title, credit: source!.credit, page: source!.page, color: source!.color },
    ...isSet ? { items: source!.items } : {}, number: at + 1, count,
  }), [source, count, isSet])

  /**
   * What a slide's crop depends on: its words and place (the room under them), the look, the crop and the marks. A
   * point slide crops its highlight's page; a page slide the post's own, as its single card would.
   */
  const cropKey = useCallback((at: number) => {
    const slide = slides[at]
    if (!slide || !card || !source || !record) return ''
    if (slide.kind === 'point')
      return JSON.stringify([slide, at, count, look, source.title, source.credit, source.items[slide.item], card.set!.crops[slide.item] ?? null, record.set_marks[slide.item] ?? [], fileUrl])
    if (slide.kind === 'page' || slide.kind === 'lead')
      return JSON.stringify([slide, at, count, look, source.title, source.credit, source.page, source.rects, source.region, card.crop, record.marks, fileUrl])
    return ''
  }, [slides, card, source, record, count, look, fileUrl])

  const pictureKey = useCallback((at: number) => {
    const slide = slides[at]
    if (!slide || !source) return ''
    return JSON.stringify([slide, at, count, look, source.title, source.credit, source.color, cropKey(at)])
  }, [slides, source, count, look, cropKey])

  const cropFor = useCallback((at: number): Promise<CropResult> => {
    const slide = slides[at], key = cropKey(at)
    if (!slide || (slide.kind !== 'point' && slide.kind !== 'page' && slide.kind !== 'lead') || !key || !card || !source || !record) return Promise.resolve({})
    let result = crops.current.get(key)
    if (!result) {
      const crop = (sheet: Awaited<ReturnType<typeof slideSheetSpace>>) => slide.kind === 'point'
        ? pageCrop(fileUrl, itemSource(source, source.items[slide.item]!), { sheet, crop: card.set!.crops[slide.item] ?? null, marks: record.set_marks[slide.item] ?? [], extraLines: 3 })
        : pageCrop(fileUrl, source, { sheet, crop: card.crop, marks: record.marks, extraLines: 3 })
      result = slideSheetSpace(slide, context(at), { look })
        .then(crop)
        .then(crop => ({ crop }), error => {
          const reason = reasonOf(error)
          setReasons(previous => previous[key] === reason ? previous : { ...previous, [key]: reason })
          return { reason }
        })
      crops.current.set(key, result)
      // Each crop holds a rendered page: keep the latest few.
      while (crops.current.size > 24) crops.current.delete(crops.current.keys().next().value!)
    }
    return result
  }, [slides, cropKey, card, source, record, context, look, fileUrl])

  /** Draws one slide on a new canvas, with its crop when it has one. */
  const draw = useCallback(async (at: number) => {
    const slide = slides[at]
    if (!slide) throw new Error('This carousel has no such slide.')
    const { crop } = await cropFor(at)
    const canvas = await renderSlide(slide, context(at), { look, crop })
    return { canvas, style: canvas.dataset.style ?? 'idea', crop }
  }, [slides, cropFor, context, look])

  /** The slide's picture, drawn once per key and kept; a drawing in flight is shared, so a key never gets two URLs. */
  const drawing = useRef(new Map<string, Promise<DrawnSlide>>())
  const picture = useCallback((at: number): Promise<DrawnSlide> => {
    const key = pictureKey(at)
    const cached = pictures.current.get(key)
    if (cached) return Promise.resolve(cached)
    let job = drawing.current.get(key)
    if (!job) {
      job = (async () => {
        const { canvas, style, crop } = await draw(at)
        const blob = await canvasPng(canvas)
        canvas.width = 0
        if (!mounted.current) throw new Error('The post was closed.')
        const item: DrawnSlide = { key, url: URL.createObjectURL(blob), alt: slideAlt(slides[at]!, at, count), style, look, index: at, crop: style === 'headline' || style === 'page' ? crop : undefined }
        pictures.current.set(key, item)
        while (pictures.current.size > 32) {
          const oldest = pictures.current.keys().next().value!
          if (oldest === key) break
          URL.revokeObjectURL(pictures.current.get(oldest)!.url); pictures.current.delete(oldest)
        }
        return item
      })().finally(() => drawing.current.delete(key))
      drawing.current.set(key, job)
    }
    return job
  }, [pictureKey, draw, slides, count, look])

  // The slide in view first; then its neighbours, so that stepping is instant.
  const key = count ? pictureKey(current) : ''
  useEffect(() => {
    if (!key) return
    wanted.current = key
    let live = true
    const cached = pictures.current.get(key)
    if (cached) setShown(cached)
    void (async () => {
      try {
        const item = cached ?? await picture(current)
        if (!live || wanted.current !== key) return
        setShown(item); setDrawError('')
        for (const next of [current + 1, current - 1]) {
          if (!live || next < 0 || next >= count) continue
          await picture(next).catch(() => {})
        }
      } catch (error) { if (live && wanted.current === key) setDrawError((error as Error).message) }
    })()
    return () => { live = false }
  }, [key, current, count, picture])

  /** Every slide, in order, drawn fresh for export; `progress` hears each one finished. */
  const drawAll = useCallback(async (progress: (done: number, total: number) => void) => {
    const canvases: HTMLCanvasElement[] = []
    for (let at = 0; at < count; at++) { canvases.push((await draw(at)).canvas); progress(at + 1, count) }
    return canvases
  }, [count, draw])

  const slide = slides[current] ?? null
  const reason = slide?.kind === 'point' || slide?.kind === 'page' || slide?.kind === 'lead' ? reasons[cropKey(current)] ?? null : null
  return {
    slides, index: current, setIndex, slide, shown,
    drawError, draw, drawAll, reason, cropOf: cropFor,
  }
}

type ViewerProps = {
  slides: SlideSpec[]
  index: number
  onIndex: (index: number) => void
  shown: DrawnSlide | null
  /** The viewer's accessible name: "Slides" for a set, the whole post's description for the Carousel style. */
  label?: string
}

/** The slide in view with Previous and Next; the arrow keys, Home and End step through when the viewer has focus. */
export function SlideViewer({ slides, index, onIndex, shown, label = 'Slides' }: ViewerProps) {
  const count = slides.length, slide = slides[index]
  const go = (next: number) => onIndex(Math.max(0, Math.min(count - 1, next)))
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[event.key]
    if (step) { event.preventDefault(); go(index + step) }
    else if (event.key === 'Home') { event.preventDefault(); go(0) }
    else if (event.key === 'End') { event.preventDefault(); go(count - 1) }
  }
  const position = `${index + 1} of ${count}`
  return (
    <div role="group" aria-roledescription="carousel" aria-label={label} data-slide-viewer tabIndex={0} onKeyDown={onKeyDown}
      style={{ display: 'flex', flexDirection: 'column', gap: 8, outlineOffset: 3, borderRadius: 8 }}>
      <div style={{ width: '100%', maxWidth: 440, alignSelf: 'center', aspectRatio: '1080 / 1350', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)', background: '#111114' }}>
        {shown && <img src={shown.url} alt={shown.alt} data-slide={shown.index + 1} data-slide-count={count} data-slide-kind={slides[shown.index]?.kind}
          data-share-card={`${shown.style}/${shown.look}`} data-share-marks={shown.crop ? shown.crop.marks.length : undefined}
          data-share-crop={shown.crop ? cropText(shown.crop.box) : undefined} style={{ width: '100%', height: '100%', display: 'block' }} />}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <button type="button" onClick={() => go(index - 1)} aria-disabled={index === 0} aria-label="Previous slide" style={faded({ ...button, padding: '4px 12px' }, index === 0)}>‹ Previous</button>
        <span aria-live="polite" data-slide-position style={{ fontSize: 12, color: '#d1d5db', textAlign: 'center', minWidth: 0 }}>
          <span style={{ fontWeight: 600 }}>{position}</span>
          {slide && <span style={muted}> · {slideName(slide)}</span>}
        </span>
        <button type="button" onClick={() => go(index + 1)} aria-disabled={index === count - 1} aria-label="Next slide" style={faded({ ...button, padding: '4px 12px' }, index === count - 1)}>Next ›</button>
      </div>
    </div>
  )
}

/**
 * Edits the words of the slide in view: the cover's headline, or one slide's text within its limit. A page slide has
 * no words to edit (Adjust crop changes it). `title` replaces the dialog's title, as "Add a takeaway" does.
 */
export function SlideEditDialog({ open, slide, index, count, title, onSave, onCancel }: {
  open: boolean; slide: SlideSpec | null; index: number; count: number; title?: string; onSave: (text: string) => void; onCancel: () => void
}) {
  const [text, setText] = useState('')
  useEffect(() => { if (open && slide) setText(slideText(slide)) }, [open, slide])
  const spec = slide && slide.kind !== 'page' ? SLIDE_FIELDS[slide.kind] : null
  const words = collapse(text)
  const empty = !words, canSave = !!spec && (!empty || spec.removable) && words.length <= spec.max
  return (
    <Modal open={open && !!spec} title={title ?? (slide ? `Edit slide ${index + 1} of ${count}: ${slideName(slide)}` : 'Edit slide')} onClose={onCancel} actions={<>
      <button type="button" onClick={onCancel} style={button}>Cancel</button>
      <button type="button" onClick={() => { if (canSave) onSave(words) }} disabled={!canSave} style={faded(primary, !canSave)}>
        {empty && spec?.removable ? 'Remove slide' : 'Save'}
      </button>
    </>}>
      {slide && spec && <>
        <p id="slide-edit-hint" style={{ ...muted, margin: '0 0 8px' }}>
          Up to {spec.max} characters.{spec.removable ? ' Leave it empty to remove this slide; Undo brings it back.' : ''}
        </p>
        {empty && spec.required && <p role="note" style={{ fontSize: 12, color: '#fca5a5', margin: '0 0 8px' }}>{spec.required}</p>}
        <textarea value={text} onChange={event => setText(event.target.value.slice(0, spec.max))} maxLength={spec.max} rows={spec.max > 100 ? 4 : 2} autoFocus
          aria-label={spec.label} aria-describedby="slide-edit-hint" style={field} />
        <div style={{ ...muted, textAlign: 'right' }}>{text.length}/{spec.max}</div>
      </>}
    </Modal>
  )
}
