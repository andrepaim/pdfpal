import { useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'

// Use local worker from node_modules
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString()

interface Props {
  url: string
  pages: number
}

export default function PdfViewer({ url }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [numPages, setNumPages] = useState(0)
  const renderingRef = useRef(false)

  useEffect(() => {
    if (!url) {
      if (containerRef.current) containerRef.current.innerHTML = ''
      setNumPages(0)
      setError('')
      return
    }

    let cancelled = false
    setLoading(true)
    setError('')
    if (containerRef.current) containerRef.current.innerHTML = ''

    const render = async () => {
      if (renderingRef.current) return
      renderingRef.current = true
      try {
        const loadingTask = pdfjsLib.getDocument(url)
        const pdf = await loadingTask.promise
        if (cancelled) return

        setNumPages(pdf.numPages)
        const container = containerRef.current
        if (!container) return

        for (let i = 1; i <= pdf.numPages; i++) {
          if (cancelled) break
          const page = await pdf.getPage(i)
          const viewport = page.getViewport({ scale: 1.5 })

          const wrapper = document.createElement('div')
          wrapper.style.cssText = `
            margin: 0 auto 12px;
            background: #fff;
            border-radius: 4px;
            overflow: hidden;
            width: ${viewport.width}px;
            max-width: 100%;
            box-shadow: 0 2px 8px rgba(0,0,0,0.4);
          `

          const canvas = document.createElement('canvas')
          canvas.width = viewport.width
          canvas.height = viewport.height
          canvas.style.display = 'block'
          canvas.style.width = '100%'

          wrapper.appendChild(canvas)
          container.appendChild(wrapper)

          const ctx = canvas.getContext('2d')!
          await page.render({ canvasContext: ctx, viewport, canvas }).promise
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message || 'Failed to render PDF')
      } finally {
        if (!cancelled) setLoading(false)
        renderingRef.current = false
      }
    }

    render()
    return () => { cancelled = true }
  }, [url])

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
      }}>
        <div style={{ fontSize: 48 }}>📄</div>
        <div>Paste a PDF URL above to get started</div>
      </div>
    )
  }

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '16px', height: '100%' }}>
      {loading && (
        <div style={{ textAlign: 'center', paddingTop: 40, color: '#6b7280' }}>
          <div className="spinner" style={{ margin: '0 auto 12px' }} />
          <div>Rendering PDF…</div>
        </div>
      )}
      {error && (
        <div style={{ color: '#f87171', padding: 16, background: '#2d1515', borderRadius: 8, margin: 8 }}>
          ⚠️ {error}
        </div>
      )}
      {!loading && !error && numPages > 0 && (
        <div style={{ color: '#6b7280', fontSize: 12, textAlign: 'center', marginBottom: 12 }}>
          {numPages} page{numPages !== 1 ? 's' : ''}
        </div>
      )}
      <div ref={containerRef} style={{ width: '100%' }} />
    </div>
  )
}
