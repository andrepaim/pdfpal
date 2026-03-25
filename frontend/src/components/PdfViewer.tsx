import { useEffect, useRef } from 'react'
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

  const defaultLayout = defaultLayoutPlugin({
    sidebarTabs: () => [],  // hide sidebar tabs (thumbnails/bookmarks) to save space
  })

  // Capture text selection inside the PDF viewer
  useEffect(() => {
    if (!onTextSelected) return
    const container = containerRef.current
    if (!container) return

    const handleMouseUp = () => {
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed) return
      const text = selection.toString().trim()
      if (text && text.length > 2) {
        onTextSelected(text)
      }
    }

    container.addEventListener('mouseup', handleMouseUp)
    return () => container.removeEventListener('mouseup', handleMouseUp)
  }, [onTextSelected])

  if (!url) {
    return (
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#4b5563',
        fontSize: 15,
        flexDirection: 'column',
        gap: 12,
        height: '100%',
        background: 'var(--bg)',
      }}>
        <div style={{ fontSize: 48 }}>📄</div>
        <div>Paste a PDF URL or open a local file to get started</div>
      </div>
    )
  }

  return (
    <div ref={containerRef} style={{ height: '100%', overflow: 'hidden' }}>
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
    </div>
  )
}
