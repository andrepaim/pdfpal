import {randomUUID} from 'node:crypto'
import type {Database} from 'better-sqlite3'
import {diagnosticCode,diagnosticReport,type DiagnosticReport} from '../shared/diagnostics.js'
import {setting} from '../sync/database.js'
const services=new WeakMap<Database,ErrorReports>()
const retention=30*86400000
export function installErrorReports(db:Database){db.exec(`CREATE TABLE IF NOT EXISTS error_reports(id TEXT PRIMARY KEY,owner TEXT NOT NULL,event TEXT NOT NULL,created_at INTEGER NOT NULL,sent INTEGER NOT NULL DEFAULT 0);`)}
export function errorReportsFor(db:Database){let service=services.get(db);if(!service){service=new ErrorReports(db);services.set(db,service)}return service}
export interface ReportTransport{write(id:string,event:DiagnosticReport):Promise<unknown>;list():Promise<{id:string;event:DiagnosticReport}[]>;delete(id:string):Promise<unknown>}
export class ErrorReports{
 private owner:()=>string=()=>''
 private transport?:()=>ReportTransport
 private active?:Promise<void>
 private epoch=0
 private stopped=false
 private lastAttempt=0
 private controller=new AbortController()
 get signal(){return this.controller.signal}
 status=''
 constructor(private db:Database){}
 bind(owner:()=>string,transport:()=>ReportTransport){this.owner=owner;this.transport=transport}
 sharing(){return setting(this.db,'telemetry_share_errors')==='1'}
 setSharing(enabled:boolean){setting(this.db,'telemetry_share_errors',enabled?'1':'0');this.cancel();if(!enabled)this.db.prepare("UPDATE error_reports SET owner='' WHERE sent=0").run()}
 cancel(){this.epoch++;this.controller.abort();this.controller=new AbortController()}
 stop(){this.stopped=true;this.cancel()}
 async close(){this.stop();await this.active?.catch(()=>{})}
 record(code:unknown,durationMs=0){
  try{
   if(this.stopped||!diagnosticCode.safeParse(code).success||(!this.sharing()&&setting(this.db,'telemetry_diagnostics')!=='1'))return
   this.db.prepare('DELETE FROM error_reports WHERE created_at<?').run(Date.now()-retention)
   // Repeated outages and polling cannot flood the free tier.
   const recent=this.db.prepare('SELECT 1 FROM error_reports WHERE json_extract(event,\'$.code\')=? AND created_at>? LIMIT 1').get(code,Date.now()-(code==='SYNC_COMPLETED'?86400000:300000))
   const day=new Date().toISOString().slice(0,10)
   const daily=setting(this.db,'report_day')===day?Number(setting(this.db,'report_count')??0):0
   if(recent||daily>=20)return
   const event=diagnosticReport.parse({format:1,code,appVersion:process.env.PDFPAL_APP_VERSION??'2.1.0',platform:['win32','linux','darwin'].includes(process.platform)?process.platform:'unknown',at:Date.now(),durationMs:Number.isFinite(durationMs)?Math.min(3600000,Math.max(0,Math.round(durationMs))):0})
   this.db.prepare('INSERT INTO error_reports VALUES(?,?,?,?,0)').run(randomUUID(),this.sharing()?this.owner():'',JSON.stringify(event),event.at)
   setting(this.db,'report_day',day);setting(this.db,'report_count',String(daily+1))
   this.db.prepare('DELETE FROM error_reports WHERE id NOT IN (SELECT id FROM error_reports ORDER BY created_at DESC LIMIT 200)').run()
  }catch{/* Reporting must never break the user's operation. */}
 }
 local(){this.db.prepare('DELETE FROM error_reports WHERE created_at<?').run(Date.now()-retention);return (this.db.prepare('SELECT id,event,sent FROM error_reports ORDER BY created_at DESC LIMIT 200').all() as {id:string;event:string;sent:number}[]).map(row=>({id:row.id,event:diagnosticReport.parse(JSON.parse(row.event)),sent:!!row.sent}))}
 overview(){const records=this.local();const pending=this.owner()?(this.db.prepare('SELECT COUNT(*) n FROM error_reports WHERE sent=0 AND owner=?').get(this.owner()) as {n:number}).n:0;return {sharing:this.sharing(),signedIn:!!this.owner(),pending,status:this.status,records}}
 flush(force=false){
  if(this.active)return this.active
  if(this.stopped||!this.sharing()||!this.owner()||!this.transport||!force&&Date.now()-this.lastAttempt<300000)return Promise.resolve()
  this.lastAttempt=Date.now();const epoch=this.epoch,owner=this.owner(),transport=this.transport()
  const valid=()=>!this.stopped&&this.sharing()&&this.epoch===epoch&&this.owner()===owner
  const task=(async()=>{
   try{
    const rows=this.db.prepare('SELECT id,event FROM error_reports WHERE sent=0 AND owner=? AND created_at>? ORDER BY created_at LIMIT 20').all(owner,Date.now()-retention) as {id:string;event:string}[]
    for(const row of rows){if(!valid())return;await transport.write(row.id,diagnosticReport.parse(JSON.parse(row.event)));if(!valid())return;this.db.prepare('UPDATE error_reports SET sent=1 WHERE id=?').run(row.id)}
    if(rows.length&&valid())await this.pruneShared(transport,valid)
    if(valid())this.status='Error reports are up to date.'
   }catch{if(valid())this.status='Reports stay on this device until the connection is available.'}
  })()
  this.active=task;void task.finally(()=>{if(this.active===task)this.active=undefined}).catch(()=>{});return task
 }
 private async pruneShared(transport:ReportTransport,valid=()=>true){const rows=(await transport.list()).sort((a,b)=>b.event.at-a.event.at);for(const [i,row]of rows.entries())if(valid()&&(i>=200||row.event.at<Date.now()-retention))await transport.delete(row.id);return rows.slice(0,200).filter(row=>row.event.at>=Date.now()-retention)}
 async shared(){if(!this.owner()||!this.transport)return [];const owner=this.owner();const rows=await this.pruneShared(this.transport(),()=>this.owner()===owner);if(this.owner()!==owner)return [];return rows}
 async clearShared(){
  this.cancel();await this.active?.catch(()=>{});if(!this.owner()||!this.transport)throw Error('Sign in to remove shared reports.')
  const owner=this.owner(),transport=this.transport();for(const row of await transport.list()){if(this.owner()!==owner)throw Error('Account changed; retry.');await transport.delete(row.id)}
  this.db.prepare('DELETE FROM error_reports WHERE owner=?').run(owner);return {ok:true}
 }
 clearLocal(){this.db.prepare('DELETE FROM error_reports').run()}
}
