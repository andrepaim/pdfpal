"""Integration tests for /api/search/papers with mocked semantic_scholar."""

from unittest.mock import patch, AsyncMock


CANNED_RESULTS = {
    "papers": [
        {
            "title": "Attention Is All You Need",
            "authors": "Vaswani et al.",
            "year": 2017,
            "arxiv_url": "https://arxiv.org/abs/1706.03762",
            "pdf_url": "https://arxiv.org/pdf/1706.03762",
        },
    ],
    "total": 1,
}


def test_search_papers_returns_results(client):
    # The route does `from semantic_scholar import search_papers as _search`
    # inside the handler, so we patch at the semantic_scholar module level.
    mock_search = AsyncMock(return_value=CANNED_RESULTS)
    with patch("semantic_scholar.search_papers", mock_search):
        resp = client.get("/api/search/papers?q=attention+mechanism")

    assert resp.status_code == 200
    data = resp.json()
    assert "papers" in data
    assert len(data["papers"]) == 1
    assert data["papers"][0]["title"] == "Attention Is All You Need"


def test_search_papers_short_query(client):
    resp = client.get("/api/search/papers?q=ab")
    assert resp.status_code == 400


def test_search_papers_empty_query(client):
    resp = client.get("/api/search/papers?q=")
    assert resp.status_code == 400
