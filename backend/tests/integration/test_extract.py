"""Integration tests for /api/extract with mocked PDF resolver."""

from unittest.mock import patch, AsyncMock
from pathlib import Path

from tests.conftest import create_project


FIXTURES_DIR = Path(__file__).parent.parent / "fixtures"


def test_extract_creates_source_in_project(client, sample_pdf_bytes):
    pid = create_project(client)

    async def mock_resolve(url):
        return (sample_pdf_bytes, "http://example.com/resolved.pdf")

    with patch("main.resolve_pdf_url", side_effect=mock_resolve):
        resp = client.post("/api/extract", json={
            "url": "http://example.com/paper",
            "project_id": pid,
        })

    assert resp.status_code == 200
    data = resp.json()
    assert data["project_id"] == pid
    assert "source_id" in data
    assert data["pages"] == 2
    assert "pdf_url" in data

    # Verify the source appears in the project's sources list
    sources = client.get(f"/api/projects/{pid}/sources").json()
    assert any(s["id"] == data["source_id"] for s in sources)


def test_extract_updates_existing_source(client, sample_pdf_bytes):
    pid = create_project(client)

    async def mock_resolve(url):
        return (sample_pdf_bytes, "http://example.com/resolved.pdf")

    # First, create a source
    with patch("main.resolve_pdf_url", side_effect=mock_resolve):
        resp1 = client.post("/api/extract", json={
            "url": "http://example.com/paper",
            "project_id": pid,
        })
    sid = resp1.json()["source_id"]

    # Now update it
    with patch("main.resolve_pdf_url", side_effect=mock_resolve):
        resp2 = client.post("/api/extract", json={
            "url": "http://example.com/paper-v2",
            "project_id": pid,
            "source_id": sid,
        })

    assert resp2.status_code == 200
    assert resp2.json()["source_id"] == sid


def test_extract_invalid_url(client):
    async def mock_resolve(url):
        raise ValueError("Invalid URL")

    with patch("main.resolve_pdf_url", side_effect=mock_resolve):
        resp = client.post("/api/extract", json={"url": "not-a-url"})

    assert resp.status_code == 400


def test_extract_legacy_session(client, sample_pdf_bytes):
    """Legacy v1 flow: no project_id creates a session."""
    async def mock_resolve(url):
        return (sample_pdf_bytes, "http://example.com/resolved.pdf")

    with patch("main.resolve_pdf_url", side_effect=mock_resolve):
        resp = client.post("/api/extract", json={
            "url": "http://example.com/paper",
        })

    assert resp.status_code == 200
    data = resp.json()
    assert "session_id" in data
    assert data["pages"] == 2
