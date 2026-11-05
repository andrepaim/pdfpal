#!/usr/bin/env node
import fs from 'node:fs'
let args = process.argv.slice(2)
const requestIndex = args[0] === '--request-file' ? 0 : args[0] === '--json' && args[1] === '--request-file' ? 1 : -1
if (requestIndex >= 0) {
  try {
    const filename = args[requestIndex + 1]
    if (!filename || args.length !== requestIndex + 2 || fs.statSync(filename).size > 8 * 1024 * 1024) throw Error()
    const payload = JSON.parse(fs.readFileSync(filename, 'utf8').replace(/^\uFEFF/, ''))
    if (!payload || !Array.isArray(payload.args) || payload.args.length > 1000 || !payload.args.every((arg: unknown) => typeof arg === 'string' && !arg.includes('\0'))) throw Error()
    args = [...(requestIndex === 1 ? ['--json'] : []), ...payload.args]
    process.argv = [...process.argv.slice(0, 2), ...args]
  } catch {
    const { reportError } = await import('./output.js')
    const { PdfpalError } = await import('../core/types.js')
    reportError(new PdfpalError('INVALID_REQUEST_FILE', 'Supply a UTF-8 JSON file containing an args array of strings (at most 8 MB).', 2), args.includes('--json'))
  }
}
const valued = new Set(['--profile','--library','--expect-library','--operation','--wait-ms','--data-dir','--content','--content-file','--title','--description','--source','--collection','--parent','--model','--agent','--port','--limit','--offset','--page','--expect-updated-at','-c','-t','-d','-s','-p','-a','-m','-l'])
const flags = new Map<string, number>()
for (let i = 0; i < args.length; i++) {
  const arg = args[i]!
  if (arg === '--') break
  if (arg.startsWith('-')) flags.set(arg.split('=')[0]!, i)
  if (valued.has(arg)) i++
}
const standalone = flags.has('--standalone')
if (standalone) process.argv.splice(flags.get('--standalone')! + 2, 1)
const first = args.filter(arg => arg !== '--json')[0]
const desktop = !standalone && (process.env.PDFPAL_CLI_DESKTOP === '1' || flags.has('--desktop') || flags.has('--profile') || ['status', 'doctor', 'library', 'skill', 'operation'].includes(first ?? ''))
if (desktop) {
  const { runDesktopCli } = await import('./desktop.js')
  await runDesktopCli(process.argv)
} else await import('./standalone.js')
