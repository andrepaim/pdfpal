import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import fs from 'node:fs'
import { cleanup, testConfig } from '../helpers/test-utils.js'
import { openDatabase, CURRENT_SCHEMA } from '../../src/core/database.js'
import { ChatService } from '../../src/core/chat.js'
import { ProjectService } from '../../src/core/projects.js'

test('version 12 chat migration preserves local message IDs, text and ordering and assigns stable sync identities once', () => {
  const config = testConfig(); let db = openDatabase(config)
  try {
    const project = new ProjectService(db).create('Migration fixture')
    const chat = new ChatService(db, config)
    chat.persist(project.id, null, 'First question', 'First answer', [])
    chat.persist(project.id, null, 'Second question', 'Second answer', [])
    const before = chat.history(project.id)
    for (const event of ['INSERT','UPDATE','DELETE']) db.exec(`DROP TRIGGER sync_chat_messages_${event}; DROP TRIGGER sync_chat_sessions_${event}`)
    db.exec(`DROP TRIGGER chat_message_sync_identity; DROP INDEX chat_message_sync_id; DROP INDEX chat_message_sync_order;
      ALTER TABLE chat_messages DROP COLUMN sync_id; ALTER TABLE chat_messages DROP COLUMN sync_order;
      ALTER TABLE chat_messages DROP COLUMN sync_turn; DELETE FROM schema_migrations WHERE version>=13;`)
    db.close(); db = openDatabase(config)
    assert.deepEqual(new ChatService(db, config).history(project.id), before)
    const identities = db.prepare('SELECT id,sync_id,sync_order,sync_turn FROM chat_messages ORDER BY id').all()
    assert.equal(new Set((identities as Array<{sync_id:string}>).map(row => row.sync_id)).size, 4)
    assert.equal((db.prepare("SELECT COUNT(*) n FROM sync_outbox WHERE entity_type LIKE 'chat_%'").get() as {n:number}).n, 0)
    db.close(); db = openDatabase(config)
    assert.deepEqual(db.prepare('SELECT id,sync_id,sync_order,sync_turn FROM chat_messages ORDER BY id').all(), identities)
  } finally { cleanup(config, db) }
})

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
    assert.equal((db.prepare('SELECT MAX(version) version FROM schema_migrations').get() as { version: number }).version, CURRENT_SCHEMA)
  } finally { cleanup(config, db) }
})

test('a fresh database provisions reading progress and the Kindle companion at the current schema version', () => {
  const config = testConfig()
  const db = openDatabase(config)
  try {
    assert.equal((db.prepare('SELECT MAX(version) version FROM schema_migrations').get() as { version: number }).version, CURRENT_SCHEMA)
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
    assert.equal((db.prepare('SELECT MAX(version) version FROM schema_migrations').get() as { version: number }).version, CURRENT_SCHEMA)
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
    assert.equal((db.prepare('SELECT MAX(version) version FROM schema_migrations').get() as { version: number }).version, CURRENT_SCHEMA)
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
    assert.equal((db.prepare('SELECT MAX(version) version FROM schema_migrations').get() as { version: number }).version, CURRENT_SCHEMA)
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
    DROP TABLE extension_pairing_requests; DROP TABLE extension_clients; DROP TABLE extension_pair_codes; DELETE FROM schema_migrations WHERE version>=7;
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
    INSERT INTO extension_clients(id,token_hash,origin,created_at,revoked_at) VALUES ('client','existing-token-hash','chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','2020-01-01',NULL);
    INSERT INTO kindle_conversations VALUES ('conversation','client','p','book-key','Book','2020-01-01');
    INSERT INTO kindle_turns(id,client_id,conversation_id,request_id,request_hash,capture_json,question,status,answer,created_at,updated_at)
      VALUES ('turn','client','conversation','request','hash','{}','Question','complete','Existing answer','2020-01-01','2020-01-01');
    ALTER TABLE chat_messages DROP COLUMN visual_id;
    ALTER TABLE kindle_turns DROP COLUMN visual_id;
    ALTER TABLE kindle_turns DROP COLUMN response_mode;
    DROP TABLE visual_explanations;
    DROP TABLE extension_pairing_requests; ALTER TABLE extension_clients DROP COLUMN label; DELETE FROM schema_migrations WHERE version>=8;
  `)
  before.close()
  const backups = new Set(fs.readdirSync(config.backupsDir)), db = openDatabase(config)
  try {
    assert.equal((db.prepare("SELECT token_hash FROM extension_clients WHERE id='client'").get() as { token_hash: string }).token_hash, 'existing-token-hash')
    assert.deepEqual(db.prepare("SELECT answer,response_mode,visual_id FROM kindle_turns WHERE id='turn'").get(), { answer: 'Existing answer', response_mode: 'text', visual_id: null })
    assert.equal((db.prepare("SELECT content FROM notes WHERE id='n'").get() as { content: string }).content, 'Keep this')
    assert.equal((db.prepare('SELECT MAX(version) version FROM schema_migrations').get() as { version: number }).version, CURRENT_SCHEMA)
    assert.equal(fs.readdirSync(config.backupsDir).filter(file => !backups.has(file)).length, 1)
  } finally { cleanup(config, db) }
})

test('version 8 upgrade keeps credentials and visual ownership and runs only once', () => {
  const config = testConfig(), before = openDatabase(config)
  before.exec(`INSERT INTO extension_clients(id,token_hash,origin,created_at) VALUES ('client','hash','chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','2020-01-01');
    INSERT INTO projects VALUES ('p','Project','','2020-01-01','2020-01-01');
    INSERT INTO visual_explanations(id,project_id,client_id,request_id,request_hash,question,status,references_json,request_json,created_at,updated_at)
      VALUES ('v','p','client','r','h','Question','complete','[]','{}','2020-01-01','2020-01-01');
    DROP TABLE extension_pairing_requests; ALTER TABLE extension_clients DROP COLUMN label; DELETE FROM schema_migrations WHERE version>=9;`)
  before.close()
  const backups = fs.readdirSync(config.backupsDir).length, db = openDatabase(config)
  assert.deepEqual(db.prepare("SELECT token_hash,label FROM extension_clients WHERE id='client'").get(), { token_hash: 'hash', label: null })
  assert.equal((db.prepare("SELECT client_id FROM visual_explanations WHERE id='v'").get() as { client_id: string }).client_id, 'client')
  assert.equal(fs.readdirSync(config.backupsDir).length, backups + 1)
  db.close()
  const reopened = openDatabase(config)
  try { assert.equal(fs.readdirSync(config.backupsDir).length, backups + 1) }
  finally { cleanup(config, reopened) }
})

test('version 16 upgrade adds share cards to a version 15 library, backs it up once and keeps its highlights', () => {
  const config = testConfig(), before = openDatabase(config)
  before.exec(`INSERT INTO projects VALUES ('p','Project','','2020-01-01','2020-01-01');
    INSERT INTO sources(id,project_id,type,title,pdf_text,pages,created_at,accessed_at) VALUES ('s','p','pdf','Paper','[Page 1]\nText',1,'2020-01-01','2020-01-01');
    INSERT INTO annotations(id,source_id,project_id,page_number,x1,y1,x2,y2,text,color,created_at) VALUES ('a','s','p',1,0.1,0.1,0.5,0.2,'Highlighted text','green','2020-01-01');
    DROP TABLE share_cards; DELETE FROM schema_migrations WHERE version>=16;`)
  before.close()
  const backups = fs.readdirSync(config.backupsDir).length, db = openDatabase(config)
  try {
    assert.equal((db.prepare('SELECT MAX(version) version FROM schema_migrations').get() as { version: number }).version, 16)
    assert.equal(CURRENT_SCHEMA, 16)
    assert.deepEqual(db.prepare("SELECT text,color FROM annotations WHERE id='a'").get(), { text: 'Highlighted text', color: 'green' })
    assert.deepEqual((db.prepare('PRAGMA index_list(share_cards)').all() as Array<{ name: string }>).map(index => index.name).filter(name => !name.startsWith('sqlite_')).sort(),
      ['share_card_annotation', 'share_card_project', 'share_card_requests'])
    assert.equal(fs.readdirSync(config.backupsDir).length, backups + 1)
    db.prepare(`INSERT INTO share_cards(id,project_id,source_id,annotation_id,request_id,request_hash,status,attempt,source_json,created_at,updated_at)
      VALUES ('c','p','s','a','r','h','complete','t','{}','2020-01-01','2020-01-01')`).run()
    assert.deepEqual(db.prepare("SELECT destination,take FROM share_cards WHERE id='c'").get(), { destination: 'linkedin', take: '' })
    assert.throws(() => db.prepare(`INSERT INTO share_cards(id,project_id,source_id,annotation_id,request_id,request_hash,status,attempt,source_json,created_at,updated_at)
      VALUES ('d','p','s','a','r2','h','complete','t','{}','2020-01-01','2020-01-01')`).run(), /UNIQUE/)
    assert.throws(() => db.prepare(`INSERT INTO share_cards(id,project_id,request_id,request_hash,status,attempt,source_json,created_at,updated_at)
      VALUES ('e','p','r3','h','done','t','{}','2020-01-01','2020-01-01')`).run(), /CHECK/)
    db.prepare("DELETE FROM sources WHERE id='s'").run()
    assert.deepEqual(db.prepare("SELECT source_id,annotation_id FROM share_cards WHERE id='c'").get(), { source_id: null, annotation_id: null })
    db.close()
    const reopened = openDatabase(config)
    try { assert.equal(fs.readdirSync(config.backupsDir).length, backups + 1); assert.equal((reopened.prepare('SELECT COUNT(*) n FROM share_cards').get() as { n: number }).n, 1) }
    finally { reopened.close() }
  } finally { fs.rmSync(config.dataDir, { recursive: true, force: true }) }
})

test('a library holding the first build\'s share_cards table opens with the final table, its posts dropped and its highlights kept', () => {
  const config = testConfig(), before = openDatabase(config)
  // The first build's table: version 16, no destination or take columns.
  before.exec(`INSERT INTO projects VALUES ('p','Project','','2020-01-01','2020-01-01');
    INSERT INTO sources(id,project_id,type,title,pdf_text,pages,created_at,accessed_at) VALUES ('s','p','pdf','Paper','[Page 1]\nText',1,'2020-01-01','2020-01-01');
    INSERT INTO annotations(id,source_id,project_id,page_number,x1,y1,x2,y2,text,color,created_at) VALUES ('a','s','p',1,0.1,0.1,0.5,0.2,'Highlighted text','green','2020-01-01');
    DROP TABLE share_cards;
    CREATE TABLE share_cards (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      source_id TEXT REFERENCES sources(id) ON DELETE SET NULL, annotation_id TEXT REFERENCES annotations(id) ON DELETE SET NULL,
      request_id TEXT NOT NULL, request_hash TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','running','complete','failed','cancelled')), attempt TEXT NOT NULL,
      source_json TEXT NOT NULL, card_json TEXT, caption_json TEXT, previous_json TEXT, instruction TEXT NOT NULL DEFAULT '',
      error TEXT, error_detail TEXT, agent TEXT, model TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE UNIQUE INDEX share_card_requests ON share_cards(project_id, request_id);
    CREATE UNIQUE INDEX share_card_annotation ON share_cards(annotation_id) WHERE annotation_id IS NOT NULL;
    CREATE INDEX share_card_project ON share_cards(project_id, created_at);
    INSERT INTO share_cards(id,project_id,source_id,annotation_id,request_id,request_hash,status,attempt,source_json,caption_json,created_at,updated_at)
      VALUES ('old','p','s','a','r','h','complete','t','{}','{"body":"Old caption","hashtags":[],"edited":null}','2020-01-01','2020-01-01');`)
  before.close()
  const backups = fs.readdirSync(config.backupsDir).length, db = openDatabase(config)
  try {
    assert.equal((db.prepare('SELECT MAX(version) version FROM schema_migrations').get() as { version: number }).version, 16)
    const columns = (db.prepare('PRAGMA table_info(share_cards)').all() as Array<{ name: string; dflt_value: string | null; notnull: number }>)
    assert.deepEqual(columns.filter(column => ['destination', 'take'].includes(column.name)).map(({ name, dflt_value, notnull }) => ({ name, dflt_value, notnull })),
      [{ name: 'destination', dflt_value: "'linkedin'", notnull: 1 }, { name: 'take', dflt_value: "''", notnull: 1 }])
    assert.equal((db.prepare('SELECT COUNT(*) n FROM share_cards').get() as { n: number }).n, 0)
    assert.deepEqual((db.prepare('PRAGMA index_list(share_cards)').all() as Array<{ name: string }>).map(index => index.name).filter(name => !name.startsWith('sqlite_')).sort(),
      ['share_card_annotation', 'share_card_project', 'share_card_requests'])
    assert.deepEqual(db.prepare("SELECT text,color FROM annotations WHERE id='a'").get(), { text: 'Highlighted text', color: 'green' })
    // The library was already at version 16, so no backup is taken; a post in the final table survives a reopen.
    assert.equal(fs.readdirSync(config.backupsDir).length, backups)
    db.prepare(`INSERT INTO share_cards(id,project_id,source_id,annotation_id,request_id,request_hash,status,attempt,source_json,destination,take,created_at,updated_at)
      VALUES ('new','p','s','a','r','h','complete','t','{}','x','A take.','2020-01-01','2020-01-01')`).run()
    db.close()
    const reopened = openDatabase(config)
    try { assert.deepEqual(reopened.prepare('SELECT id,destination,take FROM share_cards').all(), [{ id: 'new', destination: 'x', take: 'A take.' }]) }
    finally { reopened.close() }
  } finally { fs.rmSync(config.dataDir, { recursive: true, force: true }) }
})
