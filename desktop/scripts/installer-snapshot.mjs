import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
const [stage, data, mode, snapshotFile] = process.argv.slice(2)
const require = createRequire(path.join(path.resolve(stage), 'package.json'))
const Database = require('better-sqlite3')
const db = new Database(path.join(data, 'pdfpal.db'), { readonly: true })
try {
  if (db.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('Installer fixture database integrity check failed')
  const fixture = JSON.parse(fs.readFileSync(path.join(data, 'installer-acceptance-fixture.json'), 'utf8'))
  const source = db.prepare('SELECT id,title,local_path,content_hash,collection_id FROM sources WHERE id=?').get(fixture.source)
  const filename = path.resolve(data, 'files', source.local_path)
  if (!filename.startsWith(path.resolve(data) + path.sep)) throw new Error('Fixture PDF must be inside its own test library')
  const snapshot = {
    source: { ...source, local_path: path.relative(data, filename) },
    pdf: createHash('sha256').update(fs.readFileSync(filename)).digest('hex'),
    note: db.prepare('SELECT id,title,content,source_id FROM notes WHERE id=?').get(fixture.note),
    collection: db.prepare('SELECT id,name,parent_id,position FROM collections WHERE id=?').get(fixture.collection),
    annotation: db.prepare('SELECT id,text,color,page_number FROM annotations WHERE id=?').get(fixture.annotation),
    client: db.prepare('SELECT id,token_hash FROM extension_clients WHERE id=?').get(fixture.client),
    history: db.prepare('SELECT role,content FROM chat_messages WHERE session_id IN (SELECT id FROM chat_sessions WHERE source_id=?) ORDER BY id').all(fixture.source),
  }
  if (!snapshot.client || !snapshot.note || !snapshot.collection || !snapshot.annotation || !snapshot.history.length) throw new Error('Incomplete preservation fixture')
  if (mode === 'save') fs.writeFileSync(snapshotFile, JSON.stringify(snapshot))
  else if (JSON.stringify(snapshot) !== fs.readFileSync(snapshotFile, 'utf8')) throw new Error('Installer changed the preserved library/extension identity')
  console.log(mode === 'save' ? 'Installer preservation snapshot saved.' : 'Installer preserved PDF, note, collection, highlight, history, and extension identity.')
} finally { db.close() }
