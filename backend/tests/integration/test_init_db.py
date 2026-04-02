"""Verify all expected tables exist after init_db()."""

from db import get_db


EXPECTED_TABLES = [
    "projects",
    "sources",
    "chat_sessions",
    "chat_messages",
    "notes",
    "artifacts",
    "annotations",
    "source_related",
    "sessions",
    "messages",
]


def test_all_tables_exist():
    with get_db() as conn:
        rows = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        ).fetchall()
        table_names = {r["name"] for r in rows}

    for table in EXPECTED_TABLES:
        assert table in table_names, f"Missing table: {table}"


def test_annotations_index_exists():
    with get_db() as conn:
        rows = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_annotations_source'"
        ).fetchall()
    assert len(rows) == 1


def test_source_related_index_exists():
    with get_db() as conn:
        rows = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_source_related_source'"
        ).fetchall()
    assert len(rows) == 1
