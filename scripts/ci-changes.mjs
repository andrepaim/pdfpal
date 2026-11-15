// Classify the entire PR/push diff. Unknown inputs always keep the full CI suite.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export function documentationOnly(files) {
  return files.length > 0 && files.every(file =>
    /^[^/]+\.md$/i.test(file)
    || /^(?:desktop|extension|frontend)\/README\.md$/i.test(file)
    || /^docs\/.+\.(?:md|json|txt|csv|png|jpe?g|webp|gif|svg|pdf)$/i.test(file)
    || /^screenshots\/.+\.(?:md|json|html|png|jpe?g|webp|gif|svg)$/i.test(file))
}

export function changeRange(eventName, event) {
  const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/i.test(value) && !/^0+$/.test(value)
  if (eventName === 'pull_request') {
    const base = event.pull_request?.base?.sha, head = event.pull_request?.head?.sha
    return sha(base) && sha(head) ? `${base}...${head}` : null
  }
  return eventName === 'push' && sha(event.before) && sha(event.after) ? `${event.before}..${event.after}` : null
}

export function classifyChanges(eventName, event, cwd = process.cwd()) {
  const range = changeRange(eventName, event)
  if (!range) return { runFull: true, reason: 'Manual, new-branch or unknown comparison; run the full suite.' }
  try {
    // Report both sides of a rename: moving runtime code into docs must still run tests.
    const files = execFileSync('git', ['diff', '--name-only', '--no-renames', '-z', range, '--'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).split('\0').filter(Boolean)
    const docs = documentationOnly(files)
    return { runFull: !docs, reason: docs ? `Only documentation/media changed (${files.length} paths).` : 'Code, build inputs, skills, CI, unknown paths or an empty diff; run the full suite.' }
  } catch { return { runFull: true, reason: 'Could not compare commits; run the full suite.' } }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let result
  try { result = classifyChanges(process.env.GITHUB_EVENT_NAME, JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))) }
  catch { result = { runFull: true, reason: 'Could not read the event; run the full suite.' } }
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `run_full=${result.runFull}\n`)
  console.log(result.reason)
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### CI scope\n\n${result.reason}\n\nDocumentation links, credential scanning and CI-scope tests always run.\n`)
}
