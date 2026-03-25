import { useEffect, useRef, useState } from 'react'
import { Worker, Viewer, SpecialZoomLevel } from '@react-pdf-viewer/core'
import { defaultLayoutPlugin } from '@react-pdf-viewer/default-layout'
import '@react-pdf-viewer/core/lib/styles/index.css'
import '@react-pdf-viewer/default-layout/lib/styles/index.css'

interface Props {
  url: string
  pages: number
  onTextSelected?: (text: string) => void
}

export default function PdfViewer({ url, onTextSelected }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [bubble, setBubble] = useState<{ x: number; y: number; text: string } | null>(null)

  const defaultLayout = defaultLayoutPlugin({
    sidebarTabs: () => [],
  })

  useEffect(() => {
    const handleMouseUp = (e: MouseEvent) => {
      // Small delay so selection is finalized
      setTimeout(() => {
        const selection = window.getSelection()
        if (!selection || selection.isCollapsed) {
          setBubble(null)
          return
        }
        const text = selection.toString().trim()
        if (!text || text.length < 3) {
          setBubble(null)
          return
        }
        // Show bubble near the mouse position
        const container = containerRef.current
        if (!container) return
        const rect = container.getBoundingClientRect()
        setBubble({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
          text,
        })
      }, 50)
    }

    const handleMouseDown = (e: MouseEvent) => {
      // Hide bubble if clicking outside of it
      const target = e.target as HTMLElement
      if (!target.closest('[data-ask-bubble]')) {
        setBubble(null)
      }
    }

    const container = containerRef.current
    if (!container) return
    container.addEventListener('mouseup', handleMouseUp)
    container.addEventListener('mousedown', handleMouseDown)
    return () => {
      container.removeEventListener('mouseup', handleMouseUp)
      container.removeEventListener('mousedown', handleMouseDown)
    }
  }, [])

  const handleAsk = () => {
    if (!bubble) return
    onTextSelected?.(bubble.text)
    setBubble(null)
    window.getSelection()?.removeAllRanges()
  }

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
    <div ref={containerRef} style={{ height: '100%', overflow: 'hidden', position: 'relative' }}>
      <Worker workerUrl={new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()}>
        <div style={{ height: '100%' }}>
          <Viewer
            fileUrl={url}
            plugins={[defaultLayout]}
            defaultScale={SpecialZoomLevel.PageWidth}
            theme="dark"
          />
        </div>
      </Worker>

      {/* Floating "Ask" bubble on text selection */}
      {bubble && (
        <div
          data-ask-bubble="1"
          onClick={handleAsk}
          style={{
            position: 'absolute',
            left: Math.min(bubble.x, (containerRef.current?.clientWidth ?? 400) - 160),
            top: bubble.y - 48,
            background: 'var(--accent)',
            color: '#fff',
            padding: '6px 14px',
            borderRadius: 20,
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
            zIndex: 9999,
            userSelect: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            whiteSpace: 'nowrap',
          }}
        >
          💬 Ask about selection
        </div>
      )}
    </div>
  )
}
