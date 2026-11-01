// Capture existing, genuinely generated reading sessions from a running pdfpal server.
// Usage: npx tsx scripts/capture-visual-example.ts BASE_URL PROJECT CHAT_SOURCE VISUAL_SOURCE VISUAL_ID
// Import Attention Is All You Need (https://arxiv.org/pdf/1706.03762v7), select the
// tiny-gradient passage on page 4, and ask the questions recorded in
// screenshots/paper-reading-example.json before running this capture.
// No API mocking, fabricated answers, or changes to the app's DOM/styles.
import { chromium, expect } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { visualDefinition, type VisualRecord } from '../src/shared/visual.js'
import { visualHtml } from '../frontend/src/lib/visual-html.js'

const [base, project, chatSource, visualSource, visualId] = process.argv.slice(2)
if (![base, project, chatSource, visualSource, visualId].every(Boolean)) {
  throw new Error('Supply BASE_URL PROJECT CHAT_SOURCE VISUAL_SOURCE VISUAL_ID')
}
const get = async (path: string) => {
  const res = await fetch(`${base}/api/projects/${project}${path}`)
  if (!res.ok) throw new Error(`${path}: ${res.status}`)
  return res.json()
}
const record: VisualRecord = await get(`/visuals/${visualId}`)
if (record.status !== 'complete') throw new Error('The visual explanation must be complete.')
visualDefinition.parse(record.definition)
const chat = await get(`/sources/${chatSource}/chat`)
const visualChat = await get(`/sources/${visualSource}/chat`)
const browser = await chromium.launch()
try {
  const page = await browser.newPage({viewport: {width: 1600, height: 1000}, deviceScaleFactor: 1})
  async function openReader(source: string, dividerX = 960) {
    await page.goto(`${base}/projects/${project}/sources/${source}`)
    await page.locator('[data-pdf-page="1"] canvas').waitFor()
    // Resize with the actual divider, keeping the PDF and explanation readable.
    const divider = page.locator('[style*="cursor: col-resize"]')
    const box = await divider.boundingBox()
    if (!box) throw new Error('Reader divider not found')
    await page.mouse.move(box.x + box.width / 2, 450)
    await page.mouse.down(); await page.mouse.move(dividerX, 450); await page.mouse.up()
    await page.locator('[data-pdf-page="4"]').evaluate(e => e.scrollIntoView({block:'start'}))
    const heading = page.locator('[data-pdf-page="4"] .textLayer span').filter({hasText:/^Scaled Dot-Product Attention$/}).last()
    await heading.waitFor()
    // Place section 3.2.1, its equation, selected paragraph and footnote in view.
    await heading.evaluate(e => {
      const area = document.querySelector('[data-testid="pdf-scroll-area"]')!
      area.scrollTop += e.getBoundingClientRect().top - 150
    })
    await page.getByRole('combobox').filter({has:page.getByRole('option',{name:'Codex',exact:true})}).selectOption('codex')
    await page.evaluate(() => document.fonts.ready)
    await expect(page.getByTestId('page-progress')).toHaveText('Page 4 of 15')
  }
  await openReader(chatSource!)
  if (await page.locator('.katex-error').count()) throw new Error('Chat contains a math rendering error')
  await page.screenshot({path:'screenshots/1-reader.png'})

  await page.setViewportSize({width:1600,height:1100})
  await openReader(visualSource!, 1040)
  const card = page.locator('.visual-card').filter({has:page.getByRole('heading',{name:record.definition!.title,exact:true})}).last()
  await card.locator(':scope > .visual-story svg').waitFor()
  // Scroll only the chat pane, leaving the selected PDF passage in view.
  await card.evaluate(e => {
    let parent = e.parentElement
    while (parent && getComputedStyle(parent).overflowY !== 'auto') parent = parent.parentElement
    if (!parent) throw new Error('Chat scroll container not found')
    parent.scrollTop += e.getBoundingClientRect().top - parent.getBoundingClientRect().top - 8
  })
  await page.screenshot({path:'screenshots/9-visual-explanation.png'})
  // Check all generated steps in the real UI, including navigation back.
  const next = card.getByRole('button',{name:'Next step',exact:true}).first()
  for(let i=1; i<record.definition!.steps.length; i++) await next.click()
  if (!await next.isDisabled()) throw new Error('Last-step navigation failed')
  const previous = card.getByRole('button',{name:'Previous step',exact:true}).first()
  for(let i=1; i<record.definition!.steps.length; i++) await previous.click()
  await card.locator(':scope > .visual-story').getByRole('button',{name:'B',exact:true}).click()
  await expect(card.locator(':scope > .visual-story .visual-detail')).toBeVisible()
  await writeFile('screenshots/9-visual-explanation.html',visualHtml(record))
  const turn = visualChat.messages.find((m: {visual_id:string})=>m.visual_id===visualId)
  const questionIndex = visualChat.messages.indexOf(turn)-1
  await writeFile('screenshots/paper-reading-example.json',JSON.stringify({
    paper:{title:'Attention Is All You Need',url:'https://arxiv.org/pdf/1706.03762v7',page:4,section:'3.2.1',footnote:4},
    provenance:'Real PDF imported through pdfpal; passage highlighted in the browser; questions submitted through the reader to the authenticated Codex CLI. Responses are unedited. The visual was refined with a second request for clearer labels. Screenshots show the actual PDF reader.',
    chat:chat.messages, visualQuestion:visualChat.messages[questionIndex]?.content, visual:record,
  },null,2)+'\n')
  console.log('Captured both real PDF reading sessions; validated visual schema and step navigation.')
} finally { await browser.close() }
