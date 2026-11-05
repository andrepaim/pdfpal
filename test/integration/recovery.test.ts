import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {testConfig,testDb,cleanup} from '../helpers/test-utils.js'
import {ProjectService} from '../../src/core/projects.js'
import {SourceService} from '../../src/core/sources.js'
import {NoteService} from '../../src/core/notes.js'
import {CollectionService} from '../../src/core/collections.js'
import {ChatService} from '../../src/core/chat.js'
import {TrashService} from '../../src/core/trash.js'
import {BackupService} from '../../src/core/backups.js'
import {loadConfig} from '../../src/core/config.js'
import {openDatabase} from '../../src/core/database.js'
import {setting,pending} from '../../src/sync/database.js'
import {operationSchema} from '../../src/shared/sync/schema.js'

test('project deletion keeps PDFs, notes, indexed text and saved conversations recoverable atomically',async()=>{
 const config=testConfig(),db=testDb(config)
 try{
  const projects=new ProjectService(db),p=projects.create('Recover this project')
  const source=await new SourceService(db,config).add(p.id,{filename:'sample.pdf',bytes:await fs.readFile('test/fixtures/sample.pdf')})
  const notes=new NoteService(db,config),note=notes.create(p.id,{sourceSelector:source.id,content:'Keep the note'})
  const chat=new ChatService(db,config);chat.persist(p.id,source.id,'Saved question','Saved answer',[source.id])
  const before=chat.history(p.id,source.id).map(m=>[m.role,m.content,m.sources_used,m.created_at])
  setting(db,'enabled','1');setting(db,'conversations','1')
  projects.delete(p.id)
  assert.equal(projects.list().length,0)
  assert.ok((await fs.readFile(path.join(config.filesDir,source.local_path!))).length)
  const trash=new TrashService(db),items=trash.list() as {id:string}[]
  assert.equal(items.length,1)
  for(const op of pending(db)){operationSchema.parse(op);assert.match(op.operationId,/^del/)}
  const last=(db.prepare('SELECT operation_id FROM sync_outbox ORDER BY seq DESC LIMIT 1').get() as {operation_id:string}).operation_id
  assert.match(last,/_end_/)
  trash.restore(items[0]!.id)
  assert.equal(projects.resolve(p.id).title,p.title)
  assert.equal(notes.resolve(p.id,note.id).content,'Keep the note')
  assert.deepEqual(chat.history(p.id,source.id).map(m=>[m.role,m.content,m.sources_used,m.created_at]),before)
  assert.ok((db.prepare('SELECT COUNT(*) n FROM source_chunks').get() as {n:number}).n>0)
  assert.equal(trash.list().length,0)
 }finally{cleanup(config,db)}
})

test('collection Undo preserves newer filing decisions and note recovery never overwrites newer text',()=>{
 const config=testConfig(),db=testDb(config)
 try{
  const p=new ProjectService(db).create('Filing'),collections=new CollectionService(db),folder=collections.create(p.id,'Deleted folder')
  const other=collections.create(p.id,'New filing')
  db.prepare("INSERT INTO sources(id,project_id,type,title,created_at,accessed_at,collection_id) VALUES(?,?,'pdf','Paper','now','now',?)").run('paper',p.id,folder.id)
  collections.delete(p.id,folder.id)
  db.prepare('UPDATE sources SET collection_id=? WHERE id=?').run(other.id,'paper')
  const trash=new TrashService(db),item=(trash.list() as {id:string}[])[0]!
  assert.equal(trash.restore(item.id).linksSkipped,1)
  assert.equal((db.prepare("SELECT collection_id FROM sources WHERE id='paper'").get() as {collection_id:string}).collection_id,other.id)
  const notes=new NoteService(db,config),note=notes.create(p.id,{content:'Original'})
  notes.delete(p.id,note.id)
  const noteTrash=(trash.list() as {id:string}[])[0]!
  db.prepare('INSERT INTO notes(id,project_id,title,content,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(note.id,p.id,'New','Newer text','now','now')
  assert.throws(()=>trash.restore(noteTrash.id),/already exists/)
  trash.restore(noteTrash.id,true)
  assert.equal(notes.resolve(p.id,note.id).content,'Newer text')
  assert.ok(notes.list(p.id).some(n=>n.id!==note.id&&n.content==='Original'))
 }finally{cleanup(config,db)}
})

test('full backup restores an isolated library with PDFs and chats while preserving current work and disabling cloud replay',async()=>{
 const config=testConfig(),db=testDb(config),backup=new BackupService(db,config)
 let recovered:ReturnType<typeof testDb>|undefined
 try{
  const p=new ProjectService(db).create('Backup project'),notes=new NoteService(db,config)
  const source=await new SourceService(db,config).add(p.id,{filename:'sample.pdf',bytes:await fs.readFile('test/fixtures/sample.pdf')})
  const note=notes.create(p.id,{content:'Snapshot text'})
  new ChatService(db,config).persist(p.id,source.id,'Question','Answer',[source.id])
  const snapshot=await backup.create()
  assert.equal(snapshot.files.length,1);assert.equal(snapshot.missingFiles,0)
  notes.update(p.id,note.id,{content:'Newer work'})
  setting(db,'enabled','1');setting(db,'owner','test-owner');setting(db,'library',randomUUID());setting(db,'conversations','1')
  const result=await backup.restore(snapshot.id)
  assert.equal(notes.resolve(p.id,note.id).content,'Newer work')
  const cfg=loadConfig({dataDir:result.dataDir});recovered=openDatabase(cfg)
  assert.equal(new NoteService(recovered,cfg).resolve(p.id,note.id).content,'Snapshot text')
  assert.deepEqual(new ChatService(recovered,cfg).history(p.id,source.id).map(m=>m.content),['Question','Answer'])
  assert.equal(setting(recovered,'enabled'),undefined)
  assert.equal(setting(recovered,'owner'),undefined)
  assert.equal(pending(recovered).length,0)
  assert.deepEqual(await fs.readFile(path.join(cfg.filesDir,source.local_path!)),await fs.readFile('test/fixtures/sample.pdf'))
  assert.equal(new BackupService(recovered,cfg).settings().enabled,false)
 }finally{recovered?.close();await backup.close();cleanup(config,db)}
})

test('damaged and missing PDFs are reported without replacing valid backups or the current library',async()=>{
 const config=testConfig(),db=testDb(config),backup=new BackupService(db,config)
 try{
  const p=new ProjectService(db).create('Integrity')
  const source=await new SourceService(db,config).add(p.id,{filename:'sample.pdf',bytes:await fs.readFile('test/fixtures/sample.pdf')})
  const good=await backup.create()
  await fs.writeFile(path.join(backup.root,`backup-${good.id}`,'files',source.local_path!),'corrupt')
  await assert.rejects(backup.restore(good.id),/damaged/)
  assert.equal(new ProjectService(db).list().length,1)
  assert.deepEqual(await fs.readFile(path.join(config.filesDir,source.local_path!)),await fs.readFile('test/fixtures/sample.pdf'))
  await fs.unlink(path.join(config.filesDir,source.local_path!))
  const partial=await backup.create()
  assert.equal(partial.missingFiles,1)
  assert.equal((await backup.list()).find(b=>b.id===partial.id)!.complete,false)
  await assert.rejects(backup.verify('../outside'),/./)
 }finally{await backup.close();cleanup(config,db)}
})

test('scheduled retention keeps manual backups, and schedules respect disabled settings',async()=>{
 const config=testConfig(),db=testDb(config),backup=new BackupService(db,config)
 try{
  new ProjectService(db).create('Schedule')
  backup.configure({enabled:true,intervalHours:24,keep:2})
  const manual=await backup.create()
  const first=await backup.create('scheduled')
  await new Promise(r=>setTimeout(r,2));await backup.create('scheduled')
  await new Promise(r=>setTimeout(r,2));await backup.create('scheduled')
  const list=await backup.list()
  assert.ok(list.some(b=>b.id===manual.id));assert.ok(!list.some(b=>b.id===first.id))
  assert.equal(list.filter(b=>b.purpose==='scheduled').length,2)
  backup.configure({enabled:false,intervalHours:24,keep:2});setting(db,'backup_last_success','2000-01-01T00:00:00.000Z')
  await backup.maybeDue();assert.equal((await backup.list()).length,3)
  backup.configure({enabled:true,intervalHours:24,keep:2});await backup.maybeDue()
  assert.notEqual(backup.settings().lastBackup,'2000-01-01T00:00:00.000Z')
 }finally{await backup.close();cleanup(config,db)}
})

test('Undo detects damaged retained PDFs and still recovers readable text without serving damaged bytes',async()=>{
 const config=testConfig(),db=testDb(config)
 try{
  const p=new ProjectService(db).create('Damaged deleted file'),sources=new SourceService(db,config)
  const s=await sources.add(p.id,{filename:'sample.pdf',bytes:await fs.readFile('test/fixtures/sample.pdf')})
  sources.remove(p.id,s.id)
  await fs.writeFile(path.join(config.filesDir,s.local_path!),'damaged')
  const trash=new TrashService(db),item=(trash.list() as {id:string}[])[0]!
  assert.equal((await trash.restoreWithFiles(config,item.id)).missingFiles,1)
  const restored=sources.resolve(p.id,s.id)
  assert.equal(restored.local_path,null);assert.equal(restored.pdf_text,s.pdf_text)
 }finally{cleanup(config,db)}
})

test('closing cancels a backup waiting on another file writer without leaving a saved partial copy',async()=>{
 const {acquireFilesLease}=await import('../../src/core/locking.js')
 const config=testConfig(),db=testDb(config),backup=new BackupService(db,config)
 const release=await acquireFilesLease(config.dbPath)
 try{
  const creating=backup.create();const rejected=assert.rejects(creating,/cancelled|closing/)
  await backup.close();await rejected
  assert.deepEqual(await backup.list(),[])
 }finally{release();cleanup(config,db)}
})
