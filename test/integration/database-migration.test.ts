import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { cleanup, testConfig } from '../helpers/test-utils.js'
import { openDatabase } from '../../src/core/database.js'

test('opens and migrates a legacy sessions database', () => {
  const config = testConfig()
  const legacy = new Database(config.dbPath)
  legacy.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY,title TEXT,pdf_url TEXT,pdf_filename TEXT,pdf_text TEXT,pages INTEGER,created_at TEXT,accessed_at TEXT);
    CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT,session_id TEXT,role TEXT,content TEXT,created_at TEXT);
    INSERT INTO sessions VALUES ('legacy','Legacy Project','https://example.test/paper.pdf','paper.pdf','[Page 1]\nLegacy passage',1,'2020-01-01','2020-01-02');
    INSERT INTO messages(session_id,role,content,created_at) VALUES ('legacy','user','Question','2020-01-02');`)
  legacy.close()
  const db = openDatabase(config)
  try {
    assert.equal((db.prepare('SELECT COUNT(*) count FROM projects').get() as { count: number }).count, 1)
    assert.equal((db.prepare('SELECT COUNT(*) count FROM sources').get() as { count: number }).count, 1)
    assert.equal((db.prepare('SELECT COUNT(*) count FROM chat_messages').get() as { count: number }).count, 1)
    assert.equal((db.prepare('SELECT MAX(version) version FROM schema_migrations').get() as { version: number }).version, 5)
  } finally { cleanup(config, db) }
})

test('a fresh database provisions the collections schema at version 5', () => {
  const config = testConfig()
  const db = openDatabase(config)
  try {
    assert.equal((db.prepare('SELECT MAX(version) version FROM schema_migrations').get() as { version: number }).version, 5)
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='collections'").get())
    assert.ok((db.prepare('PRAGMA table_info(sources)').all() as Array<{ name: string }>).some(c => c.name === 'collection_id'))
    assert.ok((db.prepare('PRAGMA table_info(annotations)').all() as Array<{ name: string }>).some(c => c.name === 'rects'))
  } finally { cleanup(config, db) }
})

test('adds the rects column when migrating a pre-existing annotations table', () => {
  const config = testConfig()
  const legacy = new Database(config.dbPath)
  legacy.exec(`
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    CREATE TABLE projects (id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT 'Untitled Project', description TEXT DEFAULT '', created_at TEXT NOT NULL, accessed_at TEXT NOT NULL);
    CREATE TABLE sources (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'pdf', url TEXT, title TEXT, pdf_text TEXT, pages INTEGER DEFAULT 0, created_at TEXT NOT NULL, accessed_at TEXT NOT NULL);
    CREATE TABLE annotations (id TEXT PRIMARY KEY, source_id TEXT NOT NULL, project_id TEXT NOT NULL, page_number INTEGER NOT NULL, x1 REAL NOT NULL, y1 REAL NOT NULL, x2 REAL NOT NULL, y2 REAL NOT NULL, text TEXT NOT NULL, color TEXT NOT NULL DEFAULT 'yellow', created_at TEXT NOT NULL);
    INSERT INTO schema_migrations(version, applied_at) VALUES (1, datetime('now')), (2, datetime('now')), (3, datetime('now')), (4, datetime('now'));
    INSERT INTO projects VALUES ('p1','Old Project','','2020-01-01','2020-01-01');
    INSERT INTO sources VALUES ('s1','p1','pdf',NULL,'Paper',NULL,1,'2020-01-01','2020-01-01');
    INSERT INTO annotations(id,source_id,project_id,page_number,x1,y1,x2,y2,text,color,created_at) VALUES ('a1','s1','p1',1,0,0,1,1,'old highlight','yellow','2020-01-01');
  `)
  legacy.close()
  const db = openDatabase(config)
  try {
    assert.equal((db.prepare('SELECT MAX(version) version FROM schema_migrations').get() as { version: number }).version, 5)
    const row = db.prepare('SELECT rects FROM annotations WHERE id=?').get('a1') as { rects: string | null }
    assert.equal(row.rects, null)
  } finally { cleanup(config, db) }
})

test('drops a pre-existing artifacts table when migrating an older database', () => {
  const config = testConfig()
  const legacy = new Database(config.dbPath)
  legacy.exec(`
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    CREATE TABLE projects (id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT 'Untitled Project', description TEXT DEFAULT '', created_at TEXT NOT NULL, accessed_at TEXT NOT NULL);
    CREATE TABLE artifacts (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT DEFAULT 'Untitled Artifact', content TEXT DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    INSERT INTO schema_migrations(version, applied_at) VALUES (1, datetime('now')), (2, datetime('now')), (3, datetime('now'));
    INSERT INTO projects VALUES ('p1','Old Project','','2020-01-01','2020-01-01');
    INSERT INTO artifacts VALUES ('a1','p1','Saved Output','Some content','2020-01-01','2020-01-01');
  `)
  legacy.close()
  const db = openDatabase(config)
  try {
    assert.equal((db.prepare('SELECT MAX(version) version FROM schema_migrations').get() as { version: number }).version, 5)
    assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='artifacts'").get(), undefined)
  } finally { cleanup(config, db) }
})
