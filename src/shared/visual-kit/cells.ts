// cells: rows of slots (a vector, a codebook, tokens, a lookup table), with brackets under runs of cells and links
// between rows. A link that jumps over a row runs down a lane in the right margin instead of through the cells.
import type { VisualSceneV2 } from '../visual.js'
import { beatOf, chip, fontSize, head, item, lines, plain, type Ctx } from './common.js'
import { TEXT } from './text.js'
import { h, r1, type VNode } from './vnode.js'

type CellsScene = Extract<VisualSceneV2, { kind: 'cells' }>
type Link = NonNullable<CellsScene['links']>[number]
type Place = { x: number; top: number; bottom: number }

export function drawCells(ctx: Ctx, spec: CellsScene): { width: number; height: number; kids: VNode[] } {
  const { kit, W } = ctx
  const pad = 16, gap = 4, out: VNode[] = []
  const units = Math.max(...spec.rows.map(r => (r.offset ?? 0) + r.cells.reduce((s, c) => s + (c.span ?? 1), 0)))
  const rowOf = new Map(spec.rows.map(r => [r.id, r])), rowIndex = new Map(spec.rows.map((r, i) => [r.id, i]))
  const place = new Map<string, Place>(), rowBox = new Map<string, { left: number; right: number; mid: number }>()
  const every = (spec.links ?? []).filter(l => rowOf.has(l.from[0]) && rowOf.has(l.to[0]) && rowIndex.get(l.to[0])! > rowIndex.get(l.from[0])!)
  const jumps: Link[] = []
  const links = every.filter(l => {
    if (rowIndex.get(l.to[0])! - rowIndex.get(l.from[0])! < 2) return true
    if (!jumps.some(j => j.from[0] === l.from[0] && j.to[0] === l.to[0])) jumps.push(l)
    return false
  })
  const named = spec.rows.filter(r => r.label), nameWidth = Math.min(92, Math.max(0, ...named.map(r => kit.width(r.label!, TEXT.tag))))
  const lanes = jumps.length ? 14 + jumps.length * 12 + Math.max(0, ...jumps.map(l => l.label ? kit.width(l.label, TEXT.chip) + 8 : 0)) : 0
  const unitFor = (left: number) => Math.min(52, (W - 2 * pad - left - lanes - (units - 1) * gap) / units)
  const beside = named.length > 0 && unitFor(nameWidth + 12) >= 30, gutter = beside ? nameWidth + 12 : 0, u = unitFor(gutter)
  const total = units * u + (units - 1) * gap, x0 = pad + gutter + Math.max(0, (W - 2 * pad - gutter - lanes - total) / 2)
  let y = pad
  for (const row of spec.rows) {
    const brackets = (spec.brackets ?? []).filter(b => b.row === row.id), linksIn = links.some(l => l.to[0] === row.id), linksOut = links.some(l => l.from[0] === row.id)
    const below = !beside && linksIn && !brackets.length && !linksOut
    const name = (yy: number) => {
      if (!row.label) return
      out.push(plain(ctx, row.appear, beside
        ? lines(kit.wrap(row.label, nameWidth + 2, TEXT.tag), x0 - 12, yy, 'tag', 13, 'end')
        : h('text', { class: 'tag', x: r1(x0 + 1), y: r1(yy), 'dominant-baseline': 'central' }, row.label)))
    }
    if (linksIn) y += 28
    if (!beside && !below && row.label) { name(y + 6); y += 20 }
    let start = row.offset ?? 0
    rowBox.set(row.id, { left: x0 + start * (u + gap), right: x0 + total, mid: y + 16 })
    if (beside) name(y + 16)
    row.cells.forEach((cell, i) => {
      const span = cell.span ?? 1, x = x0 + start * (u + gap), w = span * u + (span - 1) * gap, text = cell.text
      place.set(`${row.id}:${i}`, { x: x + w / 2, top: y, bottom: y + 32 }); start += span
      const level = typeof cell.weight === 'number' ? Math.round(Math.max(0, Math.min(1, cell.weight)) * 10) : null, fit = kit.width(text, TEXT.cell)
      out.push(item(ctx, { tone: cell.tone ?? row.tone, appear: cell.appear ?? row.appear }, null,
        h('rect', { class: level === null ? 'cell' : `cell weighted w${level}`, x: r1(x), y: r1(y), width: r1(w), height: 32, rx: 6 }),
        text ? h('text', { class: level !== null && level >= 6 ? 'celltext on-fill' : 'celltext', x: r1(x + w / 2), y: r1(y + 16), 'text-anchor': 'middle', 'dominant-baseline': 'central', style: fit > w - 6 ? fontSize(Math.max(8, 12 * (w - 6) / fit)) : null }, text) : null))
    })
    y += 32
    if (brackets.length) {
      let deepest = 0
      for (const b of brackets) {
        const lo = Math.min(b.from, b.to), hi = Math.max(b.from, b.to), a = place.get(`${row.id}:${lo}`), z = place.get(`${row.id}:${hi}`)
        if (!a || !z) continue
        const widthOf = (k: number) => { const sp = row.cells[k]?.span ?? 1; return sp * u + (sp - 1) * gap }
        const xl = a.x - widthOf(lo) / 2 + 2, xr = z.x + widthOf(hi) / 2 - 2, text = b.label ? kit.wrap(b.label, Math.max(40, xr - xl + 4), TEXT.chip) : []
        out.push(item(ctx, { tone: b.tone, appear: beatOf(ctx, b.appear ?? row.appear) }, null,
          h('path', { class: 'edge bracket', d: `M${r1(xl)} ${r1(y + 4)}v5H${r1(xr)}v-5` }),
          text.length ? lines(text, (xl + xr) / 2, y + 17 + text.length * 6.5, 'chiptext', 13) : null))
        const depth = 13 + text.length * 13 + (text.length ? 4 : 0); deepest = Math.max(deepest, depth)
        for (let k = lo; k <= hi; k++) { const p = place.get(`${row.id}:${k}`); if (p) Object.assign(p, { x: (xl + xr) / 2, bottom: y + depth }) }
      }
      y += deepest
    }
    if (below && row.label) { name(y + 14); y += 20 }
    y += 14
  }
  for (const l of links) {
    const a = place.get(`${l.from[0]}:${l.from[1]}`), b = place.get(`${l.to[0]}:${l.to[1]}`)
    if (!a || !b || b.top <= a.bottom) continue
    const x1 = a.x, y1 = a.bottom + 3, x2 = b.x, y2 = b.top - 8, m = (y1 + y2) / 2
    out.push(item(ctx, { tone: l.tone, appear: beatOf(ctx, l.appear, rowOf.get(l.from[0])!.appear, rowOf.get(l.to[0])!.appear) }, null,
      h('path', { class: 'edge', d: `M${r1(x1)} ${r1(y1)}C${r1(x1)} ${r1(m)} ${r1(x2)} ${r1(m)} ${r1(x2)} ${r1(y2)}` }), head(x2, y2 + 5, 0, 1),
      l.label ? chip(kit, l.label, (x1 + x2) / 2, m) : null))
  }
  jumps.forEach((l, k) => { // down the right margin, clear of the row names
    const a = rowBox.get(l.from[0])!, b = rowBox.get(l.to[0])!, lane = Math.max(a.right, b.right) + 14 + k * 12, r = 8
    const text = l.label ? h('text', { class: 'chiptext', x: r1(lane + 7), y: r1((a.mid + b.mid) / 2), 'dominant-baseline': 'central' }, l.label) : null
    out.push(item(ctx, { tone: l.tone, appear: beatOf(ctx, l.appear, rowOf.get(l.from[0])!.appear, rowOf.get(l.to[0])!.appear) }, null,
      h('path', { class: 'edge', d: `M${r1(a.right + 4)} ${r1(a.mid)}H${r1(lane - r)}Q${r1(lane)} ${r1(a.mid)} ${r1(lane)} ${r1(a.mid + r)}V${r1(b.mid - r)}Q${r1(lane)} ${r1(b.mid)} ${r1(lane - r)} ${r1(b.mid)}H${r1(b.right + 9)}` }),
      head(b.right + 4, b.mid, -1, 0), text))
  })
  return { width: W, height: y - 14 + pad, kids: out }
}
