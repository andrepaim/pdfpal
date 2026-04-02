"""Integration tests for previously untested endpoints:
health, legacy sessions CRUD, chat history, related papers, extract-upload.
"""

import json
import uuid
from datetime import datetime
from unittest.mock import patch, AsyncMock, MagicMock

from db import get_db
from tests.conftest import create_project, create_source_in_db


# ---------------------------------------------------------------------------
# 1. Health endpoint
# ---------------------------------------------------------------------------

def test_health(client):
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


# ---------------------------------------------------------------------------
# 2. Legacy sessions CRUD
# ---------------------------------------------------------------------------

def test_create_session(client):
    resp = client.post("/api/sessions", json={
        "title": "Legacy Session",
        "pdf_url": "http://example.com/paper.pdf",
        "pdf_filename": "paper.pdf",
        "pdf_text": "Some text",
        "pages": 5,
    })
    assert resp.status_code == 200
    data = resp.json()
    assert "session_id" in data


def test_list_sessions(client):
    # create one first
    client.post("/api/sessions", json={"title": "List Me"})
    resp = client.get("/api/sessions")
    assert resp.status_code == 200
    sessions = resp.json()
    assert isinstance(sessions, list)
    assert any(s["title"] == "List Me" for s in sessions)


def test_get_session(client):
    create_resp = client.post("/api/sessions", json={"title": "Get Me Session"})
    sid = create_resp.json()["session_id"]

    resp = client.get(f"/api/sessions/{sid}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == sid
    assert data["title"] == "Get Me Session"
    assert "messages" in data
    assert isinstance(data["messages"], list)


def test_get_session_not_found(client):
    resp = client.get("/api/sessions/nonexistent-session-id")
    assert resp.status_code == 404


def test_update_session(client):
    create_resp = client.post("/api/sessions", json={"title": "Old Session Title"})
    sid = create_resp.json()["session_id"]

    resp = client.patch(f"/api/sessions/{sid}", json={"title": "New Session Title"})
    assert resp.status_code == 200
    assert resp.json()["ok"] is True

    get_resp = client.get(f"/api/sessions/{sid}")
    assert get_resp.json()["title"] == "New Session Title"


def test_update_session_not_found(client):
    resp = client.patch("/api/sessions/nonexistent-id", json={"title": "X"})
    assert resp.status_code == 404


def test_delete_session(client):
    create_resp = client.post("/api/sessions", json={"title": "To Delete Session"})
    sid = create_resp.json()["session_id"]

    resp = client.delete(f"/api/sessions/{sid}")
    assert resp.status_code == 200
    assert resp.json()["ok"] is True

    get_resp = client.get(f"/api/sessions/{sid}")
    assert get_resp.status_code == 404


# ---------------------------------------------------------------------------
# 3. Chat history endpoints
# ---------------------------------------------------------------------------

def _seed_chat_messages(project_id, source_id):
    """Insert a chat session + messages directly into the DB."""
    cs_id = str(uuid.uuid4())
    ts = datetime.utcnow().isoformat()
    with get_db() as conn:
        conn.execute(
            "INSERT INTO chat_sessions (id, project_id, source_id, title, created_at, accessed_at) "
            "VALUES (?,?,?,?,?,?)",
            (cs_id, project_id, source_id, "Chat", ts, ts),
        )
        conn.execute(
            "INSERT INTO chat_messages (session_id, role, content, sources_used, created_at) "
            "VALUES (?,?,?,?,?)",
            (cs_id, "user", "Hello?", "[]", ts),
        )
        conn.execute(
            "INSERT INTO chat_messages (session_id, role, content, sources_used, created_at) "
            "VALUES (?,?,?,?,?)",
            (cs_id, "assistant", "Hi there!", "[]", ts),
        )
    return cs_id


def _seed_project_chat(project_id):
    """Insert a project-level chat session (source_id IS NULL)."""
    cs_id = str(uuid.uuid4())
    ts = datetime.utcnow().isoformat()
    with get_db() as conn:
        conn.execute(
            "INSERT INTO chat_sessions (id, project_id, source_id, title, created_at, accessed_at) "
            "VALUES (?,?,?,?,?,?)",
            (cs_id, project_id, None, "Project Chat", ts, ts),
        )
        conn.execute(
            "INSERT INTO chat_messages (session_id, role, content, sources_used, created_at) "
            "VALUES (?,?,?,?,?)",
            (cs_id, "user", "Summarize", "[]", ts),
        )
        conn.execute(
            "INSERT INTO chat_messages (session_id, role, content, sources_used, created_at) "
            "VALUES (?,?,?,?,?)",
            (cs_id, "assistant", "Here is a summary.", "[]", ts),
        )
    return cs_id


def test_get_source_chat(client):
    pid = create_project(client)
    sid = create_source_in_db(pid)
    _seed_chat_messages(pid, sid)

    resp = client.get(f"/api/projects/{pid}/sources/{sid}/chat")
    assert resp.status_code == 200
    data = resp.json()
    assert "messages" in data
    assert len(data["messages"]) == 2
    assert data["messages"][0]["role"] == "user"
    assert data["messages"][1]["role"] == "assistant"


def test_get_source_chat_empty(client):
    pid = create_project(client)
    sid = create_source_in_db(pid)

    resp = client.get(f"/api/projects/{pid}/sources/{sid}/chat")
    assert resp.status_code == 200
    assert resp.json()["messages"] == []


def test_clear_source_chat(client):
    pid = create_project(client)
    sid = create_source_in_db(pid)
    _seed_chat_messages(pid, sid)

    resp = client.delete(f"/api/projects/{pid}/sources/{sid}/chat")
    assert resp.status_code == 200
    assert resp.json()["ok"] is True

    # Verify cleared
    resp2 = client.get(f"/api/projects/{pid}/sources/{sid}/chat")
    assert resp2.json()["messages"] == []


def test_get_project_chat(client):
    pid = create_project(client)
    _seed_project_chat(pid)

    resp = client.get(f"/api/projects/{pid}/chat")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["messages"]) == 2
    assert data["messages"][0]["content"] == "Summarize"


def test_get_project_chat_empty(client):
    pid = create_project(client)

    resp = client.get(f"/api/projects/{pid}/chat")
    assert resp.status_code == 200
    assert resp.json()["messages"] == []


def test_clear_project_chat(client):
    pid = create_project(client)
    _seed_project_chat(pid)

    resp = client.delete(f"/api/projects/{pid}/chat")
    assert resp.status_code == 200
    assert resp.json()["ok"] is True

    resp2 = client.get(f"/api/projects/{pid}/chat")
    assert resp2.json()["messages"] == []


def test_list_project_chats(client):
    pid = create_project(client)
    sid = create_source_in_db(pid)
    _seed_chat_messages(pid, sid)
    _seed_project_chat(pid)

    resp = client.get(f"/api/projects/{pid}/chats")
    assert resp.status_code == 200
    chats = resp.json()
    assert isinstance(chats, list)
    assert len(chats) >= 2
    # Each entry should have expected keys
    for chat in chats:
        assert "id" in chat
        assert "message_count" in chat
        assert chat["message_count"] >= 1


# ---------------------------------------------------------------------------
# 4. Related papers
# ---------------------------------------------------------------------------

def test_get_related_papers(client):
    pid = create_project(client)
    sid = create_source_in_db(pid)

    mock_result = {
        "references": [
            {
                "title": "Ref Paper",
                "authors": "Author A",
                "year": 2023,
                "arxiv_url": "https://arxiv.org/abs/1234",
                "pdf_url": "https://arxiv.org/pdf/1234",
                "s2_paper_id": "s2id1",
                "relation": "reference",
            }
        ],
        "citations": [
            {
                "title": "Citing Paper",
                "authors": "Author B",
                "year": 2024,
                "arxiv_url": "",
                "pdf_url": "",
                "s2_paper_id": "s2id2",
                "relation": "citation",
            }
        ],
        "paper_id": "abc123",
    }

    with patch("semantic_scholar.fetch_related", new_callable=AsyncMock, return_value=mock_result):
        resp = client.get(f"/api/projects/{pid}/sources/{sid}/related")

    assert resp.status_code == 200
    data = resp.json()
    assert len(data["references"]) == 1
    assert data["references"][0]["title"] == "Ref Paper"
    assert len(data["citations"]) == 1
    assert data["citations"][0]["title"] == "Citing Paper"
    assert data["cached"] is False


def test_get_related_papers_returns_cached(client):
    pid = create_project(client)
    sid = create_source_in_db(pid)

    # Insert cached data
    ts = datetime.utcnow().isoformat()
    with get_db() as conn:
        conn.execute(
            "INSERT INTO source_related (source_id, s2_paper_id, title, authors, year, arxiv_url, pdf_url, relation, fetched_at) "
            "VALUES (?,?,?,?,?,?,?,?,?)",
            (sid, "cached_id", "Cached Ref", "Author C", 2022, "", "", "reference", ts),
        )

    resp = client.get(f"/api/projects/{pid}/sources/{sid}/related")
    assert resp.status_code == 200
    data = resp.json()
    assert data["cached"] is True
    assert len(data["references"]) == 1
    assert data["references"][0]["title"] == "Cached Ref"


def test_get_related_papers_source_not_found(client):
    pid = create_project(client)
    resp = client.get(f"/api/projects/{pid}/sources/nonexistent-source/related")
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# 5. PDF upload extraction
# ---------------------------------------------------------------------------

def test_extract_upload(client, sample_pdf_bytes):
    resp = client.post(
        "/api/extract-upload",
        files={"file": ("test.pdf", sample_pdf_bytes, "application/pdf")},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "text" in data
    assert "pages" in data
    assert data["pages"] >= 1
    assert "session_id" in data
    assert data["filename"] == "test.pdf"


def test_extract_upload_with_existing_session(client, sample_pdf_bytes):
    # Create a session first
    create_resp = client.post("/api/sessions", json={"title": "Upload Session"})
    sid = create_resp.json()["session_id"]

    resp = client.post(
        f"/api/extract-upload?session_id={sid}",
        files={"file": ("updated.pdf", sample_pdf_bytes, "application/pdf")},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["session_id"] == sid

    # Session should be updated
    get_resp = client.get(f"/api/sessions/{sid}")
    assert get_resp.json()["pdf_filename"] == "updated.pdf"
