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
    assert.equal((await createBetaKit(temporary,output)).version,manifest.version)
    assert.ok((await fs.stat(path.join(output,'payload/Start test.cmd'))).isFile())
    await fs.writeFile(path.join(temporary,installer),'changed bytes')
    await assert.rejects(createBetaKit(temporary,output),/bytes/)
    await fs.writeFile(metadata,JSON.stringify({...manifest,appId:'io.pdfpal.desktop.installer-acceptance'}))
    await assert.rejects(createBetaKit(temporary,output),/production/)
  } finally { await fs.rm(temporary,{recursive:true,force:true}) }
})
