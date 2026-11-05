import { randomBytes, randomUUID } from 'node:crypto'
import type { Database } from 'better-sqlite3'
import type { Change } from '../shared/sync/schema.js'
import { PdfpalError } from './types.js'
import fs from 'node:fs/promises'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {acquireFilesLease} from './locking.js'
import type {PdfpalConfig} from './config.js'

type Row = Record<string, any>
export type TrashKind = 'project' | 'source' | 'collection' | 'note' | 'highlight' | 'chat' | 'message'
type Link = { table: string; keys: Row; field: string; value: unknown; unchanged?: Row }
type Packet = { format: 1; rows: Record<string, Row[]>; links: Link[]; files: string[] }
const kinds: Record<TrashKind, string> = { project: 'p', source: 's', collection: 'c', note: 'n', highlight: 'h', chat: 't', message: 'm' }
const entityKinds: Record<string, TrashKind> = { projects: 'project', sources: 'source', collections: 'collection', notes: 'note', annotations: 'highlight', chat_sessions: 'chat', chat_messages: 'message' }
const tables = ['projects','collections','sources','notes','kindle_conversations','visual_explanations','chat_sessions','chat_messages','kindle_turns','annotations','source_chunks','source_related']
const quote = (name: string) => '"' + name.replaceAll('"','""') + '"'
const empty = (): Packet => ({ format: 1, rows: {}, links: [], files: [] })
const key = (table: string, row: Row) => String(table === 'chat_messages' ? row.sync_id : row.id)

export function installTrash(db: Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS trash_items (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL, origin TEXT NOT NULL, ready INTEGER NOT NULL DEFAULT 1, payload TEXT NOT NULL
  );`)
}

function capture(db: Database, kind: TrashKind, id: string): Packet {
  const packet = empty()
  const select = (table: string, where: string, values: unknown[]) => {
    const rows = db.prepare(`SELECT * FROM ${quote(table)} WHERE ${where}`).all(...values) as Row[]
    packet.rows[table] = rows
    return rows
  }
  const many = (table: string, column: string, ids: unknown[]) => ids.length ? select(table, `${quote(column)} IN (${ids.map(() => '?').join(',')})`, ids) : []
  if (kind === 'project') {
    select('projects','id=?',[id])
    for (const table of ['collections','sources','notes','chat_sessions','kindle_conversations','visual_explanations','annotations']) select(table,'project_id=?',[id])
  } else if (kind === 'source') {
    select('sources','id=?',[id]); select('annotations','source_id=?',[id])
    for (const row of db.prepare('SELECT id,source_id,accessed_at FROM chat_sessions WHERE source_id=?').all(id) as Row[])
      packet.links.push({ table:'chat_sessions',keys:{id:row.id},field:'source_id',value:id,unchanged:{accessed_at:row.accessed_at} })
  } else if (kind === 'collection') {
    const rows = db.prepare(`WITH RECURSIVE tree(id) AS (SELECT id FROM collections WHERE id=?
      UNION ALL SELECT c.id FROM collections c JOIN tree t ON c.parent_id=t.id) SELECT c.* FROM collections c JOIN tree t ON c.id=t.id`).all(id) as Row[]
    packet.rows.collections = rows
    if (rows.length) for (const row of db.prepare(`SELECT id,collection_id FROM sources WHERE collection_id IN (${rows.map(() => '?').join(',')})`).all(...rows.map(r => r.id)) as Row[])
      packet.links.push({ table:'sources',keys:{id:row.id},field:'collection_id',value:row.collection_id })
  } else if (kind === 'note') select('notes','id=?',[id])
  else if (kind === 'highlight') select('annotations','id=?',[id])
  else if (kind === 'chat') select('chat_sessions','id=?',[id])
  else select('chat_messages','sync_id=?',[id])
  const sources = (packet.rows.sources ?? []).map(r => r.id)
  for (const table of ['source_chunks','source_related']) many(table,'source_id',sources)
  if (kind !== 'message') many('chat_messages','session_id',(packet.rows.chat_sessions ?? []).map(r => r.id))
  many('kindle_turns','conversation_id',(packet.rows.kindle_conversations ?? []).map(r => r.id))
  for (const note of packet.rows.notes ?? []) {
    for (const row of db.prepare('SELECT client_id,request_id FROM extension_saved_notes WHERE note_id=?').all(note.id) as Row[])
      packet.links.push({table:'extension_saved_notes',keys:row,field:'note_id',value:note.id})
    for (const row of db.prepare('SELECT id FROM visual_explanations WHERE note_id=?').all(note.id) as Row[])
      packet.links.push({table:'visual_explanations',keys:row,field:'note_id',value:note.id})
  }
  packet.files = [...new Set((packet.rows.sources ?? []).map(r => r.local_path).filter((v): v is string => typeof v === 'string' && !!v))]
  return packet
}

function merge(a: Packet, b: Packet) {
  for (const [table, rows] of Object.entries(b.rows)) {
    const all = new Map((a.rows[table] ?? []).map(row => [key(table,row),row]))
    // The first captured version precedes foreign-key changes caused by deletion.
    for (const row of rows) if (!all.has(key(table,row))) all.set(key(table,row),row)
    a.rows[table] = [...all.values()]
  }
  a.links = [...new Map([...a.links,...b.links].map(link => [JSON.stringify([link.table,link.keys,link.field]),link])).values()]
  a.files = [...new Set([...a.files,...b.files])]
  return a
}

function store(db: Database, id: string, kind: TrashKind, title: string, packet: Packet, origin: string, ready: boolean) {
  const old = db.prepare('SELECT payload FROM trash_items WHERE id=?').get(id) as {payload:string}|undefined
  const payload = JSON.stringify(old ? merge(JSON.parse(old.payload),packet) : packet)
  db.prepare(`INSERT INTO trash_items VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
    payload=excluded.payload,ready=MAX(trash_items.ready,excluded.ready),title=CASE WHEN excluded.ready=1 THEN excluded.title ELSE trash_items.title END`)
    .run(id,kind,title.slice(0,200),new Date().toISOString(),new Date(Date.now()+30*86400000).toISOString(),origin,ready?1:0,payload)
  if (ready) db.prepare('DELETE FROM trash_items WHERE ready=1 AND id NOT IN (SELECT id FROM trash_items ORDER BY created_at DESC LIMIT 100)').run()
}

/** Journal and deletion share a transaction, including cascades and outbox writes. */
export function trashDelete<T>(db: Database, kind: TrashKind, id: string, title: string, remove: () => T, additionalIds: string[] = []): T {
  return db.transaction(() => {
    const group = randomBytes(16).toString('hex'), prefix = `del${group}_${kinds[kind]}_`
    const packet = capture(db,kind,id)
    for (const extra of additionalIds) merge(packet,capture(db,kind,extra))
    store(db,group,kind,title,packet,'device',true)
    db.prepare("INSERT INTO sync_settings VALUES('deleting_prefix',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(prefix)
    try {
      const result = remove()
      const last = db.prepare('SELECT seq FROM sync_outbox WHERE operation_id LIKE ? ORDER BY seq DESC LIMIT 1').get(prefix+'%') as {seq:number}|undefined
      if (last) db.prepare('UPDATE sync_outbox SET operation_id=? WHERE seq=?').run(prefix+'end_'+randomBytes(8).toString('hex'),last.seq)
      return result
    } finally { db.prepare("DELETE FROM sync_settings WHERE key='deleting_prefix'").run() }
  })()
}

export function recordRemoteDeletion(db: Database, change: Change) {
  const grouped = /^del([a-f0-9]{32})_([pscnhtm])_(end_)?[a-f0-9]{16}$/.exec(change.operationId)
  if (change.payload !== null && !grouped) return
  const kind = entityKinds[change.entityType]
  if (!kind) return
  const groupKind = grouped ? Object.entries(kinds).find(([,code]) => code === grouped[2])![0] as TrashKind : kind
  const group = grouped?.[1] ?? randomBytes(16).toString('hex')
  const row = db.prepare(`SELECT * FROM ${quote(change.entityType)} WHERE ${change.entityType==='chat_messages'?'sync_id':'id'}=?`).get(change.entityId) as Row|undefined
  if (!row) {
    if (grouped?.[3]) db.prepare('UPDATE trash_items SET ready=1 WHERE id=?').run(group)
    return
  }
  const title = String(row.title ?? (kind==='message'?'Saved message':kind==='highlight'?'Highlight':'Saved conversation'))
  if (change.payload === null) store(db,group,groupKind,title,capture(db,kind,change.entityId),'cloud',!grouped||!!grouped[3])
  else if (grouped) {
    const packet = empty()
    const field = change.entityType==='sources'?'collection_id':change.entityType==='chat_sessions'?'source_id':null
    if (field && row[field] !== null && change.payload[field]===null)
      packet.links.push({table:change.entityType,keys:{id:row.id},field,value:row[field],...(field==='source_id'?{unchanged:{accessed_at:row.accessed_at}}:{})})
    if (packet.links.length) store(db,group,groupKind,title,packet,'cloud',!!grouped[3])
    else if (grouped[3]) db.prepare('UPDATE trash_items SET ready=1 WHERE id=?').run(group)
  }
}

export class TrashService {
  constructor(private readonly db: Database) {}
  list() {
    return this.db.prepare(`SELECT id,kind,title,created_at,expires_at,origin,ready FROM trash_items
      WHERE expires_at>? ORDER BY created_at DESC LIMIT 100`).all(new Date().toISOString())
  }
  fileReferences(): string[] {
    return (this.db.prepare('SELECT payload FROM trash_items').all() as {payload:string}[])
      .flatMap(row => (JSON.parse(row.payload) as Packet).files)
  }
  prune() { this.db.prepare('DELETE FROM trash_items WHERE expires_at<?').run(new Date().toISOString()) }
  purge(id: string) { this.db.prepare('DELETE FROM trash_items WHERE id=?').run(id) }
  async restoreWithFiles(config:PdfpalConfig,id:string,asCopy=false,committed?:(result:{restored:number;linksSkipped:number;missingFiles:number})=>void){
    const release=await acquireFilesLease(config.dbPath)
    try{
      const item=this.db.prepare('SELECT payload FROM trash_items WHERE id=?').get(id) as {payload:string}|undefined
      const unavailable=new Set<string>()
      if(item)for(const source of (JSON.parse(item.payload) as Packet).rows.sources??[]){
        if(!source.local_path)continue
        try{const file=path.join(config.filesDir,path.basename(source.local_path));const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink())throw Error();if(source.content_hash&&createHash('sha256').update(await fs.readFile(file)).digest('hex')!==source.content_hash)throw Error()}catch{unavailable.add(source.local_path)}
      }
      return this.db.transaction(()=>{const result={...this.restore(id,asCopy,unavailable),missingFiles:unavailable.size};committed?.(result);return result})()
    }finally{release()}
  }
  restore(id: string, asCopy = false, unavailable=new Set<string>()) {
    const item = this.db.prepare('SELECT payload,ready FROM trash_items WHERE id=? AND expires_at>?').get(id,new Date().toISOString()) as {payload:string;ready:number}|undefined
    if (!item) throw new PdfpalError('TRASH_NOT_FOUND','This deleted item is no longer available.',3)
    if (!item.ready) throw new PdfpalError('DELETION_IN_PROGRESS','Wait for the deletion to finish syncing before restoring it.',4)
    const packet = JSON.parse(item.payload) as Packet
    for(const source of packet.rows.sources??[])if(unavailable.has(source.local_path))source.local_path=null
    if (asCopy) {
      const identities = new Map<string,string>()
      for (const [table,rows] of Object.entries(packet.rows)) for (const row of rows) {
        if (!['chat_messages','source_chunks','source_related'].includes(table)) identities.set(String(row.id),randomUUID())
        if (table==='chat_messages') { identities.set(row.sync_id,randomUUID());if(!identities.has(row.sync_turn))identities.set(row.sync_turn,randomUUID()) }
      }
      for (const rows of Object.values(packet.rows)) for (const row of rows) {
        for (const field of ['id','project_id','source_id','collection_id','parent_id','session_id','conversation_id','visual_id','note_id','sync_id','sync_turn'])
          if (typeof row[field]==='string'&&identities.has(row[field]))row[field]=identities.get(row[field])
        if (typeof row.sources_used==='string') try {row.sources_used=JSON.stringify(JSON.parse(row.sources_used).map((v:string)=>identities.get(v)??v))}catch{}
      }
      for(const row of packet.rows.kindle_turns??[])row.request_id=randomUUID()
      packet.links=[]
    }
    return this.db.transaction(() => {
      let restored=0,linksSkipped=0
      for (const [table,rows] of Object.entries(packet.rows)) {
        if (!tables.includes(table)) throw Error('Unsupported recovery record')
        if(['source_chunks','source_related'].includes(table))continue
        for (const row of rows) {
          const field=table==='chat_messages'?'sync_id':'id'
          if (this.db.prepare(`SELECT 1 FROM ${quote(table)} WHERE ${field}=?`).get(row[field]))
            throw new PdfpalError('RESTORE_CONFLICT','An item with this identity already exists. Keep the current item or open a full backup as a separate library.',4)
        }
      }
      for (const table of tables) {
        let rows=packet.rows[table]??[]
        if (table==='collections') {
          const pending=[...rows], sorted:Row[]=[], seen=new Set<string>();
          while(pending.length) { const next=pending.findIndex(r=>!r.parent_id||seen.has(r.parent_id)||!pending.some(p=>p.id===r.parent_id));if(next<0)throw Error('Invalid collection hierarchy');const row=pending.splice(next,1)[0]!;seen.add(row.id);sorted.push(row) } rows=sorted
        }
        for (const source of rows) {
          const row={...source}
          if (table==='chat_messages'||table==='source_chunks'||table==='source_related') delete row.id
          // Preserve a note/paper when its optional filing target was deleted later.
          for (const [field,parent] of [['collection_id','collections'],['parent_id','collections'],['source_id','sources']] as const)
            if (row[field] && !this.db.prepare(`SELECT 1 FROM ${parent} WHERE id=?`).get(row[field])) { row[field]=null;linksSkipped++ }
          const fields=Object.keys(row)
          try { this.db.prepare(`INSERT INTO ${quote(table)}(${fields.map(quote).join(',')}) VALUES(${fields.map(()=>'?').join(',')})`).run(...fields.map(f=>row[f])) }
          catch { throw new PdfpalError('RESTORE_CONFLICT','Restore the parent project or discussion first. No current data was replaced.',4) }
          restored++
        }
      }
      for (const link of packet.links) {
        const allowed:Record<string,string[]>={sources:['collection_id'],chat_sessions:['source_id'],visual_explanations:['note_id'],extension_saved_notes:['note_id']}
        if(!allowed[link.table]?.includes(link.field))continue
        const conditions=[...Object.keys(link.keys).map(k=>`${quote(k)}=?`),`${quote(link.field)} IS NULL`,...Object.keys(link.unchanged??{}).map(k=>`${quote(k)} IS ?`)]
        const result=this.db.prepare(`UPDATE ${quote(link.table)} SET ${quote(link.field)}=? WHERE ${conditions.join(' AND ')}`)
          .run(link.value,...Object.values(link.keys),...Object.values(link.unchanged??{}))
        if(!result.changes)linksSkipped++
      }
      this.db.prepare('DELETE FROM trash_items WHERE id=?').run(id)
      return {restored,linksSkipped}
    })()
  }
}
