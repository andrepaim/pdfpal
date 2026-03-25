import { useState, useCallback } from 'react'
import PdfViewer from './components/PdfViewer'
import ChatPanel from './components/ChatPanel'

export default function App() {
  const [pdfUrl, setPdfUrl] = useState('')
  const [loadedUrl, setLoadedUrl] = useState('')
  const [pdfText, setPdfText] = useState('')
  const [extractError, setExtractError] = useState('')
  const [extracting, setExtracting] = useState(false)
  const [pdfPages, setPdfPages] = useState(0)

  const handleLoad = useCallback(async () => {
    if (!pdfUrl.trim()) return
    setExtractError('')
    setPdfText('')
    setExtracting(true)
    setPdfPages(0)

    try {
      const res = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: pdfUrl.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        const detail = data.detail
        if (typeof detail === 'object' && detail?.message) {
          setExtractError(detail.message)
        } else {
          setExtractError(typeof detail === 'string' ? detail : 'Failed to extract PDF')
        }
        setExtracting(false)
        return
      }
      setPdfText(data.text)
      setPdfPages(data.pages)
      setLoadedUrl(pdfUrl.trim())
    } catch (e: any) {
      setExtractError(e.message || 'Network error')
    } finally {
      setExtracting(false)
    }
  }, [pdfUrl])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleLoad()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--bg)' }}>
      {/* Header / URL bar */}
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--panel)',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        flexShrink: 0,
      }}>
        <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.5px', color: '#e5e7eb', whiteSpace: 'nowrap' }}>
          📄 pdfpal
        </div>
        <input
          type="text"
          value={pdfUrl}
          onChange={e => setPdfUrl(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Paste a PDF URL and press Enter or click Load…"
          style={{
            flex: 1,
            background: '#0f0f0f',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '8px 14px',
            color: 'var(--text)',
            fontSize: 14,
            outline: 'none',
          }}
        />
        <button
          onClick={handleLoad}
          disabled={extracting || !pdfUrl.trim()}
          style={{
            background: extracting ? '#3a3a3a' : 'var(--accent)',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            padding: '8px 18px',
            fontSize: 14,
            fontWeight: 600,
            cursor: extracting ? 'not-allowed' : 'pointer',
            whiteSpace: 'nowrap',
            transition: 'background 0.15s',
          }}
        >
          {extracting ? <span className="spinner" /> : 'Load'}
        </button>
      </div>

      {/* Error banner */}
      {extractError && (
        <div style={{
          background: '#2d1515',
          color: '#f87171',
          padding: '10px 16px',
          fontSize: 13,
          borderBottom: '1px solid #4d2020',
          flexShrink: 0,
        }}>
          ⚠️ {extractError}
        </div>
      )}

      {/* Main split */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* PDF panel — 55% */}
        <div style={{
          width: '55%',
          borderRight: '1px solid var(--border)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}>
          <PdfViewer
            url={loadedUrl ? `/api/proxy-pdf?url=${encodeURIComponent(loadedUrl)}` : ''}
            pages={pdfPages}
          />
        </div>

        {/* Chat panel — 45% */}
        <div style={{ width: '45%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <ChatPanel
            pdfText={pdfText}
            pdfUrl={loadedUrl}
            disabled={!pdfText}
          />
        </div>
      </div>
    </div>
  )
}
