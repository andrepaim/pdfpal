import { test } from 'node:test'
import assert from 'node:assert/strict'
import { authorization, callback, readResponse, requestBody } from '../../src/core/chatgpt/protocol.js'
import { AIService, bindDirectProvider } from '../../src/core/ai.js'
import { loadConfig } from '../../src/core/config.js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

test('authorization uses stable registration and callback rejects identity substitution and duplicate state', () => {
 const attempt = { state:'state', nonce:'nonce', verifier:'a'.repeat(43), redirect:'http://127.0.0.1:15555/auth/callback', clientId:'issued' }
 const url = new URL(authorization(attempt,'urn:uuid:host'))
 assert.equal(url.searchParams.get('client_id'),'issued'); assert.equal(url.searchParams.get('agent_name_hint'),null)
 assert.equal(callback(attempt,attempt.redirect+'?state=state&code=code').clientId,'issued')
 for(const query of ['state=bad&code=x','state=state&state=state&code=x','state=state&code=x&client_id=other']) assert.throws(()=>callback(attempt,attempt.redirect+'?'+query))
})
test('request body only includes fields supported by plan usage',()=>{
 const body=requestBody('model','instructions','context')
 assert.deepEqual(Object.keys(body).sort(),['input','instructions','model','store','stream'])
 assert.equal(body.store,false); assert.equal(body.stream,true)
})
test('SSE handles split UTF8 and requires completion, preserving partial text on failure',async()=>{
 const encode=new TextEncoder();const bytes=encode.encode('data: {"type":"response.output_text.delta","delta":"café"}\n\ndata: {"type":"response.completed"}\n\n')
 const stream=new ReadableStream<Uint8Array>({start(c){for(const b of bytes)c.enqueue(new Uint8Array([b]));c.close()}})
 assert.equal(await readResponse(stream,()=>{}),'café')
 const incomplete=new ReadableStream<Uint8Array>({start(c){c.enqueue(encode.encode('data: {"type":"response.output_text.delta","delta":"partial"}\n\n'));c.close()}})
 await assert.rejects(readResponse(incomplete,()=>{}),/complete/i)
})
test('direct runtime is explicit and headless direct mode cannot fall through to a CLI',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pdfpal-direct-'))
 try { const config=loadConfig({dataDir:dir}); config.aiMode='chatgpt'
 await assert.rejects(new AIService(config).invoke('question'),/desktop/i)
 const release=bindDirectProvider(config,{invoke:async()=> 'direct answer'})
 assert.equal(await new AIService(config).invoke('question'),'direct answer'); release()
 await assert.rejects(new AIService(config).invoke('question','chatgpt'),/desktop/i)
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
})
test('mode preferences preserve existing settings and honor an explicit startup agent',async()=>{
 const {saveAIModePreference}=await import('../../src/core/config.js')
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pdfpal-mode-'))
 try{fs.writeFileSync(path.join(dir,'config.json'),JSON.stringify({custom:'keep',agent:'codex'}));const config=loadConfig({dataDir:dir});saveAIModePreference(config,'chatgpt');assert.equal(config.aiMode,'chatgpt');assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'config.json'),'utf8')).custom,'keep')}
 finally{fs.rmSync(dir,{recursive:true,force:true})}
})
