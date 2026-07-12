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
    assert.equal((db.prepare('SELECT MAX(version) version FROM schema_migrations').get() as { version: number }).version, 4)
  } finally { cleanup(config, db) }
})

test('a fresh database provisions the collections schema at version 4', () => {
  const config = testConfig()
  const db = openDatabase(config)
  try {
    assert.equal((db.prepare('SELECT MAX(version) version FROM schema_migrations').get() as { version: number }).version, 4)
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='collections'").get())
    assert.ok((db.prepare('PRAGMA table_info(sources)').all() as Array<{ name: string }>).some(c => c.name === 'collection_id'))
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
    assert.equal((db.prepare('SELECT MAX(version) version FROM schema_migrations').get() as { version: number }).version, 4)
    assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='artifacts'").get(), undefined)
  } finally { cleanup(config, db) }
})
