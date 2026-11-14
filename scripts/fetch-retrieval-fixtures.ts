// Sets up the retrieval evaluation corpus: `npm run eval:retrieval:fetch [-- --pdf-dir DIR] [--update]`
//
// Downloads every PDF listed in test/fixtures/retrieval/manifest.json (sequentially,
// with a pause between requests and a generic user agent), checks each PDF's SHA-256
// against the manifest, runs pdfpal's own extractPdf, and writes <id>.txt to the
// git-ignored .cache/retrieval directory. The papers' text is never committed.
//
// PDFs go to --pdf-dir (default: a new temporary directory), which must be outside
// the repository; an existing <id>.pdf there is reused instead of downloaded.
// A PDF whose SHA-256 differs from the manifest is an error. If the extracted text
// differs from text_sha256 (for example after a pdfjs-dist upgrade) the text is
// still written and a warning is printed; `npm run eval:retrieval` then re-checks
// every evidence snippet against it. --update (maintainers only) records new
// hashes, page counts and attribution lines in the manifest.
//
// Needs network access. Never run by `npm test` or `npm run eval:retrieval`.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { extractPdf } from '../src/core/pdf.js'
import { cachedTextPath, fixtureDir, sha256, textCacheDir, type FixtureManifest, type FixtureWork } from './retrieval-eval/corpus.js'

const args = process.argv.slice(2)
const update = args.includes('--update')
const pdfDirArg = args.includes('--pdf-dir') ? args[args.indexOf('--pdf-dir') + 1] : undefined
if (args.includes('--pdf-dir') && !pdfDirArg) throw new Error('--pdf-dir needs a directory')
const repository = path.resolve(import.meta.dirname, '..')
const pdfDir = path.resolve(pdfDirArg ?? fs.mkdtempSync(path.join(os.tmpdir(), 'pdfpal-retrieval-pdfs-')))
const insideRepo = path.relative(repository, pdfDir)
if (!insideRepo.startsWith('..') && !path.isAbsolute(insideRepo)) {
  throw new Error('Keep downloaded PDFs outside the repository; pass --pdf-dir with a path elsewhere.')
}
fs.mkdirSync(pdfDir, { recursive: true })
fs.mkdirSync(textCacheDir, { recursive: true })

const manifestPath = path.join(fixtureDir, 'manifest.json')
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as FixtureManifest
// A generic client name: requests carry nothing that identifies a person or project.
const headers = { 'user-agent': 'Mozilla/5.0 (compatible; fixture-fetch)', accept: 'application/pdf' }
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

function displayName(author: string): string {
  const [last, first] = author.split(/,\s*/)
  return first ? `${first} ${last}` : author
}

function attribution(work: FixtureWork, changes: string): string {
  return `"${work.title}" by ${work.authors.map(displayName).join(', ')} (${work.source_url}), licensed under ${work.licence} (${work.licence_url}). Changes: ${changes}`
}

async function download(work: FixtureWork): Promise<Buffer> {
  const file = path.join(pdfDir, `${work.id}.pdf`)
  if (fs.existsSync(file)) return fs.readFileSync(file)
  const response = await fetch(work.pdf_url, { headers, redirect: 'follow', signal: AbortSignal.timeout(120_000) })
  if (!response.ok) throw new Error(`${work.id}: HTTP ${response.status} from ${work.pdf_url}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.subarray(0, 4).toString() !== '%PDF') throw new Error(`${work.id}: ${work.pdf_url} did not return a PDF`)
  fs.writeFileSync(file, bytes)
  await pause(4000)
  return bytes
}

const errors: string[] = [], warnings: string[] = []
for (const work of manifest.works) {
  const bytes = await download(work)
  const pdfHash = sha256(bytes)
  if (work.pdf_sha256 && work.pdf_sha256 !== pdfHash && !update) {
    errors.push(`${work.id}: the downloaded PDF does not match the manifest's SHA-256; nothing was written for it`)
    continue
  }
  const extracted = await extractPdf(bytes)
  const text = `${extracted.text}\n`
  const textHash = sha256(text)
  if (work.text_sha256 && work.text_sha256 !== textHash && !update) warnings.push(`${work.id}: extracted text differs from the labelled text (pdfjs-dist version change?)`)
  fs.writeFileSync(cachedTextPath(work), text)
  if (update || !work.text_sha256) Object.assign(work, { pdf_sha256: pdfHash, text_sha256: textHash, page_count: extracted.pages, attribution: attribution(work, manifest.changes) })
  console.log(`${work.id}: ${extracted.pages} pages, ${text.length} characters`)
}
if (update) fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`Text written to ${path.relative(process.cwd(), textCacheDir)}; PDFs kept in ${pdfDir}`)
if (warnings.length) console.warn(`Warning:\n${warnings.join('\n')}\nThe evaluation re-checks every evidence snippet; its numbers may not match the recorded baseline.`)
if (errors.length) {
  console.error(errors.join('\n'))
  process.exit(1)
}
