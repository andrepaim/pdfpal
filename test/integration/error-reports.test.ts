import {test} from 'node:test'
import assert from 'node:assert/strict'
import {testConfig,testDb,cleanup} from '../helpers/test-utils.js'
import {errorReportsFor,type ReportTransport} from '../../src/core/error-reports.js'
import {diagnosticReport,type DiagnosticReport} from '../../src/shared/diagnostics.js'
import {setting} from '../../src/sync/database.js'

test('error reports are opt-in, content-free, rate limited and never upload historical local reports',async()=>{
 const config=testConfig(),db=testDb(config),reports=errorReportsFor(db),remote=new Map<string,DiagnosticReport>()
 let owner='alice'
 const transport:ReportTransport={write:async(id,event)=>{remote.set(id,event)},list:async()=>[...remote].map(([id,event])=>({id,event})),delete:async id=>{remote.delete(id)}}
 reports.bind(()=>owner,()=>transport)
 try{
  reports.record('SYNC_FAILED');assert.equal(reports.local().length,0)
  setting(db,'telemetry_diagnostics','1');reports.record('AI_FAILED')
  await reports.flush(true);assert.equal(remote.size,0)
  reports.setSharing(true)
  reports.record('SYNC_FAILED',123.4);reports.record('SYNC_FAILED',999)
  reports.record('password=private');reports.record({code:'SERVER_ERROR',message:'Private question'})
  await reports.flush(true);assert.equal(remote.size,1)
  const event=[...remote.values()][0]!
  assert.deepEqual(Object.keys(event).sort(),['appVersion','at','code','durationMs','format','platform']);assert.equal(event.durationMs,123)
  assert.throws(()=>diagnosticReport.parse({...event,message:'Private PDF text'}))
  reports.record('BACKUP_FAILED');owner='bob';await reports.flush(true);assert.equal(remote.size,1)
  owner='alice';reports.setSharing(false);await reports.flush(true);assert.equal(remote.size,1)
  assert.equal(reports.overview().pending,0)
  await reports.clearShared();assert.equal(remote.size,0)
 }finally{await reports.close();cleanup(config,db)}
})
test('offline reporting retries idempotently, and revoking sharing prevents later queue uploads',async()=>{
 const config=testConfig(),db=testDb(config),reports=errorReportsFor(db),ids:string[]=[]
 let offline=true
 reports.bind(()=> 'alice',()=>({write:async id=>{ids.push(id);if(offline)throw Error('private error details must not persist')},list:async()=>[],delete:async()=>{}}))
 try{
  reports.setSharing(true);reports.record('SERVER_ERROR');await reports.flush(true)
  assert.equal(reports.overview().pending,1);assert.doesNotMatch(JSON.stringify(reports.overview()),/private error/)
  offline=false;await reports.flush(true);assert.equal(ids[0],ids[1]);assert.equal(reports.overview().pending,0)
  reports.record('AI_FAILED');reports.setSharing(false);reports.setSharing(true);await reports.flush(true)
  assert.equal(ids.length,2)
 }finally{await reports.close();cleanup(config,db)}
})

test('clearing local reports cannot reset the daily upload budget',async()=>{
 const config=testConfig(),db=testDb(config),reports=errorReportsFor(db),clock=Date.now
 try{
  reports.setSharing(true)
  for(let i=0;i<25;i++){Date.now=()=>clock()+i*360000;reports.record('SYNC_FAILED')}
  assert.equal(reports.local().length,20)
  reports.clearLocal();reports.record('AI_FAILED');assert.equal(reports.local().length,0)
 }finally{Date.now=clock;await reports.close();cleanup(config,db)}
})
