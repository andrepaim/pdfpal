import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { versionParts } from '../src/updates.mjs'
const day = 86400000
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
export function validateSession(value) {
  if (!value || value.format !== 1 || !uuid.test(value.sessionId ?? '') || !/^P\d{2,4}$/.test(value.participantId ?? '') ||
      !['existing-agent','missing-agent'].includes(value.cohort) || !['claude','codex','none'].includes(value.provider) ||
      !['fresh-windows-account','existing-account','sandbox'].includes(value.environment) ||
      !['pending','returned','not-returned','no-response'].includes(value.followup) ||
      !['none','installer','provider-install','sign-in','connection','reading','other'].includes(value.barrier) ||
      !['eligibleAccount','nonTechnical','neededHelp','trayPassed'].every(key => typeof value[key] === 'boolean') ||
      !Number.isFinite(Date.parse(value.startedAt)) || !Number.isFinite(Date.parse(value.updatedAt)) || Date.parse(value.updatedAt) < Date.parse(value.startedAt)) throw new Error('Invalid anonymous beta session')
  versionParts(value.desktopVersion)
  let previous = 0, missing = false
  for (const key of ['setupShownMs','pdfOpenedMs','answerReceivedMs']) {
    const elapsed = value.events?.[key]
    if (elapsed === null) { missing = true; continue }
    if (missing || !Number.isFinite(elapsed) || elapsed < previous || elapsed > day) throw new Error('Invalid beta milestone sequence')
    previous = elapsed
  }
  if (value.events.answerReceivedMs !== null && value.provider === 'none') throw new Error('Read-only sessions cannot claim AI activation')
  if (value.usefulness !== null && (!Number.isInteger(value.usefulness) || value.usefulness < 1 || value.usefulness > 5 || value.events.answerReceivedMs === null)) throw new Error('Invalid usefulness rating')
  if (value.followup !== 'pending' && value.events.answerReceivedMs === null) throw new Error('Return-use follow-up requires activation')
  if (['not-returned','no-response'].includes(value.followup) && Date.parse(value.updatedAt) - Date.parse(value.startedAt) < 14 * day) throw new Error('Do not finalize non-return before the 14-day window')
  if (value.followup === 'returned' && value.updatedAt.slice(0,10) === value.startedAt.slice(0,10)) throw new Error('Same-day use does not meet return-use definition')
  return value
}
const median = values => { const sorted=[...values].sort((a,b)=>a-b), middle=Math.floor(sorted.length/2); return sorted.length ? (sorted.length%2 ? sorted[middle] : (sorted[middle-1]+sorted[middle])/2) : null }
const fraction = (numerator,denominator) => ({ numerator,denominator,percent:denominator ? Math.round(numerator/denominator*1000)/10 : null })
export function summarizeSessions(input) {
  const unique = new Map()
  for (const item of input.map(validateSession)) {
    const previous = unique.get(item.sessionId)
    if (previous && previous.participantId !== item.participantId) throw new Error('A session ID cannot identify two participants')
    if (!previous || Date.parse(item.updatedAt) > Date.parse(previous.updatedAt)) unique.set(item.sessionId,item)
  }
  const sessions=[...unique.values()].sort((a,b)=>Date.parse(a.startedAt)-Date.parse(b.startedAt)||a.sessionId.localeCompare(b.sessionId))
  const first = new Map()
  for (const item of sessions) if (!first.has(item.participantId)) first.set(item.participantId,item)
  const people=[...first.values()], eligible=people.filter(item=>item.eligibleAccount)
  const cohorts = Object.fromEntries(['existing-agent','missing-agent'].map(cohort=>{
    const group=eligible.filter(item=>item.cohort===cohort), activated=group.filter(item=>item.events.answerReceivedMs!==null)
    const timing=median(activated.map(item=>item.events.answerReceivedMs/1000))
    const target=cohort==='existing-agent'?90:80, timeTarget=cohort==='existing-agent'?300:900
    const success=fraction(activated.length,group.length)
    return [cohort,{ activation:success,medianSecondsToFirstAnswer:timing,targetPercent:target,targetMedianSeconds:timeTarget,
      status:group.length<10?'insufficient-sample':success.percent>=target&&timing<=timeTarget?'met':'missed' }]
  }))
  const activated = new Map()
  const rated = new Map()
  for (const item of sessions) if (item.eligibleAccount && item.events.answerReceivedMs!==null) {
    // Follow up the first successful session. A later retry must not reset its
    // retention window or erase the original session's confirmed return.
    if (!activated.has(item.participantId)) activated.set(item.participantId,item)
    const previous=rated.get(item.participantId)
    if (item.usefulness!==null && (!previous || Date.parse(item.updatedAt)>Date.parse(previous.updatedAt))) rated.set(item.participantId,item)
  }
  const returnPeople=[...activated.values()]
  const returned=returnPeople.filter(item=>item.followup==='returned').length
  const pending=returnPeople.filter(item=>item.followup==='pending').length
  const noResponse=returnPeople.filter(item=>item.followup==='no-response').length
  const notReturned=returnPeople.filter(item=>item.followup==='not-returned').length
  const installation=fraction(sessions.filter(item=>item.events.setupShownMs!==null).length,sessions.length)
  const support=fraction(eligible.filter(item=>item.neededHelp).length,eligible.length)
  const ratings=[...rated.values()]
  const usefulness=fraction(ratings.filter(item=>item.usefulness>=4).length,ratings.length)
  return { format:1,observations:{files:input.length,sessions:sessions.length,duplicateReports:input.length-sessions.length,participants:people.length,eligibleParticipants:eligible.length,nonTechnicalEligible:eligible.filter(item=>item.nonTechnical).length},
    versions:[...new Set(sessions.map(item=>item.desktopVersion))],environments:Object.fromEntries(['fresh-windows-account','existing-account','sandbox'].map(environment=>[environment,sessions.filter(item=>item.environment===environment).length])),
    installation:{...installation,targetPercent:90,status:sessions.length<10?'insufficient-sample':installation.percent>=90?'met':'missed'},cohorts,
    support:{...support,targetMaximumPercent:20,status:eligible.length<20?'insufficient-sample':support.percent<=20?'met':'missed'},
    usefulness:{...usefulness,definition:'Latest rated activated session per participant; rating 4 or 5 is useful',status:ratings.length<10?'insufficient-sample':usefulness.percent>=80?'met':'missed'},
    returnUse:{...fraction(returned,returnPeople.length),confirmedNotReturned:notReturned,noResponse,pending,definition:'Confirmed other-day use within 14 days; missing responses remain unknown in the denominator',status:returnPeople.length<20?'insufficient-sample':pending?'awaiting-followup':returned/returnPeople.length>=.5?'met':'missed'},
    recruitment:{targetEligible:20,targetNonTechnical:10,status:eligible.length>=20&&eligible.filter(item=>item.nonTechnical).length>=10?'met':'insufficient-sample'},
    releaseDecision:'pending-signing-clean-account-provider-acceptance-and-human-review' }
}
export async function reportDirectory(directory) {
  const files=(await fs.readdir(directory)).filter(name=>/^session-.*\.json$/i.test(name)).sort()
  const input=await Promise.all(files.map(async name=>{
    const file=path.join(directory,name)
    if ((await fs.stat(file)).size>64*1024) throw new Error('Oversized beta session report')
    return JSON.parse(await fs.readFile(file,'utf8'))
  }))
  return summarizeSessions(input)
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Usage: node beta-report.mjs <directory-with-session-reports>')
  const directory=path.resolve(process.argv[2])
  const report=await reportDirectory(directory)
  await fs.writeFile(path.join(directory,'beta-summary.json'),JSON.stringify(report,null,2))
  console.log(JSON.stringify(report,null,2))
}
