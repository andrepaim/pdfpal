// Refresh README media from the real browser reader, using an isolated temporary library.
// Run after npm ci / npm run build: npx tsx scripts/capture-readme.ts
// No personal library, provider invocation, response interception or DOM/style replacement.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { chromium, expect } from '@playwright/test'
import { loadConfig } from '../src/core/config.js'
import { openDatabase } from '../src/core/database.js'
import { ProjectService } from '../src/core/projects.js'
import { SourceService } from '../src/core/sources.js'
import { CollectionService } from '../src/core/collections.js'
import { NoteService } from '../src/core/notes.js'
import { ChatService } from '../src/core/chat.js'
import { visualDefinition, visualFrames, visualTranscript } from '../src/shared/visual.js'
import { buildServer } from '../src/server/app.js'

const root = path.resolve(import.meta.dirname, '..')
process.chdir(root)
const temporary = await mkdtemp(path.join(tmpdir(), 'pdfpal-readme-'))
const config = loadConfig({ dataDir: temporary, dbPath: path.join(temporary, 'pdfpal.db'),
  claudeBin: path.join(temporary, 'uninstalled-claude'), codexBin: path.join(temporary, 'uninstalled-codex'),
  opencodeBin: path.join(temporary, 'uninstalled-opencode'), semanticScholarApiKey: '', agent: 'claude', aiMode: 'agent' })
const db = openDatabase(config)
let server: Awaited<ReturnType<typeof buildServer>> | undefined
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
try {
  const projects = new ProjectService(db), sources = new SourceService(db, config)
  const collections = new CollectionService(db), notes = new NoteService(db, config), chat = new ChatService(db, config)
  const project = projects.create('Understanding Transformers', 'Read the original papers, work through difficult passages, and keep what you learn.')
  projects.create('Learning Representations', 'Vector quantization, embeddings and residual networks.')
  projects.create('Reading Queue', 'Questions and papers to come back to.')
  const core = collections.create(project.id, 'Core Transformer Papers')
  const related = collections.create(project.id, 'Related Techniques')
  const papers = [
    ['1706.03762v7', 'Attention Is All You Need', core.id],
    ['1409.0473', 'Neural Machine Translation by Jointly Learning to Align and Translate', core.id],
    ['2205.14135', 'FlashAttention: Fast and Memory-Efficient Exact Attention with IO-Awareness', related.id],
  ]
  const imported = []
  for (const [id, title, collection] of papers) {
    console.log(`Importing ${title}`)
    const response = await fetch(`https://arxiv.org/pdf/${id}`, { signal: AbortSignal.timeout(60_000) })
    if (!response.ok) throw Error(`PDF ${id}: ${response.status}`)
    const source = await sources.add(project.id, { filename: `${id}.pdf`, bytes: Buffer.from(await response.arrayBuffer()) }, title, collection)
    // Preserve the public discovery link while keeping a managed copy for the reader.
    db.prepare('UPDATE sources SET url=? WHERE id=?').run(`https://arxiv.org/pdf/${id}`, source.id)
    imported.push(source)
  }
  const paper = imported[0]!
  const visualSource = await sources.add(project.id, path.join(config.filesDir, paper.local_path!), 'Attention Is All You Need — visual study', core.id)
  const reading = JSON.parse(await readFile('screenshots/paper-reading-example.json', 'utf8'))
  chat.persist(project.id, paper.id, reading.chat[0].content, reading.chat[1].content, [paper.id])
  const fixture = JSON.parse(await readFile('test/fixtures/visual-v2/attention.claude.json', 'utf8'))
  const definition = visualDefinition.parse(fixture.definition), visualId = randomUUID(), timestamp = new Date().toISOString()
  db.prepare(`INSERT INTO visual_explanations(id,project_id,request_id,request_hash,question,status,definition_json,references_json,request_json,created_at,updated_at)
    VALUES (?,?,?,?,?,'complete',?,?,?,?,?)`).run(visualId, project.id, randomUUID(), 'readme-recorded-example', fixture.question,
    JSON.stringify(definition), JSON.stringify(fixture.references), JSON.stringify({ source_id: visualSource.id }), timestamp, timestamp)
  // This recorded answer had no supplied source text. Keep its original background/illustration labels.
  chat.persist(project.id, visualSource.id, fixture.question, visualTranscript(definition, fixture.references), [], visualId)
  const note = notes.create(project.id, { title: 'Why attention replaced recurrence', content: '# Why attention replaced recurrence\n\nAttention lets each token gather information from other positions without waiting for a recurrent state to travel through the sequence.\n\n## What I understood\n\n- Queries and keys determine which tokens matter for the current position.\n- Softmax turns scores into weights that sum to one.\n- Values carry the information that gets mixed into the output.\n\n## Question to revisit\n\nHow does the cost of full attention change for long sequences, and what does FlashAttention improve?\n\nThis is a sample research note, written for the documentation.' })
  db.close()
  server = await buildServer(config)
  const base = await server.listen({ port: 0, host: '127.0.0.1' })
  browser = await chromium.launch(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {})
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 })
  page.setDefaultTimeout(20_000)
  const failures: string[] = []
  page.on('pageerror', error => failures.push(error.message))
  const capture = async (name: string) => {
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: `screenshots/${name}.png`, animations: 'disabled' })
    console.log(`Captured ${name}`)
  }
  async function openReader(pageNumber: number, dividerX: number, sourceId = paper.id) {
    await page.goto(`${base}/projects/${project.id}/sources/${sourceId}`)
    await page.locator('[data-pdf-page="1"] canvas').waitFor()
    await page.getByRole('button', { name: 'Reading preferences', exact: true }).click()
    const preferences = page.getByRole('dialog', { name: 'Reading preferences', exact: true })
    const dark = preferences.getByLabel('Dark pages', { exact: true })
    if (!await dark.isChecked()) await dark.click()
    await page.keyboard.press('Escape')
    const divider = page.locator('[style*="cursor: col-resize"]')
    const box = await divider.boundingBox()
    if (!box) throw Error('Reader divider missing')
    await page.mouse.move(box.x + box.width / 2, 450)
    await page.mouse.down(); await page.mouse.move(dividerX, 450); await page.mouse.up()
    await page.locator(`[data-pdf-page="${pageNumber}"]`).evaluate(e => e.scrollIntoView({ block: 'start' }))
    await page.locator(`[data-pdf-page="${pageNumber}"] canvas`).waitFor()
    await page.locator(`[data-pdf-page="${pageNumber}"] .textLayer span`).first().waitFor()
    await page.evaluate(() => document.fonts.ready)
    await expect(page.getByTestId('page-progress')).toHaveText(`Page ${pageNumber} of 15`)
  }
  await openReader(4, 840, visualSource.id)
  const card = page.getByRole('article', { name: 'Visual explanation' })
  await card.locator('.visual-canvas svg').waitFor()
  await card.locator('.visual-progress button').nth(6).click()
  await card.evaluate(e => {
    let parent = e.parentElement
    while (parent && getComputedStyle(parent).overflowY !== 'auto') parent = parent.parentElement
    if (!parent) throw Error('Chat scroll container missing')
    parent.scrollTop += e.getBoundingClientRect().top - parent.getBoundingClientRect().top - 8
  })
  await capture('visual-attention-steps')
  await card.getByRole('button', { name: 'Expand', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.locator('.visual-progress button').nth(4).click()
  await expect(dialog.locator('.visual-canvas svg')).toBeVisible()
  await capture('visual-attention-expanded')
  const frames = visualFrames(definition)
  for (let i = 0; i < frames.length; i++) {
    await dialog.locator('.visual-progress button').nth(i).click()
    await expect(dialog.locator('.visual-caption')).toHaveText(frames[i].caption)
  }
  await expect(dialog.getByRole('button', { name: 'Next step' })).toBeDisabled()
  await dialog.getByRole('button', { name: 'Close visual explanation' }).click()
  await card.locator('.visual-progress button').first().click()
  await expect(card.getByRole('button', { name: 'Previous step' })).toBeDisabled()
  const download = page.waitForEvent('download')
  await card.getByRole('button', { name: 'Export HTML', exact: true }).click()
  await (await download).saveAs('screenshots/9-visual-explanation.html')
  // Verify the exported artifact independently, with all network requests blocked.
  const offline = await browser.newContext({ offline: true })
  const exported = await offline.newPage()
  await exported.goto(`file://${path.join(root, 'screenshots/9-visual-explanation.html')}`)
  await expect(exported.locator('svg').first()).toBeVisible()
  for (let i = 0; i < frames.length; i++) {
    await expect(exported.locator('.beat:visible .caption')).toContainText(frames[i].caption)
    if (i < frames.length - 1) await exported.locator('#next').click()
  }
  await expect(exported.locator('#next')).toBeDisabled()
  await offline.close()

  await openReader(3, 960)
  // Scroll to the preserved decoder response, above the separate visual request.
  const answer = page.getByText('The mask blocks', { exact: false }).first()
  await answer.scrollIntoViewIfNeeded()
  const heading = page.locator('[data-pdf-page="3"] .textLayer span').filter({ hasText: /^Encoder and Decoder Stacks$/ }).last()
  await heading.evaluate(e => {
    const area = document.querySelector('[data-testid="pdf-scroll-area"]')!
    area.scrollTop += e.getBoundingClientRect().top - 360
  })
  // Select the decoder's last three lines with the mouse, then save through the normal popup.
  const passage = await page.locator('[data-pdf-page="3"] .textLayer').evaluate(layer => {
    const spans = [...layer.querySelectorAll('span')]
    const start = spans.find(e => e.textContent?.trim().endsWith('positions. This'))!
    const end = spans.find(e => e.textContent?.includes('positions less than'))!
    if (!start || !end) throw Error('Decoder passage not found')
    const range = document.createRange()
    range.setStart(start.firstChild!, start.textContent!.lastIndexOf('This'))
    range.setEnd(start.firstChild!, start.textContent!.length)
    const a = range.getBoundingClientRect(), b = end.getBoundingClientRect()
    return { x: a.left + 1, y: a.top + a.height / 2, endX: b.right + 8, endY: b.top + b.height / 2 }
  })
  await page.mouse.move(passage.x, passage.y); await page.mouse.down()
  await page.mouse.move(passage.endX, passage.endY, { steps: 12 }); await page.mouse.up()
  const highlighted = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/annotations'))
  await page.getByRole('button', { name: /Highlight/ }).click()
  if (!(await highlighted).ok()) throw Error('Highlight did not save')
  await openReader(3, 960)
  await heading.evaluate(e => {
    const area = document.querySelector('[data-testid="pdf-scroll-area"]')!
    area.scrollTop += e.getBoundingClientRect().top - 360
  })
  await capture('reader-decoder-masking')
  await page.getByTestId('page-progress').click()
  // Double-click a real PDF word to exercise the bundled offline dictionary.
  const word = await page.locator('[data-pdf-page="3"] .textLayer').evaluate(layer => {
    const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.textContent!.search(/\bstack\b/)
      if (at < 0) continue
      const range = document.createRange()
      range.setStart(node, at); range.setEnd(node, at + 5)
      const box = range.getBoundingClientRect()
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
    }
    throw Error('Dictionary word not found')
  })
  await page.mouse.dblclick(word.x, word.y)
  await expect(page.getByRole('dialog', { name: 'Definition of stack', exact: true })).toBeVisible()
  await expect(page.getByRole('dialog', { name: /^Definition of/ })).toBeVisible()
  await capture('reader-dictionary')
  await page.keyboard.press('Escape')

  // Discovery uses the app's real public services. Never capture placeholders or replace results.
  await page.getByTestId('page-progress').click()
  await page.getByRole('button', { name: /Related/ }).click()
  await expect(page.getByRole('button', { name: /^References/ })).toBeVisible({ timeout: 60_000 })
  await expect(page.getByRole('button', { name: /Add/ }).first()).toBeVisible({ timeout: 60_000 })
  await capture('2-related')
  await page.goto(`${base}/projects/${project.id}`)
  await page.getByRole('button', { name: /Add Source/ }).first().click()
  await page.getByPlaceholder('e.g. Attention Is All You Need').fill('Attention Is All You Need')
  const searched = page.waitForResponse(response => response.url().includes('/api/search/papers'), { timeout: 60_000 })
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  const searchResponse = await searched
  if (!(await searchResponse.json()).results?.length) throw Error('Paper search returned no live results')
  await expect(page.getByRole('button', { name: /Add/ }).first()).toBeVisible()
  await capture('3-search')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.goto(`${base}/projects/${project.id}`)
  const expandAll = page.getByRole('button', { name: /Expand All/ })
  if (await expandAll.count()) await expandAll.click()
  await expect(page.getByText('FlashAttention:', { exact: false }).first()).toBeVisible()
  await capture('6-collections')
  await page.goto(`${base}/projects/${project.id}/notes/${note.id}`)
  await expect(page.getByRole('heading', { name: 'What I understood', exact: true })).toBeVisible()
  await capture('5-notes')
  await page.goto(`${base}/extensions`)
  await expect(page.getByRole('button', { name: /Download Chrome extension/ }).or(page.getByRole('link', { name: /Download Chrome extension/ }))).toBeVisible()
  await capture('8-extension-setup')
  await page.goto(base)
  await expect(page.getByText('Understanding Transformers', { exact: true })).toBeVisible()
  await capture('4-projects')
  await page.getByRole('button', { name: 'Backups', exact: true }).click()
  const recovery = page.getByRole('dialog', { name: 'Backups & recovery' })
  await recovery.getByRole('button', { name: 'Back up now', exact: true }).click()
  await expect(recovery.getByRole('status')).toHaveText('Backup saved and verified.', { timeout: 30_000 })
  await capture('backups-recovery')
  if (failures.length) throw Error(`Renderer errors: ${failures.join('; ')}`)
  await writeFile('screenshots/capture-manifest.json', JSON.stringify({
    capturedAt: timestamp, applicationCommit: execFileSync('git', ['merge-base', 'HEAD', 'origin/master'], { encoding: 'utf8' }).trim(),
    surface: 'browser reader', viewport: { width: 1600, height: 1000 },
    visualFixture: 'test/fixtures/visual-v2/attention.claude.json', visualSteps: frames.length,
    decoderFixture: 'screenshots/paper-reading-example.json', providerCalls: 0,
  }, null, 2) + '\n')
} finally {
  await browser?.close()
  await server?.close()
  if (db.open) db.close()
  await rm(temporary, { recursive: true, force: true })
}
