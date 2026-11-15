import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { buildServer } from '../../src/server/app.js'
import { openDatabase } from '../../src/core/database.js'
import { RetrievalService } from '../../src/core/retrieval.js'
import { CHECK_FAILED, SHARE_CARD_PROMPT, SHARE_CARD_REPAIR, ShareCardService, pageContext, parseShareCardAnswer } from '../../src/core/share-cards.js'
import { cleanPassage, type ShareCardRecord } from '../../src/shared/share-card.js'
import { testConfig, createSource } from '../helpers/test-utils.js'

const HIGHLIGHT = 'Attention lets every position look at every other position in\nthe sequence. However, the cost grows with the square of the se-\nquence length, so long documents become expensive.'
const PASSAGE = cleanPassage(HIGHLIGHT)
const PAGES = '[Page 1]\nPage one introduces the model.\n[Page 2]\n' + HIGHLIGHT + ' We suspect that sparse patterns may reduce this cost.\n[Page 3]\nPage three compares results.\n[Page 4]\nPage four is out of range.'
const CAPTION = 'Full attention buys reach at a price that grows fast.\n\n' +
  'Every position can look at every other one, which is what makes the model flexible. The catch is cost: it grows with the square of the sequence length.\n\n' +
  'Long documents get expensive quickly, and the authors suspect sparse patterns may help without losing much quality.'
const CARD = {
  quote: 'the cost grows with the square of the sequence length', emphasis: 'the square', headline: 'Reach has a quadratic price',
  pull: 'sparse patterns may reduce this cost', topic: 'Attention', takeawaysTitle: 'What full attention costs',
  takeaways: [{ title: 'Reach is global', detail: 'Every position can use every other one.' },
    { title: 'Cost grows fast', detail: 'Doubling the input quadruples the work.' }, { title: 'Sparsity may help', detail: 'The authors suspect so; it is untested here.' }],
}
const answer = (card: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ ...CARD, ...card, caption: CAPTION, hashtags: ['attention', 'transformers', 'research'], ...extra })

// The fake agent answers call N with response-N.json when it exists, otherwise response.json. It waits delay-N.txt
// (or delay.txt) milliseconds first, exits with an error when fail-N.txt exists, and keeps each prompt as prompt.txt.N.
async function setup() {
  const config = testConfig(); config.agent = 'codex'; config.codexBin = path.join(config.dataDir, 'codex-fixture')
  const dir = config.dataDir, calls = path.join(dir, 'calls.txt')
  fs.writeFileSync(path.join(dir, 'response.json'), answer())
  fs.writeFileSync(config.codexBin, `#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path'),dir=${JSON.stringify(dir)};const input=fs.readFileSync(0,'utf8');fs.appendFileSync(path.join(dir,'calls.txt'),'call\\n')
const n=fs.readFileSync(path.join(dir,'calls.txt'),'utf8').trim().split('\\n').length;fs.writeFileSync(path.join(dir,'prompt.txt.'+n),input)
const pick=name=>[name.replace('.','-'+n+'.'),name].map(f=>path.join(dir,f)).find(f=>fs.existsSync(f))
const delay=pick('delay.txt')?Number(fs.readFileSync(pick('delay.txt'),'utf8')):20
setTimeout(()=>{if(pick('fail.txt')){process.stderr.write('boom');process.exit(1)}process.stdout.write(fs.readFileSync(pick('response.json'),'utf8'))},delay)`, { mode: 0o700 })
  const app = await buildServer(config), db = openDatabase(config)
  const project = (await app.inject({ method: 'POST', url: '/api/projects', payload: { title: 'Posts' } })).json() as { id: string }
  const other = (await app.inject({ method: 'POST', url: '/api/projects', payload: { title: 'Other' } })).json() as { id: string }
  const source = createSource(db, project.id, PAGES)
  db.prepare("UPDATE sources SET pages=4, url='https://arxiv.org/abs/1706.03762' WHERE id=?").run(source)
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
      version: 1, passage: PASSAGE, page: 2, color: 'green', title: 'Test Source', credit: '', url: 'https://arxiv.org/abs/1706.03762',
      rects: [{ x1: 0.12, y1: 0.08, x2: 0.88, y2: 0.1 }, { x1: 0.12, y1: 0.1, x2: 0.86, y2: 0.12 }, { x1: 0.12, y1: 0.12, x2: 0.6, y2: 0.14 }],
      context: record.source.context,
    })
    assert.match(record.source.context, /^Page one introduces the model\.\n\nAttention lets every position.*sparse patterns may reduce this cost\.\n\nPage three compares results\.$/)
    assert.doesNotMatch(record.source.context, /Page four/)
    assert.deepEqual(record.card, { ...CARD, quoteEdited: false, style: 'quote', look: 'ink' })
    assert.deepEqual(record.caption, { body: CAPTION, hashtags: ['attention', 'transformers', 'research'], edited: null })
    const prompt = s.prompt(1), input = s.input(1)
    assert.ok(prompt.startsWith(`${SHARE_CARD_PROMPT}\n\n{`))
    assert.equal(input.highlight, PASSAGE); assert.equal(input.pageText, record.source.context); assert.equal(input.page, 2)
    assert.equal(input.title, 'Test Source'); assert.equal(input.credit, '')
    assert.ok(!('fixedQuote' in input) && !('previousCard' in input) && !('change' in input))
    assert.match(prompt, /We suspect that sparse patterns/)
    const list = (await s.app.inject({ url: `${s.base}?source_id=${s.source}` })).json()
    assert.deepEqual(list, [{ id: record.id, status: 'complete', annotation_id: annotation, source_id: s.source, page: 2, title: CARD.headline, updated_at: record.updated_at }])
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

test('a long quote opens on Big idea and an invented one is repaired once with its reason', async () => {
  const s = await setup()
  try {
    const long = 'Attention lets every position look at every other position in the sequence. However, the cost grows with the square of the sequence length'
    s.respond(1, '```json\n' + answer({ quote: 'Attention lets every position see every other position' }) + '\n```')
    s.respond(2, answer({ quote: long, emphasis: 'every other position' }))
    const record = await s.post()
    assert.equal(record.status, 'complete'); assert.equal(s.callCount(), 2)
    assert.equal(record.card!.style, 'idea'); assert.equal(record.card!.quote, long)
    const repair = s.input(2)
    assert.ok(s.prompt(2).startsWith(`${SHARE_CARD_PROMPT}\n${SHARE_CARD_REPAIR}\n\n{`))
    assert.equal(repair.repairReason, 'quote must be copied exactly from highlight.')
    assert.match(repair.invalidPreviousAnswer, /see every other position/)
    assert.equal(repair.highlight, PASSAGE)
  } finally { await s.close() }
})

test('a second failed check fails the post with the fixed message and keeps the reason locally', async () => {
  const s = await setup()
  try {
    s.respond(1, 'not json'); s.respond(2, answer({ headline: 'H'.repeat(61) }))
    const record = await s.post()
    assert.equal(record.status, 'failed'); assert.equal(record.error, CHECK_FAILED); assert.equal(record.card, null)
    assert.equal(s.callCount(), 2)
    assert.match(s.input(2).repairReason, /^The answer must be one JSON object/)
    assert.equal((s.db.prepare('SELECT error_detail FROM share_cards WHERE id=?').get(record.id) as { error_detail: string }).error_detail, 'headline has 61 characters; allowed 1–60.')
    assert.equal(JSON.stringify(record).includes('headline has 61'), false)
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
  const source = { passage: PASSAGE, context: 'We suspect that sparse patterns may reduce this cost.' }
  const words = Array.from({ length: 30 }, () => 'word').join(' ')
  const cases: Array<[string, RegExp]> = [
    [answer({ quote: 'Attention lets every token look' }), /quote must be copied exactly/],
    [answer({ emphasis: 'tiny steps' }), /emphasis must be an exact part of quote/],
    [answer({ headline: 'H'.repeat(61) }), /headline has 61 characters/],
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
    [answer({}, { caption: 'Too short.\n\nStill short.' }), /caption has 4 words; allowed 40–120/],
    [answer({}, { caption: `${CAPTION} ${'more '.repeat(80)}` }), /allowed 40–120/],
    [answer({}, { caption: CAPTION.replaceAll('\n\n', ' ') }), /caption has 1 paragraphs/],
    [answer({}, { caption: `${'A very long opening line '.repeat(6)}\n\n${words}` }), /first line has 149 characters; allowed at most 110/],
    [answer({}, { caption: `${CAPTION} #attention` }), /must not contain hashtags/],
    [answer({}, { caption: `${CAPTION} See www.example.org now.` }), /must not contain links/],
    [answer({}, { caption: CAPTION.replace('Every position', '**Every** position') }), /without Markdown/],
    [answer({}, { caption: `${CAPTION}\n- one more point` }), /without Markdown/],
    [answer({}, { caption: `${CAPTION}\n2. one more point` }), /without Markdown/],
    [answer({}, { caption: CAPTION.replace('Every position', 'The pageText says every position') }), /caption must not mention pageText/],
    [answer({ headline: 'What the page text shows' }), /headline must not mention/],
    [answer({ takeawaysTitle: 'From the Supplied Text' }), /takeawaysTitle must not mention/],
    [answer({ takeaways: CARD.takeaways.map((item, i) => i === 2 ? { ...item, detail: 'As the supplied text says.' } : item) }), /takeaways\[2\] must not mention/],
    [answer({}, { hashtags: ['attention', 'research'] }), /hashtags has 2 items/],
    [answer({}, { hashtags: ['attention', 'good practice', 'research'] }), /hashtag "good practice"/],
    [answer({}, { hashtags: ['attention', 'Attention', 'research'] }), /must not repeat/],
    [answer({}, { hashtags: 'attention' }), /hashtags must be a list/],
    ['[1,2]', /must be one JSON object/],
    ['x'.repeat(20_001), /The answer has 20001 characters; allowed at most 20000/],
  ]
  for (const [raw, reason] of cases) assert.throws(() => parseShareCardAnswer(raw, source, { changed: false }), reason, String(reason))
  // A null optional field means empty; hashtags may carry a leading #; a change may shorten the caption.
  const parsed = parseShareCardAnswer(answer({ emphasis: null, pull: null, topic: ' Machine   learning ' }, { hashtags: ['#attention', 'ml', 'research_2'] }), source, { changed: false })
  assert.equal(parsed.card.emphasis, ''); assert.equal(parsed.card.pull, ''); assert.equal(parsed.card.topic, 'Machine learning')
  assert.deepEqual(parsed.caption.hashtags, ['attention', 'ml', 'research_2'])
  const short = 'Reach costs more than it looks.\n\nThe price grows with the square of the input length.'
  assert.equal(parseShareCardAnswer(answer({}, { caption: short }), source, { changed: true }).caption.body, short)
  assert.throws(() => parseShareCardAnswer(answer({}, { caption: short }), source, { changed: false }), /caption has 16 words; allowed 40–120/)
  // A fixed quote replaces whatever the model returned.
  const fixed = parseShareCardAnswer(answer({ quote: 'anything at all', emphasis: 'square of' }), source, { changed: false, fixedQuote: { quote: 'the square of the sequence', edited: false } })
  assert.equal(fixed.card.quote, 'the square of the sequence')
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

    s.respond(2, answer({ headline: 'Quadratic reach, briefly' }, { caption: 'Reach costs more than it looks.\n\nThe price grows with the square of the input length.' }))
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
    assert.equal(changed.instruction, 'Make it shorter')
    const input = s.input(2)
    assert.equal(input.change, 'Make it shorter'); assert.equal(input.previousCaption, CAPTION)
    assert.deepEqual(input.previousHashtags, ['attention', 'transformers', 'research'])
    assert.equal(input.previousCard.headline, CARD.headline)
    assert.ok(!('style' in input.previousCard) && !('look' in input.previousCard) && !('quoteEdited' in input.previousCard))
    assert.equal((await s.app.inject({ method: 'POST', url: `${url}/change`, payload: { instruction: '  ' } })).statusCode, 400)
    assert.equal((await s.app.inject({ method: 'POST', url: `${url}/change`, payload: { instruction: 'x'.repeat(2001) } })).statusCode, 400)

    const undone = (await s.app.inject({ method: 'POST', url: `${url}/undo`, payload: {} })).json() as ShareCardRecord
    assert.equal(undone.card!.headline, CARD.headline); assert.equal(undone.caption!.body, CAPTION); assert.equal(undone.can_undo, false)
    assert.equal(undone.card!.style, 'takeaways')
    assert.equal((await s.app.inject({ method: 'POST', url: `${url}/undo`, payload: {} })).json().detail, 'There is no earlier version to return to.')

    // Cancel aborts the request; Try again runs with the stored instruction.
    s.delay(2000, 3)
    await s.app.inject({ method: 'POST', url: `${url}/change`, payload: { instruction: 'Use Portuguese' } })
    while (s.callCount() < 3) await new Promise(resolve => setTimeout(resolve, 10))
    const cancelled = (await s.app.inject({ method: 'POST', url: `${url}/cancel`, payload: {} })).json() as ShareCardRecord
    assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.card!.headline, CARD.headline)
    assert.equal((await s.app.inject({ method: 'POST', url: `${url}/cancel`, payload: {} })).json().status, 'cancelled')
    s.respond(4, answer({ headline: 'Alcance tem preço quadrático' }, { caption: 'Atenção completa custa caro.\n\nO custo cresce com o quadrado do tamanho da sequência.' }))
    const retried = await s.app.inject({ method: 'POST', url: `${url}/retry`, payload: {} }); assert.equal(retried.statusCode, 202)
    const after = await s.settle(first.id)
    assert.equal(after.card!.headline, 'Alcance tem preço quadrático'); assert.equal(s.input(4).change, 'Use Portuguese')
    assert.equal((await s.app.inject({ method: 'POST', url: `${url}/retry`, payload: {} })).json().detail, 'This post is already complete.')

    const caption = (await s.app.inject({ method: 'PATCH', url, payload: { caption: 'My own caption.' } })).json() as ShareCardRecord
    assert.equal(caption.caption!.edited, 'My own caption.'); assert.equal(caption.caption!.body, after.caption!.body); assert.equal(caption.can_undo, true)
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
