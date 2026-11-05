import fs from 'node:fs/promises'
import syncFs from 'node:fs'
import path from 'node:path'
import { createHash,randomUUID } from 'node:crypto'
import Database, {type Database as DB} from 'better-sqlite3'
import {z} from 'zod'
import type {PdfpalConfig} from './config.js'
import {CURRENT_SCHEMA} from './database.js'
import {acquireLease,acquireFilesLease} from './locking.js'
import {TrashService} from './trash.js'
import {setting} from '../sync/database.js'
import {PdfpalError} from './types.js'
import {errorReportsFor} from './error-reports.js'

const uuid=z.string().uuid()
const fileName=z.string().min(1).max(240).refine(s=>s===path.basename(s)&&s!=='.'&&s!=='..'&&!/[\\/\x00-\x1f]/.test(s))
const fileInfo=z.object({name:fileName,bytes:z.number().int().nonnegative(),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict()
const manifestSchema=z.object({format:z.literal('pdfpal-library-backup'),version:z.literal(1),id:uuid,createdAt:z.string().datetime(),purpose:z.enum(['manual','scheduled','before-restore']),schema:z.number().int().min(1).max(CURRENT_SCHEMA),database:fileInfo,files:z.array(fileInfo).max(100000),missingFiles:z.number().int().nonnegative(),counts:z.record(z.string(),z.number().int().nonnegative())}).strict()
type Manifest=z.infer<typeof manifestSchema>
const countTables=['projects','sources','collections','notes','annotations','chat_sessions','chat_messages','kindle_conversations','kindle_turns','visual_explanations']
const recoveryMarker='.pdfpal-recovered.json'

async function digest(filename:string){
  const hash=createHash('sha256')
  for await(const chunk of syncFs.createReadStream(filename))hash.update(chunk)
  return hash.digest('hex')
}
async function regular(filename:string){const stat=await fs.lstat(filename);if(!stat.isFile()||stat.isSymbolicLink())throw new Error('Backup contains an unsupported file');return stat}
async function flush(filename:string){const handle=await fs.open(filename,'r+');try{await handle.sync()}finally{await handle.close()}}
const fail=(code:string,message:string)=>new PdfpalError(code,message,4)
async function readManifest(folder:string){const filename=path.join(folder,'manifest.json');if((await regular(filename)).size>32*1024*1024)throw fail('BACKUP_INTEGRITY','The backup manifest is too large.');return manifestSchema.parse(JSON.parse(await fs.readFile(filename,'utf8')))}

export class BackupService {
  busy: 'backup'|'restore'|null=null
  lastError=''
  private active?:Promise<any>
  private timer?:ReturnType<typeof setInterval>
  private startup?:ReturnType<typeof setTimeout>
  private closing=false
  private controller=new AbortController()
  constructor(private readonly db:DB,readonly config:PdfpalConfig){}
  get root(){return setting(this.db,'backup_directory')??path.join(this.config.backupsDir,'libraries')}
  private roots(){
    let previous:string[]=[]
    try{previous=JSON.parse(setting(this.db,'backup_locations')??'[]')}catch{}
    return [...new Set([this.root,path.join(this.config.backupsDir,'libraries'),...previous.filter(v=>typeof v==='string')])]
  }
  settings(){
    const recovered=syncFs.existsSync(path.join(this.config.dataDir,recoveryMarker))
    return {enabled:setting(this.db,'backup_enabled')?setting(this.db,'backup_enabled')==='1':!recovered,
      intervalHours:Number(setting(this.db,'backup_interval')??24),keep:Number(setting(this.db,'backup_keep')??7),
      lastBackup:setting(this.db,'backup_last_success')??null,directory:this.root,busy:this.busy,lastError:this.lastError,recovered}
  }
  configure(value:{enabled:boolean;intervalHours:number;keep:number}){
    z.object({enabled:z.boolean(),intervalHours:z.union([z.literal(6),z.literal(24),z.literal(168)]),keep:z.number().int().min(2).max(30)}).strict().parse(value)
    this.db.transaction(()=>{setting(this.db,'backup_enabled',value.enabled?'1':'0');setting(this.db,'backup_interval',String(value.intervalHours));setting(this.db,'backup_keep',String(value.keep))})()
    return this.settings()
  }
  async setDirectory(directory:string){
    if(this.busy)throw fail('BACKUP_BUSY','Wait for the current backup or recovery operation.')
    if(!path.isAbsolute(directory))throw fail('BACKUP_FOLDER','Choose an absolute backup folder.')
    const root=path.join(path.resolve(directory),'pdfpal-library-backups')
    if(root===this.config.filesDir||root.startsWith(path.resolve(this.config.filesDir)+path.sep))throw fail('BACKUP_FOLDER','Choose a folder outside the managed paper files.')
    await fs.mkdir(root,{recursive:true,mode:0o700})
    const probe=path.join(root,`.write-test-${randomUUID()}`)
    await fs.writeFile(probe,'',{flag:'wx',mode:0o600});await fs.unlink(probe)
    setting(this.db,'backup_locations',JSON.stringify(this.roots()))
    setting(this.db,'backup_directory',root)
    return this.settings()
  }
  async list(){
    const entries:Manifest[]=[]
    for(const root of this.roots()){
      const names=await fs.readdir(root).catch(()=>[] as string[])
      for(const name of names.filter(n=>/^backup-[0-9a-f-]{36}$/.test(n))){
        try{const folder=path.join(root,name);if((await fs.lstat(folder)).isSymbolicLink())continue;const m=await readManifest(folder);if(name===`backup-${m.id}`)entries.push(m)}catch{}
      }
    }
    return [...new Map(entries.map(m=>[m.id,m])).values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(m=>({...m,totalBytes:m.database.bytes+m.files.reduce((n,f)=>n+f.bytes,0),pdfFiles:m.files.length,complete:m.missingFiles===0}))
  }
  private async locate(id:string){
    uuid.parse(id)
    for(const root of this.roots()){
      const folder=path.join(root,`backup-${id}`)
      try{const stat=await fs.lstat(folder);if(stat.isDirectory()&&!stat.isSymbolicLink())return folder}catch{}
    }
    throw new PdfpalError('BACKUP_NOT_FOUND','This backup is no longer in the configured folders.',3)
  }
  private async task<T>(kind:'backup'|'restore',work:()=>Promise<T>):Promise<T>{
    this.assertOpen()
    if(this.active)throw fail('BACKUP_BUSY','Wait for the current backup or recovery operation.')
    this.busy=kind;this.lastError=''
    const task=(async()=>{
      let release:(()=>void)|undefined,files:(()=>void)|undefined
      try{release=acquireLease(`${this.config.dbPath}.backup-lock`);files=await acquireFilesLease(this.config.dbPath,120000,this.controller.signal);return await work()}
      catch(error){if(!this.closing)errorReportsFor(this.db).record(kind==='restore'?'RESTORE_FAILED':'BACKUP_FAILED');this.lastError=error instanceof PdfpalError?error.message:'The operation could not finish. Check free disk space and folder permissions, then retry.';throw error instanceof PdfpalError?error:fail('BACKUP_FAILED',this.lastError)}
      finally{files?.();release?.();this.busy=null}
    })()
    this.active=task
    void task.finally(()=>{if(this.active===task)this.active=undefined}).catch(()=>{})
    return task
  }
  create(purpose:Manifest['purpose']='manual',id:string=randomUUID()){uuid.parse(id);return this.task('backup',()=>this.snapshot(purpose,id))}
  private async snapshot(purpose:Manifest['purpose'],id:string=randomUUID()){
    this.assertOpen()
    await fs.mkdir(this.root,{recursive:true,mode:0o700})
    const temporary=path.join(this.root,`.building-${id}`),final=path.join(this.root,`backup-${id}`)
    await fs.mkdir(path.join(temporary,'files'),{recursive:true,mode:0o700})
    let copy:DB|undefined
    try{
      const database=path.join(temporary,'library.sqlite')
      await this.db.backup(database)
      this.assertOpen()
      copy=new Database(database,{readonly:true,fileMustExist:true})
      if(copy.pragma('quick_check',{simple:true})!=='ok'||(copy.pragma('foreign_key_check') as unknown[]).length)throw fail('BACKUP_INTEGRITY','The library did not pass its integrity check. Existing backups were kept.')
      const sources=copy.prepare('SELECT local_path,content_hash,type FROM sources').all() as {local_path:string|null;content_hash:string|null;type:string}[]
      const references=[...new Set([...sources.map(s=>s.local_path).filter((v):v is string=>!!v),...new TrashService(copy).fileReferences()].map(v=>path.basename(v)))]
      const counts=Object.fromEntries(countTables.map(table=>[table,(copy!.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as {n:number}).n]))
      const schema=(copy.prepare('SELECT MAX(version) n FROM schema_migrations').get() as {n:number}).n
      copy.close();copy=undefined
      const files:Manifest['files']=[];let missingFiles=sources.filter(s=>['pdf','url'].includes(s.type)&&!s.local_path).length
      for(const name of references){
        this.assertOpen()
        fileName.parse(name)
        const source=path.join(this.config.filesDir,name),target=path.join(temporary,'files',name)
        try{await regular(source)}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT'){missingFiles++;continue}throw error}
        await fs.copyFile(source,target,syncFs.constants.COPYFILE_EXCL)
        const sha256=await digest(target)
        if(sources.some(s=>s.local_path&&path.basename(s.local_path)===name&&s.content_hash&&s.content_hash!==sha256))throw fail('BACKUP_CHANGED','A paper changed while the backup was being made. Retry after the import or file update finishes. Existing backups were kept.')
        files.push({name,bytes:(await regular(target)).size,sha256});await flush(target)
      }
      const manifest:Manifest={format:'pdfpal-library-backup',version:1,id,createdAt:new Date().toISOString(),purpose,schema,database:{name:'library.sqlite',bytes:(await regular(database)).size,sha256:await digest(database)},files,missingFiles,counts}
      await flush(database);await fs.writeFile(path.join(temporary,'manifest.json'),JSON.stringify(manifest,null,2),{mode:0o600});await flush(path.join(temporary,'manifest.json'))
      this.assertOpen();await fs.rename(temporary,final)
      setting(this.db,'backup_last_success',manifest.createdAt)
      if(purpose!=='before-restore')try{await this.retain()}catch{this.lastError='The backup was saved, but an older scheduled copy could not be removed.'}
      return manifest
    }catch(error){copy?.close();await fs.rm(temporary,{recursive:true,force:true}).catch(()=>{});throw error}
  }
  private async retain(){
    const entries=await this.list(),scheduled=entries.filter(b=>b.purpose==='scheduled')
    const keep=new Set([...scheduled.slice(0,this.settings().keep),...scheduled.filter(b=>b.complete).slice(0,2)].map(b=>b.id))
    for(const item of scheduled)if(!keep.has(item.id))await fs.rm(await this.locate(item.id),{recursive:true})
  }
  async verify(id:string){
    const folder=await this.locate(id),manifest=await readManifest(folder)
    if(manifest.id!==id||manifest.database.name!=='library.sqlite')throw fail('BACKUP_INTEGRITY','This is not a supported library backup.')
    const fileDirectory=await fs.lstat(path.join(folder,'files'))
    if(!fileDirectory.isDirectory()||fileDirectory.isSymbolicLink())throw fail('BACKUP_INTEGRITY','The backup paper folder is not valid.')
    const names=new Set<string>()
    for(const entry of [manifest.database,...manifest.files]){
      const name=entry===manifest.database?path.join(folder,'library.sqlite'):path.join(folder,'files',entry.name)
      if(names.has(name))throw fail('BACKUP_INTEGRITY','The backup contains duplicate file entries.');names.add(name)
      const stat=await regular(name)
      if(stat.size!==entry.bytes||await digest(name)!==entry.sha256)throw fail('BACKUP_INTEGRITY','A backup file is missing or damaged. Nothing has been restored.')
    }
    const copy=new Database(path.join(folder,'library.sqlite'),{readonly:true,fileMustExist:true})
    try{if(copy.pragma('quick_check',{simple:true})!=='ok'||(copy.pragma('foreign_key_check') as unknown[]).length)throw fail('BACKUP_INTEGRITY','The backup database failed its integrity check.')}finally{copy.close()}
    return {folder,manifest}
  }
  restore(id:string){return this.task('restore',async()=>{
    const {folder,manifest}=await this.verify(id)
    await this.snapshot('before-restore')
    const recoveryId=randomUUID(),root=path.join(this.config.dataDir,'recovered-libraries'),temporary=path.join(root,`.building-${recoveryId}`),target=path.join(root,recoveryId)
    await fs.mkdir(path.join(temporary,'files'),{recursive:true,mode:0o700})
    let copy:DB|undefined
    try{
      await fs.copyFile(path.join(folder,'library.sqlite'),path.join(temporary,'pdfpal.db'))
      if(await digest(path.join(temporary,'pdfpal.db'))!==manifest.database.sha256)throw fail('BACKUP_INTEGRITY','The backup changed during recovery. The current library was kept.')
      for(const file of manifest.files){this.assertOpen();const targetFile=path.join(temporary,'files',file.name);await fs.copyFile(path.join(folder,'files',file.name),targetFile);if(await digest(targetFile)!==file.sha256)throw fail('BACKUP_INTEGRITY','A backup file changed during recovery. The current library was kept.')}
      copy=new Database(path.join(temporary,'pdfpal.db'))
      copy.transaction(()=>{
        copy!.prepare("INSERT INTO sync_settings VALUES('enabled','0') ON CONFLICT(key) DO UPDATE SET value='0'").run()
        for(const table of ['sync_outbox','sync_remote','sync_versions','sync_files','sync_conflicts','sync_settings','telemetry_journal','error_reports'])copy!.exec(`DELETE FROM ${table}`)
        if(copy!.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='cli_operations'").get())copy!.exec('DELETE FROM cli_operations')
        copy!.prepare("INSERT INTO sync_settings VALUES('applying','0')").run()
        copy!.prepare("UPDATE ai_jobs SET status='interrupted',error='This answer was interrupted before recovery.' WHERE status='running'").run()
        copy!.prepare("UPDATE kindle_turns SET status='failed',error='This request was interrupted before recovery.' WHERE status IN ('pending','running')").run()
        copy!.prepare('UPDATE trash_items SET ready=1').run()
        copy!.prepare('UPDATE extension_clients SET revoked_at=?').run(new Date().toISOString())
        copy!.prepare('DELETE FROM extension_pair_codes').run()
        for(const row of copy!.prepare('SELECT id,local_path FROM sources WHERE local_path IS NOT NULL').all() as {id:string;local_path:string}[])copy!.prepare('UPDATE sources SET local_path=? WHERE id=?').run(path.basename(row.local_path),row.id)
      })()
      copy.pragma('wal_checkpoint(TRUNCATE)');copy.close();copy=undefined
      const info={format:1,id:recoveryId,backupId:id,label:`Recovered ${new Date(manifest.createdAt).toLocaleDateString('en-CA')}`,createdAt:new Date().toISOString(),counts:manifest.counts,missingFiles:manifest.missingFiles}
      await fs.writeFile(path.join(temporary,recoveryMarker),JSON.stringify(info),{mode:0o600})
      this.assertOpen();await fs.rename(temporary,target)
      return {...info,dataDir:target}
    }catch(error){copy?.close();await fs.rm(temporary,{recursive:true,force:true}).catch(()=>{});throw error}
  })}
  async recovered(id:string){
    uuid.parse(id)
    const dataDir=path.join(this.config.dataDir,'recovered-libraries',id)
    if((await fs.lstat(dataDir)).isSymbolicLink())throw fail('RECOVERY_INVALID','This recovered library cannot be opened.')
    const info=JSON.parse(await fs.readFile(path.join(dataDir,recoveryMarker),'utf8'))
    if(info.id!==id||info.format!==1)throw fail('RECOVERY_INVALID','This recovered library cannot be opened.')
    return {...info,dataDir}
  }
  async listRecovered(){
    const names=await fs.readdir(path.join(this.config.dataDir,'recovered-libraries')).catch(()=>[] as string[])
    const items=[]
    for(const id of names)if(uuid.safeParse(id).success)try{items.push(await this.recovered(id))}catch{}
    return items
  }
  delete(id:string){return this.task('backup',async()=>{await fs.rm(await this.locate(id),{recursive:true});return {ok:true}})}
  async maybeDue(){
    const s=this.settings()
    if(!s.enabled||this.busy||s.lastBackup&&Date.now()-Date.parse(s.lastBackup)<s.intervalHours*3600000)return
    try{await this.create('scheduled')}catch{}
  }
  start(){
    this.startup=setTimeout(()=>void this.maybeDue(),10000);this.startup.unref()
    this.timer=setInterval(()=>{new TrashService(this.db).prune();void this.maybeDue()},60000);this.timer.unref()
  }
  private assertOpen(){if(this.closing)throw fail('BACKUP_CANCELLED','The operation stopped because pdfpal is closing. Existing backups and the current library were kept.')}
  stop(){this.closing=true;this.controller.abort();clearTimeout(this.startup);clearInterval(this.timer)}
  async close(){this.stop();await this.active?.catch(()=>{})}
}
