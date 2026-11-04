import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {loadConfig} from '../../src/core/config.js'
import {openDatabase} from '../../src/core/database.js'
import {AIService,bindDirectProvider} from '../../src/core/ai.js'
test('direct partial answers survive failure and reopen as durable interrupted work without replay',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pdfpal-ai-jobs-'));const config=loadConfig({dataDir:dir,aiMode:'chatgpt'});const db=openDatabase(config)
 try{const release=bindDirectProvider(config,{invoke:async(_p,_m,options)=>{options?.onDelta?.('partial answer');throw Error('connection lost')}})
 await assert.rejects(new AIService(config,db).invoke('Why?'),/lost/)
 const job=db.prepare('SELECT * FROM ai_jobs').get() as any
 assert.equal(job.status,'failed');assert.equal(job.answer,'partial answer');assert.equal(job.question,'Why?');release()
 }finally{db.close();fs.rmSync(dir,{recursive:true,force:true})}
})
