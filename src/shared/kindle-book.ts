export const KINDLE_ORIGINS = ['https://read.amazon.com', 'https://ler.amazon.com.br', 'https://read.amazon.co.uk']

export function kindleBookUrl(value: string): { url: string; asin: string; key: string } {
  const invalid = () => new Error('Paste the URL of an open book from a supported Kindle reader, including its book ID (ASIN).')
  let parsed: URL
  try { parsed = new URL(value) } catch { throw invalid() }
  if (value.length > 4000 || !KINDLE_ORIGINS.includes(parsed.origin) || parsed.username || parsed.password) throw invalid()
  const asin = parsed.searchParams.get('asin') || parsed.pathname.match(/^\/(?:reader\/)?([A-Z0-9]{10})\/?$/i)?.[1]
  if (!asin || !/^[A-Z0-9]{10}$/i.test(asin)) throw invalid()
  const id = asin.toUpperCase()
  return { url: `${parsed.origin}/?asin=${id}`, asin: id, key: `${parsed.origin}/${id}` }
}

// A fragment stays in the browser; project details are not sent to Amazon.
export function kindleLaunchUrl(url: string, projectId: string, server: string): string {
  const target = new URL(kindleBookUrl(url).url)
  target.hash = new URLSearchParams({ pdfpal_project: projectId, pdfpal_server: new URL(server).origin }).toString()
  return target.href
}

export function sameLocalServer(left: string, right: string): boolean {
  try {
    const a = new URL(left), b = new URL(right)
    return [a, b].every(url => url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)) && a.port === b.port
  } catch { return false }
}
