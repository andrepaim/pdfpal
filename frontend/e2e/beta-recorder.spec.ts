import { test, expect } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'

let folder: string
const installerBytes=Buffer.from('synthetic installer fixture; never executed')
const installerName='pdfpal-Setup-2.1.0-preview.3-x64.exe'
test.beforeEach(async ({page})=>{
  folder=await fs.mkdtemp(path.join(os.tmpdir(),'pdfpal-recorder-e2e-'))
  const template=await fs.readFile(path.resolve('../desktop/beta/Session recorder.html'),'utf8')
  const file=path.join(folder,'recorder.html')
  await fs.writeFile(file,template.replace('@@PDFPAL_SESSION@@',JSON.stringify({version:'2.1.0-preview.3',preflight:{nodeOnPath:false,windowsBuild:26300},installer:{name:installerName,size:installerBytes.length,sha256:createHash('sha256').update(installerBytes).digest('hex')}})))
  await page.goto(pathToFileURL(file).href)
})
test.afterEach(async()=>{await fs.rm(folder,{recursive:true,force:true})})
test('recorder exports anonymous milestones locally without network requests',async({page})=>{
  const requests:string[]=[]
  page.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url())})
  await page.getByLabel('Anonymous participant ID').fill('P01')
  await page.getByLabel('Starting point').selectOption('missing-agent')
  await page.getByLabel('Participant confirms').check()
  await expect(page.getByRole('button',{name:'Setup is visible',exact:true})).toBeDisabled()
  await page.getByRole('button',{name:'Begin installation timer',exact:true}).click()
  await page.getByRole('button',{name:'Setup is visible',exact:true}).click()
  await page.getByRole('button',{name:'First PDF is open',exact:true}).click()
  await page.getByRole('button',{name:'First answer received',exact:true}).click()
  const downloaded=page.waitForEvent('download')
  await page.getByRole('button',{name:'Save anonymous JSON report'}).click()
  const download=await downloaded
  const report=JSON.parse(await fs.readFile((await download.path())!,'utf8'))
  expect(download.suggestedFilename()).toMatch(/^session-[a-f0-9-]+\.json$/)
  expect(report.participantId).toBe('P01')
  expect(report.cohort).toBe('missing-agent')
  expect(report.events.answerReceivedMs).toBeGreaterThanOrEqual(report.events.pdfOpenedMs)
  expect(report.followup).toBe('pending')
  expect(Object.keys(report.preflight)).toEqual(['windowsBuild','nodeOnPath'])
  expect(requests).toEqual([])
})
test('follow-up retains original milestones, strips unrelated baseline fields and refuses early non-return',async({page})=>{
  const original={format:1,sessionId:'12345678-1234-1234-1234-123456789abc',participantId:'P02',cohort:'existing-agent',provider:'codex',eligibleAccount:true,nonTechnical:true,environment:'existing-account',desktopVersion:'2.1.0-preview.3',
    startedAt:new Date(Date.now()-86400000).toISOString(),updatedAt:new Date(Date.now()-86400000+120000).toISOString(),preflight:{windowsBuild:26300,token:'SECRET'},events:{setupShownMs:1000,pdfOpenedMs:2000,answerReceivedMs:3000},neededHelp:false,barrier:'none',trayPassed:true,usefulness:5,followup:'pending'}
  await page.getByLabel('Load a saved report').setInputFiles({name:'saved.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(original))})
  await expect(page.getByRole('status',{name:'Session status'})).toContainText('Saved session loaded')
  await expect(page.getByRole('button',{name:/Setup is visible:/})).toBeDisabled()
  await page.locator('#followup').selectOption('not-returned')
  await page.getByRole('button',{name:'Save anonymous JSON report'}).click()
  await expect(page.getByRole('status',{name:'Session status'})).toContainText('14-day')
  await page.locator('#followup').selectOption('returned')
  const downloaded=page.waitForEvent('download')
  await page.getByRole('button',{name:'Save anonymous JSON report'}).click()
  const report=JSON.parse(await fs.readFile((await (await downloaded).path())!,'utf8'))
  expect(report.events).toEqual(original.events)
  expect(report.sessionId).toBe(original.sessionId)
  expect(report.followup).toBe('returned')
  expect(JSON.stringify(report)).not.toContain('SECRET')
})
test('optional installer check hashes files locally and refuses changed bytes',async({page})=>{
  await page.getByText('Check installer file against the supplied manifest (optional)').click()
  await page.getByLabel('Choose the supplied installer').setInputFiles({name:installerName,mimeType:'application/octet-stream',buffer:installerBytes})
  await expect(page.getByRole('status',{name:'Installer verification'})).toContainText('matches the supplied manifest')
  const changed=Buffer.from(installerBytes);changed[0]^=1
  await page.getByLabel('Choose the supplied installer').setInputFiles({name:installerName,mimeType:'application/octet-stream',buffer:changed})
  await expect(page.getByRole('status',{name:'Installer verification'})).toContainText('does not match')
})
