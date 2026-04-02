"""Integration tests for the /api/chat endpoint with mocked Claude subprocess."""

import json
from unittest.mock import patch, AsyncMock, MagicMock

from tests.conftest import create_project, create_source_in_db
from db import get_db


def _mock_subprocess(stdout_text="This is the AI response."):
    """Create a mock for asyncio.create_subprocess_exec that returns given stdout."""
    mock_proc = AsyncMock()
    mock_proc.communicate = AsyncMock(return_value=(stdout_text.encode(), b""))
    mock_proc.kill = MagicMock()
    create_mock = AsyncMock(return_value=mock_proc)
    return create_mock


def _parse_sse(response_text: str):
    """Parse SSE events from response body."""
    events = []
    for line in response_text.strip().split("\n"):
        line = line.strip()
        if line.startswith("data: "):
            payload = line[len("data: "):]
            events.append(payload)
    return events


def test_chat_returns_sse_with_ai_text(client):
    with patch("main.asyncio.create_subprocess_exec", _mock_subprocess("Hello from AI")):
        resp = client.post("/api/chat", json={
            "message": "What is this paper about?",
            "pdf_text": "Some PDF content",
            "pdf_url": "http://example.com/paper.pdf",
        })
    assert resp.status_code == 200
    assert "text/event-stream" in resp.headers["content-type"]

    events = _parse_sse(resp.text)
    assert len(events) >= 2
    # First event should contain AI text
    first = json.loads(events[0])
    assert "text" in first
    assert "Hello from AI" in first["text"]
    # Last event should be [DONE]
    assert events[-1] == "[DONE]"


def test_chat_persists_messages_v2(client):
    pid = create_project(client)
    sid = create_source_in_db(pid)

    with patch("main.asyncio.create_subprocess_exec", _mock_subprocess("AI reply here")):
        resp = client.post("/api/chat", json={
            "message": "Explain section 3",
            "pdf_text": "Section 3 content",
            "pdf_url": "http://example.com/paper.pdf",
            "project_id": pid,
            "source_id": sid,
        })
    assert resp.status_code == 200

    # Check that messages were persisted
    with get_db() as conn:
        session = conn.execute(
            "SELECT id FROM chat_sessions WHERE project_id=? AND source_id=?",
            (pid, sid),
        ).fetchone()
        assert session is not None

        messages = conn.execute(
            "SELECT role, content FROM chat_messages WHERE session_id=? ORDER BY id",
            (session["id"],),
        ).fetchall()
        messages = [dict(m) for m in messages]

    assert len(messages) == 2
    assert messages[0]["role"] == "user"
    assert messages[0]["content"] == "Explain section 3"
    assert messages[1]["role"] == "assistant"
    assert "AI reply here" in messages[1]["content"]


def test_chat_project_level(client):
    pid = create_project(client)

    with patch("main.asyncio.create_subprocess_exec", _mock_subprocess("Project chat reply")):
        resp = client.post("/api/chat", json={
            "message": "Summarize all sources",
            "pdf_text": "combined text",
            "pdf_url": "",
            "project_id": pid,
            "active_source_ids": [],
        })
    assert resp.status_code == 200
    events = _parse_sse(resp.text)
    first = json.loads(events[0])
    assert "Project chat reply" in first["text"]
