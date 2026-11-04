import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {loadConfig} from '../../src/core/config.js'
import {openDatabase} from '../../src/core/database.js'
import {bindDirectProvider} from '../../src/core/ai.js'
import {buildServer} from '../../src/server/app.js'
test('PDF chat streams the direct provider, saves its answer, and needs no CLI executable',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pdfpal-direct-route-')),config=loadConfig({dataDir:dir,aiMode:'chatgpt'})
 const db=openDatabase(config)
 db.prepare("INSERT INTO projects(id,title,created_at,accessed_at) VALUES ('p','Paper',datetime('now'),datetime('now'))").run()
 db.prepare("INSERT INTO sources(id,project_id,type,title,pdf_text,pages,created_at,accessed_at) VALUES ('s','p','pdf','Real paper','The variance grows with dimension.',1,datetime('now'),datetime('now'))").run();db.close()
 const release=bindDirectProvider(config,{invoke:async(prompt,_model,options)=>{assert.match(prompt,/variance/);options?.onDelta?.('Scale by');return 'Scale by sqrt(d_k). [Real paper, p. 1]'}})
 const server=await buildServer(config)
 try{const result=await server.inject({method:'POST',url:'/api/chat',payload:{project_id:'p',source_id:'s',message:'Why scale?',agent:'chatgpt'}})
 assert.equal(result.statusCode,200);assert.match(result.body,/Scale by/);assert.match(result.body,/sqrt/)
 const history=await server.inject({method:'GET',url:'/api/projects/p/sources/s/chat'});assert.match(history.body,/sqrt/)
 }finally{await server.close();release();fs.rmSync(dir,{recursive:true,force:true})}
})
