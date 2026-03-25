import { useState, useCallback, useRef } from 'react'
import PdfViewer from './components/PdfViewer'
import ChatPanel from './components/ChatPanel'

export default function App() {
  const [pdfUrl, setPdfUrl] = useState('')
  const [loadedUrl, setLoadedUrl] = useState('')
  const [localFile, setLocalFile] = useState<File | null>(null)
  const [localObjectUrl, setLocalObjectUrl] = useState('')
  const [pdfText, setPdfText] = useState('')
  const [extractError, setExtractError] = useState('')
  const [extracting, setExtracting] = useState(false)
  const [pdfPages, setPdfPages] = useState(0)
  const [pdfLabel, setPdfLabel] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const resetState = () => {
    setExtractError('')
    setPdfText('')
    setExtracting(true)
    setPdfPages(0)
    setPdfLabel('')
    if (localObjectUrl) {
      URL.revokeObjectURL(localObjectUrl)
      setLocalObjectUrl('')
    }
    setLocalFile(null)
    setLoadedUrl('')
  }

  const handleLoad = useCallback(async () => {
    if (!pdfUrl.trim()) return
    resetState()

    try {
      const res = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: pdfUrl.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        const detail = data.detail
        setExtractError(
          typeof detail === 'object' && detail?.message
            ? detail.message
            : typeof detail === 'string' ? detail : 'Failed to extract PDF'
        )
        setExtracting(false)
        return
      }
      setPdfText(data.text)
      setPdfPages(data.pages)
      setPdfLabel(data.title || pdfUrl.trim().split('/').pop() || 'PDF')
      setLoadedUrl(pdfUrl.trim())
    } catch (e: any) {
      setExtractError(e.message || 'Network error')
    } finally {
      setExtracting(false)
    }
  }, [pdfUrl, localObjectUrl])

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    resetState()
    setPdfUrl('')

    const objUrl = URL.createObjectURL(file)
    setLocalObjectUrl(objUrl)
    setLocalFile(file)
    setPdfLabel(file.name)

    const formData = new FormData()
    formData.append('file', file)

    try {
      const res = await fetch('/api/extract-upload', {
        method: 'POST',
        body: formData,
      })
      const data = await res.json()
      if (!res.ok) {
        const detail = data.detail
        setExtractError(
          typeof detail === 'object' && detail?.message
            ? detail.message
            : typeof detail === 'string' ? detail : 'Failed to extract PDF'
        )
        setExtracting(false)
        return
      }
      setPdfText(data.text)
      setPdfPages(data.pages)
      if (data.title) setPdfLabel(data.title)
    } catch (e: any) {
      setExtractError(e.message || 'Network error')
    } finally {
      setExtracting(false)
      // reset input so same file can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }, [localObjectUrl])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleLoad()
  }

  const viewerUrl = localObjectUrl || (loadedUrl ? `/api/proxy-pdf?url=${encodeURIComponent(loadedUrl)}` : '')
  const chatPdfUrl = localFile ? `local:${localFile.name}` : loadedUrl

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
          placeholder="Paste a PDF URL…"
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
          {extracting && !localFile ? <span className="spinner" /> : 'Load'}
        </button>

        {/* Divider */}
        <div style={{ color: '#3a3a3a', fontSize: 20, userSelect: 'none' }}>|</div>

        {/* Local file button */}
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={extracting}
          title="Open local PDF file"
          style={{
            background: '#2a2a2a',
            color: '#d1d5db',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '8px 14px',
            fontSize: 14,
            cursor: extracting ? 'not-allowed' : 'pointer',
            whiteSpace: 'nowrap',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            transition: 'background 0.15s',
          }}
        >
          {extracting && localFile ? <span className="spinner" /> : '📂 Open file'}
        </button>

        {/* Filename label */}
        {pdfLabel && !extracting && (
          <div style={{
            fontSize: 12,
            color: '#6b7280',
            maxWidth: 180,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }} title={pdfLabel}>
            {pdfLabel}
          </div>
        )}
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
          <PdfViewer url={viewerUrl} pages={pdfPages} />
        </div>

        {/* Chat panel — 45% */}
        <div style={{ width: '45%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <ChatPanel
            pdfText={pdfText}
            pdfUrl={chatPdfUrl}
            disabled={!pdfText}
          />
        </div>
      </div>
    </div>
  )
}
