import { useState } from 'react'
import { sourcesApi, type Source } from '../lib/api'

export default function KindleBookForm({ projectId, onAdded, onClose }: {
  projectId: string; onAdded: (source: Source) => void; onClose: () => void
}) {
  const [url, setUrl] = useState(''), [title, setTitle] = useState(''), [author, setAuthor] = useState('')
  const [saving, setSaving] = useState(false), [error, setError] = useState('')
  const inputStyle = { background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: 10, color: '#e5e7eb', font: 'inherit', width: '100%', boxSizing: 'border-box' as const }
  return <form onSubmit={async event => {
    event.preventDefault()
    if (saving) return
    setSaving(true); setError('')
    try { onAdded(await sourcesApi.addKindle(projectId, { url, title, author })) }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not add this book.') }
    finally { setSaving(false) }
  }} style={{ display: 'flex', flexDirection: 'column', gap: 12, color: '#e5e7eb', fontSize: 13 }}>
    <label>Kindle reader URL<input autoFocus required type="url" maxLength={4000} value={url} onChange={e => setUrl(e.target.value)} placeholder="https://read.amazon.com/?asin=…" style={inputStyle} /></label>
    <label>Book title<input required maxLength={1000} value={title} onChange={e => setTitle(e.target.value)} style={inputStyle} /></label>
    <label>Author (optional)<input maxLength={1000} value={author} onChange={e => setAuthor(e.target.value)} style={inputStyle} /></label>
    <p style={{ color: '#9ca3af', fontSize: 12, margin: 0 }}>Copy the address while your book is open in Kindle for Web. This saves a link to the book; its full text is not imported.</p>
    {error && <div role="alert" style={{ color: '#f87171' }}>{error}</div>}
    <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
      <button type="button" onClick={onClose} style={{ ...inputStyle, width: 'auto', cursor: 'pointer' }}>Cancel</button>
      <button disabled={saving || !url.trim() || !title.trim()} style={{ ...inputStyle, width: 'auto', background: 'var(--accent)', cursor: 'pointer' }}>{saving ? 'Adding…' : 'Add Kindle book'}</button>
    </div>
  </form>
}
