import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import fs from 'node:fs'
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
    assert.equal((db.prepare('SELECT MAX(version) version FROM schema_migrations').get() as { version: number }).version, 8)
  } finally { cleanup(config, db) }
})

test('a fresh database provisions reading progress and the Kindle companion at schema version 8', () => {
  const config = testConfig()
  const db = openDatabase(config)
  try {
    assert.equal((db.prepare('SELECT MAX(version) version FROM schema_migrations').get() as { version: number }).version, 8)
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name='kindle_conversations'").get())
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='collections'").get())
    assert.ok((db.prepare('PRAGMA table_info(sources)').all() as Array<{ name: string }>).some(c => c.name === 'collection_id'))
    assert.ok((db.prepare('PRAGMA table_info(annotations)').all() as Array<{ name: string }>).some(c => c.name === 'rects'))
    const progress = (db.prepare("SELECT dflt_value FROM pragma_table_info('sources') WHERE name='last_page_read'").get() as { dflt_value: string })
    assert.equal(progress.dflt_value, '1')
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
    assert.equal((db.prepare('SELECT MAX(version) version FROM schema_migrations').get() as { version: number }).version, 8)
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
    assert.equal((db.prepare('SELECT MAX(version) version FROM schema_migrations').get() as { version: number }).version, 8)
    assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='artifacts'").get(), undefined)
  } finally { cleanup(config, db) }
})

test('adds page progress to a version 5 database without changing existing sources', () => {
  const config = testConfig()
  const legacy = new Database(config.dbPath)
  legacy.exec(`
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    CREATE TABLE projects (id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT 'Untitled Project', description TEXT DEFAULT '', created_at TEXT NOT NULL, accessed_at TEXT NOT NULL);
    CREATE TABLE sources (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'pdf', url TEXT, title TEXT, pdf_text TEXT, pages INTEGER DEFAULT 0, created_at TEXT NOT NULL, accessed_at TEXT NOT NULL);
    INSERT INTO schema_migrations(version, applied_at) VALUES
      (1, datetime('now')), (2, datetime('now')), (3, datetime('now')), (4, datetime('now')), (5, datetime('now'));
    INSERT INTO projects VALUES ('p1','Existing Project','','2020-01-01','2020-01-01');
    INSERT INTO sources VALUES ('s1','p1','pdf',NULL,'Existing Book',NULL,370,'2020-01-01','2020-01-01');
  `)
  legacy.close()

  const db = openDatabase(config)
  try {
    assert.equal((db.prepare('SELECT MAX(version) version FROM schema_migrations').get() as { version: number }).version, 8)
    const source = db.prepare('SELECT title,pages,last_page_read FROM sources WHERE id=?').get('s1') as { title: string; pages: number; last_page_read: number }
    assert.deepEqual(source, { title: 'Existing Book', pages: 370, last_page_read: 1 })
  } finally { cleanup(config, db) }
})

test('version 6 upgrade backs up the database and preserves notes, chat and reading progress', () => {
  const config = testConfig(), before = openDatabase(config)
  before.exec(`
    INSERT INTO projects VALUES ('p','Existing project','','2020-01-01','2020-01-01');
    INSERT INTO sources(id,project_id,title,last_page_read,created_at,accessed_at) VALUES ('s','p','Existing PDF',42,'2020-01-01','2020-01-01');
    INSERT INTO notes VALUES ('n','p',NULL,'Existing note','Keep this','2020-01-01','2020-01-01');
    INSERT INTO chat_sessions VALUES ('c','p','s','Existing chat','2020-01-01','2020-01-01');
    INSERT INTO chat_messages(session_id,role,content,created_at) VALUES ('c','user','Keep this conversation','2020-01-01');
    DROP TABLE visual_explanations; DROP TABLE extension_saved_notes; DROP TABLE kindle_turns; DROP TABLE kindle_conversations;
    DROP TABLE extension_clients; DROP TABLE extension_pair_codes; DELETE FROM schema_migrations WHERE version>=7;
  `)
  before.close()
  const backups = new Set(fs.readdirSync(config.backupsDir))
  const db = openDatabase(config)
  try {
    assert.equal((db.prepare("SELECT last_page_read FROM sources WHERE id='s'").get() as { last_page_read: number }).last_page_read, 42)
    assert.equal((db.prepare("SELECT content FROM notes WHERE id='n'").get() as { content: string }).content, 'Keep this')
    assert.equal((db.prepare("SELECT content FROM chat_messages WHERE session_id='c'").get() as { content: string }).content, 'Keep this conversation')
    const created = fs.readdirSync(config.backupsDir).filter(file => !backups.has(file))
    assert.equal(created.length, 1)
    const backup = new Database(`${config.backupsDir}/${created[0]}`, { readonly: true })
    try { assert.equal((backup.prepare('SELECT MAX(version) version FROM schema_migrations').get() as { version: number }).version, 6) }
    finally { backup.close() }
  } finally { cleanup(config, db) }
})

test('version 7 upgrade preserves paired connections, Kindle turns and existing notes', () => {
  const config = testConfig(), before = openDatabase(config)
  before.exec(`
    INSERT INTO projects VALUES ('p','Existing project','','2020-01-01','2020-01-01');
    INSERT INTO notes VALUES ('n','p',NULL,'Existing note','Keep this','2020-01-01','2020-01-01');
    INSERT INTO extension_clients VALUES ('client','existing-token-hash','chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','2020-01-01',NULL);
    INSERT INTO kindle_conversations VALUES ('conversation','client','p','book-key','Book','2020-01-01');
    INSERT INTO kindle_turns(id,client_id,conversation_id,request_id,request_hash,capture_json,question,status,answer,created_at,updated_at)
      VALUES ('turn','client','conversation','request','hash','{}','Question','complete','Existing answer','2020-01-01','2020-01-01');
    ALTER TABLE chat_messages DROP COLUMN visual_id;
    ALTER TABLE kindle_turns DROP COLUMN visual_id;
    ALTER TABLE kindle_turns DROP COLUMN response_mode;
    DROP TABLE visual_explanations;
    DELETE FROM schema_migrations WHERE version=8;
  `)
  before.close()
  const backups = new Set(fs.readdirSync(config.backupsDir)), db = openDatabase(config)
  try {
    assert.equal((db.prepare("SELECT token_hash FROM extension_clients WHERE id='client'").get() as { token_hash: string }).token_hash, 'existing-token-hash')
    assert.deepEqual(db.prepare("SELECT answer,response_mode,visual_id FROM kindle_turns WHERE id='turn'").get(), { answer: 'Existing answer', response_mode: 'text', visual_id: null })
    assert.equal((db.prepare("SELECT content FROM notes WHERE id='n'").get() as { content: string }).content, 'Keep this')
    assert.equal((db.prepare('SELECT MAX(version) version FROM schema_migrations').get() as { version: number }).version, 8)
    assert.equal(fs.readdirSync(config.backupsDir).filter(file => !backups.has(file)).length, 1)
  } finally { cleanup(config, db) }
})
