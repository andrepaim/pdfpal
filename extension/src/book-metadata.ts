import type { Metadata } from './shared';

// Keep this function self-contained: the background worker also executes it in
// each reader frame, including tabs opened before the extension was reloaded.
export function readBookMetadata(): Metadata {
  const clean = (value: string | null | undefined) => (value || '').replace(/\s+/g, ' ').trim().slice(0, 1000);
  const titleText = (value: string | null | undefined) => {
    const text = clean(value).replace(/\s*[-|–—]\s*(?:Amazon\s+)?Kindle(?:\s+(?:Cloud Reader|for Web))?\s*$/i, '')
      .replace(/^(?:Amazon\s+)?Kindle(?:\s+(?:Cloud Reader|for Web))?\s*[-|–—]\s*/i, '');
    return /^(?:(?:Amazon\s+)?Kindle(?:\s+(?:Cloud Reader|for Web))?|Kindle book)$/i.test(text) ? '' : text;
  };
  const read = (selectors: string, title = false) => {
    for (const selector of selectors.split(',')) {
      for (const element of document.querySelectorAll(selector)) {
        const value = [element.getAttribute('content'), element.textContent, element.getAttribute('title'), element.getAttribute('aria-label')].map(clean).find(Boolean) || '';
        const result = title ? titleText(value) : value;
        if (result) return result;
      }
    }
    return '';
  };
  const url = /^https?:/.test(location.href) ? location.href : document.referrer;
  let asin = '';
  try { const parsed = new URL(url); asin = parsed.searchParams.get('asin') || parsed.pathname.match(/\/([A-Z0-9]{10})(?:\/|$)/i)?.[1] || ''; } catch { /* Some child frames have no book URL. */ }
  return {
    title: read('[data-testid="book-title"],#reader-book-title,.kp-notebook-title,#kr-title,.top-chrome ion-title,ion-header ion-title,meta[property="og:title"],meta[name="title"]', true) || titleText(document.title),
    author: read('[data-testid="book-author"],.kp-notebook-author,[itemprop="author"],meta[name="author"]'),
    location: read('[data-testid="reader-location"],#kindleReader_footer .location,ion-footer ion-title,[aria-label^="Location "],[aria-label^="Localização "]'),
    url, asin,
  };
}
