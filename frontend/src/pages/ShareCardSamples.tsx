// /dev/share-cards: the share-card sample matrix, for review and the browser test (frontend/e2e/share-cards.spec.ts).
// Hidden: loaded lazily and linked from nowhere. Every card is drawn, encoded as a PNG and shown as an image, so
// the page holds a hundred-odd small blobs instead of as many full-size canvases.
//
// Page and Headline frames (data-frame) crop a made-up paper page drawn here, through the same planCrop that
// pageCrop uses for a PDF. Text cards (data-sample) are the first build's matrix, unchanged.
import { useEffect, useState } from 'react'
import { LOOKS, type CardSize, type PageMark, type PageRect, type ShareLook, type ShareStyle } from '../../../src/shared/share-card'
import { canvasPng, cardSheetSpace, loadCardFonts, renderCard, type PageCrop } from '../lib/share-card'
import { planCrop } from '../lib/share-card/crop-box'
import { PAGE_FRAMES, SAMPLE_PAGE, SAMPLES, type PageFrame } from '../lib/share-card/samples'

type Result = { kind: 'frame' | 'sample'; name: string; url?: string; size?: string; error?: string }
const STYLES: ShareStyle[] = ['quote', 'idea', 'takeaways']
const SIZES: CardSize[] = ['feed', 'story']
/** Canvas pixels per PDF point for the made-up page: sharp at any crop the frames use. */
const PAGE_SCALE = 4

type Word = { text: string; x: number; width: number; baseline: number; size: number }

/** Draws SAMPLE_PAGE as a PDF page would render: white, black type, justified body text. */
function drawSamplePage(): { canvas: HTMLCanvasElement; find: (phrase: string) => PageRect[] } {
  const { width, height, margin } = SAMPLE_PAGE
  const canvas = document.createElement('canvas')
  canvas.width = width * PAGE_SCALE; canvas.height = height * PAGE_SCALE
  const ctx = canvas.getContext('2d')!
  ctx.scale(PAGE_SCALE, PAGE_SCALE)
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width, height)
  ctx.textBaseline = 'alphabetic'
  const column = width - 2 * margin
  const paragraphs: Array<{ words: Word[]; font: string }> = []
  let y = margin

  /** Lays out `text` in the column; justified unless `ragged`. Returns its words. */
  const block = (text: string, font: string, size: number, leading: number, color: string, ragged: boolean): Word[] => {
    ctx.font = font; ctx.fillStyle = color
    const space = ctx.measureText(' ').width
    const tokens = text.split(/\s+/u).map(word => ({ text: word, width: ctx.measureText(word).width }))
    const lines: Array<typeof tokens> = []
    let line: typeof tokens = [], used = 0
    for (const token of tokens) {
      if (line.length && used + space + token.width > column) { lines.push(line); line = []; used = 0 }
      used += (line.length ? space : 0) + token.width; line.push(token)
    }
    if (line.length) lines.push(line)
    const words: Word[] = []
    lines.forEach((items, index) => {
      const baseline = y + size
      const last = index === lines.length - 1
      const natural = items.reduce((sum, item) => sum + item.width, 0)
      const gap = !ragged && !last && items.length > 1 ? (column - natural) / (items.length - 1) : space
      let x = margin
      for (const item of items) {
        ctx.fillText(item.text, x, baseline)
        words.push({ text: item.text, x, width: item.width, baseline, size })
        x += item.width + gap
      }
      y += leading
    })
    return words
  }

  block(SAMPLE_PAGE.journal, '400 8px "Inter"', 8, 11, '#555555', true)
  y += 18
  block(SAMPLE_PAGE.title, '700 18px "Inter"', 18, 22, '#000000', true)
  y += 10
  block(SAMPLE_PAGE.authors, '400 11px "Newsreader"', 11, 14, '#000000', true)
  block(SAMPLE_PAGE.affiliations, 'italic 400 8.5px "Newsreader"', 8.5, 12, '#333333', true)
  const body = '400 10px "Newsreader"'
  for (const section of SAMPLE_PAGE.sections) {
    y += 14
    block(section.heading, '600 10.5px "Inter"', 10.5, 15, '#000000', true)
    y += 2
    paragraphs.push({ words: block(section.text, body, 10, 13.2, '#111111', false), font: body })
  }

  /** The phrase's boxes, one per line, as page fractions. */
  const find = (phrase: string): PageRect[] => {
    const wanted = phrase.split(/\s+/u)
    for (const { words, font } of paragraphs) for (let start = 0; start + wanted.length <= words.length; start++) {
      const run = words.slice(start, start + wanted.length)
      // A phrase may end before a word's punctuation ("better:").
      if (!run.every((word, index) => index === run.length - 1 ? word.text.startsWith(wanted[index]!) : word.text === wanted[index])) continue
      ctx.font = font
      const rects: PageRect[] = []
      for (const word of run) {
        const right = word.x + (word === run.at(-1) ? ctx.measureText(wanted.at(-1)!).width : word.width)
        const top = word.baseline - 0.82 * word.size, bottom = word.baseline + 0.26 * word.size
        const current = rects.at(-1)
        if (current && Math.abs(current.y1 * height - top) < 0.5) current.x2 = right / width
        else rects.push({ x1: word.x / width, y1: top / height, x2: right / width, y2: bottom / height })
      }
      return rects
    }
    throw new Error(`The sample page has no "${phrase}".`)
  }
  return { canvas, find }
}

/** A frame's page crop, cut from the made-up page as pageCrop renders a PDF page. */
async function frameCrop(frame: PageFrame, look: ShareLook, page: ReturnType<typeof drawSamplePage>) {
  const marks: PageMark[] = frame.marks.map(mark => ({ rects: page.find(mark.phrase), color: mark.color }))
  const own = marks[0]!
  const source = { ...frame.source, rects: own.rects, color: own.color }
  const sheet = await cardSheetSpace({ card: frame.card, source }, { style: frame.style, look, size: frame.size })
  const plan = planCrop(own, SAMPLE_PAGE, { sheet, crop: frame.crop, marks, extraLines: frame.extraLines })
  if (!plan) throw new Error('too-tall')
  const image = document.createElement('canvas')
  image.width = plan.width; image.height = plan.height
  const ctx = image.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  const { box } = plan, w = page.canvas.width, h = page.canvas.height
  ctx.drawImage(page.canvas, box.x1 * w, box.y1 * h, (box.x2 - box.x1) * w, (box.y2 - box.y1) * h, 0, 0, plan.width, plan.height)
  const crop: PageCrop = { image, width: plan.width, height: plan.height, box: plan.box, marks: plan.marks }
  return { source, crop }
}

export default function ShareCardSamples() {
  const [results, setResults] = useState<Result[]>([])
  const [done, setDone] = useState(false)
  useEffect(() => {
    let cancelled = false
    const urls: string[] = []
    const show = async (kind: Result['kind'], name: string, draw: () => Promise<HTMLCanvasElement>) => {
      let result: Result
      try {
        const canvas = await draw()
        const size = `${canvas.width}×${canvas.height}`
        const url = URL.createObjectURL(await canvasPng(canvas))
        canvas.width = 0
        urls.push(url)
        result = { kind, name, url, size }
      } catch (error) { result = { kind, name, error: error instanceof Error ? error.message : String(error) } }
      if (!cancelled) setResults(previous => [...previous, result])
    }
    void (async () => {
      await loadCardFonts()
      const page = drawSamplePage()
      for (const frame of PAGE_FRAMES) for (const look of LOOKS as readonly ShareLook[]) {
        if (cancelled) return
        await show('frame', `${frame.name}-${look}`, async () => {
          const { source, crop } = await frameCrop(frame, look, page)
          const canvas = await renderCard({ card: frame.card, source }, { style: frame.style, look, size: frame.size, crop })
          if (canvas.dataset.style !== frame.style) throw new Error(`Drawn as ${canvas.dataset.style}.`)
          return canvas
        })
      }
      for (const sample of SAMPLES) for (const style of STYLES) for (const look of LOOKS as readonly ShareLook[]) for (const size of SIZES) {
        if (cancelled) return
        await show('sample', `${sample.name}-${style}-${look}-${size}`, () => renderCard({ card: sample.card, source: sample.source }, { style, look, size }))
      }
      if (!cancelled) setDone(true)
    })()
    return () => { cancelled = true; urls.forEach(url => URL.revokeObjectURL(url)) }
  }, [])
  const section = (kind: Result['kind'], title: string) => {
    const items = results.filter(result => result.kind === kind)
    return (
      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 15, margin: '0 0 12px' }}>{title} ({items.length})</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
          {items.map(result => {
            // The browser test counts data-sample; the frames are marked apart so its count still holds.
            const attributes = kind === 'frame' ? { 'data-frame': result.name } : { 'data-sample': result.name }
            return (
              <figure key={result.name} {...attributes} data-fits={result.url ? 'true' : 'false'} style={{ margin: 0, width: 216 }}>
                {result.url ? <img src={result.url} alt={result.name} style={{ width: 216, display: 'block', borderRadius: 4 }} />
                  : <div role="alert" style={{ width: 216, height: 270, background: '#511', padding: 8 }}>{result.error}</div>}
                <figcaption style={{ fontSize: 11, marginTop: 4, wordBreak: 'break-all' }}>{result.name}{result.size ? ` · ${result.size}` : ''}</figcaption>
              </figure>
            )
          })}
        </div>
      </section>
    )
  }
  return (
    <main style={{ padding: 24, background: '#202024', minHeight: '100vh', color: '#eee', fontFamily: 'system-ui, sans-serif' }} data-samples-done={done ? 'true' : undefined}>
      <h1 style={{ fontSize: 18, marginBottom: 16 }}>Share card samples ({results.length}{done ? '' : '…'})</h1>
      {section('frame', 'Page and Headline')}
      {section('sample', 'Text cards')}
    </main>
  )
}
