/**
 * RelatedPanel.tsx — Semantic Scholar references + citations for a source.
 * Shows paper cards with "Add to project" button.
 */
import { useState, useEffect } from 'react'
import { relatedApi, sourcesApi, type RelatedPaper } from '../lib/api'

interface Props {
  projectId: string
  sourceId: string
  sourceUrl: string
}

type SubTab = 'references' | 'citations'

function PaperCard({
  paper,
  projectId,
  existingUrls,
  onAdded,
}: {
  paper: RelatedPaper
  projectId: string
  existingUrls: Set<string>
  onAdded: (url: string) => void
}) {
  const [adding, setAdding] = useState(false)
  const [added, setAdded] = useState(false)
  const [err, setErr] = useState('')

  const targetUrl = paper.arxiv_url || paper.pdf_url
  const isInProject = targetUrl ? existingUrls.has(targetUrl) : false
  const hasPdf = !!paper.pdf_url
  const hasArxiv = !!paper.arxiv_url

  const handleAdd = async () => {
    if (!targetUrl) return
    setAdding(true); setErr('')
    try {
      await sourcesApi.addUrl(projectId, targetUrl)
      setAdded(true)
      onAdded(targetUrl)
    } catch (e: any) {
      setErr(e.message?.slice(0, 60) || 'Failed')
    } finally {
      setAdding(false)
    }
  }

  return (
    <div style={{
      background: '#151515', border: '1px solid var(--border)', borderRadius: 10,
      padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 6,
      opacity: !hasPdf && !hasArxiv ? 0.55 : 1,
    }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#e5e7eb', lineHeight: 1.4 }}>
        {paper.title}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {paper.authors && (
          <span style={{ fontSize: 10, color: '#6b7280', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {paper.authors}
          </span>
        )}
        {paper.year && (
          <span style={{ fontSize: 10, color: '#4b5563', flexShrink: 0 }}>{paper.year}</span>
        )}
      </div>

      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 2 }}>
        {hasArxiv && (
          <span style={{ background: '#1e1b4b', border: '1px solid #312e81', color: '#818cf8', borderRadius: 4, padding: '1px 7px', fontSize: 10 }}>arXiv</span>
        )}
        {hasPdf && !hasArxiv && (
          <span style={{ background: '#14532d', border: '1px solid #166534', color: '#4ade80', borderRadius: 4, padding: '1px 7px', fontSize: 10 }}>PDF</span>
        )}
        {!hasPdf && !hasArxiv && (
          <span style={{ background: '#1c1917', border: '1px solid #44403c', color: '#6b7280', borderRadius: 4, padding: '1px 7px', fontSize: 10 }}>No PDF</span>
        )}

        <div style={{ flex: 1 }} />

        {paper.arxiv_url && (
          <a href={paper.arxiv_url} target="_blank" rel="noreferrer"
            style={{ color: '#6b7280', fontSize: 10, textDecoration: 'none' }}
            title="Open in browser"
          >🔗</a>
        )}

        {(isInProject || added) ? (
          <span style={{ fontSize: 10, color: '#4ade80', fontWeight: 600 }}>✓ In project</span>
        ) : targetUrl ? (
          <button
            onClick={handleAdd}
            disabled={adding}
            style={{
              background: adding ? '#2a2a2a' : 'var(--accent)',
              color: '#fff', border: 'none', borderRadius: 6,
              padding: '3px 10px', fontSize: 10, fontWeight: 600,
              cursor: adding ? 'not-allowed' : 'pointer', flexShrink: 0,
            }}
          >
            {adding ? <><span className="spinner" style={{ width: 8, height: 8, marginRight: 4 }} />Adding…</> : '＋ Add'}
          </button>
        ) : null}
      </div>
      {err && <div style={{ fontSize: 10, color: '#f87171' }}>⚠ {err}</div>}
    </div>
  )
}

export default function RelatedPanel({ projectId, sourceId }: Props) {
  const [data, setData] = useState<{ references: RelatedPaper[]; citations: RelatedPaper[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [subTab, setSubTab] = useState<SubTab>('references')
  const [existingUrls, setExistingUrls] = useState<Set<string>>(new Set())

  useEffect(() => {
    // Load existing source URLs for "already in project" detection
    sourcesApi.list(projectId).then(sources => {
      const urls = new Set<string>()
      sources.forEach(s => { if (s.url) { urls.add(s.url); urls.add(s.url.replace('/abs/', '/pdf/')) } })
      setExistingUrls(urls)
    }).catch(() => {})
  }, [projectId])

  useEffect(() => {
    setLoading(true); setError('')
    relatedApi.get(projectId, sourceId)
      .then(d => {
        setData(d)
        if (d.error && !d.references.length && !d.citations.length) setError(d.error)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [projectId, sourceId])

  const handleRefresh = async () => {
    setRefreshing(true); setError('')
    try {
      const d = await relatedApi.get(projectId, sourceId, true)
      setData(d)
      if (d.error && !d.references.length && !d.citations.length) setError(d.error)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setRefreshing(false)
    }
  }

  const papers = data ? (subTab === 'references' ? data.references : data.citations) : []
  const refCount = data?.references.length ?? 0
  const citeCount = data?.citations.length ?? 0

  const subTabBtn = (t: SubTab, label: string, count: number) => (
    <button
      onClick={() => setSubTab(t)}
      style={{
        background: 'none', border: 'none',
        borderBottom: `2px solid ${subTab === t ? 'var(--accent)' : 'transparent'}`,
        color: subTab === t ? '#e5e7eb' : '#6b7280',
        fontSize: 11, fontWeight: subTab === t ? 600 : 400,
        padding: '0 8px', height: '100%', cursor: 'pointer',
      }}
    >
      {label} {count > 0 && <span style={{ fontSize: 10, color: '#4b5563' }}>({count})</span>}
    </button>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--panel)' }}>
      {/* Header */}
      <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: '#d1d5db', flex: 1 }}>Related Papers</span>
        <button
          onClick={handleRefresh}
          disabled={refreshing || loading}
          title="Refresh from Semantic Scholar"
          style={{ background: 'none', border: '1px solid var(--border)', color: '#6b7280', borderRadius: 6, padding: '3px 8px', fontSize: 10, cursor: 'pointer' }}
        >
          {refreshing ? <span className="spinner" style={{ width: 10, height: 10 }} /> : '↺'}
        </button>
      </div>

      {/* Sub-tabs */}
      {!loading && !error && (
        <div style={{ height: 32, borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'stretch', paddingLeft: 8, flexShrink: 0 }}>
          {subTabBtn('references', 'References', refCount)}
          {subTabBtn('citations', 'Citing', citeCount)}
        </div>
      )}

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {loading && (
          <div style={{ textAlign: 'center', paddingTop: 40, color: '#4b5563' }}>
            <div className="spinner" style={{ margin: '0 auto 12px' }} />
            <div style={{ fontSize: 12 }}>Querying Semantic Scholar…</div>
          </div>
        )}

        {!loading && error && (
          <div style={{ textAlign: 'center', paddingTop: 40, color: '#6b7280', fontSize: 12, padding: '40px 16px' }}>
            <div style={{ fontSize: 28, marginBottom: 12 }}>🔍</div>
            <div>{error}</div>
            <div style={{ fontSize: 11, marginTop: 8, color: '#4b5563' }}>
              This paper may not be indexed in Semantic Scholar, or its URL doesn't contain a recognizable DOI or arXiv ID.
            </div>
          </div>
        )}

        {!loading && !error && papers.length === 0 && (
          <div style={{ textAlign: 'center', paddingTop: 40, color: '#4b5563', fontSize: 12 }}>
            <div style={{ fontSize: 28, marginBottom: 12 }}>📭</div>
            No {subTab} found.
          </div>
        )}

        {!loading && papers.map((p, i) => (
          <PaperCard
            key={p.s2_paper_id || i}
            paper={p}
            projectId={projectId}
            existingUrls={existingUrls}
            onAdded={url => setExistingUrls(prev => new Set([...prev, url]))}
          />
        ))}
      </div>
    </div>
  )
}
