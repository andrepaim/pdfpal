"""
semantic_scholar.py — Semantic Scholar API client for related paper lookup.
"""

import re
import httpx
from typing import Optional

S2_BASE = "https://api.semanticscholar.org/graph/v1"
S2_FIELDS = "title,authors,year,externalIds,openAccessPdf"
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
