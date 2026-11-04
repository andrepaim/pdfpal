import fs from 'node:fs'
import { execFileSync } from 'node:child_process'

// Report paths only, so a failed check cannot copy credentials into CI logs.
const patterns = [
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{25,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{25,}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
]
const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean)
const findings = []
for (const file of files) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue
  const content = fs.readFileSync(file, 'utf8')
  if (patterns.some(pattern => pattern.test(content))) findings.push(file)
}
if (findings.length) {
  console.error('Credential patterns detected in tracked files:\n' + findings.join('\n'))
  process.exit(1)
}
console.log(`Credential check passed for ${files.length} tracked files.`)
