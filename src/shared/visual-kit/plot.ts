// plot: axes, curves, points, regions, vectors, angles and notes in data coordinates. Labels are placed by trying
// preferred sides in order around their anchor, avoiding the ink of every line, axis, tick and earlier label, and get a
// leader line when they had to move away.
import type { VisualSceneV2 } from '../visual.js'
import { densify, head, item, lines, overlapArea, smooth, type Box, type Ctx, type Pt } from './common.js'
import { TEXT } from './text.js'
import { append, h, r1, type VNode } from './vnode.js'

type PlotScene = Extract<VisualSceneV2, { kind: 'plot' }>
type Mark = PlotScene['marks'][number]
type Dir = 'c' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
type Request = { g: VNode; text: string; x: number; y: number; order: Dir[]; gap: number; note?: boolean }

const DIRS: Record<Dir, Pt> = { c: [0, 0], n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0], ne: [1, -1], nw: [-1, -1], se: [1, 1], sw: [-1, 1] }

function markPoints(m: Mark): Pt[] {
  switch (m.type) {
    case 'curve': case 'area': return m.points
    case 'line': case 'vector': return [m.from, m.to]
    case 'point': case 'note': return [m.xy]
    case 'circle': return [[m.center[0] - m.r, m.center[1] - m.r], [m.center[0] + m.r, m.center[1] + m.r]]
    case 'angle': return [m.vertex, m.from, m.to]
  }
}

export function drawPlot(ctx: Ctx, spec: PlotScene): { width: number; height: number; kids: VNode[] } {
  const { kit, W } = ctx
  const axes = spec.axes !== false, xa = spec.x, ya = spec.y
  let xmin = xa.min, xmax = xa.max, ymin = ya.min, ymax = ya.max
  if (!axes) { // without axes the frame fits the marks
    const pts = spec.marks.flatMap(markPoints)
    if (pts.length > 1) {
      const x0 = Math.min(...pts.map(p => p[0])), x1 = Math.max(...pts.map(p => p[0])), y0 = Math.min(...pts.map(p => p[1])), y1 = Math.max(...pts.map(p => p[1]))
      const px = Math.max((x1 - x0) * 0.2, 1e-6), py = Math.max((y1 - y0) * 0.3, 1e-6)
      xmin = x0 - px; xmax = x1 + px; ymin = y0 - py; ymax = y1 + py
    }
  }
  const yTicks = axes ? ya.ticks ?? [] : [], xTicks = axes ? xa.ticks ?? [] : []
  const tickW = yTicks.length ? Math.max(...yTicks.map(t => kit.width(t.label, TEXT.tick))) + 10 : 0
  const left = axes ? 18 + tickW : 16, right = axes ? 22 : 16, top = axes ? 30 : 16, bottom = axes ? (xTicks.length ? 48 : 34) : 16
  const iw = W - left - right
  const ih = Math.round(spec.equal ? Math.min(iw * 1.15, Math.max(iw * 0.45, iw * (ymax - ymin) / (xmax - xmin))) : iw * 0.66)
  const sx = (v: number) => left + (v - xmin) / (xmax - xmin) * iw, sy = (v: number) => top + ih - (v - ymin) / (ymax - ymin) * ih
  const P = (p: Pt): Pt => [sx(p[0]), sy(p[1])]
  const out: VNode[] = [], obstacles: Box[] = [], requests: Request[] = [], arcs = new Map<string, number>(), H = top + ih + bottom
  if (axes) {
    for (const t of yTicks) {
      out.push(h('line', { class: 'gridline', x1: r1(left), x2: r1(left + iw), y1: r1(sy(t.at)), y2: r1(sy(t.at)) }),
        h('text', { class: 'tick', x: r1(left - 7), y: r1(sy(t.at)), 'text-anchor': 'end', 'dominant-baseline': 'central' }, t.label))
      const w = kit.width(t.label, TEXT.tick)
      obstacles.push({ x: left - 7 - w, y: sy(t.at) - 7, w, h: 14 })
    }
    for (const t of xTicks) {
      out.push(h('line', { class: 'gridline', y1: r1(top), y2: r1(top + ih), x1: r1(sx(t.at)), x2: r1(sx(t.at)) }),
        h('text', { class: 'tick', x: r1(sx(t.at)), y: r1(top + ih + 17), 'text-anchor': 'middle' }, t.label))
      const w = Math.max(28, kit.width(t.label, TEXT.tick) + 4)
      obstacles.push({ x: sx(t.at) - w / 2, y: top + ih + 6, w, h: 14 })
    }
    out.push(h('path', { class: 'axis', d: `M${r1(left)} ${r1(top - 6)}V${r1(top + ih)}H${r1(left + iw + 6)}` }))
    if (ya.label) out.push(h('text', { class: 'tag', x: r1(left - tickW), y: 14, 'dominant-baseline': 'central' }, ya.label))
    if (xa.label) out.push(h('text', { class: 'tag', x: r1(left + iw), y: r1(H - 12), 'text-anchor': 'end', 'dominant-baseline': 'central' }, xa.label))
    obstacles.push({ x: left - 3, y: top, w: 6, h: ih }, { x: left, y: top + ih - 3, w: iw, h: 6 })
    if (ya.label) obstacles.push({ x: left - tickW, y: 6, w: kit.width(ya.label, TEXT.tag), h: 16 })
    if (xa.label) { const w = kit.width(xa.label, TEXT.tag); obstacles.push({ x: left + iw - w, y: H - 20, w, h: 16 }) }
  }
  const block = (pts: Pt[], size = 9) => { // reserve the ink of a line so labels stay off it
    for (let i = 1; i < pts.length; i++) {
      const [x1, y1] = pts[i - 1]!, [x2, y2] = pts[i]!, n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 7))
      for (let k = 0; k <= n; k++) obstacles.push({ x: x1 + (x2 - x1) * k / n - size / 2, y: y1 + (y2 - y1) * k / n - size / 2, w: size, h: size })
    }
  }
  for (const m of spec.marks) {
    const g = item(ctx, m, null); out.push(g)
    const ask = (text: string | undefined, x: number, y: number, order: Dir[], gap = 9) => { if (text) requests.push({ g, text, x, y, order, gap }) }
    if (m.type === 'curve') {
      const pts = m.points.map(P), isSmooth = pts.length > 2
      append(g, h('path', { class: m.dashed ? 'curve dashed' : 'curve', d: smooth(pts) }))
      block(isSmooth ? densify(pts) : pts)
      const k = m.labelAt === 'start' ? 0 : m.labelAt === 'peak' ? pts.reduce((best, p, i) => p[1] < pts[best]![1] ? i : best, 0) : pts.length - 1
      const at = pts[k]!
      ask(m.label, at[0], at[1], m.labelAt === 'start' ? ['n', 'ne', 's', 'se', 'e'] : ['n', 'nw', 's', 'sw', 'ne', 'se', 'w'], 8)
    } else if (m.type === 'line' || m.type === 'vector') {
      const a = P(m.from), b = P(m.to), n = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, ux = (b[0] - a[0]) / n, uy = (b[1] - a[1]) / n, vector = m.type === 'vector'
      const end: Pt = vector ? [b[0] - ux * 5, b[1] - uy * 5] : b
      const dashed = m.type === 'line' && m.dashed
      append(g, h('path', { class: `curve ${vector ? 'w-vector' : 'w-line'}${dashed ? ' dashed' : ''}`, d: `M${r1(a[0])} ${r1(a[1])}L${r1(end[0])} ${r1(end[1])}` }))
      if (vector) append(g, head(b[0], b[1], ux, uy, 8))
      block([a, b])
      const mid = m.type === 'line' && m.labelAt === 'mid', lx = mid ? (a[0] + b[0]) / 2 : b[0], ly = mid ? (a[1] + b[1]) / 2 : b[1]
      const ahead = `${Math.abs(uy) > 0.38 ? (uy < 0 ? 'n' : 's') : ''}${Math.abs(ux) > 0.38 ? (ux > 0 ? 'e' : 'w') : ''}` as Dir
      const order: Dir[] = mid ? (Math.abs(ux) > Math.abs(uy) ? ['n', 's'] : ['e', 'w'])
        : [ahead, ...(ux >= 0 ? ['e', 'ne', 'se', 'n', 's'] as Dir[] : ['w', 'nw', 'sw', 'n', 's'] as Dir[]).filter(key => key !== ahead)]
      ask(m.label, lx, ly, order, 7)
    } else if (m.type === 'point') {
      const p = P(m.xy)
      append(g, h('circle', { class: 'dot', cx: r1(p[0]), cy: r1(p[1]), r: 5 }))
      obstacles.push({ x: p[0] - 7, y: p[1] - 7, w: 14, h: 14 })
      ask(m.label, p[0], p[1], ['ne', 'e', 'se', 'n', 's', 'nw', 'w', 'sw'], 9)
    } else if (m.type === 'area') {
      const pts = m.points.map(P)
      append(g, h('path', { class: 'area', d: `${pts.map((p, i) => `${i ? 'L' : 'M'}${r1(p[0])} ${r1(p[1])}`).join('')}Z` }))
      if (m.label) requests.push({ g, text: m.label, x: pts.reduce((s, p) => s + p[0], 0) / pts.length, y: pts.reduce((s, p) => s + p[1], 0) / pts.length, order: ['c', 'n', 's', 'e', 'w'], gap: 0 })
    } else if (m.type === 'circle') {
      const c = P(m.center), rx = Math.abs(sx(m.center[0] + m.r) - c[0]), ry = Math.abs(sy(m.center[1] + m.r) - c[1])
      append(g, h('ellipse', { class: `curve w-ring${m.dashed ? ' dashed' : ''}`, cx: r1(c[0]), cy: r1(c[1]), rx: r1(rx), ry: r1(ry) }))
      const ring: Pt[] = []
      for (let k = 0; k <= 48; k++) ring.push([c[0] + rx * Math.cos(k * Math.PI / 24), c[1] + ry * Math.sin(k * Math.PI / 24)])
      block(ring, 7)
      ask(m.label, c[0] + rx * 0.64, c[1] + ry * 0.77, ['se', 's', 'e', 'sw'], 5)
    } else if (m.type === 'angle') {
      const v = P(m.vertex), a = P(m.from), b = P(m.to), key = `${Math.round(v[0])},${Math.round(v[1])}`, radius = 30 + 14 * (arcs.get(key) ?? 0)
      arcs.set(key, (arcs.get(key) ?? 0) + 1)
      const t0 = Math.atan2(a[1] - v[1], a[0] - v[0]), t1 = Math.atan2(b[1] - v[1], b[0] - v[0])
      let delta = t1 - t0
      while (delta > Math.PI) delta -= 2 * Math.PI
      while (delta < -Math.PI) delta += 2 * Math.PI
      const p0: Pt = [v[0] + radius * Math.cos(t0), v[1] + radius * Math.sin(t0)], p1: Pt = [v[0] + radius * Math.cos(t0 + delta), v[1] + radius * Math.sin(t0 + delta)]
      append(g, h('path', { class: 'curve w-ring', d: `M${r1(p0[0])} ${r1(p0[1])}A${radius} ${radius} 0 0 ${delta > 0 ? 1 : 0} ${r1(p1[0])} ${r1(p1[1])}` }))
      const arc: Pt[] = []
      for (let k = 0; k <= 12; k++) arc.push([v[0] + radius * Math.cos(t0 + delta * k / 12), v[1] + radius * Math.sin(t0 + delta * k / 12)])
      block(arc, 7)
      const tm = t0 + delta / 2
      if (m.label) requests.push({ g, text: m.label, x: v[0] + (radius + 13) * Math.cos(tm), y: v[1] + (radius + 13) * Math.sin(tm), order: ['c', 'e', 'n', 'w', 's'], gap: 4 })
    } else {
      const p = P(m.xy)
      requests.push({ g, text: m.text, x: p[0], y: p[1], order: ['c', 'n', 's', 'e', 'w'], gap: 6, note: true })
    }
  }
  // Label placement: try the preferred sides in order and keep the first spot that is free and on the canvas.
  const placed: Box[] = []
  // Points along the leader a label at `box` would need (null when it sits close enough to its anchor not to need one).
  const leaderOf = (q: { x: number; y: number; gap?: number }, box: Box): Pt[] | null => {
    const nx = Math.max(box.x, Math.min(box.x + box.w, q.x)), ny = Math.max(box.y, Math.min(box.y + box.h, q.y)), away = Math.hypot(nx - q.x, ny - q.y)
    if (away <= 15 || !q.gap) return null
    const ux = (nx - q.x) / away, uy = (ny - q.y) / away, from: Pt = [q.x + ux * 7, q.y + uy * 7], to: Pt = [nx - ux, ny - uy], n = Math.max(1, Math.ceil((away - 8) / 3))
    return Array.from({ length: n + 1 }, (_, k) => [from[0] + (to[0] - from[0]) * k / n, from[1] + (to[1] - from[1]) * k / n] as Pt)
  }
  for (const q of requests) {
    const style = q.note ? TEXT.note : TEXT.direct
    const rows = kit.wrap(q.text, Math.min(150, iw * 0.55), style), w = kit.widest(rows, style), hh = rows.length * 15
    let best: { cost: number; cx: number; cy: number; box: Box } | null = null
    const order = q.order.concat((['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as Dir[]).filter(key => !q.order.includes(key)))
    // Each side is tried centred first, then slid along its edge (so a label can sit beside a crowded spot).
    search: for (const [ring, reach] of [1, 2.4, 4, 5.6, 7.5, 10].entries()) for (const [rank, key] of order.entries()) for (const slide of key.length === 1 && key !== 'c' ? [0, -0.5, 0.5, -1, 1] : [0]) {
      const [dx, dy] = DIRS[key], diagonal = dx && dy ? 0.72 : 1, gap = (q.gap || 8) * reach
      const cx = q.x + dx * (gap * diagonal + w / 2 + (dx ? 2 : 0)) + (dy ? slide * w / 2 : 0)
      const cy = q.y + dy * (gap * diagonal + hh / 2 + (dy && !dx ? 2 : 0)) + (dx ? slide * (hh / 2 + 4) : 0)
      const box = { x: cx - w / 2 - 3, y: cy - hh / 2 - 2, w: w + 6, h: hh + 4 }
      const outside = Math.max(0, 4 - box.x) + Math.max(0, box.x + box.w - (W - 4)) + Math.max(0, 4 - box.y) + Math.max(0, box.y + box.h - (H - 4))
      const penalty = rank * 0.5 + ring * 3 + Math.abs(slide) * 1.5
      // A label far from its anchor gets a leader line; that line must not cross a label already placed.
      // It must not cross a label already placed, and should not run along other lines, where it would read as theirs.
      const inside = (p: Pt, b: Box) => p[0] > b.x && p[0] < b.x + b.w && p[1] > b.y && p[1] < b.y + b.h
      const leader = leaderOf(q, box)
      const crossed = leader?.reduce((n, p) => n + placed.filter(b => inside(p, b)).length, 0) ?? 0
      const alongInk = leader?.slice(3).filter(p => obstacles.some(o => o.w < 10 && inside(p, o))).length ?? 0
      const cost = obstacles.reduce((s, o) => s + overlapArea(box, o), 0) + outside * 60 + penalty + crossed * 400 + Math.max(0, alongInk - 3) * 40
      if (!best || cost < best.cost) best = { cost, cx, cy, box }
      if (cost < 1 + penalty) break search
    }
    if (!best) continue
    obstacles.push(best.box); placed.push(best.box)
    const leader = leaderOf(q, best.box)
    if (leader) {
      const [[x1, y1], [x2, y2]] = [leader[0]!, leader[leader.length - 1]!]
      append(q.g, h('line', { class: 'leader', x1: r1(x1), y1: r1(y1), x2: r1(x2), y2: r1(y2) }))
      block([[x1, y1], [x2, y2]], 5)
    }
    append(q.g, lines(rows, best.cx, best.cy, q.note ? 'direct note' : 'direct', 15))
  }
  return { width: W, height: H, kids: out }
}
