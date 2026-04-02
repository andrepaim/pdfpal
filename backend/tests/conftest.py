import os
import tempfile

# MUST be set before importing any app modules — db.py evaluates DB_PATH at import time
_test_db = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_test_db.close()
os.environ["PDFPAL_DB"] = _test_db.name
os.environ["GOOGLE_CLIENT_ID"] = ""  # disable auth

import pytest
from pathlib import Path
from starlette.testclient import TestClient
from main import app, init_db


FIXTURES_DIR = Path(__file__).parent / "fixtures"


@pytest.fixture(scope="session", autouse=True)
def setup_db():
    init_db()
    yield
    try:
        os.unlink(_test_db.name)
    except OSError:
        pass


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def sample_pdf_bytes():
    return (FIXTURES_DIR / "sample.pdf").read_bytes()


def create_project(client, title="Test Project"):
    """Helper to create a project and return its id."""
    resp = client.post("/api/projects", json={"title": title})
    assert resp.status_code == 200
    return resp.json()["id"]


def create_source_in_db(project_id: str):
    """Helper to insert a source directly into the DB and return its id."""
    import uuid
    from datetime import datetime
    from db import get_db

    sid = str(uuid.uuid4())
    ts = datetime.utcnow().isoformat()
    with get_db() as conn:
        conn.execute(
            "INSERT INTO sources (id, project_id, type, url, title, pdf_text, pages, created_at, accessed_at) "
            "VALUES (?,?,?,?,?,?,?,?,?)",
            (sid, project_id, "pdf", "http://example.com/test.pdf", "Test Source", "Page 1 text", 1, ts, ts),
        )
    return sid
