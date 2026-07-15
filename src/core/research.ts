import type { Database } from 'better-sqlite3'
import { PdfpalError } from './types.js'

const S2_BASE = 'https://api.semanticscholar.org/graph/v1'
const S2_FIELDS = 'title,authors,year,externalIds,openAccessPdf,venue,citationCount'
const OPENALEX_BASE = 'https://api.openalex.org'
const OPENALEX_FOCAL_FIELDS = 'id,title,display_name,referenced_works'
const OPENALEX_RELATED_FIELDS = 'id,title,display_name,authorships,publication_year,best_oa_location,locations,ids'
const REFERENCE_LIMIT = 200
const CITATION_LIMIT = 20
// Both providers cap a single response well below REFERENCE_LIMIT, so a paper
// with a long bibliography has to be assembled from several requests.
const S2_PAGE_SIZE = 100
const OPENALEX_ID_BATCH = 50

// Semantic Scholar's unauthenticated quota is small and shared per IP, not
// per caller — an optional key (free from semanticscholar.org) is scoped to
// this app instead and raises the limit substantially.
function s2Headers(apiKey: string): HeadersInit | undefined {
  return apiKey ? { 'x-api-key': apiKey } : undefined
}

type S2Paper = {
  paperId?: string
  title?: string
  authors?: Array<{ name?: string }>
  year?: number
  externalIds?: { ArXiv?: string }
  openAccessPdf?: { url?: string }
}

type OpenAlexLocation = {
  landing_page_url?: string
  pdf_url?: string
}

type OpenAlexWork = {
  id?: string
  title?: string
  display_name?: string
  authorships?: Array<{ author?: { display_name?: string }; raw_author_name?: string }>
  publication_year?: number
  referenced_works?: string[]
  ids?: { arxiv?: string }
  best_oa_location?: OpenAlexLocation | null
  locations?: OpenAlexLocation[]
}

type RelatedPaper = {
  s2_paper_id: string | null
  title: string
  authors: string
  year: number | null
  arxiv_url: string | null
  pdf_url: string | null
  relation: 'reference' | 'citation'
}

type RelatedOutput = {
  references: RelatedPaper[]
  citations: RelatedPaper[]
}

type RelatedProvider = 'semantic_scholar' | 'openalex'

function emptyOutput(): RelatedOutput {
  return { references: [], citations: [] }
}

function doiFromUrl(value: string): string | null {
  const doi = value.match(/(?:(?:dx\.)?doi\.org\/|\/doi\/(?:pdf\/)?)(10\.\d{4,}\/[^\s?#&]+)/i)?.[1]
  if (!doi) return null
  try { return decodeURIComponent(doi) } catch { return doi }
}

export function paperIdFromUrl(value: string): string | null {
  const arxiv = value.match(/arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})(?:v\d+)?/i)
  if (arxiv) return `arXiv:${arxiv[1]}`
  const doi = doiFromUrl(value)
  return doi ? `DOI:${doi}` : null
}

function normalize(paper: S2Paper, relation: 'reference' | 'citation'): RelatedPaper {
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

function openAlexId(value: string | undefined): string | null {
  return value?.match(/(?:^|\/)(W\d+)$/i)?.[1]?.toUpperCase() ?? null
}

function openAlexTitle(paper: OpenAlexWork): string {
  return paper.title?.trim() || paper.display_name?.trim() || ''
}

function arxivUrlFromOpenAlex(paper: OpenAlexWork): string | null {
  const candidates = [
    paper.ids?.arxiv,
    paper.best_oa_location?.landing_page_url,
    paper.best_oa_location?.pdf_url,
    ...(paper.locations ?? []).flatMap(location => [location.landing_page_url, location.pdf_url]),
  ]
  for (const candidate of candidates) {
    if (!candidate) continue
    const identifier = paperIdFromUrl(candidate)
    if (identifier?.startsWith('arXiv:')) return `https://arxiv.org/abs/${identifier.slice('arXiv:'.length)}`
  }
  return null
}

function normalizeOpenAlex(paper: OpenAlexWork, relation: 'reference' | 'citation'): RelatedPaper {
  const arxivUrl = arxivUrlFromOpenAlex(paper)
  const arxivId = arxivUrl?.split('/').at(-1)
  const pdfUrl = paper.best_oa_location?.pdf_url
    || paper.locations?.find(location => location.pdf_url)?.pdf_url
    || (arxivId ? `https://arxiv.org/pdf/${arxivId}` : null)
  const authors = (paper.authorships ?? [])
    .slice(0, 3)
    .map(authorship => authorship.author?.display_name ?? authorship.raw_author_name ?? '')
    .filter(Boolean)
  const paperId = openAlexId(paper.id)
  return {
    // This column predates the OpenAlex fallback. Prefix the ID so cached
    // rows retain the provider and never collide with a Semantic Scholar ID.
    s2_paper_id: paperId ? `openalex:${paperId}` : null,
    title: openAlexTitle(paper),
    authors: authors.join(', ') + ((paper.authorships?.length ?? 0) > 3 ? ', et al.' : ''),
    year: paper.publication_year ?? null,
    arxiv_url: arxivUrl,
    pdf_url: pdfUrl,
    relation,
  }
}

/**
 * Best-effort clean title for an arXiv/DOI URL via Semantic Scholar. Returns
 * null (never throws) when the URL isn't recognised, the lookup fails, or the
 * network is unavailable, so callers can fall back to PDF-derived titles.
 */
export async function titleFromUrl(url: string, apiKey = ''): Promise<string | null> {
  const paperId = paperIdFromUrl(url)
  if (!paperId) return null
  try {
    const response = await fetch(`${S2_BASE}/paper/${encodeURIComponent(paperId)}?fields=title`, { headers: s2Headers(apiKey), signal: AbortSignal.timeout(10_000) })
    if (!response.ok) return null
    const data = await response.json() as { title?: string }
    return data.title?.trim() || null
  } catch { return null }
}

async function findByTitle(title: string, apiKey: string): Promise<string | null> {
  try {
    const response = await fetch(`${S2_BASE}/paper/search?query=${encodeURIComponent(title)}&fields=title,paperId&limit=1`, { headers: s2Headers(apiKey), signal: AbortSignal.timeout(15_000) })
    if (!response.ok) return null
    const data = await response.json() as { data?: Array<{ paperId?: string }> }
    return data.data?.[0]?.paperId ?? null
  } catch {
    return null
  }
}

function titleKey(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** Avoid treating a loose full-text search hit as the user's paper. */
function isTitleMatch(sourceTitle: string, candidateTitle: string): boolean {
  const source = titleKey(sourceTitle)
  const candidate = titleKey(candidateTitle)
  if (!source || !candidate) return false
  if (source === candidate) return true
  if (source.length < 16 || candidate.length < 16) return false
  const sourceTerms = new Set(source.split(' '))
  const candidateTerms = new Set(candidate.split(' '))
  const sharedTerms = [...sourceTerms].filter(term => candidateTerms.has(term)).length
  return sharedTerms / Math.max(sourceTerms.size, candidateTerms.size) >= 0.8
}

function openAlexWorksUrl(params: Record<string, string>): string {
  const url = new URL(`${OPENALEX_BASE}/works`)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return url.toString()
}

async function findOpenAlexWork(source: { url: string | null; title: string | null }): Promise<OpenAlexWork | null> {
  const doi = doiFromUrl(source.url ?? '')
  if (doi) {
    const url = new URL(`${OPENALEX_BASE}/works/doi:${encodeURIComponent(doi)}`)
    url.searchParams.set('select', OPENALEX_FOCAL_FIELDS)
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) })
    if (response.ok) return await response.json() as OpenAlexWork
  }

  if (!source.title?.trim()) return null
  const response = await fetch(openAlexWorksUrl({
    search: source.title,
    per_page: '5',
    select: OPENALEX_FOCAL_FIELDS,
  }), { signal: AbortSignal.timeout(15_000) })
  if (!response.ok) return null
  const data = await response.json() as { results?: OpenAlexWork[] }
  return data.results?.find(work => isTitleMatch(source.title!, openAlexTitle(work))) ?? null
}

async function openAlexRelated(source: { url: string | null; title: string | null }): Promise<{ output: RelatedOutput; paperId: string } | null> {
  const paper = await findOpenAlexWork(source)
  const paperId = openAlexId(paper?.id)
  if (!paper || !paperId) return null

  const output = emptyOutput()
  const referenceIds = [...new Set((paper.referenced_works ?? []).map(openAlexId).filter((id): id is string => Boolean(id)))].slice(0, REFERENCE_LIMIT)
  const papersById = new Map<string, OpenAlexWork>()
  for (let start = 0; start < referenceIds.length; start += OPENALEX_ID_BATCH) {
    const batch = referenceIds.slice(start, start + OPENALEX_ID_BATCH)
    const response = await fetch(openAlexWorksUrl({
      filter: `openalex_id:${batch.join('|')}`,
      per_page: String(batch.length),
      select: OPENALEX_RELATED_FIELDS,
    }), { signal: AbortSignal.timeout(15_000) })
    if (!response.ok) continue
    const data = await response.json() as { results?: OpenAlexWork[] }
    for (const item of data.results ?? []) {
      const id = openAlexId(item.id)
      if (id) papersById.set(id, item)
    }
  }
  // Ordered by the focal paper's bibliography, not by response arrival.
  output.references = referenceIds.flatMap(id => {
    const referencedPaper = papersById.get(id)
    return referencedPaper && openAlexTitle(referencedPaper) ? [normalizeOpenAlex(referencedPaper, 'reference')] : []
  })

  const citationsResponse = await fetch(openAlexWorksUrl({
    filter: `cites:${paperId}`,
    per_page: String(CITATION_LIMIT),
    sort: 'cited_by_count:desc',
    select: OPENALEX_RELATED_FIELDS,
  }), { signal: AbortSignal.timeout(15_000) })
  if (citationsResponse.ok) {
    const data = await citationsResponse.json() as { results?: OpenAlexWork[] }
    output.citations = (data.results ?? [])
      .filter(citingPaper => Boolean(openAlexTitle(citingPaper)))
      .map(citingPaper => normalizeOpenAlex(citingPaper, 'citation'))
  }
  return { output, paperId }
}

async function semanticScholarRelated(paperId: string, apiKey: string): Promise<{ output: RelatedOutput } | null | { error: string }> {
  const output = emptyOutput()
  try {
    for (const relation of ['references', 'citations'] as const) {
      const wanted = relation === 'references' ? REFERENCE_LIMIT : CITATION_LIMIT
      const papers: S2Paper[] = []
      for (let offset = 0; offset < wanted; offset += S2_PAGE_SIZE) {
        const limit = Math.min(S2_PAGE_SIZE, wanted - offset)
        const response = await fetch(`${S2_BASE}/paper/${encodeURIComponent(paperId)}/${relation}?fields=${encodeURIComponent(S2_FIELDS)}&offset=${offset}&limit=${limit}`, { headers: s2Headers(apiKey), signal: AbortSignal.timeout(15_000) })
        if (response.status === 429) return { error: 'Semantic Scholar rate limit — retry in a moment' }
        if (!response.ok) {
          // A DOI/arXiv URL can be syntactically valid without being present in S2.
          // Let the caller try a title match and then OpenAlex in that case.
          if (offset === 0) return null
          // A later page failing means the paper does exist here, so keep the
          // pages already collected rather than falling through to OpenAlex.
          break
        }
        const data = await response.json() as { data?: Array<{ citedPaper?: S2Paper; citingPaper?: S2Paper }> }
        papers.push(...(data.data ?? []).map(item => item.citedPaper ?? item.citingPaper).filter((paper): paper is S2Paper => Boolean(paper?.title)))
        if ((data.data?.length ?? 0) < limit) break
      }
      output[relation] = papers.map(paper => normalize(paper, relation === 'references' ? 'reference' : 'citation'))
    }
  } catch {
    return null
  }
  return { output }
}

function cacheRelated(db: Database, sourceId: string, output: RelatedOutput): void {
  const timestamp = new Date().toISOString()
  db.transaction(() => {
    db.prepare('DELETE FROM source_related WHERE source_id=?').run(sourceId)
    const insert = db.prepare('INSERT INTO source_related(source_id,s2_paper_id,title,authors,year,arxiv_url,pdf_url,relation,fetched_at) VALUES (?,?,?,?,?,?,?,?,?)')
    for (const paper of [...output.references, ...output.citations]) insert.run(sourceId, paper.s2_paper_id, paper.title, paper.authors, paper.year, paper.arxiv_url, paper.pdf_url, paper.relation, timestamp)
  })()
}

function cachedProvider(rows: Array<Record<string, unknown>>): RelatedProvider {
  return rows.some(row => String(row.s2_paper_id ?? '').startsWith('openalex:')) ? 'openalex' : 'semantic_scholar'
}

export async function relatedPapers(db: Database, projectId: string, sourceId: string, apiKey = '', refresh = false) {
  const source = db.prepare('SELECT url,title FROM sources WHERE id=? AND project_id=?').get(sourceId, projectId) as { url: string | null; title: string | null } | undefined
  if (!source) throw new PdfpalError('SOURCE_NOT_FOUND', 'Source not found', 3)
  if (!refresh) {
    const cached = db.prepare('SELECT * FROM source_related WHERE source_id=? ORDER BY relation,id').all(sourceId) as Array<Record<string, unknown>>
    if (cached.length) return { references: cached.filter(row => row.relation === 'reference'), citations: cached.filter(row => row.relation === 'citation'), cached: true, provider: cachedProvider(cached) }
  }
  try {
    const sourcePaperId = paperIdFromUrl(source.url ?? '')
    if (sourcePaperId) {
      const result = await semanticScholarRelated(sourcePaperId, apiKey)
      if (result && 'error' in result) return { ...emptyOutput(), cached: false, paper_id: sourcePaperId, error: result.error }
      if (result) {
        cacheRelated(db, sourceId, result.output)
        return { ...result.output, cached: false, paper_id: sourcePaperId, provider: 'semantic_scholar' as const }
      }
    }

    const titlePaperId = source.title ? await findByTitle(source.title, apiKey) : null
    if (titlePaperId && titlePaperId !== sourcePaperId) {
      const result = await semanticScholarRelated(titlePaperId, apiKey)
      if (result && 'error' in result) return { ...emptyOutput(), cached: false, paper_id: titlePaperId, error: result.error }
      if (result) {
        cacheRelated(db, sourceId, result.output)
        return { ...result.output, cached: false, paper_id: titlePaperId, provider: 'semantic_scholar' as const }
      }
    }

    const fallback = await openAlexRelated(source)
    if (fallback) {
      cacheRelated(db, sourceId, fallback.output)
      return { ...fallback.output, cached: false, paper_id: `openalex:${fallback.paperId}`, provider: 'openalex' as const }
    }
    return { ...emptyOutput(), cached: false, paper_id: null, error: 'Paper not found in Semantic Scholar or OpenAlex' }
  } catch (error) {
    return { ...emptyOutput(), cached: false, error: error instanceof Error ? error.message : String(error) }
  }
}
