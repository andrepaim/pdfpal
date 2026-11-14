// flow: boxes and arrows with a layered automatic layout (longest-path ranks, barycentre ordering, waypoints on long
// edges so they are routed around nodes, label slots beside long edges, spread ports, two-way edges, group frames).
import type { VisualSceneV2 } from '../visual.js'
import { beatOf, chip, head, hint, hotspot, item, lines, plain, type Ctx, type Pt } from './common.js'
import { TEXT } from './text.js'
import { append, h, r1, type VNode } from './vnode.js'

type FlowScene = Extract<VisualSceneV2, { kind: 'flow' }>
type NodeSpec = FlowScene['nodes'][number]
type EdgeSpec = FlowScene['edges'][number]

type Base = { rank: number; order: number; bary: number; pos: number; cross: number; w: number; h: number; x: number; y: number; m0: number; m1: number }
type Real = Base & { dummy: false; spec: NodeSpec; id: string; out: Edge[]; inn: Edge[]; label: string[]; sub: string[] }
type Dummy = Base & { dummy: true; slot: number; up: Vert[]; down: Vert[]; side: number }
type Vert = Real | Dummy
type Edge = { spec: EdgeSpec; a: Real; b: Real; reversed: boolean; chain: Vert[]; ports: Map<Real, number> }
type Layout = { nodes: Real[]; edges: Edge[]; horizontal: boolean; width: number; height: number }

const base = (): Base => ({ rank: 0, order: 0, bary: 0, pos: 0, cross: 0, w: 0, h: 0, x: 0, y: 0, m0: 0, m1: 0 })
const first = (e: Edge): Real => e.chain[0] as Real
const last = (e: Edge): Real => e.chain[e.chain.length - 1] as Real

function sizeNode(ctx: Ctx, spec: NodeSpec, maxText: number): { w: number; h: number; label: string[]; sub: string[] } {
  const { kit } = ctx
  if (spec.shape === 'op') return { w: 30, h: 30, label: [[...spec.label].slice(0, 3).join('')], sub: [] }
  const label = kit.wrap(spec.label, maxText, TEXT.label), sub = spec.sub ? kit.wrap(spec.sub, Math.max(maxText, 80), TEXT.sub) : []
  const w = Math.max(54, Math.ceil(Math.max(kit.widest(label, TEXT.label), kit.widest(sub, TEXT.sub)) + (spec.shape === 'pill' ? 30 : 24)))
  return { w, h: label.length * 16 + (sub.length ? sub.length * 14 + 3 : 0) + 18, label, sub }
}

function layoutFlow(ctx: Ctx, spec: FlowScene, W: number, horizontal: boolean, shrink = 1): Layout {
  const { kit } = ctx
  const pad = 16
  const nodes: Real[] = spec.nodes.map(n => ({ ...base(), dummy: false, spec: n, id: n.id, out: [], inn: [], label: [], sub: [] }))
  const byId = new Map(nodes.map(n => [n.id, n]))
  const edges: Edge[] = []
  for (const e of spec.edges) {
    const a = byId.get(e.from), b = byId.get(e.to)
    if (a && b && a !== b) edges.push({ spec: e, a, b, reversed: false, chain: [], ports: new Map() })
  }
  // Break cycles so ranks exist, then rank by longest path.
  const state = new Map<Real, number>(), adjacency = new Map<Real, Edge[]>(nodes.map(n => [n, []]))
  for (const e of edges) adjacency.get(e.a)!.push(e)
  const visit = (n: Real) => {
    state.set(n, 1)
    for (const e of adjacency.get(n)!) { const s = state.get(e.b); if (s === 1) e.reversed = true; else if (!s) visit(e.b) }
    state.set(n, 2)
  }
  for (const n of nodes) if (!state.get(n)) visit(n)
  for (const e of edges) { if (e.reversed) [e.a, e.b] = [e.b, e.a]; e.a.out.push(e); e.b.inn.push(e) }
  const indegree = new Map(nodes.map(n => [n, n.inn.length])), queue = nodes.filter(n => !n.inn.length)
  while (queue.length) {
    const n = queue.shift()!
    for (const e of n.out) { e.b.rank = Math.max(e.b.rank, n.rank + 1); indegree.set(e.b, indegree.get(e.b)! - 1); if (!indegree.get(e.b)) queue.push(e.b) }
  }
  for (const n of nodes) if (!n.inn.length && n.out.length) n.rank = Math.min(...n.out.map(e => e.b.rank)) - 1
  const rankCount = Math.max(...nodes.map(n => n.rank)) + 1
  const ranks: Vert[][] = Array.from({ length: rankCount }, () => [])
  for (const n of nodes) ranks[n.rank]!.push(n)
  for (const e of edges) { // long edges get an invisible waypoint in every rank they cross, so they are routed around nodes
    e.chain = [e.a]
    const slot = e.spec.label && !horizontal ? kit.width(e.spec.label, TEXT.chip) + 26 : 10
    for (let r = e.a.rank + 1; r < e.b.rank; r++) {
      const d: Dummy = { ...base(), dummy: true, rank: r, slot, up: [], down: [], side: 1 }
      ranks[r]!.push(d); e.chain.push(d)
    }
    e.chain.push(e.b)
    e.chain.forEach((n, k) => { if (n.dummy) { n.up = [e.chain[k - 1]!]; n.down = [e.chain[k + 1]!] } })
  }
  const up = (n: Vert): Vert[] => n.dummy ? n.up : n.inn.map(e => e.chain[e.chain.length - 2]!)
  const down = (n: Vert): Vert[] => n.dummy ? n.down : n.out.map(e => e.chain[1]!)
  const forward = ranks.map((_, i) => i).slice(1), backward = ranks.map((_, i) => rankCount - 2 - i).filter(i => i >= 0)
  for (const rank of ranks) rank.forEach((n, i) => { n.order = i })
  for (let sweep = 0; sweep < 6; sweep++) for (const r of sweep % 2 ? backward : forward) {
    const near = sweep % 2 ? down : up
    ranks[r]!.forEach(n => { const list = near(n); n.bary = list.length ? list.reduce((s, m) => s + m.order, 0) / list.length : n.order })
    ranks[r]!.sort((a, b) => a.bary - b.bary || a.order - b.order).forEach((n, i) => { n.order = i })
  }
  // Sizes. A node may be as wide as its rank allows.
  const gapCross = horizontal ? 12 : 14
  for (const rank of ranks) {
    const real = rank.filter(n => !n.dummy).length, extra = rank.reduce((sum, n) => sum + (n.dummy ? n.slot + gapCross : 0), 0)
    const room = horizontal ? 112 : Math.min(210, (W - 2 * pad - extra - (real - 1) * gapCross) / Math.max(1, real) - 24)
    for (const n of rank) {
      if (n.dummy) { n.w = n.h = 0; n.cross = n.slot; continue }
      Object.assign(n, sizeNode(ctx, n.spec, Math.max(44, room * shrink)))
      n.cross = horizontal ? n.h : n.w
    }
  }
  // Cross-axis positions: start centred, then pull each node toward its neighbours while keeping order and spacing.
  for (const rank of ranks) {
    let at = 0
    for (const n of rank) { n.pos = at + n.cross / 2; at += n.cross + gapCross }
    const shift = (at - gapCross) / 2
    for (const n of rank) n.pos -= shift
  }
  for (let pass = 0; pass < 14; pass++) for (const r of pass % 2 ? backward : forward) {
    const near = pass % 2 ? down : up, rank = ranks[r]!
    if (!rank.length) continue
    const want = rank.map(n => {
      const all = near(n), real = all.filter(m => !m.dummy), list = n.dummy || !real.length ? all : real
      return list.length ? list.reduce((s, m) => s + m.pos, 0) / list.length : n.pos
    })
    const placed = want.slice()
    for (let i = 1; i < rank.length; i++) placed[i] = Math.max(placed[i]!, placed[i - 1]! + (rank[i - 1]!.cross + rank[i]!.cross) / 2 + gapCross)
    const drift = want.reduce((s, w, i) => s + w - placed[i]!, 0) / rank.length
    rank.forEach((n, i) => { n.pos = placed[i]! + drift })
  }
  const all = ranks.flat()
  const lo = Math.min(...all.map(n => n.pos - n.cross / 2)), hi = Math.max(...all.map(n => n.pos + n.cross / 2))
  // Main-axis positions. A gap crossed by labelled edges grows so the labels have room.
  const grouped = nodes.some(n => n.spec.group)
  const labelled = (r: number) => edges.filter(e => e.spec.label && first(e).rank <= r && last(e).rank > r)
  let at = pad + (grouped ? 6 : 0)
  const bands = ranks.map((rank, r) => {
    const thick = Math.max(0, ...rank.map(n => n.dummy ? 0 : horizontal ? n.w : n.h)), start = at
    const tags = labelled(r)
    at += thick + (horizontal ? Math.max(34, ...tags.map(e => kit.width(e.spec.label!, TEXT.chip) + 30)) : (tags.length ? Math.min(110, 46 + 20 * (tags.length - 1)) : 30)) + (grouped ? 8 : 0)
    return { start, thick }
  })
  const end = bands[rankCount - 1]!
  const mainLength = end.start + end.thick + pad + (grouped && !horizontal ? 10 : 0)
  const crossLength = hi - lo + 2 * pad + (grouped ? 20 : 0), offset = pad - lo + (grouped ? 10 : 0)
  for (const n of all) {
    const band = bands[n.rank]!, main = band.start + band.thick / 2, cross = n.pos + offset
    n.x = horizontal ? main : cross; n.y = horizontal ? cross : main
    n.m0 = band.start; n.m1 = band.start + band.thick
    if (n.dummy && n.slot > 10) { // a labelled long edge runs on the outer side of its slot so the label sits inside it
      const reals = ranks[n.rank]!.filter(m => !m.dummy), centre = reals.length ? reals.reduce((sum, m) => sum + m.pos, 0) / reals.length : n.pos
      n.side = n.pos >= centre ? 1 : -1; n.x += -n.side * (n.slot / 2 - 5)
    }
  }
  return { nodes, edges, horizontal, width: horizontal ? mainLength : crossLength, height: horizontal ? crossLength : mainLength }
}

type Chip = { g: VNode; text: string; x: number; y: number; w: number }

export function drawFlow(ctx: Ctx, spec: FlowScene): { width: number; height: number; kids: VNode[] } {
  const { kit, W } = ctx
  let L: Layout | null = (spec.direction === 'right' || (W >= 560 && spec.direction !== 'down')) ? layoutFlow(ctx, spec, W, true) : null
  if (L && L.width > W) L = null
  for (let shrink = 1; !L || (L.width > W && shrink > 0.55); shrink -= 0.15) L = layoutFlow(ctx, spec, W, false, shrink)
  const lay: Layout = L
  const H = lay.horizontal, shift = Math.max(0, (W - lay.width) / 2), out: VNode[] = [], canvasW = Math.max(W, lay.width)
  for (const n of lay.nodes) n.x += shift
  for (const e of lay.edges) for (const n of e.chain) if (n.dummy) n.x += shift
  // Group frames first, so they sit behind everything.
  const groups = new Map<string, Real[]>(), late: VNode[] = [], chips: Chip[] = []
  const framed: Array<{ members: Real[]; label: string; appear: number; x0: number; x1: number; y0: number; y1: number; rect: VNode; left: number; right: number }> = []
  for (const n of lay.nodes) if (n.spec.group) { const list = groups.get(n.spec.group) ?? []; list.push(n); groups.set(n.spec.group, list) }
  for (const [name, members] of groups) {
    const x0 = Math.min(...members.map(n => n.x - n.w / 2)) - 9, x1 = Math.max(...members.map(n => n.x + n.w / 2)) + 9
    const y0 = Math.min(...members.map(n => n.y - n.h / 2)) - 9, y1 = Math.max(...members.map(n => n.y + n.h / 2)) + 9
    const label = spec.groups?.find(g => g.id === name)?.label ?? name
    // The frame's name goes in the free margin beside it, like a brace label in a textbook figure; edges enter from the ends.
    const others: Vert[] = [...lay.nodes.filter(n => !members.includes(n)), ...lay.edges.flatMap(e => e.chain.filter(n => n.dummy))]
      .filter(n => n.y + n.h / 2 > y0 - 4 && n.y - n.h / 2 < y1 + 4)
    const roomLeft = x0 - 16 - Math.max(0, ...others.filter(n => n.x < x0).map(n => n.x + (n.w || 10) / 2 + 6))
    const roomRight = Math.min(canvasW - 16, ...others.filter(n => n.x > x1).map(n => n.x - (n.w || 10) / 2 - 6)) - x1
    const fits = (room: number) => room >= 50 && kit.widest(kit.wrap(label, room - 10, TEXT.tag), TEXT.tag) <= room - 8
    const side = fits(roomLeft) ? 'left' : fits(roomRight) ? 'right' : 'top'
    const rows = side === 'top' ? [label] : kit.wrap(label, (side === 'left' ? roomLeft : roomRight) - 10, TEXT.tag)
    const appear = Math.min(...members.map(n => n.spec.appear ?? 1))
    const rect = h('rect', { class: 'group', x: r1(x0), y: r1(y0), width: r1(x1 - x0), height: r1(y1 - y0), rx: 12 })
    out.push(plain(ctx, appear, rect))
    if (side === 'top') framed.push({ members, label, appear, x0, x1, y0, y1, rect, left: x0 - roomLeft, right: x1 + roomRight }) // placed once the ports are known
    else late.push(plain(ctx, appear, lines(rows, side === 'left' ? x0 - 9 : x1 + 9, (y0 + y1) / 2, 'tag', 13, side === 'left' ? 'end' : 'start')))
  }
  // Ports: spread the edges that share a side of a node.
  const spread = (n: Real, list: Edge[], key: (e: Edge) => Vert) => {
    const span = (H ? n.h : n.w) - 18, step = list.length > 1 ? Math.min(22, span / (list.length - 1)) : 0
    const sorted = list.slice().sort((a, b) => (H ? key(a).y - key(b).y : key(a).x - key(b).x)), offsets = sorted.map((_, i) => (i - (list.length - 1) / 2) * step)
    // an edge to a node straight ahead leaves from the middle, so the main path stays a straight line
    const straight = sorted.findIndex(e => Math.abs(H ? key(e).y - n.y : key(e).x - n.x) < 2), slide = straight < 0 ? 0 : -offsets[straight]!
    sorted.forEach((e, i) => { e.ports.set(n, n.spec.shape === 'op' ? 0 : Math.max(-span / 2, Math.min(span / 2, offsets[i]! + slide))) })
  }
  for (const n of lay.nodes) { spread(n, n.out, e => e.chain[1]!); spread(n, n.inn, e => e.chain[e.chain.length - 2]!) }
  // A frame name with no room beside the frame sits on its top (or bottom) edge, on a halo, clear of the arrows that
  // enter or leave the frame through that edge.
  for (const f of framed) {
    const w = kit.width(f.label, TEXT.tag)
    const crossings = (top: boolean) => lay.edges.flatMap(e => {
      const a = first(e), b = last(e), inA = f.members.includes(a), inB = f.members.includes(b)
      if (inA === inB) return []
      const inner = inA ? a : b, outer = inA ? b : a
      if (H || (top ? outer.y >= inner.y : outer.y <= inner.y)) return []
      return [inner.x + (e.ports.get(inner) ?? 0)]
    })
    // long edges running past the frame's edge as straight lines through their waypoints
    const passing = (y: number) => H ? [] : lay.edges.flatMap(e => e.chain.filter((d): d is Dummy => d.dummy && y > d.m0 - 24 && y < d.m1 + 24).map(d => d.x))
    const spot = (top: boolean) => {
      const xs = [...crossings(top), ...passing(top ? f.y0 : f.y1)], starts = [f.x0 + 10, f.x1 - 10 - w, ...xs.map(x => x + 8), ...xs.map(x => x - 8 - w)]
      return starts.find(sx => sx >= f.x0 + 6 && sx + w <= Math.min(canvasW - 4, f.x1 + 24) && xs.every(x => x < sx - 4 || x > sx + w + 4))
    }
    let top = spot(true), bottom = top === undefined ? spot(false) : undefined
    if (top === undefined && bottom === undefined) { // a narrow frame: widen it into the free margin so the name fits beside the arrows
      const xs = [...crossings(true), ...passing(f.y0)]
      const wantLeft = Math.min(...xs) - 8 - w - 10, wantRight = Math.max(...xs) + 8 + w + 10
      if (xs.length && wantLeft >= f.left - 6 && wantLeft < f.x0) { f.x0 = wantLeft; top = f.x0 + 10 }
      else if (xs.length && wantRight <= f.right + 6 && wantRight > f.x1) { f.x1 = wantRight; top = wantRight - 10 - w }
      f.rect.attrs.x = r1(f.x0); f.rect.attrs.width = r1(f.x1 - f.x0)
    }
    const atBottom = top === undefined && (bottom !== undefined || crossings(true).length > crossings(false).length)
    const x = top ?? bottom ?? f.x0 + 10
    late.push(plain(ctx, f.appear, h('text', { class: 'tag halo', x: r1(x), y: r1(atBottom ? f.y1 : f.y0), 'dominant-baseline': 'central' }, f.label)))
  }
  // Labels on short edges that leave the same gap are staggered along the arrows.
  const along = new Map<Edge, number>(), gaps = new Map<number, Edge[]>()
  for (const e of lay.edges) if (e.spec.label && e.chain.length === 2 && !lay.edges.some(o => o !== e && o.chain.length === 2 && o.chain[0] === e.chain[0] && o.chain[1] === e.chain[1])) {
    const list = gaps.get(first(e).rank) ?? []; list.push(e); gaps.set(first(e).rank, list)
  }
  for (const list of gaps.values()) if (list.length > 1) list
    .sort((a, b) => (H ? first(a).y - first(b).y : first(a).x + (a.ports.get(first(a)) ?? 0) - first(b).x - (b.ports.get(first(b)) ?? 0)))
    .forEach((e, i) => along.set(e, 0.2 + 0.6 * i / (list.length - 1)))
  for (const e of lay.edges) {
    const a = first(e), b = last(e), pts: Pt[] = []
    const port = (n: Real, side: 0 | 1): Pt => { const off = e.ports.get(n) ?? 0; return H ? [side ? n.x + n.w / 2 : n.x - n.w / 2, n.y + off] : [n.x + off, side ? n.y + n.h / 2 : n.y - n.h / 2] }
    pts.push(port(a, 1))
    for (const d of e.chain.slice(1, -1)) { pts.push(H ? [d.m0 + shift, d.y] : [d.x, d.m0]); pts.push(H ? [d.m1 + shift, d.y] : [d.x, d.m1]) }
    pts.push(port(b, 0))
    // the visible arrow points from spec.from to spec.to; a reversed edge is drawn tip-first
    const tipAtEnd = !e.reversed, gap = 2.5, trim = 5
    const p0 = pts[0]!, pn = pts[pts.length - 1]!
    if (H) { p0[0] += tipAtEnd ? gap : gap + trim; pn[0] -= tipAtEnd ? gap + trim : gap } else { p0[1] += tipAtEnd ? gap : gap + trim; pn[1] -= tipAtEnd ? gap + trim : gap }
    let d = `M${r1(p0[0])} ${r1(p0[1])}`
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i - 1]!, q = pts[i]!
      if (i % 2 === 0 && pts.length > 2) d += `L${r1(q[0])} ${r1(q[1])}` // straight run through a waypoint band
      else if (H ? Math.abs(p[1] - q[1]) < 0.5 : Math.abs(p[0] - q[0]) < 0.5) d += `L${r1(q[0])} ${r1(q[1])}`
      else if (H) { const m = (p[0] + q[0]) / 2; d += `C${r1(m)} ${r1(p[1])} ${r1(m)} ${r1(q[1])} ${r1(q[0])} ${r1(q[1])}` }
      else { const m = (p[1] + q[1]) / 2; d += `C${r1(p[0])} ${r1(m)} ${r1(q[0])} ${r1(m)} ${r1(q[0])} ${r1(q[1])}` }
    }
    const tip = tipAtEnd ? pn : p0, sign = tipAtEnd ? 1 : -1
    const tipPoint: Pt = H ? [tip[0] + sign * trim, tip[1]] : [tip[0], tip[1] + sign * trim]
    const t = along.get(e) ?? 0.5, q0 = pts[0]!, q3 = pts[1]!
    const bend: [Pt, Pt] = H ? [[(q0[0] + q3[0]) / 2, q0[1]], [(q0[0] + q3[0]) / 2, q3[1]]] : [[q0[0], (q0[1] + q3[1]) / 2], [q3[0], (q0[1] + q3[1]) / 2]]
    const bez = (k: 0 | 1) => (1 - t) ** 3 * q0[k] + 3 * (1 - t) ** 2 * t * bend[0][k] + 3 * (1 - t) * t * t * bend[1][k] + t ** 3 * q3[k]
    let mid: Pt = [bez(0), bez(1)]
    const way = e.chain.filter((n): n is Dummy => n.dummy)
    const w0 = way[0], wn = way[way.length - 1]
    if (w0 && wn && w0.slot > 10) mid = [w0.x + w0.side * (w0.slot / 2 - 2), (w0.m0 + wn.m1) / 2] // beside the long straight run
    const twin = lay.edges.find(o => o !== e && o.chain.length === 2 && e.chain.length === 2 && o.chain[0] === a && o.chain[1] === b)
    let anchor: 'start' | 'end' | null = null
    if (twin && e.spec.label && !H) { // two arrows between the same pair: each label sits on the outer side of its own arrow
      const leftOne = (e.ports.get(a) ?? 0) < (twin.ports.get(a) ?? 0)
      anchor = leftOne ? 'end' : 'start'; mid = [mid[0] + (leftOne ? -8 : 8), mid[1]]
    }
    const g = item(ctx, { tone: e.spec.tone ?? 'neutral', appear: beatOf(ctx, e.spec.appear, a.spec.appear, b.spec.appear) }, null,
      h('path', { class: e.spec.dashed ? 'edge dashed' : 'edge', d }), head(tipPoint[0], tipPoint[1], H ? sign : 0, H ? 0 : sign))
    out.push(g)
    if (e.spec.label) {
      const w = kit.width(e.spec.label, TEXT.chip) + 10
      chips.push({ g, text: e.spec.label, x: mid[0] + (anchor === 'end' ? -w / 2 : anchor === 'start' ? w / 2 : 0), y: mid[1], w })
    }
  }
  // Labels that would sit on top of each other move apart along the arrows.
  chips.sort((p, q) => p.y - q.y || p.x - q.x)
  for (let i = 0; i < chips.length; i++) for (let j = 0; j < i; j++) {
    const p = chips[j]!, q = chips[i]!
    if (Math.abs(p.x - q.x) < (p.w + q.w) / 2 + 4 && Math.abs(p.y - q.y) < 17) { const push = (17 - Math.abs(p.y - q.y)) / 2 + 0.5; p.y -= push; q.y += push }
  }
  for (const c of chips) { c.x = Math.max(c.w / 2 + 4, Math.min(canvasW - c.w / 2 - 4, c.x)); append(c.g, ...chip(kit, c.text, c.x, c.y)) }
  out.push(...late)
  for (const n of lay.nodes) {
    const s = n.spec, x = n.x - n.w / 2, y = n.y - n.h / 2
    const shape = s.shape === 'op' ? h('circle', { class: 'shape', cx: r1(n.x), cy: r1(n.y), r: 15 })
      : h('rect', { class: 'shape', x: r1(x), y: r1(y), width: r1(n.w), height: r1(n.h), rx: s.shape === 'pill' ? r1(n.h / 2) : 9 })
    const block = n.label.length * 16 + (n.sub.length ? n.sub.length * 14 + 3 : 0), top = n.y - block / 2
    const node = item(ctx, s, null, shape,
      lines(n.label, n.x, top + n.label.length * 8, 'label', 16),
      n.sub.length ? lines(n.sub, n.x, top + n.label.length * 16 + 3 + n.sub.length * 7, 'sub', 14) : null,
      // the "has more" dot sits on the outline's top-right: the corner of a box, 45° round the end of a pill or circle
      s.detail ? (s.shape === 'op' ? hint(n.x + 11, n.y - 11)
        : s.shape === 'pill' ? hint(n.x + n.w / 2 - n.h / 2 + n.h / 2 * Math.SQRT1_2, n.y - n.h / 2 * Math.SQRT1_2)
        : hint(n.x + n.w / 2 - 2, y + 2)) : null)
    if (s.detail) hotspot(ctx, node, s.id, s.label, s.detail)
    out.push(node)
  }
  return { width: canvasW, height: lay.height, kids: out }
}
