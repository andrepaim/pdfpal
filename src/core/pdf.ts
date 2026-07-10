import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { load } from 'cheerio'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { PdfpalError } from './types.js'

const HEADERS = { 'user-agent': 'Mozilla/5.0 pdfpal/2.0', accept: 'application/pdf,text/html;q=0.9,*/*;q=0.8' }

async function fetchBytes(url: string, timeoutMs = 45_000): Promise<{ response: Response; bytes: Buffer }> {
  try {
    const response = await fetch(url, { headers: HEADERS, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) })
    return { response, bytes: Buffer.from(await response.arrayBuffer()) }
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
    if (timedOut) throw new PdfpalError('PDF_FETCH_TIMEOUT', `Timed out downloading the PDF from ${new URL(url).hostname}. Try again or use another open-access URL.`, 1)
    throw error
  }
}

export function rewritePdfUrl(input: string): string {
  const url = new URL(input)
  for (const key of [...url.searchParams.keys()]) if (key.startsWith('utm_') || ['ref', 'source', 'campaign'].includes(key)) url.searchParams.delete(key)
  let value = url.toString()
  value = value.replace(/^https?:\/\/arxiv\.org\/(?:abs|html)\/([^?#]+)/, (_, slug: string) => `https://arxiv.org/pdf/${slug.replace(/v\d+$/, '')}`)
  value = value.replace(/^(https?:\/\/openreview\.net)\/forum\?id=([^&]+)/, '$1/pdf?id=$2')
  const acl = value.match(/^https?:\/\/aclanthology\.org\/([^/?#]+)\/?$/)
  if (acl) value = `https://aclanthology.org/${acl[1]}.pdf`
  const pmlr = value.match(/^(https?:\/\/proceedings\.mlr\.press\/v\d+)\/([a-z0-9]+)\.html/)
  if (pmlr) value = `${pmlr[1]}/${pmlr[2]}/${pmlr[2]}.pdf`
  return value
}

export async function resolvePdf(input: string): Promise<{ bytes: Buffer; url: string }> {
  let url = rewritePdfUrl(input)
  let fetched: { response: Response; bytes: Buffer }
  try {
    fetched = await fetchBytes(url)
  } catch (error) {
    // arxiv.org occasionally throttles or stalls large downloads. Its export
    // host serves the same canonical PDF and is safe to use as a retry.
    if (error instanceof PdfpalError && error.code === 'PDF_FETCH_TIMEOUT' && new URL(url).hostname === 'arxiv.org') {
      url = url.replace('://arxiv.org/', '://export.arxiv.org/')
      fetched = await fetchBytes(url)
    } else throw error
  }
  let { response, bytes } = fetched
  if (!response.ok) throw new PdfpalError('PDF_FETCH_FAILED', `Failed to fetch PDF: HTTP ${response.status}`)
  if (bytes.subarray(0, 4).toString() === '%PDF') return { bytes, url: response.url }
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('html')) throw new PdfpalError('NOT_A_PDF', 'The source did not return a PDF')
  const $ = load(bytes.toString('utf8'))
  const href = $('meta[name="citation_pdf_url"],meta[property="citation_pdf_url"]').attr('content')
    ?? $('a[href*=".pdf"]').first().attr('href')
  if (!href) throw new PdfpalError('PDF_LINK_NOT_FOUND', 'Could not find a PDF link on the page')
  url = new URL(href, response.url).toString()
  ;({ response, bytes } = await fetchBytes(rewritePdfUrl(url)))
  if (!response.ok) throw new PdfpalError('PDF_FETCH_FAILED', `Failed to fetch discovered PDF: HTTP ${response.status}`)
  if (bytes.subarray(0, 4).toString() !== '%PDF') throw new PdfpalError('NOT_A_PDF', 'Discovered link did not return a PDF')
  return { bytes, url: response.url }
}

export async function extractPdf(bytes: Buffer): Promise<{ text: string; pages: number; title: string }> {
  const document = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise
  if (document.numPages > 50) throw new PdfpalError('PDF_TOO_LARGE', `PDFs over 50 pages are not supported (${document.numPages} pages)`)
  const parts: string[] = []
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
    const page = await document.getPage(pageNumber)
    const content = await page.getTextContent()
    const text = content.items.map(item => 'str' in item ? item.str : '').join(' ').replace(/\s+/g, ' ').trim()
    if (text) parts.push(`[Page ${pageNumber}]\n${text}`)
  }
  const metadata = await document.getMetadata().catch(() => null)
  let title = String((metadata?.info as Record<string, unknown> | undefined)?.Title ?? '').trim()
  if (/^(microsoft word|untitled)/i.test(title) || title.length > 200) title = ''
  if (!title) title = parts[0]?.split('\n')[1]?.slice(0, 120) ?? ''
  await document.destroy()
  return { text: parts.join('\n\n'), pages: document.numPages, title }
}

export function storePdf(bytes: Buffer, filesDir: string, sourceId: string): { localPath: string; hash: string } {
  fs.mkdirSync(filesDir, { recursive: true })
  const localPath = path.join(filesDir, `${sourceId}.pdf`)
  const temporary = `${localPath}.${process.pid}.tmp`
  fs.writeFileSync(temporary, bytes, { mode: 0o600 })
  fs.renameSync(temporary, localPath)
  return { localPath, hash: createHash('sha256').update(bytes).digest('hex') }
}
