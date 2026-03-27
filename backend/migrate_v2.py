"""
migrate_v2.py — Migrate pdfpal v1 schema to v2.

v1: sessions + messages
v2: projects + sources + chat_sessions + messages + notes + artifacts

Migration:
  - Each v1 session → new project (same id used as project id) + one source
  - v1 messages → chat_session linked to that source

Run once: python3 migrate_v2.py
Safe to re-run (uses CREATE IF NOT EXISTS + checks before inserting).
"""

import sqlite3
import uuid
from datetime import datetime
from pathlib import Path

DB_PATH = Path(__file__).parent / "pdfpal.db"

def migrate():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=OFF")  # off during migration

    print("Starting pdfpal v2 migration...")

    # ── Create new tables ────────────────────────────────────────────────────

    conn.executescript("""
        CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL DEFAULT 'Untitled Project',
            description TEXT DEFAULT '',
            created_at TEXT NOT NULL,
            accessed_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS sources (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            type TEXT NOT NULL DEFAULT 'pdf',  -- pdf | url | text
            url TEXT,
            title TEXT,
            pdf_text TEXT,
            pages INTEGER DEFAULT 0,
            created_at TEXT NOT NULL,
            accessed_at TEXT NOT NULL,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS chat_sessions (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            source_id TEXT,              -- NULL = project-level chat
            title TEXT DEFAULT 'Chat',
            created_at TEXT NOT NULL,
            accessed_at TEXT NOT NULL,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
            FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS chat_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            sources_used TEXT DEFAULT '[]',  -- JSON array of source_ids
            created_at TEXT NOT NULL,
            FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS notes (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            source_id TEXT,              -- NULL = project-level note
            title TEXT DEFAULT 'Untitled Note',
            content TEXT DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS artifacts (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            title TEXT DEFAULT 'Untitled Artifact',
            content TEXT DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );
    """)
    conn.commit()
    print("✓ New tables created")

    # ── Migrate existing sessions → projects + sources ────────────────────────

    sessions = conn.execute("SELECT * FROM sessions").fetchall()
    migrated_projects = 0
    migrated_sources = 0
    migrated_messages = 0

    for session in sessions:
        sid = session["id"]

        # Check if already migrated
        existing = conn.execute("SELECT id FROM projects WHERE id=?", (sid,)).fetchone()
        if existing:
            continue

        now = datetime.utcnow().isoformat()
        title = session["title"] or "Untitled Project"
        created_at = session["created_at"] or now
        accessed_at = session["accessed_at"] or now

        # Create project (use same id as session for continuity)
        conn.execute(
            "INSERT INTO projects (id, title, description, created_at, accessed_at) VALUES (?,?,?,?,?)",
            (sid, title, "", created_at, accessed_at)
        )
        migrated_projects += 1

        # Create source from session's PDF
        source_id = str(uuid.uuid4())
        conn.execute(
            "INSERT INTO sources (id, project_id, type, url, title, pdf_text, pages, created_at, accessed_at) "
            "VALUES (?,?,?,?,?,?,?,?,?)",
            (
                source_id, sid, "pdf",
                session["pdf_url"],
                session["title"],
                session["pdf_text"],
                session["pages"] or 0,
                created_at, accessed_at
            )
        )
        migrated_sources += 1

        # Migrate messages → chat_session + chat_messages
        old_messages = conn.execute(
            "SELECT * FROM messages WHERE session_id=? ORDER BY id ASC",
            (sid,)
        ).fetchall()

        if old_messages:
            chat_session_id = str(uuid.uuid4())
            conn.execute(
                "INSERT INTO chat_sessions (id, project_id, source_id, title, created_at, accessed_at) "
                "VALUES (?,?,?,?,?,?)",
                (chat_session_id, sid, source_id, "Chat", created_at, accessed_at)
            )
            for msg in old_messages:
                conn.execute(
                    "INSERT INTO chat_messages (session_id, role, content, sources_used, created_at) "
                    "VALUES (?,?,?,?,?)",
                    (chat_session_id, msg["role"], msg["content"], "[]", msg["created_at"] or now)
                )
                migrated_messages += 1

    conn.commit()
    print(f"✓ Migrated {migrated_projects} projects, {migrated_sources} sources, {migrated_messages} messages")

    # ── Summary ────────────────────────────────────────────────────────────────

    projects_count = conn.execute("SELECT COUNT(*) FROM projects").fetchone()[0]
    sources_count = conn.execute("SELECT COUNT(*) FROM sources").fetchone()[0]
    sessions_count = conn.execute("SELECT COUNT(*) FROM chat_sessions").fetchone()[0]

    print(f"\nDB state after migration:")
    print(f"  projects:      {projects_count}")
    print(f"  sources:       {sources_count}")
    print(f"  chat_sessions: {sessions_count}")
    print(f"\nMigration complete. Old 'sessions' and 'messages' tables kept for safety.")
    print("You can drop them later with: DROP TABLE sessions; DROP TABLE messages;")

    conn.execute("PRAGMA foreign_keys=ON")
    conn.close()

if __name__ == "__main__":
    migrate()
