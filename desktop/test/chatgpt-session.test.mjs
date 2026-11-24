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
test('a failed protected credential write never connects the newly authorized account',async()=>{
 let opened,writable=true,requests=0
 const s=new Session({read:async()=>structuredClone(saved),write:async()=>{if(!writable)throw Error('Secure credential storage is unavailable')},open:async url=>{opened=new URL(url)},verify:async()=>({sub:'synthetic-reader'}),fetch:async()=>{requests++;return Response.json({access_token:'synthetic-access',refresh_token:'synthetic-refresh',id_token:'synthetic-id',scope:'chatgpt.tokens.use.direct',expires_in:3600})}})
 await s.init();writable=false;await s.connect()
 const target=new URL(opened.searchParams.get('redirect_uri'));target.searchParams.set('state',opened.searchParams.get('state'));target.searchParams.set('code','synthetic-code');target.searchParams.set('client_id','synthetic-client')
 try {
  await fetch(target);for(let i=0;i<50&&s.summary().busy;i++)await new Promise(r=>setTimeout(r,10))
  assert.equal(requests,1);assert.equal(s.summary().connected,false);assert.deepEqual(s.data.accounts,[]);assert.equal(s.data.active,null)
  assert.equal(JSON.stringify(s.data).includes('synthetic-access'),false)
  await assert.rejects(s.invoke('synthetic prompt'),/Connect ChatGPT/)
 } finally {s.cancelConnect()}
})

test('direct ChatGPT validates effort against the active model and sends the selected level', async () => {
  const account = id => ({
    id, scope: 'chatgpt.tokens.use.direct', access_token: 'fixture', expires_at: Date.now() + 60_000,
    model: 'reader', models: [{ id: 'reader', name: 'Reader' }],
  })
  let state = { ...saved, active: 'first', accounts: [account('first'), account('second')] }
  let levels = ['low', 'high']
  let writable = true
  const bodies = []
  const session = new Session({
    read: async () => structuredClone(state),
    write: async next => {
      if (!writable) throw Error('Vault unavailable')
      state = structuredClone(next)
    },
    open: async () => {},
    fetch: async (url, init) => {
      if (url.endsWith('/models')) return Response.json({ models: [
        { slug: 'reader', display_name: 'Reader', visibility: 'list', default_reasoning_level: 'low', supported_reasoning_levels: levels.map(effort => ({ effort })) },
        { slug: 'other', display_name: 'Other', visibility: 'list' },
      ] })
      assert.ok(url.endsWith('/responses'))
      bodies.push(JSON.parse(init.body))
      return new Response('data: {"type":"response.output_text.delta","delta":"done"}\n\ndata: {"type":"response.completed"}\n\n')
    },
  })
  await session.init()
  assert.deepEqual(session.summary().effortDefaults, {})
  const { models } = await session.models()
  assert.deepEqual(models[0].efforts, levels)
  assert.equal(models[0].defaultEffort, 'low')
  assert.equal(models[1].efforts, undefined)
  await assert.rejects(session.setEfforts('second', { reader: 'high' }))
  await assert.rejects(session.setEfforts('first', { reader: 'high', other: 'high' }))
  assert.deepEqual(session.summary().effortDefaults, {})
  await session.setEfforts('first', { reader: 'high' })
  assert.deepEqual(state.accounts[0].effortDefaults, { reader: 'high' })
  writable = false
  await assert.rejects(session.setEfforts('first', { reader: '' }), /Vault unavailable/)
  writable = true
  await session.invoke('one')
  await session.invoke('two', 'reader', { effort: 'low' })
  await session.invoke('three', 'reader', { effort: '' })
  await session.invoke('four', 'other')
  await assert.rejects(session.invoke('five', 'other', { effort: 'high' }), /effort/i)
  levels = ['low']
  await session.models()
  await session.invoke('six', 'reader')
  assert.deepEqual(bodies.map(body => body.reasoning), [{ effort: 'high' }, { effort: 'low' }, undefined, undefined, undefined])
  await session.select('second')
  assert.deepEqual(session.summary().effortDefaults, {})
})
