import {test} from 'node:test'
import assert from 'node:assert/strict'
import {Session} from '../src/chatgpt/session.mjs'
const saved={host:'urn:uuid:host',accounts:[],active:null}
test('identity-only grants cannot invoke models and session data returned to UI never contains tokens',async()=>{
 const s=new Session({read:async()=>structuredClone(saved),write:async()=>{},open:()=>{},verify:async()=>({sub:'subject'}),fetch:async()=>{throw Error('unexpected network')}})
 await s.init();assert.equal(s.summary().connected,false);assert.equal(JSON.stringify(s.summary()).includes('refresh_token'),false)
 await assert.rejects(s.invoke('prompt'),/Connect/)
})
test('refresh rotation is serialized and persisted before inference uses the replacement',async()=>{
 let persisted,refreshes=0
 const state={...saved,active:'account',accounts:[{id:'account',client_id:'client',subject:'subject',scope:'chatgpt.tokens.use.direct',access_token:'old',refresh_token:'refresh',expires_at:0,models:[]}]}
 const s=new Session({read:async()=>state,write:async v=>{persisted=structuredClone(v)},open:()=>{},verify:async()=>({sub:'subject'}),fetch:async(url)=>{assert.match(url,/oauth\/token/);refreshes++;return Response.json({access_token:'new',refresh_token:'rotated',expires_in:3600})}})
 await s.init();assert.deepEqual(await Promise.all([s.token(),s.token()]),['new','new']);assert.equal(refreshes,1);assert.equal(persisted.accounts[0].refresh_token,'rotated')
 assert.equal(JSON.stringify(s.summary()).includes('rotated'),false)
})
test('model discovery cannot write the response into a different active account',async()=>{
 let release
 const account=id=>({id,subject:id,scope:'chatgpt.tokens.use.direct',access_token:id,expires_at:Date.now()+3600000,models:[]})
 const state={...saved,active:'a',accounts:[account('a'),account('b')]}
 const s=new Session({read:async()=>state,write:async()=>{},open:()=>{},fetch:async()=>new Promise(resolve=>{release=()=>resolve(Response.json({models:[{slug:'a-only',display_name:'A model',visibility:'list'}]}))})})
 await s.init();const request=s.models();await new Promise(r=>setImmediate(r));await s.select('b');release();await request
 assert.deepEqual(s.data.accounts.find(a=>a.id==='b').models,[])
})
test('browser callback finishes a new registration without exposing credentials to UI',async()=>{
 let opened,persisted
 const s=new Session({read:async()=>structuredClone(saved),write:async v=>{persisted=structuredClone(v)},open:async url=>{opened=new URL(url)},verify:async(_token,client,nonce)=>{assert.equal(client,'issued-client');assert.ok(nonce);return{sub:'reader',email:'reader@example.test'}},fetch:async url=>url.endsWith('/models')?Response.json({models:[{slug:'eligible',display_name:'Eligible',visibility:'list'}]}):Response.json({access_token:'private-access',refresh_token:'private-refresh',id_token:'private-identity',scope:'chatgpt.tokens.use.direct',expires_in:3600})})
 await s.init();await s.connect();const target=new URL(opened.searchParams.get('redirect_uri'));target.searchParams.set('state',opened.searchParams.get('state'));target.searchParams.set('code','one-time-code');target.searchParams.set('client_id','issued-client')
 await fetch(target);for(let i=0;i<50&&s.summary().busy;i++)await new Promise(r=>setTimeout(r,10))
 assert.equal(s.summary().connected,true);assert.equal(s.summary().model,'eligible');assert.equal(persisted.accounts[0].client_id,'issued-client');assert.ok(!JSON.stringify(s.summary()).includes('private-'));s.cancelConnect()
})
