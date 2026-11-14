import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import os from 'node:os'
import { betaOptions } from '../src/beta-acceptance.mjs'
import fs from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { summarizeSessions, validateSession } from '../scripts/beta-report.mjs'
import { createBetaKit, sandboxConfiguration } from '../scripts/create-beta-kit.mjs'
test('beta control requires isolated metadata and dedicated temporary paths', () => {
  const directory = path.join(os.tmpdir(), 'pdfpal-beta-12345678-1234-1234-1234-123456789abc')
  const env = { PDFPAL_BETA_DIRECTORY: directory, PDFPAL_DATA_DIR: path.join(directory, 'library'), PDFPAL_DB: path.join(directory, 'library/pdfpal.db'), PDFPAL_DESKTOP_PROFILE: path.join(directory, 'profile') }
  const metadata = { appId: 'io.pdfpal.desktop.installer-acceptance' }
  assert.equal(betaOptions(metadata, env).control, path.join(directory, 'control.json'))
  assert.throws(() => betaOptions({ appId: 'io.pdfpal.desktop' }, env))
  for (const key of Object.keys(env)) assert.throws(() => betaOptions(metadata, { ...env, [key]: path.join(os.homedir(), '.pdfpal') }))
  assert.throws(() => betaOptions(metadata, {}))
})

function session(number=1, patch={}) {
  return { format:1,sessionId:`12345678-1234-1234-1234-${String(number).padStart(12,'0')}`,participantId:`P${String(number).padStart(2,'0')}`,
    cohort:number<=10?'existing-agent':'missing-agent',provider:'codex',eligibleAccount:true,nonTechnical:number<=10,environment:'fresh-windows-account',desktopVersion:'2.1.0-preview.3',
    startedAt:'2026-10-01T12:00:00Z',updatedAt:'2026-10-16T12:00:00Z',events:{setupShownMs:10000,pdfOpenedMs:30000,answerReceivedMs:120000},neededHelp:false,barrier:'none',trayPassed:true,usefulness:5,followup:'pending',...patch }
}
test('empty beta data stays unknown and cannot claim release readiness',()=>{
  const report=summarizeSessions([])
  assert.equal(report.installation.percent,null)
  assert.equal(report.cohorts['existing-agent'].status,'insufficient-sample')
  assert.equal(report.returnUse.percent,null)
  assert.match(report.releaseDecision,/pending/)
})
test('updated reports and retries do not inflate first-attempt activation or participant retention',()=>{
  const first=session(1,{events:{setupShownMs:10000,pdfOpenedMs:null,answerReceivedMs:null},usefulness:null,updatedAt:'2026-10-01T12:10:00Z'})
  const retry=session(2,{participantId:'P01',cohort:'existing-agent',startedAt:'2026-10-02T12:00:00Z',updatedAt:'2026-10-02T12:05:00Z'})
  const followup={...retry,updatedAt:'2026-10-16T12:00:00Z',followup:'returned'}
  const report=summarizeSessions([first,retry,followup])
  assert.deepEqual(report.observations,{files:3,sessions:2,duplicateReports:1,participants:1,eligibleParticipants:1,nonTechnicalEligible:1})
  assert.equal(report.cohorts['existing-agent'].activation.numerator,0)
  assert.equal(report.cohorts['existing-agent'].activation.denominator,1)
  assert.equal(report.returnUse.numerator,1);assert.equal(report.returnUse.denominator,1)
})
test('retention preserves pending and no-response counts without inventing confirmed non-return',()=>{
  const rows=Array.from({length:20},(_,i)=>session(i+1,{followup:i<10?'returned':'no-response'}))
  let report=summarizeSessions(rows)
  assert.equal(report.returnUse.denominator,20);assert.equal(report.returnUse.numerator,10)
  assert.equal(report.returnUse.noResponse,10);assert.equal(report.returnUse.confirmedNotReturned,0)
  assert.equal(report.returnUse.status,'met')
  assert.equal(report.recruitment.status,'met');assert.equal(report.cohorts['missing-agent'].status,'met')
  report=summarizeSessions(rows.map(item=>({...item,followup:item.followup==='no-response'?'pending':item.followup})))
  assert.equal(report.returnUse.status,'awaiting-followup')
})
test('a later retry cannot erase the first activated session follow-up or reset its window',()=>{
  const first=session(1,{followup:'returned'})
  const retry=session(2,{participantId:'P01',cohort:'existing-agent',startedAt:'2026-10-17T12:00:00Z',updatedAt:'2026-10-18T12:00:00Z',usefulness:3})
  let report=summarizeSessions([first,retry])
  assert.equal(report.returnUse.numerator,1);assert.equal(report.returnUse.pending,0)
  assert.equal(report.usefulness.numerator,0)
  report=summarizeSessions([{...first,followup:'pending'},{...retry,followup:'returned'}])
  assert.equal(report.returnUse.numerator,0);assert.equal(report.returnUse.pending,1)
})
test('read-only, ineligible, invalid milestone and premature follow-up reports cannot count as activation',()=>{
  const reading=session(1,{provider:'none',events:{setupShownMs:10000,pdfOpenedMs:30000,answerReceivedMs:null},usefulness:null})
  const ineligible=session(2,{eligibleAccount:false})
  const report=summarizeSessions([reading,ineligible])
  assert.equal(report.cohorts['existing-agent'].activation.numerator,0)
  assert.equal(report.cohorts['existing-agent'].activation.denominator,1)
  assert.equal(report.returnUse.denominator,0)
  assert.throws(()=>validateSession(session(1,{participantId:'name@example.com'})))
  assert.throws(()=>validateSession(session(1,{events:{setupShownMs:null,pdfOpenedMs:10,answerReceivedMs:20}})))
  assert.throws(()=>validateSession(session(1,{followup:'no-response',updatedAt:'2026-10-02T12:00:00Z'})))
  assert.throws(()=>validateSession(session(1,{followup:'returned',updatedAt:'2026-10-01T12:10:00Z'})))
})
test('ChatGPT sign-in is a third starting point reported with raw counts and no invented target',()=>{
  const chatgpt=(number,patch={})=>session(number,{cohort:'chatgpt-sign-in',provider:'chatgpt',desktopVersion:'2.8.0-beta.1',...patch})
  const rows=[...Array.from({length:10},(_,i)=>session(i+1)),...Array.from({length:10},(_,i)=>session(i+11)),
    ...Array.from({length:12},(_,i)=>chatgpt(i+21,{neededHelp:i===0,events:i<2?{setupShownMs:10000,pdfOpenedMs:30000,answerReceivedMs:null}:{setupShownMs:10000,pdfOpenedMs:30000,answerReceivedMs:60000+i*1000},usefulness:i<2?null:i<4?3:5}))]
  const report=summarizeSessions(rows)
  assert.deepEqual(Object.keys(report.cohorts),['chatgpt-sign-in','existing-agent','missing-agent'])
  const cohort=report.cohorts['chatgpt-sign-in']
  assert.deepEqual(cohort.activation,{numerator:10,denominator:12,percent:83.3})
  assert.equal(cohort.firstAttempts,12);assert.equal(cohort.support.numerator,1)
  assert.equal(cohort.targetPercent,null);assert.equal(cohort.targetMedianSeconds,null);assert.equal(cohort.status,'target-not-defined')
  assert.equal(report.cohorts['existing-agent'].status,'met');assert.equal(report.cohorts['missing-agent'].status,'met')
  assert.deepEqual(report.builds.map(build=>build.version),['2.1.0-preview.3','2.8.0-beta.1'])
  assert.deepEqual(report.builds[1],{version:'2.8.0-beta.1',sessions:12,participants:12,activatedSessions:10,usefulness:{numerator:8,denominator:10,percent:80}})
  assert.equal(summarizeSessions([chatgpt(1)]).cohorts['chatgpt-sign-in'].status,'target-not-defined')
  // Signing in to ChatGPT and then reading without AI is a recorded, non-activated attempt.
  const reading=summarizeSessions([chatgpt(1,{provider:'none',events:{setupShownMs:10000,pdfOpenedMs:30000,answerReceivedMs:null},usefulness:null,barrier:'sign-in'})])
  assert.deepEqual(reading.cohorts['chatgpt-sign-in'].activation,{numerator:0,denominator:1,percent:0})
  assert.throws(()=>validateSession(chatgpt(1,{provider:'codex'})),/ChatGPT/)
  assert.throws(()=>validateSession(session(1,{provider:'chatgpt'})),/ChatGPT/)
  assert.throws(()=>validateSession(chatgpt(1,{barrier:'provider-install'})),/installation/)
  assert.throws(()=>validateSession(chatgpt(1,{cohort:'chatgpt'})))
  assert.throws(()=>validateSession(chatgpt(1,{desktopVersion:undefined})))
})
test('a ChatGPT session and its follow-up deduplicate into one activated, returning participant',()=>{
  const saved=session(1,{cohort:'chatgpt-sign-in',provider:'chatgpt',desktopVersion:'2.8.0-beta.1',updatedAt:'2026-10-01T12:20:00Z'})
  const followup={...saved,updatedAt:'2026-10-03T09:00:00Z',followup:'returned'}
  const report=summarizeSessions([saved,followup])
  assert.equal(report.observations.duplicateReports,1)
  assert.deepEqual(report.cohorts['chatgpt-sign-in'].activation,{numerator:1,denominator:1,percent:100})
  assert.equal(report.returnUse.numerator,1);assert.equal(report.returnUse.pending,0)
  assert.deepEqual(report.versions,['2.8.0-beta.1'])
})
test('reports saved before the ChatGPT cohort aggregate exactly as before',()=>{
  // Literal copy of a format-1 report written by the earlier recorder.
  const old={format:1,sessionId:'12345678-1234-1234-1234-123456789abc',participantId:'P02',cohort:'missing-agent',provider:'claude',eligibleAccount:true,nonTechnical:true,environment:'existing-account',desktopVersion:'2.1.0-preview.3',
    startedAt:'2026-10-01T12:00:00.000Z',updatedAt:'2026-10-16T12:00:00.000Z',preflight:{windowsBuild:26300,nodeOnPath:false},events:{setupShownMs:1000,pdfOpenedMs:2000,answerReceivedMs:300000},neededHelp:false,barrier:'none',trayPassed:true,usefulness:4,followup:'returned'}
  const report=summarizeSessions([old])
  assert.deepEqual(report.cohorts['missing-agent'],{activation:{numerator:1,denominator:1,percent:100},medianSecondsToFirstAnswer:300,targetPercent:80,targetMedianSeconds:900,firstAttempts:1,support:{numerator:0,denominator:1,percent:0},status:'insufficient-sample'})
  assert.deepEqual(report.cohorts['existing-agent'].activation,{numerator:0,denominator:0,percent:null})
  assert.deepEqual(report.cohorts['chatgpt-sign-in'].activation,{numerator:0,denominator:0,percent:null})
  assert.deepEqual(report.observations,{files:1,sessions:1,duplicateReports:0,participants:1,eligibleParticipants:1,nonTechnicalEligible:1})
  assert.equal(report.usefulness.numerator,1);assert.equal(report.returnUse.numerator,1)
  assert.deepEqual(report.versions,['2.1.0-preview.3'])
  assert.deepEqual(report.builds,[{version:'2.1.0-preview.3',sessions:1,participants:1,activatedSessions:1,usefulness:{numerator:1,denominator:1,percent:100}}])
})
test('Sandbox maps only payload/results, escapes host paths, and rejects unsupported host locations',()=>{
  const config=sandboxConfiguration('C:\\Beta & Books')
  assert.match(config,/C:\\Beta &amp; Books\\payload/)
  assert.match(config,/<ReadOnly>true<\/ReadOnly>/)
  assert.match(config,/<ClipboardRedirection>Disable<\/ClipboardRedirection>/)
  assert.throws(()=>sandboxConfiguration('\\\\server\\share'))
})
test('beta kit verifies production installer identity and bytes before distributing a payload',async()=>{
  const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'pdfpal-beta-kit-test-'))
  try {
    const installer='pdfpal-Setup-2.1.0-preview.3-x64.exe',bytes=Buffer.from('synthetic test installer; never executable')
    const manifest={format:1,appId:'io.pdfpal.desktop',platform:'win32',arch:'x64',version:'2.1.0-preview.3',signed:false,installer,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}
    await fs.writeFile(path.join(temporary,installer),bytes)
    const metadata=path.join(temporary,'pdfpal-desktop-release.json')
    await fs.writeFile(metadata,JSON.stringify(manifest))
    const output=path.join(temporary,'kit')
    await fs.mkdir(path.join(output,'payload'),{recursive:true})
    await fs.writeFile(path.join(output,'payload/Start-Test.ps1'),'obsolete helper')
    assert.equal((await createBetaKit(temporary,output)).version,manifest.version)
    const html=await fs.readFile(path.join(output,'payload/Session recorder.html'),'utf8')
    assert.ok(html.includes(manifest.sha256));assert.ok(!html.includes('@@PDFPAL_SESSION@@'))
    // Every recorded report takes its desktopVersion from this seed.
    assert.equal(JSON.parse(html.match(/<script id="session" type="application\/json">(.*?)<\/script>/)[1]).version,manifest.version)
    assert.ok(html.includes('value="chatgpt-sign-in"'))
    assert.match(await fs.readFile(path.join(output,'payload/Windows quickstart.txt'),'utf8'),/Continue with ChatGPT/)
    assert.match(await fs.readFile(path.join(output,'Read me first.txt'),'utf8'),/ChatGPT sign-in/)
    await assert.rejects(fs.stat(path.join(output,'payload/Start-Test.ps1')))
    await fs.writeFile(path.join(temporary,installer),'changed bytes')
    await assert.rejects(createBetaKit(temporary,output),/bytes/)
    await fs.writeFile(metadata,JSON.stringify({...manifest,appId:'io.pdfpal.desktop.installer-acceptance'}))
    await assert.rejects(createBetaKit(temporary,output),/production/)
  } finally { await fs.rm(temporary,{recursive:true,force:true}) }
})
