import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { buildServer } from '../../src/server/app.js'
import { openDatabase } from '../../src/core/database.js'
import { RetrievalService } from '../../src/core/retrieval.js'
import { CHECK_FAILED, SHARE_CARD_REPAIR, ShareCardService, pageContext, parseShareCardAnswer, sharePostPrompt, sharedContext } from '../../src/core/share-cards.js'
import { DRAFT, REGION_STYLE_REFUSED, SET_STYLE_REFUSED, captionText, cleanPassage, draftLimits, type Caption, type Destination, type ShareCardRecord, type SourceKind } from '../../src/shared/share-card.js'
import { testConfig, createSource } from '../helpers/test-utils.js'

const HIGHLIGHT = 'Attention lets every position look at every other position in\nthe sequence. However, the cost grows with the square of the se-\nquence length, so long documents become expensive.'
const PASSAGE = cleanPassage(HIGHLIGHT)
const PAGES = '[Page 1]\nPage one introduces the model.\n[Page 2]\n' + HIGHLIGHT + ' We suspect that sparse patterns may reduce this cost.\n[Page 3]\nPage three compares results.\n[Page 4]\nPage four is out of range.'
const URL = 'https://arxiv.org/abs/1706.03762'
/** A LinkedIn and Instagram draft: 3–6 paragraphs, about 140 words, no numbers. */
const FINDING = 'Full attention buys reach at a price that grows fast.\n\n' +
  'In the model the authors describe, every position in a sequence can look at every other position. That is what makes it flexible: a word at the end of a document can draw directly on a word at the start, with nothing in between to forget it.\n\n' +
  'The catch is cost. The authors state that it grows with the square of the sequence length, so a longer document costs far more than its length suggests, and long documents become expensive.\n\n' +
  'They suspect that sparse patterns may reduce this cost, letting each position attend to a chosen few others instead of all of them. That remains a suspicion in the paper, not a result, and it is the open question for anyone who wants this reach on long inputs.'
const CAVEAT = FINDING.replace('Full attention buys reach at a price that grows fast.', 'The fix for the cost of attention is still a suspicion, not a result.')
const X_FINDING = 'Every position can look at every other one, but the cost grows with the square of the sequence length. The authors suspect sparse patterns may reduce it.'
const DRAFTS = { finding: FINDING, contrast: '', caveat: CAVEAT }
const HASHTAGS = ['attention', 'transformers', 'research']
const CARD = {
  quote: 'the cost grows with the square of the sequence length', emphasis: 'the square', headline: 'Reach has a quadratic price',
  pull: 'sparse patterns may reduce this cost', topic: 'Attention', takeawaysTitle: 'What full attention costs',
  takeaways: [{ title: 'Reach is global', detail: 'Every position can use every other one.' },
    { title: 'Cost grows fast', detail: 'Doubling the input quadruples the work.' }, { title: 'Sparsity may help', detail: 'The authors suspect so; it is untested here.' }],
}
const answer = (card: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ ...CARD, ...card, drafts: DRAFTS, hashtags: HASHTAGS, ...extra })
const drafts = (value: Partial<Record<'finding' | 'contrast' | 'caveat', unknown>>, card: Record<string, unknown> = {}) => answer(card, { drafts: { ...DRAFTS, ...value } })
const caption = (extra: Partial<Caption> = {}): Caption =>
  ({ destination: 'linkedin', take: '', drafts: DRAFTS, angle: 'finding', hashtags: HASHTAGS, showTags: false, link: 'post', edited: null, ...extra })
const prompt = (destination: Destination = 'linkedin', take = '') => sharePostPrompt(destination, draftLimits(destination, { take, url: URL }))

// The fake agent answers call N with response-N.json when it exists, otherwise response.json. It waits delay-N.txt
// (or delay.txt) milliseconds first, exits with an error when fail-N.txt exists, and keeps each prompt as prompt.txt.N.
async function setup() {
  const config = testConfig(); config.agent = 'codex'; config.codexBin = path.join(config.dataDir, 'codex-fixture')
  const dir = config.dataDir, calls = path.join(dir, 'calls.txt')
  fs.writeFileSync(path.join(dir, 'response.json'), answer())
  fs.writeFileSync(config.codexBin, `#!/usr/bin/env node
if(process.argv.includes('--version')){console.log('codex-cli 0.164.0');process.exit(0)};if(process.argv.includes('--help')){console.log('--tools --strict-mcp-config --disallowedTools --ignore-user-config --ignore-rules --ephemeral --disable');process.exit(0)};if(process.argv.includes('status')){process.exit(1)};
const fs=require('node:fs'),path=require('node:path'),dir=${JSON.stringify(dir)};const input=fs.readFileSync(0,'utf8');fs.appendFileSync(path.join(dir,'calls.txt'),'call\\n')
const n=fs.readFileSync(path.join(dir,'calls.txt'),'utf8').trim().split('\\n').length;fs.writeFileSync(path.join(dir,'prompt.txt.'+n),input)
const pick=name=>[name.replace('.','-'+n+'.'),name].map(f=>path.join(dir,f)).find(f=>fs.existsSync(f))
const delay=pick('delay.txt')?Number(fs.readFileSync(pick('delay.txt'),'utf8')):20
setTimeout(()=>{if(pick('fail.txt')){process.stderr.write('boom');process.exit(1)}process.stdout.write(fs.readFileSync(pick('response.json'),'utf8'))},delay)`, { mode: 0o700 })
  const app = await buildServer(config), db = openDatabase(config)
  const project = (await app.inject({ method: 'POST', url: '/api/projects', payload: { title: 'Posts' } })).json() as { id: string }
  const other = (await app.inject({ method: 'POST', url: '/api/projects', payload: { title: 'Other' } })).json() as { id: string }
  const source = createSource(db, project.id, PAGES)
  db.prepare('UPDATE sources SET pages=4, url=? WHERE id=?').run(URL, source)
  new RetrievalService(db).index(source, PAGES)
  const base = `/api/projects/${project.id}/share-cards`
  const callCount = () => fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').trim().split('\n').length : 0
  const prompt = (n: number) => fs.readFileSync(path.join(dir, `prompt.txt.${n}`), 'utf8')
  const input = (n: number) => JSON.parse(prompt(n).slice(prompt(n).lastIndexOf('\n\n{') + 2)) as Record<string, any>
  const respond = (n: number, text: string) => fs.writeFileSync(path.join(dir, `response-${n}.json`), text)
  const delay = (ms: number, n?: number) => fs.writeFileSync(path.join(dir, n ? `delay-${n}.txt` : 'delay.txt'), String(ms))
  const fail = (n: number) => fs.writeFileSync(path.join(dir, `fail-${n}.txt`), '1')
  async function highlight(text = HIGHLIGHT, extra: Record<string, unknown> = {}) {
    const response = await app.inject({ method: 'POST', url: `/api/projects/${project.id}/sources/${source}/annotations`,
      payload: { page_number: 2, x1: 0.12, y1: 0.08, x2: 0.88, y2: 0.14, text, color: 'green',
        rects: [{ x1: 0.12, y1: 0.08, x2: 0.88, y2: 0.1 }, { x1: 0.12, y1: 0.1, x2: 0.86, y2: 0.12 }, { x1: 0.12, y1: 0.12, x2: 0.6, y2: 0.14 }], ...extra } })
    assert.equal(response.statusCode, 200)
    return (response.json() as { id: string }).id
  }
  async function create(annotation: string, extra: Record<string, unknown> = {}) {
    return app.inject({ method: 'POST', url: base, payload: { request_id: randomUUID(), annotation_id: annotation, ...extra } })
  }
  async function settle(id: string): Promise<ShareCardRecord> {
    for (let i = 0; i < 300; i++) {
      const response = await app.inject({ url: `${base}/${id}` }); assert.equal(response.statusCode, 200)
      const record = response.json() as ShareCardRecord
      if (record.status !== 'pending' && record.status !== 'running') return record
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    throw new Error('Share card fixture did not finish')
  }
  async function post(annotation?: string) {
    const response = await create(annotation ?? await highlight()); assert.equal(response.statusCode, 202)
    return settle((response.json() as ShareCardRecord).id)
  }
  return { app, config, db, project, other, source, base, callCount, prompt, input, respond, delay, fail, highlight, create, settle, post,
    async close() { await app.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true }) } }
}

test('a highlight becomes a post in one request built from the passage and its pages', async () => {
  const s = await setup()
  try {
    const annotation = await s.highlight()
    const response = await s.create(annotation); assert.equal(response.statusCode, 202)
    const started = response.json() as ShareCardRecord
    assert.equal(started.annotation_id, annotation); assert.equal(started.source_id, s.source); assert.equal(started.card, null)
    assert.ok(['pending', 'running'].includes(started.status))
    const record = await s.settle(started.id)
    assert.equal(record.status, 'complete'); assert.equal(record.error, null); assert.equal(record.can_undo, false)
    assert.equal(s.callCount(), 1)
    assert.deepEqual(record.source, {
      version: 1, kind: 'highlight', passage: PASSAGE, page: 2, color: 'green', region: null, items: [], title: 'Test Source', credit: '', url: URL,
      rects: [{ x1: 0.12, y1: 0.08, x2: 0.88, y2: 0.1 }, { x1: 0.12, y1: 0.1, x2: 0.86, y2: 0.12 }, { x1: 0.12, y1: 0.12, x2: 0.6, y2: 0.14 }],
      context: record.source.context,
    })
    assert.match(record.source.context, /^Page one introduces the model\.\n\nAttention lets every position.*sparse patterns may reduce this cost\.\n\nPage three compares results\.$/)
    assert.doesNotMatch(record.source.context, /Page four/)
    // LinkedIn by default: the Page style, hashtags hidden, the link in the post.
    assert.deepEqual(record.card, { ...CARD, quoteEdited: false, style: 'page', look: 'ink', crop: null, set: null })
    assert.deepEqual(record.caption, caption())
    assert.equal(record.destination, 'linkedin'); assert.equal(record.take, '')
    assert.deepEqual(record.marks, [{ color: 'green', rects: record.source.rects }])
    assert.equal(captionText(record.source, record.caption!), `${FINDING}\n\n📄 Test Source · p. 2\n${URL}`)
    const sent = s.prompt(1), input = s.input(1)
    assert.ok(sent.startsWith(`${prompt()}\n\n{`))
    assert.match(sent, /share it on LinkedIn/); assert.match(sent, /120–300 words in 3–8 paragraphs/)
    assert.deepEqual(Object.keys(input).sort(), ['credit', 'highlight', 'page', 'pageText', 'title'])
    assert.equal(input.highlight, PASSAGE); assert.equal(input.pageText, record.source.context); assert.equal(input.page, 2)
    assert.equal(input.title, 'Test Source'); assert.equal(input.credit, '')
    assert.match(sent, /We suspect that sparse patterns/)
    const list = (await s.app.inject({ url: `${s.base}?source_id=${s.source}` })).json()
    assert.deepEqual(list, [{ id: record.id, status: 'complete', annotation_id: annotation, source_id: s.source, page: 2, kind: 'highlight', title: CARD.headline, updated_at: record.updated_at }])
    assert.equal((await s.app.inject({ url: `${s.base}?source_id=other` })).json().length, 0)
    // A post in another project is not found, whatever the route.
    for (const request of [{ url: `/api/projects/${s.other.id}/share-cards/${record.id}` },
      { method: 'POST' as const, url: `/api/projects/${s.other.id}/share-cards/${record.id}/undo`, payload: {} },
      { method: 'PATCH' as const, url: `/api/projects/${s.other.id}/share-cards/${record.id}`, payload: { caption: 'x' } },
      { method: 'DELETE' as const, url: `/api/projects/${s.other.id}/share-cards/${record.id}` }]) {
      assert.equal((await s.app.inject(request)).statusCode, 404)
    }
    assert.equal((await s.app.inject({ method: 'POST', url: `/api/projects/${s.other.id}/share-cards`, payload: { request_id: randomUUID(), annotation_id: annotation } })).statusCode, 404)
  } finally { await s.close() }
})

test('an invented quote is repaired once with its reason', async () => {
  const s = await setup()
  try {
    const long = 'Attention lets every position look at every other position in the sequence. However, the cost grows with the square of the sequence length'
    s.respond(1, '```json\n' + answer({ quote: 'Attention lets every position see every other position' }) + '\n```')
    s.respond(2, answer({ quote: long, emphasis: 'every other position' }))
    const record = await s.post()
    assert.equal(record.status, 'complete'); assert.equal(s.callCount(), 2)
    assert.equal(record.card!.style, 'page'); assert.equal(record.card!.quote, long)
    const repair = s.input(2)
    assert.ok(s.prompt(2).startsWith(`${prompt()}\n${SHARE_CARD_REPAIR}\n\n{`))
    assert.equal(repair.repairReason, 'quote must be copied exactly from highlight.')
    assert.match(repair.invalidPreviousAnswer, /see every other position/)
    assert.equal(repair.highlight, PASSAGE)
  } finally { await s.close() }
})

test('a second failed check fails the post with the fixed message and keeps the reason locally', async () => {
  const s = await setup()
  try {
    s.respond(1, 'not json'); s.respond(2, answer({ headline: 'H'.repeat(81) }))
    const record = await s.post()
    assert.equal(record.status, 'failed'); assert.equal(record.error, CHECK_FAILED); assert.equal(record.card, null)
    assert.equal(s.callCount(), 2)
    assert.match(s.input(2).repairReason, /^The answer must be one JSON object/)
    assert.equal((s.db.prepare('SELECT error_detail FROM share_cards WHERE id=?').get(record.id) as { error_detail: string }).error_detail, 'headline has 81 characters; allowed 1–80.')
    assert.equal(JSON.stringify(record).includes('headline has 81'), false)
  } finally { await s.close() }
})

test('an assistant failure is never repaired or retried', async () => {
  const s = await setup()
  try {
    s.fail(1)
    const record = await s.post()
    assert.equal(record.status, 'failed'); assert.equal(s.callCount(), 1)
    assert.equal(record.error, 'The assistant could not finish this request. Retry, or check your connection in AI settings.')
    assert.equal((s.db.prepare('SELECT error_detail FROM share_cards WHERE id=?').get(record.id) as { error_detail: string | null }).error_detail, null)
    // A failure on the repair request also ends the post, with the assistant's message and no further call.
    s.respond(2, 'not json'); s.fail(3)
    const repaired = await s.post()
    assert.equal(repaired.status, 'failed'); assert.equal(s.callCount(), 3)
    assert.equal(repaired.error, 'The assistant could not finish this request. Retry, or check your connection in AI settings.')
  } finally { await s.close() }
})

test('every invalid answer is named so the repair can fix it', () => {
  const source = { passage: PASSAGE, context: 'We suspect that sparse patterns may reduce this cost.', title: 'Attention Is All You Need', credit: '', page: 2, url: URL }
  const options = { destination: 'linkedin' as const, take: '', changed: false }
  const withLine = (line: string) => FINDING.replace('The catch is cost.', line)
  const cases: Array<[string, RegExp]> = [
    // The card's words, as before.
    [answer({ quote: 'Attention lets every token look' }), /quote must be copied exactly/],
    [answer({ emphasis: 'tiny steps' }), /emphasis must be an exact part of quote/],
    [answer({ headline: 'H'.repeat(81) }), /headline has 81 characters; allowed 1–80/],
    [answer({ pull: 'An invented pull quote.' }), /pull must be copied exactly/],
    [answer({ takeaways: CARD.takeaways.slice(0, 2) }), /exactly three/],
    [answer({ takeaways: 'none' }), /takeaways must be a list/],
    [answer({ takeaways: [1, 2, 3] }), /takeaways\[0\] must be an object/],
    [answer({ takeaways: [{ title: 'a' }, CARD.takeaways[1], CARD.takeaways[2]] }), /takeaways\[0\] needs a string title and detail/],
    [answer({ topic: 'T'.repeat(25) }), /topic has 25 characters/],
    [answer({ topic: ' ' }), /topic must name the subject/],
    [answer({ topic: null }), /topic must name the subject/],
    [answer({ topic: '#Attention' }), /only letters, digits and spaces/],
    [answer({ headline: 7 }), /headline must be a string/],
    [answer({ headline: 'What the page text shows' }), /headline must not mention/],
    [answer({ takeawaysTitle: 'From the Supplied Text' }), /takeawaysTitle must not mention/],
    [answer({ takeaways: CARD.takeaways.map((item, i) => i === 2 ? { ...item, detail: 'As the supplied text says.' } : item) }), /takeaways\[2\] must not mention/],
    // Numbers the source does not state, in the card's words.
    [answer({ headline: 'Attention costs 10x more' }), /^Error: headline has numbers that are not in highlight, pageText, title, credit, page or readerTake: 10\. Use only numbers stated there\.$/],
    [answer({ takeawaysTitle: 'Three lessons from 2023' }), /takeawaysTitle has numbers .*: 2023\./],
    [answer({ takeaways: CARD.takeaways.map((item, i) => i === 1 ? { ...item, detail: 'Doubling the input means 4 times the work.' } : item) }), /takeaways\[1\] has numbers .*: 4\./],
    // The drafts' shape.
    [answer({}, { drafts: undefined }), /drafts must be an object with the strings finding, contrast and caveat/],
    [answer({}, { drafts: 'x' }), /drafts must be an object/],
    [drafts({ finding: '' }), /drafts\.finding must not be empty/],
    [drafts({ finding: null }), /drafts\.finding must not be empty/],
    [drafts({ finding: 7 }), /drafts\.finding must be a string/],
    [drafts({ caveat: FINDING }), /drafts\.caveat must differ from drafts\.finding, or be ""/],
    // Lengths, by destination.
    [drafts({ finding: 'Too short.\n\nStill short.' }), /^Error: drafts\.finding has 4 words; allowed 120–300\.$/],
    [drafts({ finding: `${FINDING} ${'more '.repeat(200)}` }), /drafts\.finding has 338 words; allowed 120–300/],
    [drafts({ finding: `${FINDING}\n\n${'Extraordinarily '.repeat(150)}` }), /drafts\.finding has 3\d{3} characters; allowed at most 3000/],
    [drafts({ finding: FINDING.replaceAll('\n\n', ' ') }), /drafts\.finding has 1 paragraphs; use 3–8 separated by blank lines/],
    [drafts({ finding: `${'A very long opening line '.repeat(6)}\n\n${FINDING}` }), /The first line of drafts\.finding has 149 characters; allowed at most 140/],
    [drafts({ caveat: 'Too short.\n\nStill short.' }), /drafts\.caveat has 4 words/],
    // What a draft may not contain.
    [drafts({ finding: `${FINDING} #attention` }), /drafts\.finding must not contain hashtags/],
    [drafts({ finding: `${FINDING} See www.example.org now.` }), /drafts\.finding must not contain links/],
    [drafts({ finding: FINDING.replace('The catch', '**The** catch') }), /without Markdown/],
    [drafts({ finding: `${FINDING}\n- one more point` }), /without Markdown/],
    [drafts({ finding: `${FINDING}\n2. one more point` }), /without Markdown/],
    [drafts({ finding: withLine('The pageText says so.') }), /drafts\.finding must not mention pageText/],
    [drafts({ finding: withLine('Your readerTake fits here.') }), /drafts\.finding must not mention pageText/],
    [drafts({ finding: `${FINDING}\n\nI think this matters for long documents.` }), /drafts\.finding must not use the first person \("I think"\); only readerTake speaks for the reader/],
    [drafts({ finding: withLine('My worry is cost.') }), /first person \("My"\)/],
    [drafts({ finding: withLine("I've seen the cost.") }), /first person \("I've"\)/],
    [drafts({ caveat: withLine('Isso me preocupa.') }), /drafts\.caveat must not use the first person \("me"\)/],
    [drafts({ finding: `${FINDING}\n\nWhat do you think` }), /drafts\.finding must not ask for comments, likes or shares/],
    [drafts({ finding: `${FINDING}\n\nFollow for more on attention.` }), /must not ask for comments/],
    [drafts({ finding: `${FINDING}\n\nWill sparse patterns be enough?` }), /drafts\.finding must end on the point, not on a question/],
    [drafts({ finding: withLine('The authors write “the cost grows with the cube of the length” here.') }), /drafts\.finding quotes words that are not in highlight or pageText: “the cost grows with the cube of the length”/],
    // Numbers the source does not state, in a draft; the page number is in the source.
    [drafts({ finding: withLine('The catch is cost: 4 times the work on page 2.') }), /^Error: drafts\.finding has numbers that are not in highlight, pageText, title, credit, page or readerTake: 4\. Use only numbers stated there\.$/],
    [drafts({ caveat: CAVEAT.replace('The catch is cost.', 'Since 2017 the catch is cost.') }), /drafts\.caveat has numbers .*: 2017\./],
    // Hashtags and the answer as a whole.
    [answer({}, { hashtags: ['attention', 'research'] }), /hashtags has 2 items/],
    [answer({}, { hashtags: ['attention', 'good practice', 'research'] }), /hashtag "good practice"/],
    [answer({}, { hashtags: ['attention', 'Attention', 'research'] }), /must not repeat/],
    [answer({}, { hashtags: 'attention' }), /hashtags must be a list/],
    ['[1,2]', /must be one JSON object/],
    ['x'.repeat(40_001), /The answer has 40001 characters; allowed at most 40000/],
  ]
  for (const [raw, reason] of cases) assert.throws(() => parseShareCardAnswer(raw, source, options), reason, String(reason))

  // Null optional fields mean empty; hashtags may carry a leading #; a short quotation or one copied exactly may stand.
  const parsed = parseShareCardAnswer(answer({ emphasis: null, pull: null, topic: ' Machine   learning ' },
    { hashtags: ['#attention', 'ml', 'research_2'], drafts: { finding: withLine('The authors write “the cost grows with the square of the sequence length” here, and call it “my favourite trick”.'), contrast: null } }), source, options)
  assert.equal(parsed.card.emphasis, ''); assert.equal(parsed.card.pull, ''); assert.equal(parsed.card.topic, 'Machine learning')
  assert.deepEqual(parsed.hashtags, ['attention', 'ml', 'research_2'])
  assert.deepEqual({ contrast: parsed.drafts.contrast, caveat: parsed.drafts.caveat }, { contrast: '', caveat: '' })
  // A number from the title or credit, and a Type I error, pass.
  parseShareCardAnswer(drafts({ finding: withLine('The catch is cost, as in 2017, without a Type I error in sight.') }), { ...source, credit: 'Vaswani et al., 2017' }, options)
  // A change may shorten a draft to a single paragraph.
  const short = 'Reach costs more than it looks. The price grows with the square of the input length.'
  assert.equal(parseShareCardAnswer(drafts({ finding: short }), source, { ...options, changed: true }).drafts.finding, short)
  assert.throws(() => parseShareCardAnswer(drafts({ finding: short }), source, options), /drafts\.finding has 16 words; allowed 120–300/)
  // A fixed quote replaces whatever the model returned.
  const fixed = parseShareCardAnswer(answer({ quote: 'anything at all', emphasis: 'square of' }), source, { ...options, fixedQuote: { quote: 'the square of the sequence', edited: false } })
  assert.equal(fixed.card.quote, 'the square of the sequence')
})

test('drafts follow the limits of their destination', () => {
  const source = { passage: PASSAGE, context: 'We suspect that sparse patterns may reduce this cost.', title: 'Attention Is All You Need', credit: '', page: 2, url: URL }
  const x = { destination: 'x' as const, take: '', changed: false }
  const xDrafts = (finding: string) => drafts({ finding, caveat: '' })
  assert.equal(parseShareCardAnswer(xDrafts(X_FINDING), source, x).drafts.finding, X_FINDING)
  // X keeps room for the link the app appends; without a link the whole 280 characters are the draft's.
  const long = 'Attention '.repeat(26).trim()
  assert.throws(() => parseShareCardAnswer(xDrafts(long), source, x), /drafts\.finding has 259 characters; allowed at most 255/)
  parseShareCardAnswer(xDrafts(long), { ...source, url: '' }, x)
  assert.throws(() => parseShareCardAnswer(xDrafts(FINDING), source, x), /drafts\.finding has 1\d\d words; allowed 8–60/)
  assert.throws(() => parseShareCardAnswer(xDrafts(`${X_FINDING}\n\nOne.\n\nTwo more words.`), source, x), /drafts\.finding has 3 paragraphs; use 1–2/)
  // Instagram: 80–200 words, a first line of at most 125 characters.
  const instagram = { destination: 'instagram' as const, take: '', changed: false }
  parseShareCardAnswer(answer(), source, instagram)
  assert.throws(() => parseShareCardAnswer(drafts({ finding: `${'A long opening line '.repeat(7)}\n\n${FINDING}` }), source, instagram), /first line of drafts\.finding has 139 characters; allowed at most 125/)
  assert.throws(() => parseShareCardAnswer(drafts({ caveat: `${CAVEAT} ${'more '.repeat(70)}` }), source, instagram), /drafts\.caveat has 2\d\d words; allowed 80–200/)
  assert.equal(DRAFT.instagram.maxWords, 200)
})

test('with a take, every draft carries it word for word as its own paragraph and only the take speaks in the first person', () => {
  const source = { passage: PASSAGE, context: 'We suspect that sparse patterns may reduce this cost.', title: 'Attention Is All You Need', credit: '', page: 2, url: URL }
  const take = 'This is why my long-context runs feel slow, and 3 retries rarely help.'
  const options = { destination: 'linkedin' as const, take, changed: false }
  const parsed = parseShareCardAnswer(drafts({ finding: `${FINDING}\n\n${take}`, caveat: `${CAVEAT}\n\n${take}` }), source, options)
  assert.ok(parsed.drafts.finding.endsWith(take))
  // The take may lead, longer than the hook limit; its whitespace is compared collapsed.
  const longTake = `${take} ${'It is the price of reach. '.repeat(3)}`.trim()
  assert.ok(longTake.length > DRAFT.linkedin.hookMax)
  parseShareCardAnswer(drafts({ finding: `${longTake}\n\n${FINDING}`, caveat: '' }), source, { ...options, take: `  ${longTake.replaceAll(' ', '  ')} ` })
  assert.throws(() => parseShareCardAnswer(drafts({ finding: `${FINDING}\n\n${take}` }), source, options), /^Error: drafts\.caveat must contain readerTake word for word as a paragraph of its own\.$/)
  assert.throws(() => parseShareCardAnswer(drafts({ finding: `${FINDING}\n\n${take.replace('rarely', 'seldom')}`, caveat: '' }), source, options), /drafts\.finding must contain readerTake/)
  assert.throws(() => parseShareCardAnswer(drafts({ finding: `${FINDING} ${take}`, caveat: '' }), source, options), /drafts\.finding must contain readerTake/)
  assert.throws(() => parseShareCardAnswer(drafts({ finding: `${FINDING}\n\nI agree.\n\n${take}`, caveat: '' }), source, options), /first person \("I agree"\)/)
  // The take's numbers are allowed elsewhere, and a take may end on a question.
  parseShareCardAnswer(drafts({ finding: `${FINDING.replace('The catch is cost.', 'The catch is cost, even after 3 retries.')}\n\n${take}`, caveat: '' }), source, options)
  parseShareCardAnswer(drafts({ finding: `${FINDING}\n\nIs reach worth it?`, caveat: '' }), source, { ...options, take: 'Is reach worth it?' })
  // On X the take raises the limits and needs a lead-in.
  const x = { destination: 'x' as const, take, changed: false }
  parseShareCardAnswer(drafts({ finding: `${X_FINDING}\n\n${take}`, caveat: '' }), source, x)
  assert.throws(() => parseShareCardAnswer(drafts({ finding: take, caveat: '' }), source, x), /drafts\.finding has 1 paragraphs; use 2–2/)
})

test('the page context leads with the highlight page and fills the rest from its neighbours', () => {
  const pages = new Map([[1, 'a'.repeat(9000)], [2, 'b'.repeat(4000)], [3, 'c'.repeat(9000)]])
  const context = pageContext(pages, 2)
  assert.equal(context.length, 12_000)
  assert.match(context, /^a{3998}\n\nb{4000}\n\nc{3998}$/)
  assert.equal(pageContext(new Map([[2, 'b'.repeat(13_000)]]), 2).length, 12_000)
  assert.equal(pageContext(new Map([[1, 'short'], [2, 'own'], [3, 'c'.repeat(20_000)]]), 2).length, 12_000)
  assert.equal(pageContext(new Map(), 5), '')
})

test('requests are idempotent, one post per highlight, and at most two generations run at once', async () => {
  const s = await setup()
  try {
    s.delay(400)
    const [a, b, c] = [await s.highlight(), await s.highlight(), await s.highlight()]
    const payload = { request_id: randomUUID(), annotation_id: a }
    const first = await s.app.inject({ method: 'POST', url: s.base, payload }); assert.equal(first.statusCode, 202)
    const id = (first.json() as ShareCardRecord).id
    const again = await s.app.inject({ method: 'POST', url: s.base, payload }); assert.equal(again.statusCode, 200); assert.equal(again.json().id, id)
    const reused = await s.app.inject({ method: 'POST', url: s.base, payload: { ...payload, annotation_id: b } })
    assert.equal(reused.statusCode, 409); assert.equal(reused.json().detail, 'This request ID was already used for another post.')
    const same = await s.create(a); assert.equal(same.statusCode, 200); assert.equal(same.json().id, id)
    assert.equal((await s.create(b)).statusCode, 202)
    const busy = await s.create(c); assert.equal(busy.statusCode, 429); assert.equal(busy.json().detail, 'pdfpal is busy writing posts. Try again shortly.')
    assert.equal((s.db.prepare('SELECT COUNT(*) n FROM share_cards').get() as { n: number }).n, 2)
    await s.settle(id)
    assert.equal(s.callCount(), 2)
    assert.equal((await s.app.inject({ method: 'POST', url: s.base, payload: { request_id: 'nope', annotation_id: a } })).statusCode, 400)
    assert.equal((await s.app.inject({ method: 'POST', url: s.base, payload: { ...payload, request_id: randomUUID(), extra: 1 } })).statusCode, 400)
    assert.equal((await s.create('missing')).statusCode, 404)
  } finally { await s.close() }
})

test('passages outside the limits and non-PDF sources are refused without a request', async () => {
  const s = await setup()
  try {
    const short = await s.create(await s.highlight('Too short.'))
    assert.equal(short.statusCode, 422); assert.equal(short.json().detail, 'Highlight a longer passage to make a post.')
    const long = await s.create(await s.highlight('word '.repeat(1300)))
    assert.equal(long.statusCode, 422); assert.equal(long.json().detail, 'Highlight a shorter passage to make a post.')
    const kindle = await s.highlight()
    s.db.prepare("UPDATE sources SET type='kindle' WHERE id=?").run(s.source)
    const refused = await s.create(kindle); assert.equal(refused.statusCode, 422); assert.equal(refused.json().detail, 'Posts can be made from PDF highlights only.')
    assert.equal(s.callCount(), 0)
  } finally { await s.close() }
})

test('a short passage is the quote whatever the model returns', async () => {
  const s = await setup()
  try {
    const text = 'Long documents become\nexpensive quickly.'
    s.respond(1, answer({ quote: 'Something else entirely', emphasis: 'expensive', pull: '' }))
    const record = await s.post(await s.highlight(text))
    assert.equal(record.status, 'complete'); assert.equal(s.callCount(), 1)
    assert.equal(record.card!.quote, 'Long documents become expensive quickly.'); assert.equal(record.card!.quoteEdited, false)
    assert.equal(s.input(1).fixedQuote, 'Long documents become expensive quickly.')
  } finally { await s.close() }
})

test('change keeps style and look behind Undo; restyle waits; cancel and retry; edits', async () => {
  const s = await setup()
  try {
    const first = await s.post()
    const url = `${s.base}/${first.id}`
    const restyled = (await s.app.inject({ method: 'PATCH', url, payload: { style: 'takeaways', look: 'marker' } })).json() as ShareCardRecord
    assert.equal(restyled.card!.style, 'takeaways'); assert.equal(restyled.card!.look, 'marker'); assert.equal(restyled.can_undo, false)
    assert.equal((await s.app.inject({ method: 'PATCH', url, payload: { style: 'poster', look: 'ink' } })).statusCode, 400)
    assert.equal((await s.app.inject({ method: 'PATCH', url, payload: { style: 'page', look: 'ink', caption: 'x' } })).statusCode, 400)

    s.respond(2, drafts({ finding: 'Reach costs more than it looks. The price grows with the square of the input length.', caveat: '' }, { headline: 'Quadratic reach, briefly' }))
    s.delay(300, 2)
    const changing = await s.app.inject({ method: 'POST', url: `${url}/change`, payload: { instruction: 'Make it shorter' } })
    assert.equal(changing.statusCode, 202)
    assert.equal((await s.app.inject({ method: 'PATCH', url, payload: { style: 'quote', look: 'ink' } })).json().detail, 'Wait for the current version or cancel it first.')
    assert.equal((await s.app.inject({ method: 'POST', url: `${url}/change`, payload: { instruction: 'Again' } })).statusCode, 409)
    assert.equal((await s.app.inject({ method: 'POST', url: `${url}/undo`, payload: {} })).statusCode, 409)
    assert.equal((await s.app.inject({ method: 'POST', url: `${url}/retry`, payload: {} })).statusCode, 409)
    assert.equal((await s.app.inject({ url })).json().card.headline, CARD.headline)
    const changed = await s.settle(first.id)
    assert.equal(changed.status, 'complete'); assert.equal(changed.card!.headline, 'Quadratic reach, briefly')
    assert.equal(changed.card!.style, 'takeaways'); assert.equal(changed.card!.look, 'marker'); assert.equal(changed.can_undo, true)
    assert.equal(changed.instruction, 'Make it shorter'); assert.equal(changed.caption!.drafts.finding, 'Reach costs more than it looks. The price grows with the square of the input length.')
    // The caveat is gone from the new answer, so the angle is the finding.
    assert.equal(changed.caption!.angle, 'finding'); assert.equal(changed.caption!.drafts.caveat, '')
    const input = s.input(2)
    assert.equal(input.change, 'Make it shorter'); assert.deepEqual(input.previousDrafts, DRAFTS)
    assert.deepEqual(input.previousHashtags, HASHTAGS); assert.equal(input.previousDestination, 'linkedin')
    assert.equal(input.previousCard.headline, CARD.headline)
    assert.ok(!('style' in input.previousCard) && !('look' in input.previousCard) && !('quoteEdited' in input.previousCard) && !('crop' in input.previousCard))
    assert.equal((await s.app.inject({ method: 'POST', url: `${url}/change`, payload: { instruction: '  ' } })).statusCode, 400)
    assert.equal((await s.app.inject({ method: 'POST', url: `${url}/change`, payload: { instruction: 'x'.repeat(2001) } })).statusCode, 400)

    const undone = (await s.app.inject({ method: 'POST', url: `${url}/undo`, payload: {} })).json() as ShareCardRecord
    assert.equal(undone.card!.headline, CARD.headline); assert.deepEqual(undone.caption, caption()); assert.equal(undone.can_undo, false)
    assert.equal(undone.card!.style, 'takeaways')
    assert.equal((await s.app.inject({ method: 'POST', url: `${url}/undo`, payload: {} })).json().detail, 'There is no earlier version to return to.')

    // Cancel aborts the request; Try again runs with the stored instruction.
    s.delay(2000, 3)
    await s.app.inject({ method: 'POST', url: `${url}/change`, payload: { instruction: 'Use Portuguese' } })
    while (s.callCount() < 3) await new Promise(resolve => setTimeout(resolve, 10))
    const cancelled = (await s.app.inject({ method: 'POST', url: `${url}/cancel`, payload: {} })).json() as ShareCardRecord
    assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.card!.headline, CARD.headline)
    assert.equal((await s.app.inject({ method: 'POST', url: `${url}/cancel`, payload: {} })).json().status, 'cancelled')
    s.respond(4, drafts({ finding: 'Atenção completa custa caro. O custo cresce com o quadrado do tamanho da sequência.', caveat: '' }, { headline: 'Alcance tem preço quadrático' }))
    const retried = await s.app.inject({ method: 'POST', url: `${url}/retry`, payload: {} }); assert.equal(retried.statusCode, 202)
    const after = await s.settle(first.id)
    assert.equal(after.card!.headline, 'Alcance tem preço quadrático'); assert.equal(s.input(4).change, 'Use Portuguese')
    assert.equal((await s.app.inject({ method: 'POST', url: `${url}/retry`, payload: {} })).json().detail, 'This post is already complete.')

    const edited = (await s.app.inject({ method: 'PATCH', url, payload: { caption: 'My own caption.' } })).json() as ShareCardRecord
    assert.equal(edited.caption!.edited, 'My own caption.'); assert.deepEqual(edited.caption!.drafts, after.caption!.drafts); assert.equal(edited.can_undo, true)
    assert.equal(captionText(edited.source, edited.caption!), 'My own caption.')
    assert.equal((await s.app.inject({ method: 'PATCH', url, payload: { caption: ' ' } })).statusCode, 400)

    const quote = (await s.app.inject({ method: 'PATCH', url, payload: { quote: 'the cost grows with the square of the sequence  length' } })).json() as ShareCardRecord
    assert.equal(quote.card!.quote, 'the cost grows with the square of the sequence length'); assert.equal(quote.card!.quoteEdited, false); assert.equal(quote.card!.emphasis, 'the square')
    const fixed = (await s.app.inject({ method: 'PATCH', url, payload: { quote: 'The cost grows with the sequence length squared' } })).json() as ShareCardRecord
    assert.equal(fixed.card!.quoteEdited, true); assert.equal(fixed.card!.emphasis, '')
    assert.equal((await s.app.inject({ method: 'PATCH', url, payload: { quote: 'q'.repeat(241) } })).statusCode, 400)
    // An edited quote stays the reader's through a change.
    await s.app.inject({ method: 'POST', url: `${url}/change`, payload: { instruction: 'Punchier headline' } })
    const kept = await s.settle(first.id)
    assert.equal(kept.card!.quote, 'The cost grows with the sequence length squared'); assert.equal(kept.card!.quoteEdited, true)
    assert.equal(s.input(5).fixedQuote, 'The cost grows with the sequence length squared')

    const credit = (await s.app.inject({ method: 'PATCH', url, payload: { credit: ' Vaswani  et al., 2017 ' } })).json() as ShareCardRecord
    assert.equal(credit.source.credit, 'Vaswani et al., 2017')
    assert.equal((s.db.prepare('SELECT author FROM sources WHERE id=?').get(s.source) as { author: string }).author, 'Vaswani et al., 2017')
    assert.equal((await s.app.inject({ method: 'PATCH', url, payload: { credit: 'c'.repeat(201) } })).statusCode, 400)
    // Later posts from the source start with that credit.
    const next = await s.post()
    assert.equal(next.source.credit, 'Vaswani et al., 2017'); assert.equal(s.input(s.callCount()).credit, 'Vaswani et al., 2017')

    assert.equal((await s.app.inject({ method: 'DELETE', url })).statusCode, 204)
    assert.equal((await s.app.inject({ url })).statusCode, 404)
  } finally { await s.close() }
})

test('a destination and a take set the request, the defaults and Undo; each change is one request', async () => {
  const s = await setup()
  try {
    const take = 'This is why my long-context runs feel slow.'
    const withTake = (text: string) => `${text}\n\n${take}`
    s.respond(1, drafts({ finding: withTake(FINDING), caveat: withTake(CAVEAT) }))
    const started = await s.create(await s.highlight(), { destination: 'instagram', take: `  ${take.replace(' ', '\n')} ` })
    assert.equal(started.statusCode, 202)
    const first = await s.settle((started.json() as ShareCardRecord).id), url = `${s.base}/${first.id}`
    // Instagram opens on the Headline style with hashtags shown; the take is stored as one line.
    assert.equal(first.status, 'complete'); assert.equal(first.destination, 'instagram'); assert.equal(first.take, take)
    assert.equal(first.card!.style, 'headline')
    assert.deepEqual(first.caption, caption({ destination: 'instagram', take, showTags: true, drafts: { finding: withTake(FINDING), contrast: '', caveat: withTake(CAVEAT) } }))
    assert.ok(s.prompt(1).startsWith(`${prompt('instagram', take)}\n\n{`)); assert.match(s.prompt(1), /share it on Instagram/)
    assert.equal(s.input(1).readerTake, take)
    assert.equal(captionText(first.source, first.caption!), `${withTake(FINDING)}\n\n📄 Test Source · p. 2\n${URL}\n\n#attention #transformers #research`)

    // Settings written in place, without a request.
    const crop = { x1: 0.05, y1: 0.05, x2: 0.95, y2: 0.4 }
    await s.app.inject({ method: 'PATCH', url, payload: { look: 'paper', style: 'headline' } })
    await s.app.inject({ method: 'PATCH', url, payload: { crop } })
    await s.app.inject({ method: 'PATCH', url, payload: { angle: 'caveat' } })
    await s.app.inject({ method: 'PATCH', url, payload: { link: 'comment' } })
    assert.equal(s.callCount(), 1)

    // Another destination: one request; its default style and hashtag setting; the look, crop and link stay.
    s.respond(2, drafts({ finding: withTake(X_FINDING), caveat: '' }))
    const moving = await s.app.inject({ method: 'POST', url: `${url}/change`, payload: { destination: 'x' } })
    assert.equal(moving.statusCode, 202); assert.equal((moving.json() as ShareCardRecord).destination, 'x')
    const moved = await s.settle(first.id)
    assert.equal(s.callCount(), 2)
    assert.equal(moved.status, 'complete'); assert.equal(moved.destination, 'x'); assert.equal(moved.take, take); assert.equal(moved.instruction, '')
    assert.deepEqual({ style: moved.card!.style, look: moved.card!.look, crop: moved.card!.crop }, { style: 'page', look: 'paper', crop })
    assert.deepEqual(moved.caption, caption({ destination: 'x', take, drafts: { finding: withTake(X_FINDING), contrast: '', caveat: '' }, link: 'comment' }))
    assert.equal(captionText(moved.source, moved.caption!), `${withTake(X_FINDING)}\n\n${URL}`)
    const input = s.input(2)
    assert.ok(s.prompt(2).startsWith(`${prompt('x', take)}\n\n{`)); assert.match(s.prompt(2), /share it on X, Bluesky or Threads/)
    assert.equal(input.previousDestination, 'instagram'); assert.equal(input.readerTake, take); assert.ok(!('change' in input))
    assert.deepEqual(input.previousDrafts, first.caption!.drafts)

    // Undo returns to Instagram with its take, style and angle; the crop, set since, stays.
    const undone = (await s.app.inject({ method: 'POST', url: `${url}/undo`, payload: {} })).json() as ShareCardRecord
    assert.equal(undone.destination, 'instagram'); assert.equal(undone.take, take); assert.equal(undone.caption!.destination, 'instagram')
    assert.deepEqual({ style: undone.card!.style, look: undone.card!.look, crop: undone.card!.crop }, { style: 'headline', look: 'paper', crop })
    assert.equal(undone.caption!.angle, 'caveat'); assert.equal(undone.caption!.link, 'comment')

    // Clearing the take: one request without readerTake; the destination and its style stay; the angle stays when the new answer has it.
    s.respond(3, answer())
    assert.equal((await s.app.inject({ method: 'POST', url: `${url}/change`, payload: { take: '' } })).statusCode, 202)
    const plain = await s.settle(first.id)
    assert.equal(s.callCount(), 3); assert.ok(!('readerTake' in s.input(3)))
    assert.equal(plain.take, ''); assert.equal(plain.destination, 'instagram'); assert.equal(plain.card!.style, 'headline')
    assert.equal(plain.caption!.take, ''); assert.equal(plain.caption!.angle, 'caveat'); assert.equal(plain.caption!.showTags, true)

    // An instruction with a new take, together: still one request.
    s.respond(4, drafts({ finding: withTake(FINDING), caveat: '' }))
    await s.app.inject({ method: 'POST', url: `${url}/change`, payload: { instruction: 'Warmer tone', take } })
    const both = await s.settle(first.id)
    assert.equal(s.callCount(), 4); assert.equal(both.instruction, 'Warmer tone'); assert.equal(both.take, take)
    assert.equal(s.input(4).change, 'Warmer tone'); assert.equal(s.input(4).readerTake, take)

    // A failed change keeps the last version but records the request, which Try again repeats.
    s.respond(5, 'not json'); s.respond(6, 'not json')
    await s.app.inject({ method: 'POST', url: `${url}/change`, payload: { destination: 'linkedin' } })
    const failed = await s.settle(first.id)
    assert.equal(failed.status, 'failed'); assert.equal(failed.destination, 'linkedin'); assert.equal(failed.caption!.destination, 'instagram')
    s.respond(7, drafts({ finding: withTake(FINDING), caveat: '' }))
    await s.app.inject({ method: 'POST', url: `${url}/retry`, payload: {} })
    const retried = await s.settle(first.id)
    assert.match(s.prompt(7), /share it on LinkedIn/); assert.equal(retried.caption!.destination, 'linkedin'); assert.equal(retried.card!.style, 'page')
    assert.equal(retried.caption!.showTags, false); assert.equal(retried.instruction, '')

    // Refusals, without a request.
    for (const [payload, detail] of [[{}, 'Describe the change, or choose another destination or take.'], [{ take: 't'.repeat(401) }, 'A take has at most 400 characters.'],
      [{ instruction: ' ' }, 'Describe the change in 1–2,000 characters.']] as const) {
      const response = await s.app.inject({ method: 'POST', url: `${url}/change`, payload })
      assert.equal(response.statusCode, 400); assert.equal(response.json().detail, detail)
    }
    for (const payload of [{ destination: 'facebook' }, { take: 7 }, { instruction: 'x', extra: 1 }])
      assert.equal((await s.app.inject({ method: 'POST', url: `${url}/change`, payload })).statusCode, 400)
    assert.equal((await s.create(await s.highlight(), { destination: 'facebook' })).statusCode, 400)
    const tooLong = await s.create(await s.highlight(), { take: 't'.repeat(401) })
    assert.equal(tooLong.statusCode, 400); assert.equal(tooLong.json().detail, 'A take has at most 400 characters.')
    assert.equal(s.callCount(), 7)
  } finally { await s.close() }
})

test('crop, angle, hashtags, link and headline edits; none makes a request', async () => {
  const s = await setup()
  try {
    const first = await s.post(), url = `${s.base}/${first.id}`
    const patch = (payload: unknown) => s.app.inject({ method: 'PATCH', url, payload })
    const crop = { x1: 0.1, y1: 0.05, x2: 0.9, y2: 0.3 }
    const cropped = (await patch({ crop })).json() as ShareCardRecord
    assert.deepEqual(cropped.card!.crop, crop); assert.equal(cropped.can_undo, false)
    for (const bad of [{ ...crop, x2: 0.1 }, { ...crop, y1: 0.3 }]) {
      const response = await patch({ crop: bad }); assert.equal(response.statusCode, 400); assert.equal(response.json().detail, 'A crop needs x1 < x2 and y1 < y2.')
    }
    for (const bad of [{ ...crop, x2: 1.2 }, { x1: 0, y1: 0, x2: 1 }, { ...crop, extra: 1 }, 'auto']) assert.equal((await patch({ crop: bad })).statusCode, 400)
    assert.equal(((await patch({ crop: null })).json() as ShareCardRecord).card!.crop, null)

    const refused = await patch({ angle: 'contrast' })
    assert.equal(refused.statusCode, 400); assert.equal(refused.json().detail, 'This post has no draft for that angle.')
    assert.equal((await patch({ angle: 'summary' })).statusCode, 400)
    await patch({ caption: 'My own words.' })
    const angled = (await patch({ angle: 'caveat' })).json() as ShareCardRecord
    assert.equal(angled.caption!.angle, 'caveat'); assert.equal(angled.caption!.edited, null)
    assert.ok(captionText(angled.source, angled.caption!).startsWith(CAVEAT))

    const tagged = (await patch({ show_tags: true })).json() as ShareCardRecord
    assert.equal(tagged.caption!.showTags, true); assert.ok(captionText(tagged.source, tagged.caption!).endsWith('#attention #transformers #research'))
    assert.equal((await patch({ show_tags: 'yes' })).statusCode, 400)
    const held = (await patch({ link: 'comment' })).json() as ShareCardRecord
    assert.equal(held.caption!.link, 'comment'); assert.equal(captionText(held.source, held.caption!).includes(URL), false)
    assert.equal((await patch({ link: 'bio' })).statusCode, 400)
    assert.equal((await patch({ link: 'post', show_tags: true })).statusCode, 400)

    // The reader's headline: their words, numbers allowed, behind Undo.
    const headline = (await patch({ headline: '  2023 was   the year of long contexts ' })).json() as ShareCardRecord
    assert.equal(headline.card!.headline, '2023 was the year of long contexts'); assert.equal(headline.can_undo, true)
    for (const bad of [' ', 'h'.repeat(81)]) {
      const response = await patch({ headline: bad }); assert.equal(response.statusCode, 400); assert.equal(response.json().detail, 'A headline needs 1–80 characters.')
    }
    assert.equal(((await patch({ headline: 'h'.repeat(80) })).json() as ShareCardRecord).card!.headline.length, 80)
    const undone = (await s.app.inject({ method: 'POST', url: `${url}/undo`, payload: {} })).json() as ShareCardRecord
    assert.equal(undone.card!.headline, '2023 was the year of long contexts')
    assert.equal(s.callCount(), 1)

    // Nothing changes a post while a version is being written, or before it has one.
    s.delay(300, 2)
    await s.app.inject({ method: 'POST', url: `${url}/change`, payload: { instruction: 'Shorter' } })
    for (const payload of [{ crop }, { angle: 'finding' }, { show_tags: false }, { link: 'post' }, { headline: 'New' }]) {
      const response = await patch(payload); assert.equal(response.statusCode, 409); assert.equal(response.json().detail, 'Wait for the current version or cancel it first.')
    }
    await s.settle(first.id)
    s.fail(3)
    const failed = await s.post()
    assert.equal(failed.status, 'failed')
    const none = await s.app.inject({ method: 'PATCH', url: `${s.base}/${failed.id}`, payload: { crop } })
    assert.equal(none.statusCode, 409); assert.equal(none.json().detail, 'This post has no completed version yet.')
  } finally { await s.close() }
})

test('choosing an angle keeps an Undo step only when it clears the reader\'s edited text', async () => {
  const s = await setup()
  try {
    const first = await s.post(), url = `${s.base}/${first.id}`
    const patch = async (payload: unknown) => (await s.app.inject({ method: 'PATCH', url, payload })).json() as ShareCardRecord
    // Without edited text the angle is written in place: no Undo step appears.
    const plain = await patch({ angle: 'caveat' })
    assert.equal(plain.caption!.angle, 'caveat'); assert.equal(plain.can_undo, false)
    assert.equal((await patch({ angle: 'finding' })).can_undo, false)

    // With edited text the angle clears it, and Undo brings the reader's words back.
    const edited = await patch({ caption: 'My own words.' })
    assert.equal(edited.caption!.edited, 'My own words.')
    const angled = await patch({ angle: 'caveat' })
    assert.equal(angled.caption!.edited, null); assert.equal(angled.caption!.angle, 'caveat'); assert.equal(angled.can_undo, true)
    const undone = (await s.app.inject({ method: 'POST', url: `${url}/undo`, payload: {} })).json() as ShareCardRecord
    assert.equal(undone.caption!.edited, 'My own words.'); assert.equal(undone.caption!.angle, 'finding')
    assert.equal(captionText(undone.source, undone.caption!), 'My own words.')
    assert.equal(s.callCount(), 1)
  } finally { await s.close() }
})

test('marks are every highlight now on the post\'s page, read live', async () => {
  const s = await setup()
  try {
    const own = await s.highlight()
    const first = await s.post(own), url = `${s.base}/${first.id}`
    const ownRects = first.source.rects
    const other = await s.highlight(HIGHLIGHT, { color: 'pink', rects: [{ x1: 0.2, y1: 0.5, x2: 0.7, y2: 0.52 }] })
    await s.highlight(HIGHLIGHT, { page_number: 3, color: 'blue' })
    // A highlight made before per-line boxes is drawn with its bounding box.
    const old = await s.highlight(HIGHLIGHT, { color: 'purple', rects: undefined, x1: 0.1, y1: 0.7, x2: 0.5, y2: 0.75 })
    const marks = () => s.app.inject({ url }).then(response => (response.json() as ShareCardRecord).marks)
    assert.deepEqual(await marks(), [{ rects: ownRects, color: 'green' }, { rects: [{ x1: 0.2, y1: 0.5, x2: 0.7, y2: 0.52 }], color: 'pink' },
      { rects: [{ x1: 0.1, y1: 0.7, x2: 0.5, y2: 0.75 }], color: 'yellow' }])
    await s.app.inject({ method: 'PATCH', url: `/api/projects/${s.project.id}/sources/${s.source}/annotations/${own}`, payload: { color: 'blue' } })
    assert.equal((await marks())[0]!.color, 'blue')
    // The post's own highlight deleted: its stored boxes stand in; the others stay live.
    for (const id of [own, old]) await s.app.inject({ method: 'DELETE', url: `/api/projects/${s.project.id}/sources/${s.source}/annotations/${id}` })
    assert.deepEqual(await marks(), [{ rects: ownRects, color: 'green' }, { rects: [{ x1: 0.2, y1: 0.5, x2: 0.7, y2: 0.52 }], color: 'pink' }])
    assert.ok(other)
    // The source deleted: only the stored boxes are left.
    await s.app.inject({ method: 'DELETE', url: `/api/projects/${s.project.id}/sources/${s.source}` })
    assert.deepEqual(await marks(), [{ rects: ownRects, color: 'green' }])
  } finally { await s.close() }
})

test('a stale job never overwrites a newer one, and a restart fails what was running', async () => {
  const s = await setup()
  try {
    s.delay(300)
    const started = (await s.create(await s.highlight())).json() as ShareCardRecord
    // A newer generation took over the row (as a change or retry would) while this job was still waiting.
    await new Promise(resolve => setTimeout(resolve, 100))
    s.db.prepare("UPDATE share_cards SET attempt='newer' WHERE id=?").run(started.id)
    await new Promise(resolve => setTimeout(resolve, 600))
    const row = s.db.prepare('SELECT status,card_json FROM share_cards WHERE id=?').get(started.id) as { status: string; card_json: string | null }
    assert.equal(row.card_json, null); assert.equal(row.status, 'running')
    // A fresh process has no job for it: reading the post fails it, and Try again works.
    const restarted = new ShareCardService(s.db, s.config)
    const failed = restarted.get(s.project.id, started.id)
    assert.equal(failed.status, 'failed'); assert.equal(failed.error, 'pdfpal restarted before this post finished. Use Try again.')
    s.delay(20)
    const retried = (await s.app.inject({ method: 'POST', url: `${s.base}/${started.id}/retry`, payload: {} }))
    assert.equal(retried.statusCode, 202)
    assert.equal((await s.settle(started.id)).status, 'complete')
    await restarted.close()
  } finally { await s.close() }
})

test('a post outlives its highlight and source, and restoring them reconnects it', async () => {
  const s = await setup()
  try {
    const annotation = await s.highlight()
    const record = await s.post(annotation)
    const link = () => s.db.prepare('SELECT source_id,annotation_id FROM share_cards WHERE id=?').get(record.id) as { source_id: string | null; annotation_id: string | null }
    const restoreLatest = async () => {
      const trash = (await s.app.inject({ url: '/api/recovery/trash' })).json() as Array<{ id: string }>
      const response = await s.app.inject({ method: 'POST', url: `/api/recovery/trash/${trash[0]!.id}/restore`, payload: {} })
      assert.equal(response.statusCode, 200, response.body)
      return response.json() as { linksSkipped: number }
    }

    assert.equal((await s.app.inject({ method: 'DELETE', url: `/api/projects/${s.project.id}/sources/${s.source}/annotations/${annotation}` })).statusCode, 204)
    assert.deepEqual(link(), { source_id: s.source, annotation_id: null })
    assert.equal((await s.app.inject({ url: `${s.base}/${record.id}` })).json().card.headline, CARD.headline)
    assert.equal((await restoreLatest()).linksSkipped, 0)
    assert.deepEqual(link(), { source_id: s.source, annotation_id: annotation })

    assert.equal((await s.app.inject({ method: 'DELETE', url: `/api/projects/${s.project.id}/sources/${s.source}` })).statusCode, 200)
    assert.deepEqual(link(), { source_id: null, annotation_id: null })
    assert.equal((await s.app.inject({ url: s.base })).json()[0].id, record.id)
    assert.equal((await restoreLatest()).linksSkipped, 0)
    assert.deepEqual(link(), { source_id: s.source, annotation_id: annotation })

    assert.equal((await s.app.inject({ method: 'DELETE', url: `/api/projects/${s.project.id}` })).statusCode, 200)
    assert.equal((s.db.prepare('SELECT COUNT(*) n FROM share_cards').get() as { n: number }).n, 0)
    assert.equal((await restoreLatest()).linksSkipped, 0)
    assert.deepEqual(link(), { source_id: s.source, annotation_id: annotation })
    assert.deepEqual((await s.app.inject({ url: `${s.base}/${record.id}` })).json(), record)
  } finally { await s.close() }
})

// Posts from a region of a page or from the first page: the reader drew a box; the assistant sees only text.
const REGION = { x1: 0.1, y1: 0.4, x2: 0.9, y2: 0.75 }
const REGION_CARD = { headline: 'Longer inputs cost far more', topic: 'Attention' }
const regionAnswer = (extra: Record<string, unknown> = {}) => JSON.stringify({ ...REGION_CARD, drafts: DRAFTS, hashtags: HASHTAGS, ...extra })
const regionCard = (extra: Record<string, unknown> = {}) => ({
  quote: '', quoteEdited: false, emphasis: '', pull: '', takeawaysTitle: '', takeaways: [], style: 'page', look: 'ink', crop: REGION, set: null, ...REGION_CARD, ...extra,
})
const regionPrompt = (kind: SourceKind, destination: Destination = 'linkedin') => sharePostPrompt(destination, draftLimits(destination, { url: URL }), kind)

async function regionSetup() {
  const s = await setup()
  const body = (extra: Record<string, unknown> = {}) => ({ request_id: randomUUID(), source_id: s.source, page: 3, region: REGION, text: ' Sequence\nlength   Cost ', kind: 'region', ...extra })
  const start = (extra: Record<string, unknown> = {}) => s.app.inject({ method: 'POST', url: s.base, payload: body(extra) })
  s.respond(1, regionAnswer())
  return { ...s, body, start }
}

test('a region of a page becomes a post from its text alone, with the region as its crop', async () => {
  const s = await regionSetup()
  try {
    const payload = s.body()
    const response = await s.app.inject({ method: 'POST', url: s.base, payload }); assert.equal(response.statusCode, 202, response.body)
    const record = await s.settle((response.json() as ShareCardRecord).id)
    assert.equal(record.status, 'complete'); assert.equal(s.callCount(), 1)
    assert.equal(record.annotation_id, null); assert.equal(record.source_id, s.source)
    assert.deepEqual(record.source, {
      version: 1, kind: 'region', passage: 'Sequence length Cost', page: 3, rects: [], color: 'yellow', region: REGION, items: [],
      context: record.source.context, title: 'Test Source', credit: '', url: URL,
    })
    assert.match(record.source.context, /^Attention lets every position.*\n\nPage three compares results\.\n\nPage four is out of range\.$/)
    assert.deepEqual(record.card, regionCard())
    assert.deepEqual(record.caption, caption())
    assert.deepEqual(record.marks, [])
    const sent = s.prompt(1), input = s.input(1)
    assert.ok(sent.startsWith(`${regionPrompt('region')}\n\n{`))
    assert.match(sent, /selected a region of the page/); assert.match(sent, /Figure 3/); assert.doesNotMatch(sent, /fixedQuote|takeawaysTitle/)
    assert.deepEqual(Object.keys(input).sort(), ['credit', 'page', 'pageText', 'regionText', 'title'])
    assert.equal(input.regionText, 'Sequence length Cost'); assert.equal(input.page, 3); assert.equal(input.pageText, record.source.context)
    const list = (await s.app.inject({ url: `${s.base}?source_id=${s.source}` })).json()
    assert.deepEqual(list, [{ id: record.id, status: 'complete', annotation_id: null, source_id: s.source, page: 3, kind: 'region', title: REGION_CARD.headline, updated_at: record.updated_at }])

    // A highlight on the page shows as a mark; the region itself is not one.
    await s.highlight(HIGHLIGHT, { page_number: 3, color: 'pink', rects: [{ x1: 0.2, y1: 0.5, x2: 0.7, y2: 0.52 }] })
    assert.deepEqual((await s.app.inject({ url: `${s.base}/${record.id}` })).json().marks, [{ rects: [{ x1: 0.2, y1: 0.5, x2: 0.7, y2: 0.52 }], color: 'pink' }])

    // Only the request ID makes a retry idempotent: the same region again is a second post.
    const again = await s.app.inject({ method: 'POST', url: s.base, payload }); assert.equal(again.statusCode, 200); assert.equal(again.json().id, record.id)
    const reused = await s.app.inject({ method: 'POST', url: s.base, payload: { ...payload, page: 2 } })
    assert.equal(reused.statusCode, 409); assert.equal(reused.json().detail, 'This request ID was already used for another post.')
    s.fail(2)
    const second = await s.start(); assert.equal(second.statusCode, 202)
    const failed = await s.settle((second.json() as ShareCardRecord).id)
    assert.notEqual(failed.id, record.id); assert.equal(failed.status, 'failed')
    // Without a headline yet, the list names it by its page.
    assert.equal(((await s.app.inject({ url: s.base })).json() as Array<{ id: string; title: string }>).find(item => item.id === failed.id)!.title, 'Region on p. 3')
  } finally { await s.close() }
})

test('the first page becomes a post about the paper, on the destination\'s default style', async () => {
  const s = await regionSetup()
  try {
    const top = { x1: 0, y1: 0, x2: 1, y2: 0.5 }
    s.respond(1, regionAnswer({ headline: 'Attention alone can model a sequence' }))
    const response = await s.start({ kind: 'paper', page: 1, region: top, text: 'Test Source. Page one introduces the model.', destination: 'instagram' })
    assert.equal(response.statusCode, 202, response.body)
    const record = await s.settle((response.json() as ShareCardRecord).id)
    assert.equal(record.source.kind, 'paper'); assert.deepEqual(record.source.region, top); assert.equal(record.source.passage, 'Test Source. Page one introduces the model.')
    assert.equal(record.card!.style, 'headline'); assert.deepEqual(record.card!.crop, top); assert.equal(record.caption!.showTags, true)
    assert.ok(s.prompt(1).startsWith(`${regionPrompt('paper', 'instagram')}\n\n{`))
    assert.match(s.prompt(1), /sharing the paper itself/); assert.match(s.prompt(1), /what the paper studied and its main result/)
    assert.equal(s.input(1).regionText, 'Test Source. Page one introduces the model.')
    const [summary] = (await s.app.inject({ url: s.base })).json() as Array<{ kind: string; title: string }>
    assert.deepEqual({ kind: summary!.kind, title: summary!.title }, { kind: 'paper', title: 'Attention alone can model a sequence' })
    // An empty region text is allowed: the page text carries the post.
    s.respond(2, regionAnswer())
    const empty = await s.settle(((await s.start({ kind: 'paper', page: 1, region: top, text: '' })).json() as ShareCardRecord).id)
    assert.equal(empty.status, 'complete'); assert.equal(empty.source.passage, ''); assert.equal(s.input(2).regionText, '')
  } finally { await s.close() }
})

test('a region post keeps its region as the crop, refuses text cards and quote edits, and changes in one request', async () => {
  const s = await regionSetup()
  try {
    const first = await s.settle(((await s.start()).json() as ShareCardRecord).id), url = `${s.base}/${first.id}`
    const patch = (payload: unknown) => s.app.inject({ method: 'PATCH', url, payload })
    const moved = { x1: 0.05, y1: 0.3, x2: 0.95, y2: 0.8 }
    assert.deepEqual(((await patch({ crop: moved })).json() as ShareCardRecord).card!.crop, moved)
    assert.deepEqual(((await patch({ crop: null })).json() as ShareCardRecord).card!.crop, REGION)
    for (const style of ['quote', 'idea', 'takeaways']) {
      const refused = await patch({ style, look: 'ink' }); assert.equal(refused.statusCode, 400); assert.equal(refused.json().detail, REGION_STYLE_REFUSED)
    }
    assert.equal(((await patch({ style: 'headline', look: 'marker' })).json() as ShareCardRecord).card!.style, 'headline')
    const quote = await patch({ quote: 'Sequence length' })
    assert.equal(quote.statusCode, 400); assert.equal(quote.json().detail, 'A post made from a region has no quote to edit.')
    assert.equal(((await patch({ headline: 'My own headline' })).json() as ShareCardRecord).card!.headline, 'My own headline')
    await patch({ crop: moved })

    s.respond(2, regionAnswer({ headline: 'Cost grows with length', quote: 'ignored', takeaways: [{ title: 'ignored', detail: 'ignored' }], drafts: { finding: X_FINDING, contrast: '', caveat: '' } }))
    await s.app.inject({ method: 'POST', url: `${url}/change`, payload: { instruction: 'Shorter', destination: 'x' } })
    const changed = await s.settle(first.id)
    assert.equal(s.callCount(), 2); assert.equal(changed.status, 'complete')
    assert.deepEqual(changed.card, regionCard({ headline: 'Cost grows with length', crop: moved, style: 'page', look: 'marker' }))
    const input = s.input(2)
    assert.deepEqual(input.previousCard, { headline: 'My own headline', topic: 'Attention' }); assert.equal(input.change, 'Shorter')
    assert.ok(s.prompt(2).startsWith(`${regionPrompt('region', 'x')}\n\n{`))
    // Undo returns to LinkedIn and the Headline style; the crop set since stays.
    const undone = (await s.app.inject({ method: 'POST', url: `${url}/undo`, payload: {} })).json() as ShareCardRecord
    assert.equal(undone.destination, 'linkedin'); assert.equal(undone.card!.style, 'headline'); assert.deepEqual(undone.card!.crop, moved)
  } finally { await s.close() }
})

test('a region post is refused without a request when its region, page, source or text is out of bounds', async () => {
  const s = await regionSetup()
  try {
    const refuse = async (extra: Record<string, unknown>, status: number, detail?: string) => {
      const response = await s.start(extra)
      assert.equal(response.statusCode, status, `${JSON.stringify(extra)} ${response.body}`)
      if (detail) assert.equal(response.json().detail, detail)
    }
    const small = 'A region needs x1 < x2 and y1 < y2 inside the page, and at least 5% of the page in each direction.'
    await refuse({ region: { ...REGION, x2: 0.12 } }, 400, small)
    await refuse({ region: { ...REGION, y1: 0.8 } }, 400, small)
    await refuse({ region: { ...REGION, x2: 1.2 } }, 400)
    await refuse({ region: { x1: 0, y1: 0, x2: 1 } }, 400)
    await refuse({ page: 5 }, 422, 'This page is not in the PDF.')
    await refuse({ page: 0 }, 400)
    await refuse({ kind: 'highlight' }, 400)
    await refuse({ annotation_id: 'a' }, 400)
    await refuse({ text: 'word '.repeat(1300) }, 422, 'Choose a smaller region to make a post.')
    await refuse({ take: 't'.repeat(401) }, 400, 'A take has at most 400 characters.')
    await refuse({ source_id: 'missing' }, 404, 'Source not found.')
    const elsewhere = createSource(s.db, s.other.id, PAGES)
    await refuse({ source_id: elsewhere }, 404, 'Source not found.')
    s.db.prepare("UPDATE sources SET type='kindle' WHERE id=?").run(s.source)
    await refuse({}, 422, 'Posts can be made from PDFs only.')
    s.db.prepare("UPDATE sources SET type='pdf', pages=0 WHERE id=?").run(s.source)
    // Without a page count, the pages of the extracted text decide.
    await refuse({ page: 5 }, 422, 'This page is not in the PDF.')
    assert.equal(s.callCount(), 0)
    assert.equal((await s.start({ page: 4 })).statusCode, 202)
  } finally { await s.close() }
})

test('a region answer has only a headline, a topic, drafts and hashtags, checked against the region text', () => {
  const source = { kind: 'region' as const, passage: 'Cost grows 4x at 2048 tokens', context: 'Figure 3: The cost of attention by sequence length.', title: 'Attention', credit: '', page: 3, url: URL }
  const options = { destination: 'linkedin' as const, take: '', changed: false }
  const parsed = parseShareCardAnswer(regionAnswer({ quote: 'not used', emphasis: 'x', pull: 'y', takeawaysTitle: 'z', takeaways: 'none', headline: 'Figure 3: cost grows 4x at 2048 tokens' }), source, options)
  assert.deepEqual(parsed.card, regionCard({ headline: 'Figure 3: cost grows 4x at 2048 tokens', crop: null }))
  assert.deepEqual(parsed.drafts, DRAFTS)
  const withLine = (line: string) => FINDING.replace('The catch is cost.', line)
  for (const [raw, reason] of [
    [regionAnswer({ headline: undefined }), /headline must be a string/],
    [regionAnswer({ headline: 'H'.repeat(81) }), /headline has 81 characters; allowed 1–80/],
    [regionAnswer({ topic: '' }), /topic must name the subject/],
    [regionAnswer({ headline: 'Cost grows 8x' }), /^Error: headline has numbers that are not in regionText, pageText, title, credit, page or readerTake: 8\. Use only numbers stated there\.$/],
    [regionAnswer({ drafts: { ...DRAFTS, finding: withLine('The catch is cost: 5 times more.') } }), /drafts\.finding has numbers that are not in regionText, .*: 5\./],
    [regionAnswer({ drafts: { ...DRAFTS, finding: withLine('The regionText says so.') } }), /drafts\.finding must not mention pageText or the supplied text/],
    [regionAnswer({ drafts: { ...DRAFTS, finding: withLine('The authors write “the cost doubles with every token we add” here.') } }), /quotes words that are not in regionText or pageText/],
    [regionAnswer({ drafts: { ...DRAFTS, finding: '' } }), /drafts\.finding must not be empty/],
  ] as Array<[string, RegExp]>) assert.throws(() => parseShareCardAnswer(raw, source, options), reason, String(reason))
  // Numbers and quotations from the region text and the caption pass.
  parseShareCardAnswer(regionAnswer({ drafts: { ...DRAFTS, finding: withLine('In Figure 3 the authors chart “the cost of attention by sequence length” up to 2048 tokens.') } }), source, options)
})

test('a region post outlives its source, and restoring the source reconnects it', async () => {
  const s = await regionSetup()
  try {
    const record = await s.settle(((await s.start()).json() as ShareCardRecord).id)
    assert.equal((await s.app.inject({ method: 'DELETE', url: `/api/projects/${s.project.id}/sources/${s.source}` })).statusCode, 200)
    const orphan = (await s.app.inject({ url: `${s.base}/${record.id}` })).json() as ShareCardRecord
    assert.equal(orphan.source_id, null); assert.deepEqual(orphan.card, record.card); assert.deepEqual(orphan.marks, [])
    const trash = (await s.app.inject({ url: '/api/recovery/trash' })).json() as Array<{ id: string }>
    const restored = await s.app.inject({ method: 'POST', url: `/api/recovery/trash/${trash[0]!.id}/restore`, payload: {} })
    assert.equal(restored.statusCode, 200, restored.body); assert.equal(restored.json().linksSkipped, 0)
    assert.deepEqual((await s.app.inject({ url: `${s.base}/${record.id}` })).json(), record)
  } finally { await s.close() }
})

// Carousels: two to eight highlights of one paper, in the reader's order.
const POINTS = ['Every position sees every other one', 'Page three compares results', 'Page four is out of range']
const SET_WORDS = {
  topic: 'Attention', headline: 'Reach has a quadratic price', study: 'The authors describe a model built on attention alone.', points: POINTS,
  takeaway: 'Attention buys reach at a cost that grows fast.', limitations: 'Sparse patterns are only suspected to reduce the cost.',
}
const setAnswer = (extra: Record<string, unknown> = {}) => JSON.stringify({ ...SET_WORDS, drafts: DRAFTS, hashtags: HASHTAGS, ...extra })
const setCard = (extra: Record<string, unknown> = {}, set: Record<string, unknown> = {}) => ({
  quote: '', quoteEdited: false, emphasis: '', pull: '', takeawaysTitle: '', takeaways: [], style: 'headline', look: 'ink', crop: null,
  headline: SET_WORDS.headline, topic: SET_WORDS.topic, ...extra,
  set: { study: SET_WORDS.study, points: POINTS, takeaway: SET_WORDS.takeaway, limitations: SET_WORDS.limitations, crops: [null, null, null], ...set },
})
const PAGE_THREE = 'Page three compares results.', PAGE_FOUR = 'Page four is out of range.'
const BOX = (y: number) => [{ x1: 0.1, y1: y, x2: 0.8, y2: y + 0.02 }]

async function setSetup() {
  const s = await setup()
  // The reader's order is not the pages' order.
  const ids = [await s.highlight(HIGHLIGHT, { color: 'green', rects: BOX(0.1) }), await s.highlight(PAGE_THREE, { page_number: 3, color: 'pink', rects: BOX(0.3) }),
    await s.highlight(PAGE_FOUR, { page_number: 4, color: 'blue', rects: BOX(0.5) })]
  const body = (extra: Record<string, unknown> = {}) => ({ request_id: randomUUID(), source_id: s.source, annotation_ids: ids, kind: 'set', ...extra })
  const start = (extra: Record<string, unknown> = {}) => s.app.inject({ method: 'POST', url: s.base, payload: body(extra) })
  s.respond(1, setAnswer())
  return { ...s, ids, body, start }
}

test('several highlights become a carousel built from their own words and pages', async () => {
  const s = await setSetup()
  try {
    const payload = s.body()
    const response = await s.app.inject({ method: 'POST', url: s.base, payload }); assert.equal(response.statusCode, 202, response.body)
    const record = await s.settle((response.json() as ShareCardRecord).id)
    assert.equal(record.status, 'complete'); assert.equal(s.callCount(), 1)
    assert.equal(record.annotation_id, null); assert.equal(record.source_id, s.source)
    const items = [{ annotation_id: s.ids[0], passage: PASSAGE, page: 2, rects: BOX(0.1), color: 'green' },
      { annotation_id: s.ids[1], passage: PAGE_THREE, page: 3, rects: BOX(0.3), color: 'pink' }, { annotation_id: s.ids[2], passage: PAGE_FOUR, page: 4, rects: BOX(0.5), color: 'blue' }]
    assert.deepEqual(record.source, {
      version: 1, kind: 'set', passage: [PASSAGE, PAGE_THREE, PAGE_FOUR].join('\n\n'), page: 2, rects: [], color: 'yellow', region: null, items,
      context: record.source.context, title: 'Test Source', credit: '', url: URL,
    })
    // The items' own pages, in page order; not their neighbours.
    assert.match(record.source.context, /^Attention lets every position.*sparse patterns may reduce this cost\.\n\nPage three compares results\.\n\nPage four is out of range\.$/)
    assert.doesNotMatch(record.source.context, /Page one/)
    assert.deepEqual(record.card, setCard())
    assert.deepEqual(record.caption, caption())
    assert.deepEqual(record.set_marks, items.map(item => [{ rects: item.rects, color: item.color }]))
    assert.deepEqual(record.marks, record.set_marks[0])
    const sent = s.prompt(1), input = s.input(1)
    assert.ok(sent.startsWith(`${sharePostPrompt('linkedin', draftLimits('linkedin', { url: URL }), 'set')}\n\n{`))
    assert.match(sent, /in this order, to tell its story in a carousel/); assert.match(sent, /- points: one string per entry in highlights/)
    assert.deepEqual(Object.keys(input).sort(), ['credit', 'highlights', 'pageText', 'title'])
    assert.deepEqual(input.highlights, items.map(item => ({ page: item.page, text: item.passage })))
    assert.equal(input.pageText, record.source.context)
    const list = (await s.app.inject({ url: `${s.base}?source_id=${s.source}` })).json()
    assert.deepEqual(list, [{ id: record.id, status: 'complete', annotation_id: null, source_id: s.source, page: 2, kind: 'set', title: SET_WORDS.headline, updated_at: record.updated_at }])

    // Only the request ID makes a retry idempotent: the same highlights again are a second carousel.
    const again = await s.app.inject({ method: 'POST', url: s.base, payload }); assert.equal(again.statusCode, 200); assert.equal(again.json().id, record.id)
    assert.equal((await s.app.inject({ method: 'POST', url: s.base, payload: { ...payload, annotation_ids: s.ids.slice(0, 2) } })).statusCode, 409)
    s.fail(2)
    const failed = await s.settle(((await s.start({ annotation_ids: [s.ids[2], s.ids[0]] })).json() as ShareCardRecord).id)
    assert.equal(failed.status, 'failed'); assert.notEqual(failed.id, record.id)
    assert.equal(((await s.app.inject({ url: s.base })).json() as Array<{ id: string; title: string }>).find(item => item.id === failed.id)!.title, '2 highlights')
    // A highlight in more than one carousel, and in its own post, is fine.
    assert.equal((await s.create(s.ids[0]!)).statusCode, 202)
  } finally { await s.close() }
})

test('a carousel\'s slide words and crops are edited one at a time; text cards and quote edits are refused', async () => {
  const s = await setSetup()
  try {
    const first = await s.settle(((await s.start()).json() as ShareCardRecord).id), url = `${s.base}/${first.id}`
    const patch = (payload: unknown) => s.app.inject({ method: 'PATCH', url, payload })
    const refuse = async (payload: unknown, detail: string) => {
      const response = await patch(payload); assert.equal(response.statusCode, 400, JSON.stringify(payload)); assert.equal(response.json().detail, detail)
    }
    const point = (await patch({ set_text: { field: 'point', index: 1, text: '  Results  are compared ' } })).json() as ShareCardRecord
    assert.deepEqual(point.card!.set!.points, [POINTS[0], 'Results are compared', POINTS[2]]); assert.equal(point.can_undo, true)
    const noStudy = (await patch({ set_text: { field: 'study', text: ' ' } })).json() as ShareCardRecord
    assert.equal(noStudy.card!.set!.study, '')
    assert.equal(((await patch({ set_text: { field: 'limitations', text: 'Untested at scale.' } })).json() as ShareCardRecord).card!.set!.limitations, 'Untested at scale.')
    assert.equal(((await patch({ set_text: { field: 'takeaway', text: 'Reach costs.' } })).json() as ShareCardRecord).card!.set!.takeaway, 'Reach costs.')
    await refuse({ set_text: { field: 'takeaway', text: '' } }, 'takeaway has 0 characters; allowed 1–140.')
    await refuse({ set_text: { field: 'point', index: 0, text: 'p'.repeat(71) } }, 'points[0] has 71 characters; allowed 1–70.')
    await refuse({ set_text: { field: 'point', text: 'No index' } }, 'Name the point to edit with its index.')
    await refuse({ set_text: { field: 'study', index: 0, text: 'x' } }, 'Only a point has an index.')
    await refuse({ set_text: { field: 'point', index: 3, text: 'x' } }, 'This carousel has no point 4.')
    for (const bad of [{ set_text: { field: 'cover', text: 'x' } }, { set_text: { field: 'point', index: -1, text: 'x' } }, { set_text: { field: 'study' } }])
      assert.equal((await patch(bad)).statusCode, 400)
    const undone = (await s.app.inject({ method: 'POST', url: `${url}/undo`, payload: {} })).json() as ShareCardRecord
    assert.equal(undone.card!.set!.takeaway, SET_WORDS.takeaway)

    // One highlight slide's crop, in place and kept through Undo; null is automatic again.
    const crop = { x1: 0.05, y1: 0.2, x2: 0.95, y2: 0.45 }
    await patch({ set_text: { field: 'takeaway', text: 'Reach costs.' } })
    const cropped = (await patch({ crop, slide: 1 })).json() as ShareCardRecord
    assert.deepEqual(cropped.card!.set!.crops, [null, crop, null]); assert.equal(cropped.card!.crop, null)
    const kept = (await s.app.inject({ method: 'POST', url: `${url}/undo`, payload: {} })).json() as ShareCardRecord
    assert.deepEqual(kept.card!.set!.crops, [null, crop, null]); assert.equal(kept.card!.set!.takeaway, SET_WORDS.takeaway)
    assert.deepEqual(((await patch({ crop: null, slide: 1 })).json() as ShareCardRecord).card!.set!.crops, [null, null, null])
    await patch({ crop, slide: 2 })
    await refuse({ crop }, 'A carousel has a crop for each highlight slide; name the slide.')
    await refuse({ crop, slide: 3 }, 'This carousel has no highlight slide 4.')
    await refuse({ crop: { ...crop, x2: 0 }, slide: 0 }, 'A crop needs x1 < x2 and y1 < y2.')
    for (const style of ['page', 'quote', 'idea', 'takeaways']) await refuse({ style, look: 'ink' }, SET_STYLE_REFUSED)
    assert.equal(((await patch({ style: 'headline', look: 'paper' })).json() as ShareCardRecord).card!.look, 'paper')
    await refuse({ quote: 'Every position' }, 'A carousel has no quote to edit.')
    assert.equal(((await patch({ headline: 'My own cover' })).json() as ShareCardRecord).card!.headline, 'My own cover')

    // A new destination: one request; the Headline style, the look and the crops stay.
    s.respond(2, setAnswer({ drafts: { finding: X_FINDING, contrast: '', caveat: '' }, headline: 'Reach, priced' }))
    await s.app.inject({ method: 'POST', url: `${url}/change`, payload: { destination: 'x' } })
    const moved = await s.settle(first.id)
    assert.equal(s.callCount(), 2); assert.equal(moved.status, 'complete')
    assert.deepEqual(moved.card, setCard({ headline: 'Reach, priced', look: 'paper' }, { crops: [null, null, crop] }))
    assert.deepEqual(s.input(2).previousCard, { headline: 'My own cover', topic: 'Attention', study: '', points: [POINTS[0], 'Results are compared', POINTS[2]],
      takeaway: SET_WORDS.takeaway, limitations: 'Untested at scale.' })

    // A single post has no slides.
    const single = await s.post(s.ids[0])
    const singleUrl = `${s.base}/${single.id}`
    for (const [payload, detail] of [[{ set_text: { field: 'study', text: 'x' } }, 'Only a carousel has slide text.'], [{ crop, slide: 0 }, 'Only a carousel has slides.']] as const) {
      const response = await s.app.inject({ method: 'PATCH', url: singleUrl, payload }); assert.equal(response.statusCode, 400); assert.equal(response.json().detail, detail)
    }
  } finally { await s.close() }
})

test('a carousel is refused without a request when its highlights are too few, too many, repeated, foreign or out of bounds', async () => {
  const s = await setSetup()
  try {
    const refuse = async (extra: Record<string, unknown>, status: number, detail?: string) => {
      const response = await s.start(extra)
      assert.equal(response.statusCode, status, `${JSON.stringify(extra)} ${response.body}`)
      if (detail) assert.equal(response.json().detail, detail)
    }
    await refuse({ annotation_ids: [s.ids[0]] }, 400)
    await refuse({ annotation_ids: Array.from({ length: 9 }, () => randomUUID()) }, 400)
    await refuse({ annotation_ids: [s.ids[0], s.ids[1], s.ids[0]] }, 400, 'Choose each highlight once.')
    await refuse({ annotation_ids: [s.ids[0], 'missing'] }, 404, 'Highlight not found.')
    const elsewhere = createSource(s.db, s.project.id, PAGES)
    await refuse({ source_id: elsewhere }, 404, 'Highlight not found.')
    await refuse({ source_id: 'missing' }, 404, 'Source not found.')
    await refuse({ source_id: createSource(s.db, s.other.id, PAGES) }, 404, 'Source not found.')
    await refuse({ annotation_id: s.ids[0] }, 400)
    await refuse({ kind: 'region' }, 400)
    await refuse({ annotation_ids: [s.ids[0], await s.highlight('Too short.')] }, 422, 'Highlight 2 is too short for a post.')
    await refuse({ annotation_ids: [await s.highlight('word '.repeat(1300)), s.ids[0]] }, 422, 'Highlight 1 is too long for a post.')
    await refuse({ take: 't'.repeat(401) }, 400, 'A take has at most 400 characters.')
    s.db.prepare("UPDATE sources SET type='kindle' WHERE id=?").run(s.source)
    await refuse({}, 422, 'Posts can be made from PDFs only.')
    assert.equal(s.callCount(), 0)
  } finally { await s.close() }
})

test('a carousel answer is checked field by field against every highlight, the pages and the take', () => {
  const items = [{ annotation_id: 'a', passage: 'The model reached 41% accuracy on 2048 tokens.', page: 2, rects: [], color: 'yellow' as const },
    { annotation_id: 'b', passage: 'We suspect that sparse patterns may reduce this cost.', page: 7, rects: [], color: 'yellow' as const }]
  const source = { kind: 'set' as const, items, passage: items.map(item => item.passage).join('\n\n'), context: 'Table 2 compares models.', title: 'Attention', credit: 'Vaswani et al., 2017', page: 2, url: URL }
  const options = { destination: 'linkedin' as const, take: '', changed: false }
  const words = { ...SET_WORDS, points: ['Accuracy reached 41% at 2048 tokens', 'Sparse patterns may cut the cost'] }
  const answer = (extra: Record<string, unknown> = {}) => setAnswer({ ...words, ...extra })
  const parsed = parseShareCardAnswer(answer({ quote: 'ignored', takeaways: 'ignored', study: null, limitations: null }), source, options)
  assert.deepEqual(parsed.card, setCard({}, { points: words.points, study: '', limitations: '', crops: [null, null] }))
  // A number from a later highlight's page, the credit or the take passes.
  parseShareCardAnswer(answer({ takeaway: 'Seen on page 7 of the 2017 paper.' }), source, options)
  const take = 'Only 3 caveats matter.'
  parseShareCardAnswer(answer({ limitations: 'There are 3 caveats.', drafts: { finding: `${FINDING}\n\n${take}`, contrast: '', caveat: `${CAVEAT}\n\n${take}` } }), source, { ...options, take })
  for (const [raw, reason] of [
    [answer({ points: words.points.slice(0, 1) }), /^Error: points has 1 items; it needs exactly 2, one per highlight in order\.$/],
    [answer({ points: 'one' }), /^Error: points must be a list of strings, one per highlight in order\.$/],
    [answer({ points: ['a', 7] }), /points must be a list of strings/],
    [answer({ points: ['p'.repeat(71), 'b'] }), /points\[0\] has 71 characters; allowed 1–70/],
    [answer({ study: 's'.repeat(161) }), /study has 161 characters; allowed 0–160/],
    [answer({ takeaway: undefined }), /takeaway must be a string/],
    [answer({ takeaway: '' }), /takeaway has 0 characters; allowed 1–140/],
    [answer({ limitations: 'l'.repeat(161) }), /limitations has 161 characters/],
    [answer({ headline: '' }), /headline has 0 characters/],
    [answer({ topic: '' }), /topic must name the subject/],
    [answer({ points: ['Accuracy reached 42%', words.points[1]] }), /^Error: points\[0\] has numbers that are not in highlights, pageText, title, credit, page or readerTake: 42\. Use only numbers stated there\.$/],
    [answer({ study: 'A study of 1,000 papers.' }), /study has numbers .*: 1,000\./],
    [answer({ limitations: 'Only 3 models were compared.' }), /limitations has numbers .*: 3\./],
    [answer({ headline: 'Accuracy hit 50%' }), /headline has numbers .*: 50\./],
    [answer({ takeaway: 'The pageText says so.' }), /takeaway must not mention pageText or the supplied text/],
    [answer({ study: 'My reading of a model study.' }), /study must not use the first person \("My"\)/],
    [answer({ limitations: 'The authors write “sparse patterns will certainly remove every cost” here.' }), /limitations quotes words that are not in highlights or pageText/],
    [answer({ points: ['See www.example.org', words.points[1]] }), /points\[0\] must not contain links/],
    [answer({ drafts: { ...DRAFTS, finding: '' } }), /drafts\.finding must not be empty/],
    [answer({ drafts: { ...DRAFTS, finding: FINDING.replace('The catch is cost.', 'The catch is cost, 9 times over.') } }), /drafts\.finding has numbers that are not in highlights/],
  ] as Array<[string, RegExp]>) assert.throws(() => parseShareCardAnswer(raw, source, options), reason, String(reason))
})

test('a carousel\'s page text shares the budget fairly between its highlights\' pages, in page order', () => {
  const pages = new Map([[1, 'a'.repeat(9000)], [2, 'b'.repeat(100)], [3, 'c'.repeat(9000)], [9, 'unused']])
  const context = sharedContext(pages, [3, 1, 2, 3])
  assert.equal(context.length, 12_000)
  assert.match(context, /^a{5948}\n\nb{100}\n\nc{5948}$/)
  assert.equal(sharedContext(new Map([[1, 'short'], [2, 'text']]), [2, 1]), 'short\n\ntext')
  assert.equal(sharedContext(new Map(), [4, 5]), '')
})

test('a carousel outlives its highlights and its source, and restoring the source reconnects it', async () => {
  const s = await setSetup()
  try {
    const record = await s.settle(((await s.start()).json() as ShareCardRecord).id), url = `${s.base}/${record.id}`
    // Deleting one of its highlights changes nothing in the post: its stored words and boxes stand in.
    assert.equal((await s.app.inject({ method: 'DELETE', url: `/api/projects/${s.project.id}/sources/${s.source}/annotations/${s.ids[1]}` })).statusCode, 204)
    assert.deepEqual((await s.app.inject({ url })).json(), record)
    // A new highlight on an item's page shows on that slide only.
    await s.highlight(PAGE_FOUR, { page_number: 4, color: 'yellow', rects: BOX(0.8) })
    const marked = (await s.app.inject({ url })).json() as ShareCardRecord
    assert.deepEqual(marked.set_marks[2], [{ rects: BOX(0.5), color: 'blue' }, { rects: BOX(0.8), color: 'yellow' }])
    assert.deepEqual(marked.set_marks.slice(0, 2), record.set_marks.slice(0, 2))
    assert.equal((await s.app.inject({ method: 'DELETE', url: `/api/projects/${s.project.id}/sources/${s.source}` })).statusCode, 200)
    const orphan = (await s.app.inject({ url })).json() as ShareCardRecord
    assert.equal(orphan.source_id, null); assert.deepEqual(orphan.card, record.card); assert.deepEqual(orphan.set_marks, record.set_marks)
    const trash = (await s.app.inject({ url: '/api/recovery/trash' })).json() as Array<{ id: string }>
    const restored = await s.app.inject({ method: 'POST', url: `/api/recovery/trash/${trash[0]!.id}/restore`, payload: {} })
    assert.equal(restored.statusCode, 200, restored.body); assert.equal(restored.json().linksSkipped, 0)
    assert.equal(((await s.app.inject({ url })).json() as ShareCardRecord).source_id, s.source)
  } finally { await s.close() }
})

// Review fixes: false refusals and false passes in the answer checks, and service defects.
const reviewSource = { passage: PASSAGE, context: 'We suspect that sparse patterns may reduce this cost. In the self-atten- tion layer every position looks at every other one.',
  title: 'Attention Is All You Need', credit: '', page: 2, url: URL }
const reviewOptions = { destination: 'linkedin' as const, take: '', changed: false }
const withReviewLine = (line: string) => FINDING.replace('The catch is cost.', line)
const passes = (line: string, options: Partial<typeof reviewOptions> = {}) => parseShareCardAnswer(drafts({ finding: withReviewLine(line) }), reviewSource, { ...reviewOptions, ...options })
const refuses = (line: string, reason: RegExp) => assert.throws(() => passes(line), reason, line)

test('review: an exact quotation across a line-end hyphen in the page text passes', () => {
  passes('The authors write “in the self-attention layer every position looks at every other one” here.')
  refuses('The authors write “in the self-attention layer every position looks at nothing else” here.', /quotes words that are not in highlight or pageText/)
})

test('review: first person, hashtags and links are found by Unicode-aware boundaries, without false positives', () => {
  passes('Le résultat reste le même, the crème de la crème of models.')
  passes('Code in C# and F# ranks #2 here.')
  passes('In the U.S., e.g. in Fig. 2, the authors et al. agree on Node.js, i.e. it holds.')
  refuses('It helps me, and #attention matters.', /must not contain hashtags/)
  refuses('Read more at evil.example/x today.', /must not contain links/)
  refuses('See example.com for the rest.', /must not contain links/)
  refuses('See www.example.org now.', /must not contain links/)
  refuses('Isso me preocupa.', /first person \("me"\)/)
  refuses('Thoughts? Let me know.', /first person \("me"\)/)
})

test('review: a quotation chopped by ellipses or in single curly quotes is still checked', () => {
  passes('The authors write “every position look … the cost grows with the square” here.')
  refuses('The authors write “the cost … cubes … with every … position” here.', /quotes words that are not in highlight or pageText/)
  refuses('The authors write “sparse patterns may … the cost grows” here.', /quotes words that are not in highlight or pageText/)
  refuses('The authors write ‘the cost grows with the cube of the length’ here.', /quotes words that are not in highlight or pageText/)
  passes('The authors’ model is theirs, and it’s honest about ‘cost’.')
})

test('review: with a take, a draft always has words of its own besides the take', () => {
  const take = 'This is why my long-context runs still feel slow to me today.'
  assert.throws(() => parseShareCardAnswer(drafts({ finding: take, caveat: '' }), reviewSource, { ...reviewOptions, take, changed: true }), /drafts\.finding has 1 paragraphs; use 2–8/)
  assert.throws(() => parseShareCardAnswer(drafts({ finding: `— — —\n\n${take}`, caveat: '' }), reviewSource, { ...reviewOptions, take, changed: true }),
    /^Error: drafts\.finding must lead into readerTake with words of its own\.$/)
  parseShareCardAnswer(drafts({ finding: `The cost grows with the square of the length.\n\n${take}`, caveat: '' }), reviewSource, { ...reviewOptions, take, changed: true })
})

test('review: a reader\'s edited quote survives a rewrite of a short highlight', async () => {
  const s = await setup()
  try {
    s.respond(1, answer({ emphasis: 'expensive', pull: '' })); s.respond(2, answer({ emphasis: '', pull: '' }))
    const first = await s.post(await s.highlight('Long documents become\nexpensive quickly.')), url = `${s.base}/${first.id}`
    const edited = (await s.app.inject({ method: 'PATCH', url, payload: { quote: 'Long inputs get expensive fast.' } })).json() as ShareCardRecord
    assert.equal(edited.card!.quoteEdited, true)
    await s.app.inject({ method: 'POST', url: `${url}/change`, payload: { instruction: 'Shorter headline' } })
    const changed = await s.settle(first.id)
    assert.equal(changed.status, 'complete'); assert.equal(changed.card!.quote, 'Long inputs get expensive fast.'); assert.equal(changed.card!.quoteEdited, true)
    assert.equal(s.input(2).fixedQuote, 'Long inputs get expensive fast.')
  } finally { await s.close() }
})

test('review: look, style, hashtags and link set after the last Undo step survive Undo, as the crop does', async () => {
  const s = await setup()
  try {
    const first = await s.post(), url = `${s.base}/${first.id}`
    const patch = (payload: unknown) => s.app.inject({ method: 'PATCH', url, payload })
    await patch({ headline: 'My own headline' })
    await patch({ style: 'idea', look: 'marker' }); await patch({ show_tags: true }); await patch({ link: 'comment' })
    const undone = (await s.app.inject({ method: 'POST', url: `${url}/undo`, payload: {} })).json() as ShareCardRecord
    assert.equal(undone.card!.headline, CARD.headline)
    assert.deepEqual({ style: undone.card!.style, look: undone.card!.look, showTags: undone.caption!.showTags, link: undone.caption!.link },
      { style: 'idea', look: 'marker', showTags: true, link: 'comment' })
  } finally { await s.close() }
})

test('review: a stored post that no longer reads is left out of the list, refused clearly, and still deletable', async () => {
  const s = await setup()
  try {
    const good = await s.post()
    // A first-build row restored from a trash packet: a caption with a body, a card without a crop.
    const old = JSON.parse(JSON.stringify(good)) as ShareCardRecord
    const { crop: _crop, set: _set, ...oldCard } = old.card!
    s.db.prepare(`INSERT INTO share_cards(id,project_id,source_id,annotation_id,request_id,request_hash,status,attempt,source_json,card_json,caption_json,created_at,updated_at)
      VALUES ('old',?,?,NULL,'r-old','h','complete','t',?,?,?,'2020-01-01','2020-01-01')`).run(s.project.id, s.source,
      JSON.stringify({ version: 1, passage: PASSAGE, page: 2, rects: [], color: 'yellow', context: '', title: 'Old', credit: '', url: '' }),
      JSON.stringify(oldCard), JSON.stringify({ body: 'Old caption', hashtags: [], edited: null }))
    const list = await s.app.inject({ url: s.base })
    assert.equal(list.statusCode, 200); assert.deepEqual((list.json() as Array<{ id: string }>).map(item => item.id), [good.id])
    const detail = 'This post was saved by an earlier build of pdfpal and can no longer be opened. Delete it.'
    for (const request of [{ url: `${s.base}/old` }, { method: 'PATCH' as const, url: `${s.base}/old`, payload: { look: 'ink', style: 'quote' } },
      { method: 'POST' as const, url: `${s.base}/old/change`, payload: { instruction: 'Again' } }, { method: 'POST' as const, url: `${s.base}/old/undo`, payload: {} }]) {
      const response = await s.app.inject(request); assert.equal(response.statusCode, 422, request.url); assert.equal(response.json().detail, detail)
    }
    assert.equal(s.callCount(), 1)
    assert.equal((await s.app.inject({ method: 'DELETE', url: `${s.base}/old` })).statusCode, 204)
    assert.equal((s.db.prepare("SELECT COUNT(*) n FROM share_cards WHERE id='old'").get() as { n: number }).n, 0)
  } finally { await s.close() }
})
