import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import type { Database as DatabaseType } from 'better-sqlite3'
import type { PdfpalConfig } from './config.js'
import { ensureDataDirectories } from './config.js'

const CURRENT_SCHEMA = 6

function columnExists(db: DatabaseType, table: string, column: string): boolean {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some(row => row.name === column)
}

function tableExists(db: DatabaseType, table: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))
}

function backupExisting(db: DatabaseType, config: PdfpalConfig): void {
  if (!fs.existsSync(config.dbPath) || fs.statSync(config.dbPath).size === 0) return
  const existing = tableExists(db, 'schema_migrations')
    ? (db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version: number | null }).version ?? 0
    : 0
  if (existing >= CURRENT_SCHEMA) return
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const destination = path.join(config.backupsDir, `pdfpal-${stamp}.db`)
  // VACUUM INTO accepts a SQL string literal, not a JSON/double-quoted
  // identifier. Escape the path explicitly because this is a local path we
  // generated, not user-provided SQL.
  db.exec(`VACUUM INTO '${destination.replaceAll("'", "''")}'`)
}

export function openDatabase(config: PdfpalConfig): DatabaseType {
  ensureDataDirectories(config)
  const db = new Database(config.dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('busy_timeout = 5000')
  db.pragma('foreign_keys = ON')
  backupExisting(db, config)
  migrate(db)
  return db
}

function migrate(db: DatabaseType): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT 'Untitled Project', description TEXT DEFAULT '',
      created_at TEXT NOT NULL, accessed_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'pdf', url TEXT, title TEXT,
      pdf_text TEXT, pages INTEGER DEFAULT 0, last_page_read INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL, accessed_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, source_id TEXT, title TEXT DEFAULT 'Chat',
      created_at TEXT NOT NULL, accessed_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY(source_id) REFERENCES sources(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, role TEXT NOT NULL,
      content TEXT NOT NULL, sources_used TEXT DEFAULT '[]', created_at TEXT NOT NULL,
      FOREIGN KEY(session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, source_id TEXT, title TEXT DEFAULT 'Untitled Note',
      content TEXT DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS annotations (
      id TEXT PRIMARY KEY, source_id TEXT NOT NULL, project_id TEXT NOT NULL, page_number INTEGER NOT NULL,
      x1 REAL NOT NULL, y1 REAL NOT NULL, x2 REAL NOT NULL, y2 REAL NOT NULL, text TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT 'yellow', created_at TEXT NOT NULL,
      FOREIGN KEY(source_id) REFERENCES sources(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS source_related (
      id INTEGER PRIMARY KEY AUTOINCREMENT, source_id TEXT NOT NULL, s2_paper_id TEXT, title TEXT,
      authors TEXT, year INTEGER, arxiv_url TEXT, pdf_url TEXT, relation TEXT, fetched_at TEXT,
      FOREIGN KEY(source_id) REFERENCES sources(id) ON DELETE CASCADE
    );
  `)

  const add = (column: string, declaration: string) => {
    if (!columnExists(db, 'sources', column)) db.exec(`ALTER TABLE sources ADD COLUMN ${column} ${declaration}`)
  }
  add('original_location', 'TEXT')
  add('local_path', 'TEXT')
  add('media_type', 'TEXT')
  add('byte_size', 'INTEGER')
  add('content_hash', 'TEXT')

  db.exec(`
    CREATE TABLE IF NOT EXISTS source_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT, source_id TEXT NOT NULL, page_number INTEGER NOT NULL,
      chunk_index INTEGER NOT NULL, content TEXT NOT NULL,
      FOREIGN KEY(source_id) REFERENCES sources(id) ON DELETE CASCADE,
      UNIQUE(source_id, page_number, chunk_index)
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS source_chunks_fts USING fts5(content, content='source_chunks', content_rowid='id');
    CREATE TRIGGER IF NOT EXISTS source_chunks_ai AFTER INSERT ON source_chunks BEGIN
      INSERT INTO source_chunks_fts(rowid, content) VALUES (new.id, new.content);
    END;
    CREATE TRIGGER IF NOT EXISTS source_chunks_ad AFTER DELETE ON source_chunks BEGIN
      INSERT INTO source_chunks_fts(source_chunks_fts, rowid, content) VALUES('delete', old.id, old.content);
    END;
    CREATE TRIGGER IF NOT EXISTS source_chunks_au AFTER UPDATE ON source_chunks BEGIN
      INSERT INTO source_chunks_fts(source_chunks_fts, rowid, content) VALUES('delete', old.id, old.content);
      INSERT INTO source_chunks_fts(rowid, content) VALUES (new.id, new.content);
    END;
    CREATE INDEX IF NOT EXISTS idx_source_chunks_source ON source_chunks(source_id, page_number);
    INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (1, datetime('now'));
  `)

  const migrated = db.prepare('SELECT 1 FROM schema_migrations WHERE version=2').get()
  if (!migrated) {
    migrateLegacySessions(db)
    db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (2, datetime('now'))").run()
  }

  if (!db.prepare('SELECT 1 FROM schema_migrations WHERE version=3').get()) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS collections (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, parent_id TEXT,
        name TEXT NOT NULL DEFAULT 'New Collection', position INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
        FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY(parent_id) REFERENCES collections(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_collections_project ON collections(project_id, parent_id, position);
    `)
    // Sources reference at most one collection; deleting a collection (directly
    // or via a parent cascade) unfiles its papers rather than destroying them.
    if (!columnExists(db, 'sources', 'collection_id'))
      db.exec('ALTER TABLE sources ADD COLUMN collection_id TEXT REFERENCES collections(id) ON DELETE SET NULL')
    db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (3, datetime('now'))").run()
  }

  if (!db.prepare('SELECT 1 FROM schema_migrations WHERE version=4').get()) {
    // The artifacts feature was removed; drop its table for existing databases.
    db.exec('DROP TABLE IF EXISTS artifacts')
    db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (4, datetime('now'))").run()
  }

  if (!db.prepare('SELECT 1 FROM schema_migrations WHERE version=5').get()) {
    // A highlight spanning multiple lines used to be stored as a single
    // x1..y2 box (the union of every line's rect), which visually expanded
    // to cover whole lines that were only partially selected. `rects` stores
    // the precise per-line boxes instead; x1..y2 remains the union, used for
    // sorting and as a fallback for annotations created before this column
    // existed (rects is NULL for those rows).
    if (!columnExists(db, 'annotations', 'rects')) db.exec('ALTER TABLE annotations ADD COLUMN rects TEXT')
    db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (5, datetime('now'))").run()
  }

  if (!db.prepare('SELECT 1 FROM schema_migrations WHERE version=6').get()) {
    // Reading progress belongs to the managed source so it survives browser
    // cache clears and is shared by every client using this local database.
    if (!columnExists(db, 'sources', 'last_page_read'))
      db.exec('ALTER TABLE sources ADD COLUMN last_page_read INTEGER NOT NULL DEFAULT 1')
    db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (6, datetime('now'))").run()
  }
}

/** Migrate the original sessions/messages model without requiring network access. */
function migrateLegacySessions(db: DatabaseType): void {
  if (!tableExists(db, 'sessions') || !tableExists(db, 'messages')) return
  const sessions = db.prepare('SELECT * FROM sessions').all() as Array<Record<string, unknown>>
  const insertProject = db.prepare('INSERT INTO projects(id,title,description,created_at,accessed_at) VALUES (?,?,?,?,?)')
  const insertSource = db.prepare(`INSERT INTO sources(id,project_id,type,url,title,pdf_text,pages,created_at,accessed_at)
    VALUES (?,?,?,?,?,?,?,?,?)`)
  const insertChat = db.prepare('INSERT INTO chat_sessions(id,project_id,source_id,title,created_at,accessed_at) VALUES (?,?,?,?,?,?)')
  const insertMessage = db.prepare('INSERT INTO chat_messages(session_id,role,content,sources_used,created_at) VALUES (?,?,?,?,?)')
  const insertChunk = db.prepare('INSERT INTO source_chunks(source_id,page_number,chunk_index,content) VALUES (?,?,?,?)')
  const transaction = db.transaction(() => {
    for (const session of sessions) {
      const projectId = String(session.id)
      const existing = db.prepare('SELECT id FROM projects WHERE id=?').get(projectId)
      if (existing) continue
      const timestamp = String(session.created_at || new Date().toISOString())
      const accessed = String(session.accessed_at || timestamp)
      const title = String(session.title || session.pdf_filename || 'Untitled Project')
      insertProject.run(projectId, title, '', timestamp, accessed)
      const sourceId = randomUUID()
      const text = String(session.pdf_text || '')
      insertSource.run(sourceId, projectId, 'pdf', session.pdf_url ?? null, title, text, Number(session.pages || 0), timestamp, accessed)
      indexLegacyText(insertChunk, sourceId, text)
      const messages = db.prepare('SELECT role,content,created_at FROM messages WHERE session_id=? ORDER BY id').all(projectId) as Array<Record<string, unknown>>
      if (!messages.length) continue
      const chatId = randomUUID()
      insertChat.run(chatId, projectId, sourceId, 'Chat', timestamp, accessed)
      for (const message of messages) insertMessage.run(chatId, String(message.role), String(message.content), '[]', String(message.created_at || timestamp))
    }
  })
  transaction()
  // External-content FTS tables need a rebuild after bulk legacy inserts.
  db.exec("INSERT INTO source_chunks_fts(source_chunks_fts) VALUES ('rebuild')")
}

function indexLegacyText(insert: { run: (...args: any[]) => unknown }, sourceId: string, text: string): void {
  const pages = [...text.matchAll(/^\[Page (\d+)\]\s*$/gm)]
  const parts = pages.length
    ? pages.map((match, index) => ({ page: Number(match[1]), text: text.slice((match.index ?? 0) + match[0].length, pages[index + 1]?.index ?? text.length) }))
    : [{ page: 1, text }]
  for (const part of parts) {
    const clean = part.text.replace(/\s+/g, ' ').trim()
    for (let offset = 0, chunk = 0; offset < clean.length; chunk++) {
      const end = Math.min(clean.length, offset + 1500)
      insert.run(sourceId, part.page, chunk, clean.slice(offset, end))
      if (end === clean.length) break
      offset = Math.max(offset + 1, end - 150)
    }
  }
}
