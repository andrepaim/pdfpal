import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseVisualDefinitionV2, visualDefinitionV1, visualSceneV2, type VisualSceneV2, type VisualStepV1 } from '../../src/shared/visual.js'
import { approximateMeasure, drawSceneV2, drawStepV1, svgMarkup, VISUAL_KIT_CSS, walk, type Drawing, type VNode } from '../../src/shared/visual-kit/index.js'
import { lintDrawing } from '../helpers/visual-lint.js'

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures')
const read = (dir: string) => fs.readdirSync(path.join(fixtures, dir)).filter(f => f.endsWith('.json')).sort()
  .map(file => ({ file, json: JSON.parse(fs.readFileSync(path.join(fixtures, dir, file), 'utf8')) as { definition: unknown } }))
const v2 = read('visual-v2').map(({ file, json }) => ({ file, scenes: parseVisualDefinitionV2(json.definition).definition.scenes }))
const v1 = read('visual-v1').map(({ file, json }) => ({ file, steps: visualDefinitionV1.parse(json.definition).steps }))
const measure = approximateMeasure
const scene = (value: unknown): VisualSceneV2 => visualSceneV2.parse(value)
const beat = (caption: string) => ({ caption, explanation: `${caption}.`, basis: 'illustration' })

// Kinds the stored fixtures do not cover, taken from the visual study's runs (bars, quadrant) or written to force a path
// (a three-column comparison, which stacks into cards when narrow).
const extra: VisualSceneV2[] = [
  scene({ kind: 'bars', title: 'Sharpe ratios', label: 'Sharpe ratio (CAL slope)', beats: [beat('One'), beat('Two')], items: [
    { id: 'g', label: 'Minimum-variance G', value: 0.3386, note: 'premium 3.83%, SD 11.32%', tone: 'neutral' },
    { id: 'p', label: 'Optimal portfolio P', value: 0.4107, note: 'premium 5.64%, SD 13.74%', tone: 'accent', appear: 2 }] }),
  scene({ kind: 'quadrant', title: 'Four views of technology', beats: [beat('One'), beat('Two')], x: { low: 'Neutral', high: 'Value-laden' }, y: { low: 'Autonomous', high: 'Human control' }, items: [
    { id: 'inst', label: 'Instrumentalism', sub: 'a neutral tool', quadrant: 'top-left', detail: 'Technology serves whatever ends people choose.' },
    { id: 'crit', label: 'Critical theory', sub: 'social values, choice', quadrant: 'top-right', tone: 'primary', detail: 'Values are built in, but people can change them.' },
    { id: 'det', label: 'Determinism', sub: 'progress with its own logic', quadrant: 'bottom-left', appear: 2 },
    { id: 'sub', label: 'Substantivism', sub: 'efficiency and power', quadrant: 'bottom-right', tone: 'secondary', appear: 2 }] }),
  scene({ kind: 'compare', title: 'Three quantizers', beats: [beat('One'), beat('Two')], columns: [{ id: 'a', title: 'Scalar', tone: 'primary' }, { id: 'b', title: 'Vector', tone: 'secondary' }, { id: 'c', title: 'Product', tone: 'accent' }],
    rows: [{ label: 'Codebook', cells: ['One value per level', 'k centroids in full dimension', 'm small codebooks'] },
      { label: 'Cost', cells: ['Cheap', 'Grows exponentially with bits', 'Linear in the number of parts'], appear: 2 }] }),
]
const allScenes = [...v2.flatMap(f => f.scenes.map((s, i) => ({ name: `${f.file} #${i + 1}`, scene: s }))), ...extra.map(s => ({ name: s.kind, scene: s }))]

function nodes(svg: VNode): VNode[] { const list: VNode[] = []; walk(svg, node => list.push(node)); return list }
const items = (drawing: Drawing) => nodes(drawing.svg).filter(n => n.attrs['data-at'] !== undefined)

test('every stored fixture lays out at 360 and 640 without throwing, and v1 steps restyle', () => {
  assert.ok(v2.length >= 7 && v1.length >= 7)
  for (const { name, scene: s } of allScenes) for (const width of [320, 360, 640]) {
    const drawing = drawSceneV2(s, { width, measure })
    assert.ok(drawing.width >= width && drawing.height > 40, `${name} at ${width}`)
    assert.equal(drawing.svg.tag, 'svg')
    assert.equal(drawing.svg.attrs.viewBox, `0 0 ${drawing.width} ${drawing.height}`)
    assert.equal(drawing.beats, s.beats.length)
    assert.match(svgMarkup(drawing.svg), /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" class="vx-svg"/)
  }
  for (const { file, steps } of v1) for (const step of steps) {
    const drawing = drawStepV1(step, { measure })
    assert.equal(drawing.width, 360, file); assert.equal(drawing.height, step.scene.height); assert.equal(drawing.beats, 1)
  }
})

test('the geometry lint finds no defects in the v2 fixtures at 360 px (and in the extra kinds at 320 and 640)', () => {
  const found: string[] = []
  for (const { name, scene: s } of allScenes) for (const issue of lintDrawing(drawSceneV2(s, { width: 360, measure }).svg, measure)) found.push(`${name}: ${issue.kind} ${issue.note}`)
  for (const s of extra) for (const width of [320, 640]) for (const issue of lintDrawing(drawSceneV2(s, { width, measure }).svg, measure)) found.push(`${s.kind} at ${width}: ${issue.kind} ${issue.note}`)
  assert.deepEqual(found, [])
})

test('the geometry lint reports the defects it is meant to catch', () => {
  const t = (x: number, y: number, words: string): VNode => ({ tag: 'text', attrs: { class: 'label', x, y, 'dominant-baseline': 'central' }, children: [words] })
  const box = (x: number, y: number): VNode => ({ tag: 'rect', attrs: { class: 'shape', x, y, width: 100, height: 40 }, children: [] })
  const g = (...children: VNode[]): VNode => ({ tag: 'g', attrs: { class: 'el t-neutral', 'data-at': 1 }, children })
  const svg: VNode = { tag: 'svg', attrs: { viewBox: '0 0 300 200' }, children: [
    g(box(10, 10), t(15, 30, 'A label far too long for its box')), g(box(60, 20)), g(t(250, 100, 'Off the canvas edge')),
    g({ tag: 'path', attrs: { class: 'edge', d: 'M20 150H200' }, children: [] }), g(t(30, 150, 'struck')), g(t(32, 152, 'stacked'))] }
  const kinds = new Set(lintDrawing(svg, measure).map(i => i.kind))
  for (const kind of ['label overflows its box', 'text collides with a box', 'two boxes overlap', 'text leaves the canvas', 'a line runs through a label', 'two labels overlap'])
    assert.ok(kinds.has(kind), kind)
})

test('markup escapes text and attribute values', () => {
  const evil = '<script>alert("x")</script> & \'q\''
  const s = scene({ kind: 'flow', title: evil, beats: [beat('One')], nodes: [{ id: 'a', label: evil, sub: '"><img src=x onerror=alert(1)>', detail: evil }, { id: 'b', label: 'B' }], edges: [{ from: 'a', to: 'b', label: '<b>' }] })
  const html = svgMarkup(drawSceneV2(s, { width: 360, measure }).svg)
  assert.equal(/<script|<img|<b>/.test(html), false)
  assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt; &amp; &#39;q&#39;/)
  assert.match(html, /aria-label="&lt;script&gt;/)
  assert.equal(svgMarkup({ tag: 'svg', attrs: { onload: 'alert(1)', 'bad name': 1 }, children: [{ tag: 'script x', attrs: {}, children: ['alert(1)'] }] }), '<svg xmlns="http://www.w3.org/2000/svg"/>')
})

test('styling is classes only: no inline colours anywhere', () => {
  const drawings = [...allScenes.flatMap(({ scene: s }) => [320, 360, 640].map(width => drawSceneV2(s, { width, measure }))), ...v1.flatMap(f => f.steps.map(step => drawStepV1(step, { measure })))]
  for (const drawing of drawings) for (const node of nodes(drawing.svg)) {
    for (const key of ['fill', 'stroke', 'color', 'stop-color', 'opacity', 'fill-opacity', 'stroke-opacity']) assert.equal(node.attrs[key], undefined, `${node.tag} has ${key}`)
    if (node.attrs.style !== undefined) assert.match(String(node.attrs.style), /^font-size:\d+(\.\d)?px$/)
  }
})

test('items carry their tone and beat; later beats are hidden in markup', () => {
  const s = allScenes.find(x => x.scene.kind === 'flow' && x.scene.beats.length >= 3)!.scene
  const drawing = drawSceneV2(s, { width: 360, measure })
  for (const item of items(drawing)) {
    const at = Number(item.attrs['data-at'])
    assert.ok(at >= 1 && at <= drawing.beats)
    assert.match(String(item.attrs.class), /^el( t-(neutral|primary|secondary|accent|positive|negative))?( |$)/)
  }
  const later = items(drawing).filter(n => Number(n.attrs['data-at']) > 1).length
  assert.ok(later > 0)
  assert.equal((svgMarkup(drawing.svg, 1).match(/is-hidden/g) ?? []).length, later)
  assert.equal(svgMarkup(drawing.svg, drawing.beats).includes('is-hidden'), false)
  assert.equal(svgMarkup(drawing.svg).includes('is-hidden'), false)
  // An item set to appear after the last beat is clamped, so it still shows on the last one.
  const clamped = scene({ kind: 'bars', title: 'T', beats: [beat('One')], items: [{ id: 'a', label: 'A', value: 1, appear: 5 }, { id: 'b', label: 'B', value: 2 }] })
  assert.ok(items(drawSceneV2(clamped, { width: 360, measure })).every(n => n.attrs['data-at'] === 1))
})

test('flow nodes, quadrant items and v1 nodes with detail become hotspots with a visible marker', () => {
  const check = (drawing: Drawing, expected: string[]) => {
    assert.deepEqual(drawing.hotspots.map(h => h.id).sort(), [...expected].sort())
    for (const spot of drawing.hotspots) {
      const node = items(drawing).find(n => n.attrs['data-hotspot'] === spot.id)!
      assert.ok(node, spot.id)
      assert.match(String(node.attrs.class), /\bhot\b/)
      assert.ok(node.children.some(k => typeof k !== 'string' && k.tag === 'circle' && k.attrs.class === 'hint'), `${spot.id} has a marker`)
      assert.ok(spot.label && spot.detail)
    }
    assert.equal(items(drawing).filter(n => n.attrs['data-hotspot'] !== undefined).length, expected.length)
  }
  for (const { scene: s } of allScenes) {
    const drawing = drawSceneV2(s, { width: 360, measure })
    const expected = s.kind === 'flow' ? s.nodes.filter(n => n.detail).map(n => n.id) : s.kind === 'quadrant' ? s.items.filter(i => i.detail).map(i => i.id) : []
    check(drawing, expected)
  }
  assert.ok(allScenes.some(({ scene: s }) => s.kind === 'flow' && s.nodes.some(n => n.detail)))
  const step: VisualStepV1 = v1.flatMap(f => f.steps).find(st => st.scene.elements.some(e => e.type === 'node' && e.detail))!
  check(drawStepV1(step, { measure }), step.scene.elements.filter(e => e.type === 'node' && e.detail).map(e => e.id))
})

test('nothing is ever dimmed: no focus, rest or spotlight output', () => {
  for (const { scene: s } of allScenes) {
    const html = svgMarkup(drawSceneV2(s, { width: 360, measure }).svg, 1)
    assert.equal(/focus|is-rest|data-id=/.test(html), false)
  }
  assert.equal(/is-rest|is-focus|\.el[^{]*\{[^}]*opacity:\s*\.[1-9]/.test(VISUAL_KIT_CSS), false)
  assert.match(VISUAL_KIT_CSS, /\.el\.is-hidden\{opacity:0/)
  assert.match(VISUAL_KIT_CSS, /prefers-reduced-motion/)
  assert.match(VISUAL_KIT_CSS, /data-theme=paper/)
  assert.equal(/@font-face/.test(VISUAL_KIT_CSS), false)
})

test('the approximate measurer follows Inter widths', () => {
  // Reference widths: canvas measureText with the bundled font in Chromium (at 1000 px, scaled, so unhinted).
  assert.ok(Math.abs(measure('Nearest-neighbour look-up', 13, 600) - 170.8) < 2.5)
  assert.ok(Math.abs(measure('continuous vector', 11, 450) - 94.2) < 1.5)
  assert.ok(measure('Wide', 13, 700) > measure('Wide', 13, 400))
  assert.equal(measure('', 13, 600), 0)
  assert.ok(measure('θ → λ', 12, 600) > 20 && measure('漢字', 12, 600) === 24)
})

test('the browser measurer module imports under Node and falls back to the approximation', async () => {
  const module = await import('../../frontend/src/lib/visual-measure.ts')
  assert.equal(module.measureVisualText('Encoder', 13, 600), measure('Encoder', 13, 600))
  await module.ensureVisualFont()
  assert.equal(await module.visualFontDataUrl(), undefined)
})
