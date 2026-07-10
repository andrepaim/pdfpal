import test from 'node:test'
import assert from 'node:assert/strict'
import { resolvePdf, rewritePdfUrl } from '../../src/core/pdf.js'
import { PdfpalError } from '../../src/core/types.js'

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
