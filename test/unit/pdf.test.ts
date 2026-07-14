import test from 'node:test'
import assert from 'node:assert/strict'
import { excerptFromText, resolvePdf, rewritePdfUrl, titleFromLines } from '../../src/core/pdf.js'
import { PdfpalError } from '../../src/core/types.js'

test('titleFromLines picks the largest-font line, not just the first real line', () => {
  // Regression: extractPdf used to join every line's text with spaces before
  // splitting on '\n' to find "the second line", which meant the title
  // fallback grabbed the entire first page as one 120-char blob instead of
  // just its title line.
  const lines = [
    { text: 'Attention Is All You Need', fontSize: 17.22 },
    { text: 'Ashish Vaswani, Noam Shazeer, Niki Parmar, et al.', fontSize: 9.96 },
  ]
  assert.equal(titleFromLines(lines), 'Attention Is All You Need')
})

test('titleFromLines skips a small-font permission notice printed above the title', () => {
  // Regression: some camera-ready PDFs (this is the real first page of the
  // "Attention Is All You Need" arXiv PDF) print a copyright/permission
  // notice above the title in a smaller font. Picking "the first
  // substantive line" grabbed the notice instead of the title.
  const lines = [
    { text: 'Provided proper attribution is provided, Google hereby grants permission to', fontSize: 11.96 },
    { text: 'reproduce the tables and figures in this paper solely for use in journalistic or', fontSize: 11.96 },
    { text: 'scholarly works.', fontSize: 11.96 },
    { text: 'Attention Is All You Need', fontSize: 17.22 },
    { text: 'Ashish Vaswani', fontSize: 9.96 },
  ]
  assert.equal(titleFromLines(lines), 'Attention Is All You Need')
})

test('titleFromLines skips blank or trivially short leading lines', () => {
  const lines = [{ text: '1', fontSize: 10 }, { text: '', fontSize: 10 }, { text: 'Real Paper Title Here', fontSize: 10 }]
  assert.equal(titleFromLines(lines), 'Real Paper Title Here')
})

test('excerptFromText skips straight to the content after an "Abstract" heading', () => {
  // Regression: a plain prefix of the extracted text often surfaces
  // boilerplate (arXiv watermarks, journal headers, copyright notices)
  // instead of anything about the paper. This is the real first page of the
  // "Attention Is All You Need" arXiv PDF, where a Google copyright notice
  // and the title/authors precede the actual abstract.
  const text = '[Page 1]\nProvided proper attribution is provided, Google hereby grants permission to reproduce the tables and figures in this paper solely for use in journalistic or scholarly works. Attention Is All You Need Ashish Vaswani Google Brain Abstract The dominant sequence transduction models are based on complex recurrent or convolutional neural networks.'
  assert.equal(excerptFromText(text), 'The dominant sequence transduction models are based on complex recurrent or convolutional neural networks.')
})

test('excerptFromText handles the "Abstract—" dash style used by IEEE-formatted papers', () => {
  const text = '[Page 1]\n1 Product quantization for nearest neighbor search Herve Jegou, Matthijs Douze Abstract— This paper introduces a product quantization based approach.'
  assert.equal(excerptFromText(text), 'This paper introduces a product quantization based approach.')
})

test('excerptFromText falls back to the raw prefix when no "Abstract" heading is found', () => {
  assert.equal(excerptFromText('[Page 1]\nJust some extracted text with no heading.'), 'Just some extracted text with no heading.')
  assert.equal(excerptFromText(null), '')
})

test('excerptFromText truncates on a word boundary and adds an ellipsis', () => {
  const body = 'word '.repeat(100).trim()
  const result = excerptFromText(`Abstract ${body}`, 20)
  assert.ok(result.endsWith('…'))
  assert.ok(result.length <= 21)
  assert.equal(result, 'word word word word…')
})

test('rewritePdfUrl removes tracking parameters and known paper paths', () => {
  assert.equal(rewritePdfUrl('https://arxiv.org/abs/2401.0001v2?utm_source=x'), 'https://arxiv.org/pdf/2401.0001')
  assert.equal(rewritePdfUrl('https://aclanthology.org/2024.test/'), 'https://aclanthology.org/2024.test.pdf')
  assert.equal(rewritePdfUrl('https://example.com/paper.pdf?ref=home'), 'https://example.com/paper.pdf')
})

test('resolvePdf accepts direct PDFs and discovers relative HTML links', async () => {
  const original = globalThis.fetch
  try {
    globalThis.fetch = (async () => new Response(Buffer.from('%PDF-direct'), { status: 200, headers: { 'content-type': 'application/pdf' } })) as typeof fetch
    assert.equal((await resolvePdf('https://example.test/paper')).bytes.subarray(0, 4).toString(), '%PDF')
    let calls = 0
    globalThis.fetch = (async () => {
      calls++
      const response = calls === 1
        ? new Response('<meta name="citation_pdf_url" content="/paper.pdf">', { status: 200, headers: { 'content-type': 'text/html' } })
        : new Response(Buffer.from('%PDF-found'), { status: 200, headers: { 'content-type': 'application/pdf' } })
      Object.defineProperty(response, 'url', { value: calls === 1 ? 'https://example.test/article' : 'https://example.test/paper.pdf' })
      return response
    }) as typeof fetch
    assert.equal((await resolvePdf('https://example.test/article')).bytes.subarray(0, 4).toString(), '%PDF')
  } finally { globalThis.fetch = original }
})

test('resolvePdf reports HTTP and missing-link failures', async () => {
  const original = globalThis.fetch
  try {
    globalThis.fetch = (async () => new Response('no', { status: 404 })) as typeof fetch
    await assert.rejects(() => resolvePdf('https://example.test/missing'),
      (error: unknown) => error instanceof PdfpalError && error.code === 'PDF_FETCH_FAILED')
    globalThis.fetch = (async () => new Response('<html>none</html>', { status: 200, headers: { 'content-type': 'text/html' } })) as typeof fetch
    await assert.rejects(() => resolvePdf('https://example.test/article'),
      (error: unknown) => error instanceof PdfpalError && error.code === 'PDF_LINK_NOT_FOUND')
  } finally { globalThis.fetch = original }
})

test('resolvePdf turns aborts into actionable timeout errors', async () => {
  const original = globalThis.fetch
  try {
    globalThis.fetch = (async () => { throw new DOMException('timed out', 'TimeoutError') }) as typeof fetch
    await assert.rejects(() => resolvePdf('https://example.test/slow.pdf'),
      (error: unknown) => error instanceof PdfpalError && error.code === 'PDF_FETCH_TIMEOUT' && /example\.test/.test(error.message))
  } finally { globalThis.fetch = original }
})
