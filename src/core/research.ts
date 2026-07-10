import type { Database } from 'better-sqlite3'
import { PdfpalError } from './types.js'

const S2_BASE = 'https://api.semanticscholar.org/graph/v1'
const FIELDS = 'title,authors,year,externalIds,openAccessPdf,venue,citationCount'

type S2Paper = {
  paperId?: string
  title?: string
  authors?: Array<{ name?: string }>
  year?: number
  externalIds?: { ArXiv?: string }
  openAccessPdf?: { url?: string }
}

export function paperIdFromUrl(value: string): string | null {
  const arxiv = value.match(/arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})(?:v\d+)?/i)
  if (arxiv) return `arXiv:${arxiv[1]}`
  const doi = value.match(/(?:doi\.org|\/doi\/(?:pdf\/)?)(10\.\d{4,}\/[^\s?#&]+)/i)
  return doi ? `DOI:${doi[1]}` : null
}

function normalize(paper: S2Paper, relation: 'reference' | 'citation') {
  const arxiv = paper.externalIds?.ArXiv
  return {
    s2_paper_id: paper.paperId ?? null,
    title: paper.title ?? '',
    authors: (paper.authors ?? []).slice(0, 3).map(author => author.name ?? '').filter(Boolean).join(', ') + ((paper.authors?.length ?? 0) > 3 ? ', et al.' : ''),
    year: paper.year ?? null,
    arxiv_url: arxiv ? `https://arxiv.org/abs/${arxiv}` : null,
    pdf_url: paper.openAccessPdf?.url || (arxiv ? `https://arxiv.org/pdf/${arxiv}` : null),
    relation,
  }
}

async function findByTitle(title: string): Promise<string | null> {
  const response = await fetch(`${S2_BASE}/paper/search?query=${encodeURIComponent(title)}&fields=title,paperId&limit=1`, { signal: AbortSignal.timeout(15_000) })
  if (!response.ok) return null
  const data = await response.json() as { data?: Array<{ paperId?: string }> }
  return data.data?.[0]?.paperId ?? null
}

export async function relatedPapers(db: Database, projectId: string, sourceId: string, refresh = false) {
  const source = db.prepare('SELECT url,title FROM sources WHERE id=? AND project_id=?').get(sourceId, projectId) as { url: string | null; title: string | null } | undefined
  if (!source) throw new PdfpalError('SOURCE_NOT_FOUND', 'Source not found', 3)
  if (!refresh) {
    const cached = db.prepare('SELECT * FROM source_related WHERE source_id=? ORDER BY relation,id').all(sourceId) as Array<Record<string, unknown>>
    if (cached.length) return { references: cached.filter(row => row.relation === 'reference'), citations: cached.filter(row => row.relation === 'citation'), cached: true }
  }
  try {
    const paperId = paperIdFromUrl(source.url ?? '') || (source.title ? await findByTitle(source.title) : null)
    if (!paperId) return { references: [], citations: [], cached: false, paper_id: null, error: 'Paper not found in Semantic Scholar' }
    const output: { references: ReturnType<typeof normalize>[]; citations: ReturnType<typeof normalize>[] } = { references: [], citations: [] }
    for (const relation of ['references', 'citations'] as const) {
      const response = await fetch(`${S2_BASE}/paper/${encodeURIComponent(paperId)}/${relation}?fields=${encodeURIComponent(FIELDS)}&limit=${relation === 'references' ? 60 : 20}`, { signal: AbortSignal.timeout(15_000) })
      if (response.status === 429) return { ...output, cached: false, paper_id: paperId, error: 'Semantic Scholar rate limit — retry in a moment' }
      if (!response.ok) continue
      const data = await response.json() as { data?: Array<{ citedPaper?: S2Paper; citingPaper?: S2Paper }> }
      output[relation] = (data.data ?? []).map(item => item.citedPaper ?? item.citingPaper).filter((paper): paper is S2Paper => Boolean(paper?.title)).map(paper => normalize(paper, relation === 'references' ? 'reference' : 'citation'))
    }
    const timestamp = new Date().toISOString()
    db.transaction(() => {
      db.prepare('DELETE FROM source_related WHERE source_id=?').run(sourceId)
      const insert = db.prepare('INSERT INTO source_related(source_id,s2_paper_id,title,authors,year,arxiv_url,pdf_url,relation,fetched_at) VALUES (?,?,?,?,?,?,?,?,?)')
      for (const paper of [...output.references, ...output.citations]) insert.run(sourceId, paper.s2_paper_id, paper.title, paper.authors, paper.year, paper.arxiv_url, paper.pdf_url, paper.relation, timestamp)
    })()
    return { ...output, cached: false, paper_id: paperId }
  } catch (error) {
    return { references: [], citations: [], cached: false, error: error instanceof Error ? error.message : String(error) }
  }
}
