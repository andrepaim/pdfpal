import type {FastifyInstance} from 'fastify'
import type {Database} from 'better-sqlite3'
import type {PdfpalConfig} from '../core/config.js'
import {BackupService} from '../core/backups.js'
import {TrashService} from '../core/trash.js'
import {z} from 'zod'

export async function registerRecoveryRoutes(app:FastifyInstance,db:Database,config:PdfpalConfig){
  const backups=new BackupService(db,config),trash=new TrashService(db)
  app.decorate('libraryBackups',backups)
  app.get('/api/recovery/settings',async()=>backups.settings())
  app.post('/api/recovery/settings',async req=>backups.configure(z.object({enabled:z.boolean(),intervalHours:z.union([z.literal(6),z.literal(24),z.literal(168)]),keep:z.number().int().min(2).max(30)}).strict().parse(req.body)))
  app.get('/api/recovery/backups',async()=>backups.list())
  app.post('/api/recovery/backups',async()=>backups.create())
  app.post<{Params:{id:string}}>('/api/recovery/backups/:id/verify',async req=>{const result=await backups.verify(req.params.id);return {valid:true,backup:result.manifest}})
  app.post<{Params:{id:string}}>('/api/recovery/backups/:id/restore',async req=>backups.restore(req.params.id))
  app.delete<{Params:{id:string}}>('/api/recovery/backups/:id',async req=>backups.delete(req.params.id))
  app.get('/api/recovery/libraries',async()=>backups.listRecovered())
  app.get('/api/recovery/trash',async()=>trash.list())
  app.post<{Params:{id:string}}>('/api/recovery/trash/:id/restore',async req=>trash.restoreWithFiles(config,z.string().regex(/^[a-f0-9]{32}$/).parse(req.params.id),z.object({asCopy:z.boolean().optional()}).strict().parse(req.body??{}).asCopy))
  app.delete<{Params:{id:string}}>('/api/recovery/trash/:id',async req=>{trash.purge(z.string().regex(/^[a-f0-9]{32}$/).parse(req.params.id));return {ok:true}})
  app.addHook('preClose',async()=>backups.stop())
  app.addHook('onClose',async()=>{await backups.close()})
  backups.start()
  return backups
}
