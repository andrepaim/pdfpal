"""
pdf_resolver.py — Smart PDF URL resolution.

Strategy:
1. Apply known URL rewrite rules (fast, no extra fetch)
2. Fetch the URL; if content-type is application/pdf, done
3. If HTML, scrape the page for a PDF link
"""

import re
from urllib.parse import urljoin, urlparse
import httpx
import json

# ---------------------------------------------------------------------------
# Rewrite rules for known sites
# ---------------------------------------------------------------------------

def strip_tracking_params(url: str) -> str:
    """Strip utm_* and other tracking query params."""
    from urllib.parse import urlparse, parse_qs, urlencode, urlunparse
    parsed = urlparse(url)
    qs = {k: v for k, v in parse_qs(parsed.query, keep_blank_values=True).items()
          if not k.startswith('utm_') and k not in ('ref', 'source', 'campaign')}
    cleaned = urlunparse(parsed._replace(query=urlencode(qs, doseq=True)))
    return cleaned


def extract_doi(url: str) -> str | None:
    """Extract a DOI from a URL."""
    # doi.org/10.xxxx/...
    m = re.search(r'(?:doi\.org|/doi/(?:pdf/)?)/(10\.\d{4,}/[^\s?#&]+)', url)
    if m:
        return m.group(1)
    return None


async def resolve_via_unpaywall(doi: str, client: httpx.AsyncClient) -> tuple[bytes, str] | None:
    """
    Look up a DOI in Unpaywall and fetch the best open-access PDF.
    Returns (pdf_bytes, url) or None.
    """
    try:
        r = await client.get(
            f"https://api.unpaywall.org/v2/{doi}",
            params={"email": "pdfpal@pdfpal.app"},
            timeout=10,
        )
        if r.status_code != 200:
            return None
        data = r.json()
        locs = data.get("oa_locations", [])
        # Prefer repository/green OA, skip ACM/publisher-only links
        for loc in locs:
            pdf_url = loc.get("url_for_pdf") or loc.get("url")
            if not pdf_url:
                continue
            if "dl.acm.org" in pdf_url or "acm.org" in pdf_url:
                continue  # blocked
            if pdf_url.startswith("http"):
                try:
                    r2 = await client.get(rewrite_url(pdf_url), timeout=30)
                    r2.raise_for_status()
                    if r2.content.startswith(b"%PDF"):
                        return r2.content, str(r2.url)
                except Exception:
                    continue
    except Exception:
        pass
    return None


async def resolve_via_semantic_scholar(doi: str, client: httpx.AsyncClient) -> tuple[bytes, str] | None:
    """
    Look up a DOI in Semantic Scholar and attempt to fetch an open-access PDF.
    Returns (pdf_bytes, url) or None.
    """
    try:
        r = await client.get(
            f"https://api.semanticscholar.org/graph/v1/paper/DOI:{doi}",
            params={"fields": "openAccessPdf,title"},
            timeout=10,
        )
        if r.status_code != 200:
            return None
        data = r.json()
        oa = data.get("openAccessPdf")
        if not oa or not oa.get("url"):
            return None
        pdf_url = oa["url"]
        # Rewrite through our own rewriter in case it's arxiv etc.
        pdf_url = rewrite_url(pdf_url)
        r2 = await client.get(pdf_url, timeout=30)
        r2.raise_for_status()
        if r2.content.startswith(b"%PDF"):
            return r2.content, str(r2.url)
    except Exception:
        pass
    return None


def rewrite_url(url: str) -> str:
    """
    Apply known URL transformations to get a direct PDF link.
    Returns the (possibly rewritten) URL.
    """
    # arxiv: /abs/ or /html/ → /pdf/ (strip version suffix e.g. v2)
    def _arxiv_rewrite(m):
        slug = re.sub(r'v\d+$', '', m.group(2))
        return f"https://arxiv.org/pdf/{slug}"
    url = re.sub(r'https?://arxiv\.org/(abs|html)/([^\s?#]+)', _arxiv_rewrite, url)

    # arxiv: remove trailing 'v1', 'v2' etc for cleaner URL (optional, keep version)
    # PubMed Central: /pmc/articles/PMCXXXXXX/ → PDF via NLM
    m = re.match(r'https?://(?:www\.)?ncbi\.nlm\.nih\.gov/pmc/articles/(PMC\d+)/?', url)
    if m:
        return f"https://www.ncbi.nlm.nih.gov/pmc/articles/{m.group(1)}/pdf/"

    # Semantic Scholar: paper page → try PDF link (will fall back to scraping)
    # ACL Anthology: /anthology/XXXX → PDF
    m = re.match(r'https?://aclanthology\.org/([^\s?#/]+)/?$', url)
    if m:
        return f"https://aclanthology.org/{m.group(1)}.pdf"

    # OpenReview: /forum?id=XXX → /pdf?id=XXX
    url = re.sub(
        r'(https?://openreview\.net)/forum\?id=([^\s&]+)',
        r'\1/pdf?id=\2',
        url
    )

    # PMLR (ICML, AISTATS, etc): /v*/XXXX.html → /v*/XXXX/XXXX.pdf
    m = re.match(r'(https?://proceedings\.mlr\.press/v\d+)/([a-z0-9]+)\.html', url)
    if m:
        base, slug = m.group(1), m.group(2)
        return f"{base}/{slug}/{slug}.pdf"

    # NeurIPS: /paper_files/paper/YYYY/hash/XXX-Paper.pdf pattern already direct
    # Nature, Springer, Elsevier — no simple rewrite, need scraping

    # ACM DL: strip tracking params from /doi/pdf/ URLs (bot challenge, but clean URL helps sometimes)
    m = re.match(r'(https?://dl\.acm\.org/doi/(?:pdf/)?)([^\s?#]+)', url)
    if m:
        return m.group(1) + m.group(2)  # strip query params; fallback to S2 will handle it

    return url


# ---------------------------------------------------------------------------
# HTML scraping for PDF links
# ---------------------------------------------------------------------------

PDF_LINK_PATTERNS = [
    # Open Graph / meta tags
    re.compile(r'<meta[^>]+property=["\']citation_pdf_url["\'][^>]+content=["\']([^"\']+)["\']', re.IGNORECASE),
    re.compile(r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']citation_pdf_url["\']', re.IGNORECASE),
    re.compile(r'<meta[^>]+name=["\']citation_pdf_url["\'][^>]+content=["\']([^"\']+)["\']', re.IGNORECASE),
    # <a href> with .pdf
    re.compile(r'<a[^>]+href=["\']([^"\']*\.pdf(?:\?[^"\']*)?)["\']', re.IGNORECASE),
    # data-url or data-href for PDF
    re.compile(r'data-(?:url|href)=["\']([^"\']*\.pdf(?:\?[^"\']*)?)["\']', re.IGNORECASE),
    # Common class/id patterns: "pdf-link", "download-pdf"
    re.compile(r'<a[^>]+(?:class|id)=["\'][^"\']*pdf[^"\']*["\'][^>]+href=["\']([^"\']+)["\']', re.IGNORECASE),
    re.compile(r'<a[^>]+href=["\']([^"\']+)["\'][^>]+(?:class|id)=["\'][^"\']*pdf[^"\']*["\']', re.IGNORECASE),
]

def extract_pdf_link_from_html(html: str, base_url: str) -> str | None:
    """Scrape HTML for a PDF link. Returns absolute URL or None."""
    for pattern in PDF_LINK_PATTERNS:
        m = pattern.search(html)
        if m:
            href = m.group(1).strip()
            if href and not href.startswith('javascript'):
                return urljoin(base_url, href)
    return None


# ---------------------------------------------------------------------------
# Main resolver
# ---------------------------------------------------------------------------

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml,application/pdf;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

async def resolve_pdf_url(url: str) -> tuple[bytes, str]:
    """
    Resolve a URL to PDF bytes.
    Returns (pdf_bytes, resolved_url).
    Raises ValueError with a user-friendly message on failure.
    """
    # Step 1: strip tracking params, then rewrite known patterns
    url = strip_tracking_params(url)
    rewritten = rewrite_url(url)

    async with httpx.AsyncClient(follow_redirects=True, timeout=30, headers=HEADERS, verify=False) as client:
        # Step 2: fetch the (possibly rewritten) URL
        try:
            r = await client.get(rewritten)
            r.raise_for_status()
        except httpx.HTTPStatusError as e:
            status = e.response.status_code
            # For arxiv versioned URLs that 404, try without version
            if status == 404 and "arxiv.org/pdf/" in rewritten:
                clean = re.sub(r'v\d+$', '', rewritten)
                if clean != rewritten:
                    try:
                        r = await client.get(clean)
                        r.raise_for_status()
                        rewritten = clean
                    except Exception:
                        pass
            elif status in (403, 401, 429):
                # Blocked — try open-access fallbacks
                doi = extract_doi(url)
                if doi:
                    result = await resolve_via_semantic_scholar(doi, client)
                    if result:
                        return result
                    result = await resolve_via_unpaywall(doi, client)
                    if result:
                        return result
                raise ValueError(
                    f"Access denied (HTTP {status}). "
                    f"This publisher blocks automated access. "
                    f"Try finding a preprint version (e.g. on arXiv or the authors' website)."
                )
            else:
                raise ValueError(f"HTTP {status} fetching URL")
        except Exception as e:
            raise ValueError(f"Failed to fetch URL: {e}")

        content_type = r.headers.get("content-type", "")

        # If it's a PDF, we're done
        if "application/pdf" in content_type or rewritten.endswith(".pdf"):
            if len(r.content) < 100:
                raise ValueError("Response too small to be a valid PDF")
            if not r.content.startswith(b"%PDF"):
                raise ValueError("Response is not a valid PDF file")
            return r.content, str(r.url)

        # Step 3: it's HTML — scrape for a PDF link
        if "text/html" in content_type:
            html = r.text
            pdf_link = extract_pdf_link_from_html(html, str(r.url))

            if pdf_link:
                try:
                    r2 = await client.get(pdf_link)
                    r2.raise_for_status()
                    if r2.content.startswith(b"%PDF"):
                        return r2.content, str(r2.url)
                except Exception:
                    pass

            # No PDF link found — try open-access fallbacks via DOI
            doi = extract_doi(url)
            if doi:
                result = await resolve_via_semantic_scholar(doi, client)
                if result:
                    return result
                result = await resolve_via_unpaywall(doi, client)
                if result:
                    return result

            raise ValueError(
                f"No PDF found at this URL. "
                f"The page loaded as HTML. "
                f"Try finding a direct PDF link (e.g. for arXiv use /pdf/ instead of /abs/)."
            )

        raise ValueError(f"Unexpected content type: {content_type}")
