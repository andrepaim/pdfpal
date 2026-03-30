"""
semantic_scholar.py — Semantic Scholar API client for related paper lookup.
"""

import re
import httpx
from typing import Optional

S2_BASE = "https://api.semanticscholar.org/graph/v1"
S2_FIELDS = "title,authors,year,externalIds,openAccessPdf,venue,citationCount"
S2_HEADERS = {
    "User-Agent": "pdfpal/1.0 (self-hosted research tool)",
}


def extract_arxiv_id(url: str) -> Optional[str]:
    """Extract arXiv ID from a URL or string like arxiv.org/abs/1706.03762 or /pdf/1706.03762."""
    m = re.search(r'arxiv\.org/(?:abs|pdf)/(\d{4}\.\d{4,5}(?:v\d+)?)', url, re.IGNORECASE)
    if m:
        return re.sub(r'v\d+$', '', m.group(1))
    # bare ID like 1706.03762
    m = re.match(r'^(\d{4}\.\d{4,5})(?:v\d+)?$', url.strip())
    if m:
        return m.group(1)
    return None


def extract_doi(url: str) -> Optional[str]:
    """Extract a DOI from a URL."""
    m = re.search(r'(?:doi\.org|/doi/(?:pdf/)?)/(10\.\d{4,}/[^\s?#&]+)', url)
    if m:
        return m.group(1)
    return None


def paper_id_from_url(url: str) -> Optional[str]:
    """Return a Semantic Scholar paper ID string like 'arXiv:1706.03762' or 'DOI:10.x/y'."""
    arxiv = extract_arxiv_id(url)
    if arxiv:
        return f"arXiv:{arxiv}"
    doi = extract_doi(url)
    if doi:
        return f"DOI:{doi}"
    return None


def best_pdf_url(paper: dict) -> Optional[str]:
    """Return the best available PDF URL for a paper dict from S2."""
    oa = paper.get("openAccessPdf") or {}
    oa_url = oa.get("url")
    if oa_url and "dl.acm.org" not in oa_url:
        return oa_url
    ext = paper.get("externalIds") or {}
    arxiv = ext.get("ArXiv")
    if arxiv:
        return f"https://arxiv.org/pdf/{arxiv}"
    # Return the blocked URL anyway so frontend can show it
    return oa_url or None


def arxiv_url(paper: dict) -> Optional[str]:
    ext = paper.get("externalIds") or {}
    arxiv = ext.get("ArXiv")
    if arxiv:
        return f"https://arxiv.org/abs/{arxiv}"
    return None


def format_authors(paper: dict) -> str:
    authors = paper.get("authors") or []
    names = [a.get("name", "") for a in authors[:3]]
    if len(authors) > 3:
        names.append("et al.")
    return ", ".join(names)


def format_paper(paper: dict, relation: Optional[str] = None) -> dict:
    """Normalize a S2 paper dict into a consistent result format."""
    return {
        "s2_paper_id": paper.get("paperId"),
        "title": paper.get("title", ""),
        "authors": format_authors(paper),
        "year": paper.get("year"),
        "venue": paper.get("venue") or "",
        "citation_count": paper.get("citationCount"),
        "arxiv_url": arxiv_url(paper),
        "pdf_url": best_pdf_url(paper),
        "relation": relation,
    }


OPENALEX_BASE = "https://api.openalex.org"
OPENALEX_EMAIL = "pdfpal@pdfpal.app"  # polite pool — 100K req/day


async def search_papers(query: str, limit: int = 20) -> dict:
    """
    Search OpenAlex (primary) and arXiv (secondary) simultaneously.
    Returns {"results": [...], "error": str|None}
    """
    import asyncio

    async def search_openalex(client: httpx.AsyncClient) -> list:
        try:
            r = await client.get(
                f"{OPENALEX_BASE}/works",
                params={
                    "search": query,
                    "select": "title,authorships,publication_year,open_access,cited_by_count,doi,primary_location",
                    "per-page": limit,
                    "mailto": OPENALEX_EMAIL,
                },
                timeout=12,
            )
            if r.status_code != 200:
                return []
            results = []
            for work in r.json().get("results", []):
                if not work.get("title"):
                    continue
                # Extract authors
                authors_list = [
                    a.get("author", {}).get("display_name", "")
                    for a in (work.get("authorships") or [])[:3]
                    if a.get("author", {}).get("display_name")
                ]
                if len(work.get("authorships") or []) > 3:
                    authors_list.append("et al.")
                authors_str = ", ".join(authors_list)

                # Extract PDF / arXiv URL — filter known blocked publishers
                BLOCKED = ("dl.acm.org", "acm.org/ft_gateway", "ieeexplore.ieee.org",
                           "link.springer.com", "sciencedirect.com", "elsevier.com")
                oa = work.get("open_access") or {}
                oa_url = oa.get("oa_url") or ""
                if any(b in oa_url for b in BLOCKED):
                    oa_url = ""
                pdf_url = oa_url if oa_url and oa_url.endswith(".pdf") else None
                arx_url = None
                arx_id = None

                # Check DOI for arXiv
                doi = work.get("doi") or ""
                loc = work.get("primary_location") or {}
                landing = loc.get("landing_page_url") or ""
                for candidate in [oa_url, doi, landing]:
                    m = re.search(r'arxiv\.org/(?:abs|pdf)/(\d{4}\.\d{4,5})', candidate or "", re.I)
                    if m:
                        arx_id = m.group(1)
                        arx_url = f"https://arxiv.org/abs/{arx_id}"
                        pdf_url = f"https://arxiv.org/pdf/{arx_id}"
                        break

                venue = (loc.get("source") or {}).get("display_name") or ""

                results.append({
                    "s2_paper_id": None,
                    "title": work["title"],
                    "authors": authors_str,
                    "year": work.get("publication_year"),
                    "venue": venue,
                    "citation_count": work.get("cited_by_count"),
                    "arxiv_url": arx_url,
                    "pdf_url": pdf_url or oa_url or None,
                    "relation": None,
                })
            return results
        except Exception:
            return []

    async def search_arxiv(client: httpx.AsyncClient) -> list:
        try:
            import xml.etree.ElementTree as ET
            r = await client.get(
                "https://export.arxiv.org/api/query",
                params={
                    "search_query": f"ti:{query}",
                    "start": 0,
                    "max_results": 10,
                    "sortBy": "relevance",
                },
                timeout=15,
            )
            if r.status_code != 200 or not r.text.strip():
                return []
            ns = {"atom": "http://www.w3.org/2005/Atom"}
            root = ET.fromstring(r.text)
            results = []
            for entry in root.findall("atom:entry", ns):
                title_el = entry.find("atom:title", ns)
                title_text = title_el.text.strip().replace("\n", " ") if title_el is not None and title_el.text else ""
                if not title_text:
                    continue
                arxiv_id = ""
                id_el = entry.find("atom:id", ns)
                if id_el is not None and id_el.text:
                    m = re.search(r'abs/(\S+)', id_el.text)
                    if m:
                        arxiv_id = re.sub(r'v\d+$', '', m.group(1))
                authors_els = entry.findall("atom:author/atom:name", ns)
                authors_list = [a.text for a in authors_els[:3] if a.text]
                authors_str = ", ".join(authors_list[:3])
                if len(authors_list) > 3:
                    authors_str += ", et al."
                year = None
                pub_el = entry.find("atom:published", ns)
                if pub_el is not None and pub_el.text:
                    year = int(pub_el.text[:4])
                results.append({
                    "s2_paper_id": None,
                    "title": title_text,
                    "authors": authors_str,
                    "year": year,
                    "venue": "arXiv",
                    "citation_count": None,
                    "arxiv_url": f"https://arxiv.org/abs/{arxiv_id}" if arxiv_id else None,
                    "pdf_url": f"https://arxiv.org/pdf/{arxiv_id}" if arxiv_id else None,
                    "relation": None,
                })
            return results
        except Exception:
            return []

    async with httpx.AsyncClient(timeout=15, headers=S2_HEADERS) as client:
        openalex_results, arxiv_results = await asyncio.gather(
            search_openalex(client),
            search_arxiv(client),
        )

    # Merge: OpenAlex first, then arXiv results not already covered (title dedup)
    seen_titles = {r["title"].lower()[:60] for r in openalex_results}
    merged = list(openalex_results)
    for r in arxiv_results:
        if r["title"].lower()[:60] not in seen_titles:
            merged.append(r)
            seen_titles.add(r["title"].lower()[:60])

    return {"results": merged, "error": None if merged else "No results found"}


async def search_paper_by_title(title: str, client: httpx.AsyncClient) -> Optional[str]:
    """
    Search Semantic Scholar by title and return the best-matching paper ID.
    Returns an S2 paper ID string or None.
    """
    import asyncio
    for attempt in range(3):
        try:
            r = await client.get(
                f"{S2_BASE}/paper/search",
                params={"query": title, "fields": "title,paperId", "limit": 3},
                timeout=10,
            )
            if r.status_code == 429:
                await asyncio.sleep(2 ** attempt)  # 1s, 2s, 4s backoff
                continue
            if r.status_code != 200:
                return None
            data = r.json()
            results = data.get("data", [])
            if not results:
                return None
            # Pick the top result — S2 search is usually good enough for exact titles
            return results[0].get("paperId")
        except Exception:
            return None
    return None


async def fetch_related(source_url: str, limit: int = 20, source_title: str = "") -> dict:
    """
    Fetch references and citations for a paper given its source URL (and optionally title).
    Returns {"references": [...], "citations": [...], "paper_id": str|None}
    Each item: {title, authors, year, arxiv_url, pdf_url, s2_paper_id, relation}
    """
    paper_id = paper_id_from_url(source_url)
    if not paper_id and not source_title:
        return {"references": [], "citations": [], "paper_id": None, "error": "Could not identify paper from URL"}

    results = {"references": [], "citations": [], "paper_id": paper_id}

    async with httpx.AsyncClient(timeout=15, headers=S2_HEADERS) as client:
        # No URL-based ID — try title search
        if not paper_id and source_title:
            s2_id = await search_paper_by_title(source_title, client)
            if s2_id:
                paper_id = s2_id  # bare S2 paper ID
                results["paper_id"] = paper_id
            else:
                return {"references": [], "citations": [], "paper_id": None,
                        "error": "Paper not found in Semantic Scholar (no arXiv/DOI in URL and title search returned no results)"}

        for relation in ("references", "citations"):
            try:
                r = await client.get(
                    f"{S2_BASE}/paper/{paper_id}/{relation}",
                    params={"fields": S2_FIELDS, "limit": limit},
                )
                if r.status_code == 404:
                    results["error"] = f"Paper not found in Semantic Scholar ({paper_id})"
                    continue
                if r.status_code == 429:
                    results["error"] = "Semantic Scholar rate limit — click ↺ to retry in a moment"
                    continue
                r.raise_for_status()
                data = r.json()

                for item in data.get("data", []):
                    # references have a "citedPaper" key, citations have "citingPaper"
                    paper = item.get("citedPaper") or item.get("citingPaper") or {}
                    if not paper or not paper.get("title"):
                        continue
                    results[relation].append({
                        "s2_paper_id": paper.get("paperId"),
                        "title": paper.get("title", ""),
                        "authors": format_authors(paper),
                        "year": paper.get("year"),
                        "arxiv_url": arxiv_url(paper),
                        "pdf_url": best_pdf_url(paper),
                        "relation": "reference" if relation == "references" else "citation",
                    })
            except httpx.HTTPStatusError:
                pass
            except Exception as e:
                results["error"] = str(e)

    return results
