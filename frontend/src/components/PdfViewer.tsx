import { useState, useRef, useEffect } from 'react'
import { Document, Page, pdfjs, type DocumentProps } from 'react-pdf'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'
import { dictionaryApi, type Annotation, type DictionaryResult } from '../lib/api'
import { isDefinable, selectionContext } from '../lib/selection-context'
import DefinitionCard from './DefinitionCard'
import VisualIcon from './VisualIcon'

// Bundle the worker from the same pdfjs-dist version used by react-pdf.
// package.json pins pdfjs-dist to react-pdf's exact version (no "^"): pdfjs
// throws if the API and worker versions differ, and a caret range lets npm
// hoist a newer pdfjs-dist here than the one react-pdf bundles internally,
// silently breaking every render with "Failed to render page".
pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()

type PageRect = { x1: number; y1: number; x2: number; y2: number }
type PageSize = { width: number; height: number }
type PdfLinkTarget = Parameters<NonNullable<DocumentProps['onItemClick']>>[0]
type ReadingPosition = { page: number; offsetY: number; offsetX: number; fitWidth: boolean; scale: number }

interface Props {
  url: string
  pages: number
  initialPage?: number
  isResizing?: boolean
  onPageChange?: (page: number) => void
  /** `page` is the PDF page the selection starts on, when it can be determined. */
  onTextSelected?: (text: string, page?: number) => void
  onExplainVisually?: (text: string, page?: number) => void
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
//
// The rects are measured per text node, not with range.getClientRects() on
// the whole selection. That call also returns the border box of every
// element the range fully contains. Within one page that only added a
// zero-area box for the <br> pdf.js puts between lines. Across a page break
// it adds whole elements, such as the first page's annotation layer, so the
// highlight covered the entire first page. Measuring text nodes inside text
// layers, grouped by the page they belong to, keeps only the selected text.
// A selection that crosses pages gives one entry per page, in document order.
type PageSelection = { page: number; bbox: PageRect; rects: PageRect[]; text: string }

function getSelectionPages(selection: Selection): PageSelection[] {
  if (selection.rangeCount === 0) return []
  const range = selection.getRangeAt(0)
  const common = range.commonAncestorContainer
  const root = common.nodeType === Node.TEXT_NODE ? common.parentNode : common
  if (!root) return []
  const byPage = new Map<HTMLElement, { rects: DOMRect[]; text: string }>()
  // Rejecting a node outside the range skips its whole subtree, so pages the
  // selection does not touch are not walked.
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: node => range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
  })
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node as HTMLElement
    if (!element?.closest('.textLayer')) continue
    const pageEl = element.closest<HTMLElement>('[data-page-number]')
    if (!pageEl) continue
    const entry = byPage.get(pageEl) ?? { rects: [], text: '' }
    byPage.set(pageEl, entry)
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (element.tagName === 'BR') entry.text += '\n'
      continue
    }
    const part = document.createRange()
    part.selectNodeContents(node)
    if (node === range.startContainer) part.setStart(node, range.startOffset)
    if (node === range.endContainer) part.setEnd(node, range.endOffset)
    entry.text += part.toString()
    entry.rects.push(...Array.from(part.getClientRects()).filter(r => r.width > 0 && r.height > 0))
  }
  const pages: PageSelection[] = []
  for (const [pageEl, { rects: clientRects, text }] of byPage) {
    const page = parseInt(pageEl.getAttribute('data-page-number') || '0', 10)
    const pageRect = pageEl.getBoundingClientRect()
    if (!page || clientRects.length === 0 || pageRect.width === 0 || pageRect.height === 0) continue
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
    pages.push({ page, bbox, rects, text: text.replace(/[ \t]*\n[ \t]*/g, '\n').trim() })
  }
  return pages
}

const ZOOM_LEVELS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0]
const DARK_PAGES_STORAGE_KEY = 'pdfpal.pdf.darkPages'
const DEFINITIONS_STORAGE_KEY = 'pdfpal.pdf.definitions'
const DEFINITION_CARD_WIDTH = 340
// Room the card needs under the selection before it opens above it instead.
const DEFINITION_CARD_ROOM = 220

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

const FALLBACK_PAGE_SIZE: PageSize = { width: 595, height: 842 }

function getPageSize(page: PDFPageProxy): PageSize {
  const viewport = page.getViewport({ scale: 1 })
  return viewport.width > 0 && viewport.height > 0
    ? { width: viewport.width, height: viewport.height }
    : FALLBACK_PAGE_SIZE
}

export default function PdfViewer({
  url, initialPage = 1, isResizing, onPageChange, onTextSelected, onExplainVisually,
  annotations, onHighlightCreate, onHighlightClick,
}: Props) {
  const requestedPage = normalizePage(initialPage)
  const [numPages, setNumPages] = useState(0)
  const [pageSizes, setPageSizes] = useState<PageSize[]>([])
  const [currentPage, setCurrentPage] = useState(requestedPage)
  const [restored, setRestored] = useState(false)
  const [scale, setScale] = useState(1.0)
  const [fitWidth, setFitWidth] = useState(true)
  const [darkPages, setDarkPages] = useState(() => {
    try { return localStorage.getItem(DARK_PAGES_STORAGE_KEY) === 'true' }
    catch { return false }
  })
  const [containerWidth, setContainerWidth] = useState(800)
  const [linkHistory, setLinkHistory] = useState<ReadingPosition[]>([])
  const [returnPosition, setReturnPosition] = useState<ReadingPosition | null>(null)
  const [bubble, setBubble] = useState<{ x: number; y: number; text: string; pages: PageSelection[] } | null>(null)
  // Definitions of a selected word are on unless the reader turned them off.
  const [definitions, setDefinitions] = useState(() => {
    try { return localStorage.getItem(DEFINITIONS_STORAGE_KEY) !== 'false' }
    catch { return true }
  })
  const [definition, setDefinition] = useState<{ id: number; result: DictionaryResult; style: React.CSSProperties } | null>(null)
  const definitionsRef = useRef(definitions)
  // Counts lookups and clicks, so an answer that arrives after the reader
  // has moved on is dropped instead of opening a card for an old selection.
  const definitionRequest = useRef(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const currentPageRef = useRef(requestedPage)
  const activeUrlRef = useRef(url)
  const pdfRef = useRef<PDFDocumentProxy | null>(null)
  const navigationRef = useRef({ fitWidth, scale, containerWidth, onPageChange })
  // react-pdf retains its initial onItemClick callback. Read live settings
  // through refs so reference links also work after zoom or layout changes.
  useEffect(() => { navigationRef.current = { fitWidth, scale, containerWidth, onPageChange } }, [fitWidth, scale, containerWidth, onPageChange])
  useEffect(() => () => { pdfRef.current = null }, [url])
  useEffect(() => {
    // Privacy settings can disable storage; the toggle still works for the
    // current reader even when its preference cannot be saved.
    try { localStorage.setItem(DARK_PAGES_STORAGE_KEY, String(darkPages)) }
    catch { /* Keep the in-memory preference. */ }
  }, [darkPages])
  useEffect(() => { activeUrlRef.current = url }, [url])
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

  useEffect(() => {
    definitionsRef.current = definitions
    if (!definitions) setDefinition(null)
    try { localStorage.setItem(DEFINITIONS_STORAGE_KEY, String(definitions)) }
    catch { /* The preference still applies until the reader is closed. */ }
  }, [definitions])

  // The card is placed over the viewer, so it would drift away from its word
  // when the pages scroll underneath it.
  useEffect(() => {
    const scroll = scrollRef.current
    if (!definition || !scroll) return
    const close = () => setDefinition(null)
    scroll.addEventListener('scroll', close, { passive: true })
    return () => scroll.removeEventListener('scroll', close)
  }, [definition])

  // Text selection bubble and definition card
  useEffect(() => {
    // Look a selected word or short phrase up in the offline dictionary and
    // open the card under it, or above it near the bottom of the viewer.
    const defineSelection = (range: Range, text: string, viewer: DOMRect) => {
      const rects = Array.from(range.getClientRects()).filter(r => r.width > 0 && r.height > 0)
      if (!rects.length) return
      const left = Math.min(...rects.map(r => r.left)) - viewer.left
      const top = Math.min(...rects.map(r => r.top)) - viewer.top
      const bottom = Math.max(...rects.map(r => r.bottom)) - viewer.top
      const x = Math.max(8, Math.min(left, viewer.width - DEFINITION_CARD_WIDTH - 8))
      // Above the word, the card also has to clear the selection bubble.
      const style = bottom + DEFINITION_CARD_ROOM > viewer.height && top > DEFINITION_CARD_ROOM
        ? { left: x, bottom: viewer.height - top + 56 }
        : { left: x, top: bottom + 8 }
      const id = ++definitionRequest.current
      dictionaryApi.define(text, selectionContext(range)).then(result => {
        // No card when the dictionary has no entry: names, numbers, "the".
        if (id === definitionRequest.current && result.entries.length) setDefinition({ id, result, style })
      }).catch(() => { /* Definitions are an extra; the selection still works without one. */ })
    }
    const handleMouseUp = (e: MouseEvent) => {
      // A click in the bubble or the card is not a new selection.
      if ((e.target as HTMLElement).closest?.('[data-ask-bubble],[data-definition-card]')) return
      setTimeout(() => {
        const selection = window.getSelection()
        if (!selection || selection.isCollapsed) return
        const selected = selection.toString(), text = selected.trim()
        const container = containerRef.current
        if (!text || !container) return
        const anchor = selection.anchorNode
        if (!anchor || !container.contains(anchor)) return
        const rect = container.getBoundingClientRect()
        // Untrimmed: a space at either end tells the lookup the word is complete.
        if (definitionsRef.current && isDefinable(selected)) defineSelection(selection.getRangeAt(0), selected, rect)
        if (text.length < 3) return
        const pages = getSelectionPages(selection)
        setBubble({ x: e.clientX - rect.left, y: e.clientY - rect.top, text, pages })
      }, 80)
    }
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('[data-ask-bubble],[data-definition-card]')) setBubble(null)
      if (!target.closest('[data-definition-card]')) { definitionRequest.current++; setDefinition(null) }
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
    onTextSelected?.(bubble.text, bubble.pages[0]?.page)
    setBubble(null)
    window.getSelection()?.removeAllRanges()
  }

  const handleVisual = () => {
    if (!bubble) return
    onExplainVisually?.(bubble.text, bubble.pages[0]?.page)
    setBubble(null)
    window.getSelection()?.removeAllRanges()
  }

  // An annotation belongs to one page, so a selection that crosses a page
  // break is saved as one highlight per page, each holding that page's text.
  const handleHighlight = () => {
    if (!bubble?.pages.length) return
    const single = bubble.pages.length === 1
    for (const { page, bbox, rects, text } of bubble.pages) {
      onHighlightCreate?.({ page_number: page, x1: bbox.x1, y1: bbox.y1, x2: bbox.x2, y2: bbox.y2, rects, text: single ? bubble.text : text, color: 'yellow' })
    }
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

  const handleDocumentLoadSuccess = async (pdf: PDFDocumentProxy, loadedUrl: string) => {
    if (activeUrlRef.current !== loadedUrl) return
    pdfRef.current = pdf
    // Reading a page proxy only loads its geometry; canvases, text, images, and
    // annotations remain lazy. Exact dimensions keep placeholders stable for
    // book trim sizes and PDFs whose pages do not all share one MediaBox.
    const loadedSizes = await Promise.all(
      Array.from({ length: pdf.numPages }, async (_, index): Promise<PageSize | null> => {
        try {
          return getPageSize(await pdf.getPage(index + 1))
        } catch {
          return null
        }
      }),
    )
    if (activeUrlRef.current !== loadedUrl) return
    const fallback = loadedSizes.find((size): size is PageSize => size !== null) ?? FALLBACK_PAGE_SIZE
    setPageSizes(loadedSizes.map(size => size ?? fallback))
    setNumPages(pdf.numPages)
  }

  const handleInternalLink = async ({ pageNumber, dest }: PdfLinkTarget) => {
    const pdf = pdfRef.current
    if (!pdf || pageNumber < 1 || pageNumber > pdf.numPages) return
    const page = await pdf.getPage(pageNumber)
    if (pdfRef.current !== pdf) return
    const scroll = scrollRef.current
    // Every page has a sized placeholder, even before its canvas is mounted.
    const target = scroll?.querySelector<HTMLElement>(`[data-pdf-page="${pageNumber}"]`)
    if (!scroll || !target) return
    const settings = navigationRef.current
    const pageScale = settings.fitWidth ? settings.containerWidth / getPageSize(page).width : settings.scale
    const viewport = page.getViewport({ scale: pageScale })
    const destination = Array.isArray(dest) ? dest as unknown[] : []
    const kind = (destination[1] as { name?: string } | undefined)?.name
    const coordinate = (index: number, fallback: number) => typeof destination[index] === 'number' ? destination[index] as number : fallback
    let x = 0, y = 0
    if (kind === 'XYZ' || kind === 'FitR' || kind === 'FitH' || kind === 'FitBH' || kind === 'FitV' || kind === 'FitBV') {
      const left = kind === 'FitH' || kind === 'FitBH' ? page.view[0] : coordinate(2, page.view[0])
      const top = kind === 'FitV' || kind === 'FitBV' ? page.view[3] : coordinate(kind === 'FitR' ? 5 : kind === 'XYZ' ? 3 : 2, page.view[3])
      ;[x, y] = viewport.convertToViewportPoint(left, top)
    }
    const targetRect = target.getBoundingClientRect()
    const scrollRect = scroll.getBoundingClientRect()
    const origin = scroll.querySelector<HTMLElement>(`[data-pdf-page="${currentPageRef.current}"]`)
    if (origin) {
      const originRect = origin.getBoundingClientRect()
      const position: ReadingPosition = {
        page: currentPageRef.current,
        offsetY: (scrollRect.top - originRect.top) / originRect.height,
        offsetX: scroll.scrollLeft / originRect.width,
        fitWidth: settings.fitWidth,
        scale: settings.scale,
      }
      setLinkHistory(history => [...history, position])
    }
    scroll.scrollTop += targetRect.top - scrollRect.top + Math.max(0, y) - 16
    if (viewport.width > scroll.clientWidth) {
      const pageLeft = targetRect.left + (targetRect.width - viewport.width) / 2
      scroll.scrollLeft += pageLeft - scrollRect.left + Math.max(0, x)
    }
    currentPageRef.current = pageNumber
    setCurrentPage(pageNumber)
    settings.onPageChange?.(pageNumber)
  }

  const handleBackToCitation = () => {
    const previous = linkHistory.at(-1)
    if (!previous || returnPosition) return
    setLinkHistory(history => history.slice(0, -1))
    setFitWidth(previous.fitWidth)
    setScale(previous.scale)
    setReturnPosition(previous)
    setBubble(null)
  }

  useEffect(() => {
    if (!returnPosition) return
    // Restore after zoom and page placeholders adopt their new dimensions.
    // Page-relative offsets also remain useful after a fit-width resize.
    const frame = requestAnimationFrame(() => {
      const scroll = scrollRef.current
      const target = scroll?.querySelector<HTMLElement>(`[data-pdf-page="${returnPosition.page}"]`)
      if (scroll && target) {
        const targetRect = target.getBoundingClientRect()
        scroll.scrollTop += targetRect.top - scroll.getBoundingClientRect().top + returnPosition.offsetY * targetRect.height
        scroll.scrollLeft = returnPosition.offsetX * targetRect.width
        currentPageRef.current = returnPosition.page
        setCurrentPage(returnPosition.page)
        navigationRef.current.onPageChange?.(returnPosition.page)
      }
      setReturnPosition(null)
    })
    return () => cancelAnimationFrame(frame)
  }, [returnPosition, containerWidth, fitWidth, scale])

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
    <div ref={containerRef} className="pdf-viewer" data-page-theme={darkPages ? 'dark' : 'light'} style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg)', position: 'relative' }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px',
        background: 'var(--panel)', borderBottom: '1px solid var(--border)',
        flexShrink: 0, flexWrap: 'wrap',
      }}>
        {(linkHistory.length > 0 || returnPosition) && (
          <button
            type="button"
            onClick={handleBackToCitation}
            disabled={returnPosition !== null}
            title={`Return to page ${linkHistory.at(-1)?.page ?? returnPosition?.page}`}
            style={{ ...btnStyle, width: 'auto', padding: '4px 10px', fontSize: 12 }}
          >
            Back to citation
          </button>
        )}
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
        <button
          type="button"
          aria-pressed={definitions}
          onClick={() => setDefinitions(value => !value)}
          title="Show the dictionary meaning of a word when you select it"
          style={{ ...btnStyle, width: 'auto', padding: '4px 10px', marginLeft: 'auto', fontSize: 12, background: definitions ? 'var(--accent)' : btnStyle.background }}
        >
          Definitions
        </button>
        <button
          type="button"
          aria-pressed={darkPages}
          onClick={() => setDarkPages(value => !value)}
          title="Use dark page colors. Figure and photo colors will also change."
          style={{ ...btnStyle, width: 'auto', padding: '4px 10px', fontSize: 12, background: darkPages ? 'var(--accent)' : btnStyle.background }}
        >
          Dark pages
        </button>
      </div>

      {/* PDF scroll area */}
      <div ref={scrollRef} data-testid="pdf-scroll-area" style={{ flex: 1, overflow: 'auto', padding: '16px 0' }}>
        <Document
          key={url}
          file={url}
          options={PDF_OPTIONS}
          onItemClick={target => { void handleInternalLink(target).catch(error => console.error('PDF link navigation error:', error)) }}
          onLoadSuccess={pdf => { void handleDocumentLoadSuccess(pdf, url) }}
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
                pageSize={pageSizes[i] ?? FALLBACK_PAGE_SIZE}
                annotations={pageAnnotations}
                onHighlightClick={onHighlightClick}
              />
            )
          })}
        </Document>
      </div>

      {definition && (
        <DefinitionCard key={definition.id} result={definition.result} style={definition.style} onClose={() => setDefinition(null)} />
      )}

      {/* Selection bubble */}
      {bubble && (
        <div
          data-ask-bubble="1"
          onMouseDown={event => event.preventDefault()}
          style={{
            position: 'absolute',
            left: Math.max(8, Math.min(bubble.x, (containerRef.current?.clientWidth ?? 400) - 360)),
            top: Math.max(bubble.y - 48, 8),
            display: 'flex', flexWrap: 'wrap', maxWidth: 'calc(100% - 16px)', gap: 6, zIndex: 9999, userSelect: 'none',
          }}
        >
          {bubble.pages.length > 0 && (
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
          {onExplainVisually && <button onClick={handleVisual} style={{
            background: '#26233c', color: '#c7d2fe', border: '1px solid #6366f1', padding: '6px 12px', borderRadius: 20,
            fontSize: 12, fontWeight: 600, cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,0.4)', whiteSpace: 'nowrap',
          }}><VisualIcon />Explain visually</button>}
        </div>
      )}
    </div>
  )
}

interface LazyPdfPageProps {
  pageNumber: number
  pageWidth?: number
  pageScale?: number
  pageSize: PageSize
  annotations: Annotation[]
  onHighlightClick?: (annotation: Annotation) => void
}

// The viewer can contain hundreds of pages. Mounting a canvas and text layer
// for every page at once overwhelms the browser (especially for scanned PDFs
// whose pages contain JPEG2000 images), leaving later canvases permanently
// hidden while their text layers remain selectable. Keep the layout with a
// lightweight placeholder and only mount pages as they approach the viewport.

function LazyPdfPage({ pageNumber, pageWidth, pageScale, pageSize: initialPageSize, annotations, onHighlightClick }: LazyPdfPageProps) {
  const pageRef = useRef<HTMLDivElement>(null)
  const [shouldRender, setShouldRender] = useState(pageNumber === 1)
  const [pageSize, setPageSize] = useState(initialPageSize)

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

  const placeholderWidth = pageWidth ?? pageSize.width * (pageScale ?? 1)
  const placeholderHeight = pageWidth
    ? pageWidth * pageSize.height / pageSize.width
    : pageSize.height * (pageScale ?? 1)

  return (
    <div
      ref={pageRef}
      data-pdf-page={pageNumber}
      aria-label={`Page ${pageNumber}`}
      style={{ display: 'flex', justifyContent: 'center', marginBottom: 12, position: 'relative', minHeight: placeholderHeight }}
    >
      <div style={{ position: 'relative', isolation: 'isolate' }}>
        {shouldRender ? (
          <Page
            pageNumber={pageNumber}
            width={pageWidth}
            scale={pageScale}
            onLoadSuccess={page => setPageSize(getPageSize(page))}
            renderTextLayer={true}
            renderAnnotationLayer={true}
            loading={<LoadingPage />}
            error={<ErrorPage />}
          />
        ) : (
          <div style={{ width: placeholderWidth, height: placeholderHeight, background: 'var(--pdf-page-background)' }} aria-label={`Page ${pageNumber}`} />
        )}
        {annotations.map(ann =>
          // rects gives one box per selected line; annotations from before
          // that field existed only have the x1..y2 union.
          (ann.rects && ann.rects.length ? ann.rects : [ann]).map((r, i) => (
            <div
              key={`${ann.id}-${i}`}
              className="pdf-highlight"
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
