import { useState, useRef, useEffect } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'

// Worker served as a static file from /public
pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'

interface Props {
  url: string
  pages: number
  isResizing?: boolean
  onTextSelected?: (text: string) => void
}

const ZOOM_LEVELS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0]

// Module-level constant so react-pdf's loadDocument effect never sees a new
// object reference, preventing spurious document destroy/reload cycles.
const PDF_OPTIONS = { withCredentials: true }

export default function PdfViewer({ url, isResizing, onTextSelected }: Props) {
  const [numPages, setNumPages] = useState(0)
  const [scale, setScale] = useState(1.0)
  const [fitWidth, setFitWidth] = useState(true)
  const [containerWidth, setContainerWidth] = useState(800)
  const [bubble, setBubble] = useState<{ x: number; y: number; text: string } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
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
        setBubble({ x: e.clientX - rect.left, y: e.clientY - rect.top, text })
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

  // Reset to fit-width on new PDF
  useEffect(() => {
    setFitWidth(true)
    setNumPages(0)
  }, [url])

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
          <span style={{ marginLeft: 8, fontSize: 12, color: '#6b7280' }}>{numPages} pages</span>
        )}
      </div>

      {/* PDF scroll area */}
      <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', padding: '16px 0' }}>
        <Document
          key={url}
          file={url}
          options={PDF_OPTIONS}
          onLoadSuccess={({ numPages }) => setNumPages(numPages)}
          onLoadError={err => console.error('PDF load error:', err)}
          loading={<LoadingPage />}
          error={<ErrorPage />}
        >
          {Array.from({ length: numPages }, (_, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
              <Page
                pageNumber={i + 1}
                width={pageWidth}
                scale={pageScale}
                renderTextLayer={true}
                renderAnnotationLayer={true}
                loading={<LoadingPage />}
                error={<ErrorPage />}
              />
            </div>
          ))}
        </Document>
      </div>

      {/* Selection bubble */}
      {bubble && (
        <div
          data-ask-bubble="1"
          onClick={handleAsk}
          style={{
            position: 'absolute',
            left: Math.min(bubble.x, (containerRef.current?.clientWidth ?? 400) - 180),
            top: Math.max(bubble.y - 48, 8),
            background: 'var(--accent)', color: '#fff',
            padding: '6px 14px', borderRadius: 20, fontSize: 13, fontWeight: 600,
            cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
            zIndex: 9999, userSelect: 'none', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
          }}
        >
          💬 Ask about selection
        </div>
      )}
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
