// Geometry lint for laid-out figures: the checks of the visual study's lint (lint2.mjs), run on the kit's VNode tree with
// a text measurer instead of on a browser's getBBox(). Everything is linted as on the last beat (all items visible).
import { TEXT, makeKit, type Measure, type TextStyle, type VNode } from '../../src/shared/visual-kit/index.js'

export type LintIssue = { kind: string; note: string }
type Box = { x: number; y: number; w: number; h: number }
type Pt = [number, number]
type Placed = { node: VNode; parent: VNode; group: VNode; classes: Set<string> }

// Inter's ascender and descender (em), which is what a browser's text bounding box spans.
const ASC = 0.96875, DESC = 0.2421875
const STYLES: Record<string, TextStyle> = {
  label: TEXT.label, sub: TEXT.sub, tag: TEXT.tag, chiptext: TEXT.chip, tick: TEXT.tick, direct: TEXT.direct,
  value: TEXT.value, celltext: TEXT.cell, body: TEXT.body, fallback: { size: 13, weight: 400 },
}
const classesOf = (node: VNode) => new Set(String(node.attrs.class ?? '').split(/\s+/).filter(Boolean))
const num = (node: VNode, key: string) => Number(node.attrs[key] ?? 0)
const area = (a: Box, b: Box) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
const shrink = (b: Box, n: number): Box => ({ x: b.x + n, y: b.y + n, w: Math.max(0, b.w - 2 * n), h: Math.max(0, b.h - 2 * n) })
const within = (o: Box, n: Box) => n.x >= o.x - 1 && n.y >= o.y - 1 && n.x + n.w <= o.x + o.w + 1 && n.y + n.h <= o.y + o.h + 1

function textStyle(node: VNode, classes: Set<string>): TextStyle {
  let style: TextStyle = { size: 13, weight: 400 }
  for (const name of classes) if (STYLES[name]) style = STYLES[name]
  if (classes.has('note')) style = TEXT.note
  const override = /font-size:\s*([\d.]+)px/.exec(String(node.attrs.style ?? ''))
  if (override) style = { ...style, size: Number(override[1]) }
  return style
}

function textBox(node: VNode, classes: Set<string>, kit: ReturnType<typeof makeKit>): { box: Box; words: string } | null {
  const style = textStyle(node, classes), anchor = String(node.attrs['text-anchor'] ?? 'start')
  const rows: Array<{ text: string; x: number; y: number; central: boolean }> = []
  const spans = node.children.filter((kid): kid is VNode => typeof kid !== 'string' && kid.tag === 'tspan')
  if (spans.length) for (const span of spans) rows.push({ text: span.children.filter((k): k is string => typeof k === 'string').join(''), x: num(span, 'x'), y: num(span, 'y'), central: span.attrs['dominant-baseline'] === 'central' })
  else rows.push({ text: node.children.filter((k): k is string => typeof k === 'string').join(''), x: num(node, 'x'), y: num(node, 'y'), central: node.attrs['dominant-baseline'] === 'central' })
  let box: Box | null = null
  for (const row of rows) {
    if (!row.text.trim()) continue
    const w = kit.width(row.text, style), x = anchor === 'middle' ? row.x - w / 2 : anchor === 'end' ? row.x - w : row.x
    const top = row.central ? row.y - (ASC + DESC) / 2 * style.size : row.y - ASC * style.size
    const b = { x, y: top, w, h: (ASC + DESC) * style.size }
    box = box ? { x: Math.min(box.x, b.x), y: Math.min(box.y, b.y), w: Math.max(box.x + box.w, b.x + b.w) - Math.min(box.x, b.x), h: Math.max(box.y + box.h, b.y + b.h) - Math.min(box.y, b.y) } : b
  }
  return box ? { box, words: rows.map(r => r.text).join(' ').trim() } : null
}

/** Points every ~3 px along an absolute SVG path (M L H V C Q A Z), or a line element. */
export function samplePath(node: VNode): Pt[] {
  if (node.tag === 'line') return sampleSegment([num(node, 'x1'), num(node, 'y1')], [num(node, 'x2'), num(node, 'y2')])
  const tokens = String(node.attrs.d ?? '').match(/[MLHVCQAZ]|-?\d*\.?\d+(?:e-?\d+)?/gi) ?? []
  const out: Pt[] = []
  let i = 0, cmd = 'M', at: Pt = [0, 0], start: Pt = [0, 0]
  const next = () => Number(tokens[i++])
  while (i < tokens.length) {
    if (/[a-z]/i.test(tokens[i]!)) cmd = tokens[i++]!.toUpperCase()
    if (cmd === 'Z') { out.push(...sampleSegment(at, start)); at = start; continue }
    if (cmd === 'M') { at = [next(), next()]; start = at; out.push(at); cmd = 'L'; continue }
    if (cmd === 'L') { const p: Pt = [next(), next()]; out.push(...sampleSegment(at, p)); at = p }
    else if (cmd === 'H') { const p: Pt = [next(), at[1]]; out.push(...sampleSegment(at, p)); at = p }
    else if (cmd === 'V') { const p: Pt = [at[0], next()]; out.push(...sampleSegment(at, p)); at = p }
    else if (cmd === 'C') {
      const c1: Pt = [next(), next()], c2: Pt = [next(), next()], p: Pt = [next(), next()], p0 = at
      const n = Math.max(4, Math.ceil((Math.hypot(c1[0] - p0[0], c1[1] - p0[1]) + Math.hypot(c2[0] - c1[0], c2[1] - c1[1]) + Math.hypot(p[0] - c2[0], p[1] - c2[1])) / 3))
      for (let k = 1; k <= n; k++) { const t = k / n, a = 1 - t; out.push([a ** 3 * p0[0] + 3 * a * a * t * c1[0] + 3 * a * t * t * c2[0] + t ** 3 * p[0], a ** 3 * p0[1] + 3 * a * a * t * c1[1] + 3 * a * t * t * c2[1] + t ** 3 * p[1]]) }
      at = p
    } else if (cmd === 'Q') {
      const c: Pt = [next(), next()], p: Pt = [next(), next()], p0 = at
      const n = Math.max(4, Math.ceil((Math.hypot(c[0] - p0[0], c[1] - p0[1]) + Math.hypot(p[0] - c[0], p[1] - c[1])) / 3))
      for (let k = 1; k <= n; k++) { const t = k / n, a = 1 - t; out.push([a * a * p0[0] + 2 * a * t * c[0] + t * t * p[0], a * a * p0[1] + 2 * a * t * c[1] + t * t * p[1]]) }
      at = p
    } else if (cmd === 'A') {
      let rx = Math.abs(next()), ry = Math.abs(next())
      const phi = next() * Math.PI / 180, large = next(), sweep = next(), p: Pt = [next(), next()]
      // endpoint to centre parameterisation (SVG 1.1, F.6.5)
      const cos = Math.cos(phi), sin = Math.sin(phi), dx = (at[0] - p[0]) / 2, dy = (at[1] - p[1]) / 2
      const x1 = cos * dx + sin * dy, y1 = -sin * dx + cos * dy
      const lambda = x1 * x1 / (rx * rx) + y1 * y1 / (ry * ry)
      if (lambda > 1) { rx *= Math.sqrt(lambda); ry *= Math.sqrt(lambda) }
      const sign = large === sweep ? -1 : 1
      const coef = sign * Math.sqrt(Math.max(0, (rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1) / (rx * rx * y1 * y1 + ry * ry * x1 * x1)))
      const cxp = coef * rx * y1 / ry, cyp = -coef * ry * x1 / rx
      const cx = cos * cxp - sin * cyp + (at[0] + p[0]) / 2, cy = sin * cxp + cos * cyp + (at[1] + p[1]) / 2
      const angle = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
      const t1 = angle(1, 0, (x1 - cxp) / rx, (y1 - cyp) / ry)
      let dt = angle((x1 - cxp) / rx, (y1 - cyp) / ry, (-x1 - cxp) / rx, (-y1 - cyp) / ry)
      if (!sweep && dt > 0) dt -= 2 * Math.PI
      if (sweep && dt < 0) dt += 2 * Math.PI
      const n = Math.max(4, Math.ceil(Math.abs(dt) * Math.max(rx, ry) / 3))
      for (let k = 1; k <= n; k++) { const t = t1 + dt * k / n; out.push([cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos]) }
      at = p
    } else i++ // unknown token: skip
  }
  return out
}
function sampleSegment(a: Pt, b: Pt): Pt[] {
  const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 3)), out: Pt[] = []
  for (let k = 0; k <= n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n])
  return out
}

/** Lints a laid-out figure. Returns one issue per defect, in the categories of the study's lint. */
export function lintDrawing(svg: VNode, measure: Measure): LintIssue[] {
  const kit = makeKit(measure), issues: LintIssue[] = []
  const [, , vw = 0, vh = 0] = String(svg.attrs.viewBox).split(/\s+/).map(Number)
  const placed: Placed[] = []
  const visit = (node: VNode, parent: VNode, group: VNode | null) => {
    const classes = classesOf(node)
    const own = node.tag === 'g' && classes.has('el') ? node : group
    placed.push({ node, parent, group: own ?? (parent.tag === 'g' ? parent : node), classes })
    for (const kid of node.children) if (typeof kid !== 'string' && kid.tag !== 'tspan') visit(kid, node, own)
  }
  for (const kid of svg.children) if (typeof kid !== 'string') visit(kid, svg, null)
  const texts = placed.filter(p => p.node.tag === 'text').flatMap(p => {
    const t = textBox(p.node, p.classes, kit)
    if (!t || t.box.w <= 0) return []
    const siblings = p.parent.children, index = siblings.indexOf(p.node), previous = index > 0 ? siblings[index - 1] : undefined
    const masked = typeof previous === 'object' && classesOf(previous).has('chip')
    return [{ ...p, b: t.box, words: t.words, masked }]
  })
  const boxes = placed.filter(p => ['rect', 'circle', 'ellipse'].includes(p.node.tag) && (p.classes.has('shape') || p.classes.has('cell'))).map(p => {
    const n = p.node
    const b: Box = n.tag === 'rect' ? { x: num(n, 'x'), y: num(n, 'y'), w: num(n, 'width'), h: num(n, 'height') }
      : n.tag === 'circle' ? { x: num(n, 'cx') - num(n, 'r'), y: num(n, 'cy') - num(n, 'r'), w: 2 * num(n, 'r'), h: 2 * num(n, 'r') }
      : { x: num(n, 'cx') - num(n, 'rx'), y: num(n, 'cy') - num(n, 'ry'), w: 2 * num(n, 'rx'), h: 2 * num(n, 'ry') }
    return { ...p, b, card: p.classes.has('card') }
  }).filter(s => s.b.w * s.b.h > 300)
  const strokes = placed.filter(p => (p.node.tag === 'path' || p.node.tag === 'line') && ['edge', 'curve', 'axis', 'leader'].some(c => p.classes.has(c)) && !p.classes.has('area'))
  const name = (t: { words: string }) => `"${t.words.slice(0, 28)}"`
  for (const t of texts) {
    if (t.b.x < -1 || t.b.y < -1 || t.b.x + t.b.w > vw + 1 || t.b.y + t.b.h > vh + 1) issues.push({ kind: 'text leaves the canvas', note: name(t) })
    const own = boxes.find(s => s.group === t.group && s.parent === t.parent)
    if (own && (t.b.w > own.b.w - 4 || t.b.h > own.b.h - 2)) issues.push({ kind: 'label overflows its box', note: name(t) })
    // A card is a container: text laid out inside it on its own beat is not a collision.
    for (const s of boxes) if (s.group !== t.group && !(s.card && within(s.b, t.b)) && area(shrink(t.b, 2), s.b) > 8) issues.push({ kind: 'text collides with a box', note: name(t) })
  }
  for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++)
    if (area(shrink(texts[i]!.b, 1.5), shrink(texts[j]!.b, 1.5)) > 6) issues.push({ kind: 'two labels overlap', note: `${name(texts[i]!)} and ${name(texts[j]!)}` })
  for (const line of strokes) {
    const hit = new Set<typeof texts[number]>()
    for (const p of samplePath(line.node)) for (const t of texts) {
      if (t.masked || hit.has(t)) continue
      const b = shrink(t.b, 2.5)
      if (p[0] > b.x && p[0] < b.x + b.w && p[1] > b.y && p[1] < b.y + b.h) hit.add(t)
    }
    for (const t of hit) issues.push({ kind: 'a line runs through a label', note: name(t) })
  }
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i]!, b = boxes[j]!
    if (a.group === b.group || area(a.b, b.b) < 12) continue
    if (!within(a.b, b.b) && !within(b.b, a.b)) issues.push({ kind: 'two boxes overlap', note: '' })
  }
  return issues
}
