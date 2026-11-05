import {randomUUID} from 'node:crypto'
import type {Database} from 'better-sqlite3'
import { AgentService, type AgentName } from './agents.js'
import type { PdfpalConfig } from './config.js'
import {errorReportsFor} from './error-reports.js'
export type ProviderName=AgentName|'chatgpt'
export interface DirectProvider { invoke(prompt:string,model?:string,options?:{signal?:AbortSignal;onDelta?:(text:string)=>void}):Promise<string> }
const direct=new WeakMap<PdfpalConfig,DirectProvider>()
export function bindDirectProvider(config:PdfpalConfig,provider:DirectProvider){direct.set(config,provider);return()=>direct.delete(config)}
export class AIService {
 constructor(private config:PdfpalConfig, private db?:Database){}
 async invoke(prompt:string,provider?:ProviderName,model?:string,options:{signal?:AbortSignal;onDelta?:(text:string)=>void;projectId?:string;sourceId?:string;question?:string}={}) {
  const started=performance.now()
  try{return await this.generate(prompt,provider,model,options)}catch(error){if(this.db&&!options.signal?.aborted)errorReportsFor(this.db).record('AI_FAILED',performance.now()-started);throw error}
 }
 private async generate(prompt:string,provider?:ProviderName,model?:string,options:{signal?:AbortSignal;onDelta?:(text:string)=>void;projectId?:string;sourceId?:string;question?:string}={}) {
  const selected=provider||(this.config.aiMode==='chatgpt'?'chatgpt':this.config.agent)
  if(selected==='chatgpt'){
   const runtime=direct.get(this.config)
   if(!runtime)return Promise.reject(new Error('Open the Windows desktop app to use the ChatGPT connection, or explicitly select an installed agent.'))
   if(!this.db)return runtime.invoke(prompt,model,options)
   const id=randomUUID(),now=()=>new Date().toISOString();let partial='', checkpoint=0
   this.db.prepare("INSERT INTO ai_jobs(id,project_id,source_id,question,provider,model,status,created_at,updated_at) VALUES (?,?,?,?,?,?,'running',?,?)").run(id,options.projectId||null,options.sourceId||null,options.question||prompt,'chatgpt',model||null,now(),now())
   try{const result=await runtime.invoke(prompt,model,{...options,onDelta:text=>{partial=text;if(Date.now()-checkpoint>250){checkpoint=Date.now();this.db!.prepare('UPDATE ai_jobs SET answer=?,updated_at=? WHERE id=?').run(text,now(),id)};options.onDelta?.(text)}});this.db.prepare("UPDATE ai_jobs SET status='complete',answer=?,updated_at=? WHERE id=?").run(result,now(),id);return result}
   catch(e){this.db.prepare("UPDATE ai_jobs SET status=?,answer=?,error=?,updated_at=? WHERE id=?").run(/abort|cancel/i.test((e as Error).message)?'cancelled':'failed',partial,(e as Error).message.slice(0,300),now(),id);throw e}
  }
  return new AgentService(this.config).invoke(prompt,selected,model,options)
 }
}
