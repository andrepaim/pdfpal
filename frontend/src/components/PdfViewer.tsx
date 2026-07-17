import { useState, useRef, useEffect } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'
import type { Annotation } from '../lib/api'

// Bundle the worker from the same pdfjs-dist version used by react-pdf.
// package.json pins pdfjs-dist to react-pdf's exact version (no "^"): pdfjs
// throws if the API and worker versions differ, and a caret range lets npm
// hoist a newer pdfjs-dist here than the one react-pdf bundles internally,
// silently breaking every render with "Failed to render page".
pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()

type PageRect = { x1: number; y1: number; x2: number; y2: number }

interface Props {
  url: string
  pages: number
  initialPage?: number
  isResizing?: boolean
  onPageChange?: (page: number) => void
  onTextSelected?: (text: string) => void
  annotations?: Annotation[]
  onHighlightCreate?: (data: { page_number: number; x1: number; y1: number; x2: number; y2: number; rects: PageRect[]; text: string; color: string }) => void
  onHighlightClick?: (annotation: Annotation) => void
}

const COLOR_MAP: Record<string, string> = {
  yellow: 'rgba(253,224,71,0.40)',
  green:  'rgba(74,222,128,0.40)',
  blue:   'rgba(96,165,250,0.40)',
  pink:   'rgba(244,114,182,0.40)',
}

// A highlight spanning multiple lines used to be drawn as a single box (the
// union of every line's rect), which visually expanded to cover whole lines
// that were only partially selected — e.g. selecting one full line plus half
// of the next made the highlight cover all of the second line too. Returning
// one rect per line (plus the union, kept for sorting/back-compat) lets the
// caller draw a highlight that hugs the actual selected text on each line.
function getSelectionPageRects(selection: Selection): { page: number; bbox: PageRect; rects: PageRect[] } | null {
  if (selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  // getClientRects() includes a zero-area rect for the <br> pdf.js inserts
  // between lines: since every text span is position:absolute (out of flow),
  // the <br> has no explicit left/top and collapses to the page's top-left
  // corner. Left in, that phantom rect drags the bounding box up to (0,0)
  // whenever a selection crosses a line break, ballooning the highlight to
  // cover the whole top-left of the page.
  const clientRects = Array.from(range.getClientRects()).filter(r => r.width > 0 && r.height > 0)
  if (clientRects.length === 0) return null
  const anchor = selection.anchorNode?.parentElement
  const pageEl = anchor?.closest('[data-page-number]') as HTMLElement | null
  if (!pageEl) return null
  const pageNum = parseInt(pageEl.getAttribute('data-page-number') || '0', 10)
  if (!pageNum) return null
  const pageRect = pageEl.getBoundingClientRect()
  if (pageRect.width === 0 || pageRect.height === 0) return null
  const rects = clientRects.map(r => ({
    x1: Math.max(0, (r.left   - pageRect.left) / pageRect.width),
    y1: Math.max(0, (r.top    - pageRect.top)  / pageRect.height),
    x2: Math.min(1, (r.right  - pageRect.left) / pageRect.width),
    y2: Math.min(1, (r.bottom - pageRect.top)  / pageRect.height),
  }))
  const bbox = {
    x1: Math.min(...rects.map(r => r.x1)), y1: Math.min(...rects.map(r => r.y1)),
    x2: Math.max(...rects.map(r => r.x2)), y2: Math.max(...rects.map(r => r.y2)),
  }
  return { page: pageNum, bbox, rects }
}

const ZOOM_LEVELS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0]

function normalizePage(page: number | undefined): number {
  return Number.isInteger(page) && Number(page) > 0 ? Number(page) : 1
}

// Module-level constant so react-pdf's loadDocument effect never sees a new
// object reference, preventing spurious document destroy/reload cycles.
const PDF_OPTIONS = {
  withCredentials: true,
  // PDF.js needs these assets to decode JPEG2000 page images and to load
  // fallback fonts. Vite exposes them at these stable paths in dev and in
  // the production bundle (see vite.config.ts).
  wasmUrl: '/pdfjs/wasm/',
  standardFontDataUrl: '/pdfjs/standard_fonts/',
}

export default function PdfViewer({
  url, initialPage = 1, isResizing, onPageChange, onTextSelected,
  annotations, onHighlightCreate, onHighlightClick,
}: Props) {
  const requestedPage = normalizePage(initialPage)
  const [numPages, setNumPages] = useState(0)
  const [currentPage, setCurrentPage] = useState(requestedPage)
  const [restored, setRestored] = useState(false)
  const [scale, setScale] = useState(1.0)
  const [fitWidth, setFitWidth] = useState(true)
  const [containerWidth, setContainerWidth] = useState(800)
  const [bubble, setBubble] = useState<{ x: number; y: number; text: string; coords: ReturnType<typeof getSelectionPageRects> } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const currentPageRef = useRef(requestedPage)
  // Use a ref so the ResizeObserver callback always sees the current value
  // without needing to re-subscribe the observer on every drag start/end.
  const isResizingRef = useRef(isResizing)
  useEffect(() => { isResizingRef.current = isResizing }, [isResizing])

  // Measure scroll area width for fit-width
  useEffect(() => {
    const measure = () => {
      const el = scrollRef.current
      if (!el) return
      // clientWidth excludes scrollbar; subtract 2px for border/rounding
      const w = el.clientWidth - 2
      if (w > 100) setContainerWidth(w)
    }
    // Measure after paint
    requestAnimationFrame(() => requestAnimationFrame(measure))
    const obs = new ResizeObserver(() => {
      // Skip pdfjs re-renders while the user is actively dragging the split handle.
      // Measure once when drag ends (see isResizing effect below).
      if (!isResizingRef.current) measure()
    })
    if (scrollRef.current) obs.observe(scrollRef.current)
    return () => obs.disconnect()
  }, [url])

  // When drag ends, take one final measurement so the PDF snaps to the new width.
  // Defer the update by 200 ms so any in-flight pdfjs render tasks that were
  // started at the old width have time to finish before we issue a new one.
  // Firing synchronously on mouse-up races with those tasks and produces the
  // "Cannot read properties of null (reading 'sendWithPromise')" crash.
  useEffect(() => {
    if (!isResizing) {
      const timer = setTimeout(() => {
        const el = scrollRef.current
        if (!el) return
        const w = el.clientWidth - 2
        if (w > 100) setContainerWidth(w)
      }, 200)
      return () => clearTimeout(timer)
    }
  }, [isResizing])

  // Text selection bubble
  useEffect(() => {
    const handleMouseUp = (e: MouseEvent) => {
      setTimeout(() => {
        const selection = window.getSelection()
        if (!selection || selection.isCollapsed) return
        const text = selection.toString().trim()
        if (!text || text.length < 3) return
        const container = containerRef.current
        if (!container) return
        const anchor = selection.anchorNode
        if (!anchor || !container.contains(anchor)) return
        const rect = container.getBoundingClientRect()
        const coords = getSelectionPageRects(selection)
        setBubble({ x: e.clientX - rect.left, y: e.clientY - rect.top, text, coords })
      }, 80)
    }
    const handleMouseDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-ask-bubble]')) setBubble(null)
    }
    document.addEventListener('mouseup', handleMouseUp)
    document.addEventListener('mousedown', handleMouseDown)
    return () => {
      document.removeEventListener('mouseup', handleMouseUp)
      document.removeEventListener('mousedown', handleMouseDown)
    }
  }, [])

  const handleAsk = () => {
    if (!bubble) return
    onTextSelected?.(bubble.text)
    setBubble(null)
    window.getSelection()?.removeAllRanges()
  }

  const handleHighlight = () => {
    if (!bubble?.coords) return
    const { page, bbox, rects } = bubble.coords
    onHighlightCreate?.({ page_number: page, x1: bbox.x1, y1: bbox.y1, x2: bbox.x2, y2: bbox.y2, rects, text: bubble.text, color: 'yellow' })
    setBubble(null)
    window.getSelection()?.removeAllRanges()
  }

  const zoomIn = () => {
    setFitWidth(false)
    setScale(s => Math.min(2.0, +(s + 0.25).toFixed(2)))
  }
  const zoomOut = () => {
    setFitWidth(false)
    setScale(s => Math.max(0.5, +(s - 0.25).toFixed(2)))
  }
  const setFit = () => setFitWidth(true)
  const setZoomLevel = (z: number) => { setFitWidth(false); setScale(z) }

  // Always pass width in fit mode; pass scale only in manual zoom mode
  const pageWidth = fitWidth ? containerWidth || undefined : undefined
  const pageScale = fitWidth ? undefined : scale

  // Every lazy page has a full-size placeholder, so a deep page can be located
  // before its PDF canvas is mounted. Wait until both the document and the
  // measured fit-width layout exist, then align the saved page in the reader.
  useEffect(() => {
    const scroll = scrollRef.current
    if (!scroll || !numPages || restored) return
    const page = Math.min(numPages, normalizePage(initialPage))
    const timer = setTimeout(() => {
      const target = scroll.querySelector<HTMLElement>(`[data-pdf-page="${page}"]`)
      if (!target) return
      const scrollRect = scroll.getBoundingClientRect()
      const targetRect = target.getBoundingClientRect()
      scroll.scrollTop += targetRect.top - scrollRect.top - 16
      currentPageRef.current = page
      setCurrentPage(page)
      setRestored(true)
    }, 0)
    return () => clearTimeout(timer)
  }, [containerWidth, initialPage, numPages, restored, url])

  // A narrow observation band through the viewport center defines the current
  // reading page. This stays correct for mixed page sizes and avoids doing a
  // getBoundingClientRect scan across hundreds of pages on every scroll event.
  useEffect(() => {
    const scroll = scrollRef.current
    if (!scroll || !restored || !numPages || isResizing) return
    const pages = Array.from(scroll.querySelectorAll<HTMLElement>('[data-pdf-page]'))
    const observer = new IntersectionObserver(entries => {
      const visible = entries.filter(entry => entry.isIntersecting)
      if (!visible.length) return
      const rootCenter = visible[0]?.rootBounds
        ? (visible[0].rootBounds!.top + visible[0].rootBounds!.bottom) / 2
        : scroll.getBoundingClientRect().top + scroll.clientHeight / 2
      const closest = visible.reduce((best, entry) => {
        const distance = Math.abs((entry.boundingClientRect.top + entry.boundingClientRect.bottom) / 2 - rootCenter)
        const bestDistance = Math.abs((best.boundingClientRect.top + best.boundingClientRect.bottom) / 2 - rootCenter)
        return distance < bestDistance ? entry : best
      })
      const page = Number((closest.target as HTMLElement).dataset.pdfPage)
      if (!Number.isInteger(page) || page === currentPageRef.current) return
      currentPageRef.current = page
      setCurrentPage(page)
      onPageChange?.(page)
    }, { root: scroll, rootMargin: '-47% 0px -47% 0px', threshold: 0 })
    for (const page of pages) observer.observe(page)
    return () => observer.disconnect()
  }, [isResizing, numPages, onPageChange, restored, url])

  if (!url) {
    return (
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#4b5563', fontSize: 15, flexDirection: 'column', gap: 12, height: '100%',
        background: 'var(--bg)',
      }}>
        <div style={{ fontSize: 48 }}>📄</div>
        <div>Paste a PDF URL or open a local file to get started</div>
      </div>
    )
  }

  return (
    <div ref={containerRef} style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg)', position: 'relative' }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px',
        background: 'var(--panel)', borderBottom: '1px solid var(--border)',
        flexShrink: 0, flexWrap: 'wrap',
      }}>
        <button onClick={zoomOut} title="Zoom out" style={btnStyle}>−</button>
        <select
          value={fitWidth ? 'fit' : String(scale)}
          onChange={e => e.target.value === 'fit' ? setFit() : setZoomLevel(parseFloat(e.target.value))}
          style={{ background: '#0f0f0f', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 8px', fontSize: 13, cursor: 'pointer' }}
        >
          <option value="fit">Fit width</option>
          {ZOOM_LEVELS.map(z => (
            <option key={z} value={z}>{Math.round(z * 100)}%</option>
          ))}
        </select>
        <button onClick={zoomIn} title="Zoom in" style={btnStyle}>+</button>
        {numPages > 0 && (
          <span data-testid="page-progress" aria-live="polite" style={{ marginLeft: 8, fontSize: 12, color: '#6b7280' }}>
            Page {Math.min(currentPage, numPages)} of {numPages}
          </span>
        )}
      </div>

      {/* PDF scroll area */}
      <div ref={scrollRef} data-testid="pdf-scroll-area" style={{ flex: 1, overflow: 'auto', padding: '16px 0' }}>
        <Document
          key={url}
          file={url}
          options={PDF_OPTIONS}
          onLoadSuccess={({ numPages }) => setNumPages(numPages)}
          onLoadError={err => console.error('PDF load error:', err)}
          loading={<LoadingPage />}
          error={<ErrorPage />}
        >
          {Array.from({ length: numPages }, (_, i) => {
            const pageNum = i + 1
            const pageAnnotations = (annotations ?? []).filter(a => a.page_number === pageNum)
            return (
              <LazyPdfPage
                key={i}
                pageNumber={pageNum}
                pageWidth={pageWidth}
                pageScale={pageScale}
                annotations={pageAnnotations}
                onHighlightClick={onHighlightClick}
              />
            )
          })}
        </Document>
      </div>

      {/* Selection bubble */}
      {bubble && (
        <div
          data-ask-bubble="1"
          style={{
            position: 'absolute',
            left: Math.min(bubble.x, (containerRef.current?.clientWidth ?? 400) - 260),
            top: Math.max(bubble.y - 48, 8),
            display: 'flex', gap: 6, zIndex: 9999, userSelect: 'none',
          }}
        >
          {bubble.coords && (
            <button
              onClick={handleHighlight}
              style={{
                background: '#854d0e', color: '#fef08a',
                border: 'none', padding: '6px 14px', borderRadius: 20, fontSize: 13, fontWeight: 600,
                cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,0.4)', whiteSpace: 'nowrap',
              }}
            >
              🖊 Highlight
            </button>
          )}
          <button
            onClick={handleAsk}
            style={{
              background: 'var(--accent)', color: '#fff',
              border: 'none', padding: '6px 14px', borderRadius: 20, fontSize: 13, fontWeight: 600,
              cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,0.4)', whiteSpace: 'nowrap',
            }}
          >
            💬 Ask
          </button>
        </div>
      )}
    </div>
  )
}

interface LazyPdfPageProps {
  pageNumber: number
  pageWidth?: number
  pageScale?: number
  annotations: Annotation[]
  onHighlightClick?: (annotation: Annotation) => void
}

// The viewer can contain hundreds of pages. Mounting a canvas and text layer
// for every page at once overwhelms the browser (especially for scanned PDFs
// whose pages contain JPEG2000 images), leaving later canvases permanently
// hidden while their text layers remain selectable. Keep the layout with a
// lightweight placeholder and only mount pages as they approach the viewport.
const PAGE_ASPECT_RATIO = 1.53

function LazyPdfPage({ pageNumber, pageWidth, pageScale, annotations, onHighlightClick }: LazyPdfPageProps) {
  const pageRef = useRef<HTMLDivElement>(null)
  const [shouldRender, setShouldRender] = useState(pageNumber === 1)

  useEffect(() => {
    if (shouldRender || !pageRef.current) return
    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          setShouldRender(true)
          observer.disconnect()
        }
      },
      { rootMargin: '1200px 0px' },
    )
    observer.observe(pageRef.current)
    return () => observer.disconnect()
  }, [shouldRender])

  const placeholderWidth = pageWidth ?? 600 * (pageScale ?? 1)
  const placeholderHeight = placeholderWidth * PAGE_ASPECT_RATIO

  return (
    <div
      ref={pageRef}
      data-pdf-page={pageNumber}
      aria-label={`Page ${pageNumber}`}
      style={{ display: 'flex', justifyContent: 'center', marginBottom: 12, position: 'relative', minHeight: placeholderHeight }}
    >
      <div style={{ position: 'relative' }}>
        {shouldRender ? (
          <Page
            pageNumber={pageNumber}
            width={pageWidth}
            scale={pageScale}
            renderTextLayer={true}
            renderAnnotationLayer={true}
            loading={<LoadingPage />}
            error={<ErrorPage />}
          />
        ) : (
          <div style={{ width: placeholderWidth, height: placeholderHeight, background: 'white' }} aria-label={`Page ${pageNumber}`} />
        )}
        {annotations.map(ann =>
          // rects gives one box per selected line; annotations from before
          // that field existed only have the x1..y2 union.
          (ann.rects && ann.rects.length ? ann.rects : [ann]).map((r, i) => (
            <div
              key={`${ann.id}-${i}`}
              onClick={() => onHighlightClick?.(ann)}
              title={ann.text}
              style={{
                position: 'absolute',
                left:   `${r.x1 * 100}%`,
                top:    `${r.y1 * 100}%`,
                width:  `${(r.x2 - r.x1) * 100}%`,
                height: `${(r.y2 - r.y1) * 100}%`,
                background: COLOR_MAP[ann.color] ?? COLOR_MAP.yellow,
                pointerEvents: 'auto',
                cursor: 'pointer',
                zIndex: 2,
                borderRadius: 2,
                mixBlendMode: 'multiply',
              }}
            />
          )),
        )}
      </div>
    </div>
  )
}

const btnStyle: React.CSSProperties = {
  background: '#2a2a2a', border: '1px solid var(--border)', color: 'var(--text)',
  borderRadius: 6, width: 28, height: 28, fontSize: 16, cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
}

function LoadingPage() {
  return (
    <div style={{ width: 600, height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4b5563' }}>
      <span className="spinner" />
    </div>
  )
}

function ErrorPage() {
  return (
    <div style={{ width: 600, padding: 16, color: '#f87171', background: '#2d1515', borderRadius: 8, textAlign: 'center' }}>
      ⚠️ Failed to render page
    </div>
  )
}
