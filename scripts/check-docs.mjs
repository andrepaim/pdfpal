// Check tracked Markdown links against the checkout, without network access.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const files = execFileSync('git', ['ls-files', '-z', '*.md'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean)
const withoutCode = text => text.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, '')
const slug = text => text.replace(/<[^>]+>/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').toLowerCase()
  .replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, '').replace(/\s/g, '-')
function anchors(filename) {
  const content = withoutCode(fs.readFileSync(filename, 'utf8')), used = new Set()
  for (const match of content.matchAll(/^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    const base = slug(match[1])
    let id = base, duplicate = 0
    while (used.has(id)) id = `${base}-${++duplicate}`
    used.add(id)
  }
  for (const match of content.matchAll(/\b(?:id|name)=["']([^"']+)["']/g)) used.add(match[1])
  return used
}
const errors = []
let links = 0
for (const file of files) {
  const content = withoutCode(fs.readFileSync(path.join(root, file), 'utf8'))
  // Inline links/images and reference definitions. Angle brackets allow spaces in local paths.
  const targets = [...content.matchAll(/!?\[[^\]\n]*\]\(<?([^\s)>]+|[^>]+(?=>))>?(?:\s+"[^"]*")?\)/g),
    ...content.matchAll(/^ {0,3}\[[^\]]+\]:\s*<?([^\s>]+)>?/gm)]
  for (const match of targets) {
    const target = match[1]
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target)) continue
    links++
    let decoded
    try { decoded = decodeURIComponent(target) } catch { errors.push(`${file}: invalid URL ${target}`); continue }
    const [location, fragment] = decoded.split('#')
    const destination = location ? path.resolve(path.dirname(path.join(root, file)), location.split('?')[0]) : path.join(root, file)
    if (!fs.existsSync(destination)) { errors.push(`${file}: missing ${target}`); continue }
    if (fragment && /\.md$/i.test(destination) && !anchors(destination).has(fragment)) errors.push(`${file}: missing heading ${target}`)
  }
}
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1 }
else console.log(`Checked ${links} local links in ${files.length} Markdown files.`)
