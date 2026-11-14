// compare: the same questions asked of two or three things. Columns when they fit, otherwise one card per thing.
import type { VisualSceneV2 } from '../visual.js'
import { fontSize, item, lines, toneClass, type Ctx } from './common.js'
import { TEXT } from './text.js'
import { h, r1, type VNode } from './vnode.js'

type CompareScene = Extract<VisualSceneV2, { kind: 'compare' }>

export function drawCompare(ctx: Ctx, spec: CompareScene): { width: number; height: number; kids: VNode[] } {
  const { kit, W } = ctx
  const pad = 16, gap = 10, n = spec.columns.length, out: VNode[] = [], cw = (W - 2 * pad - (n - 1) * gap) / n
  if (cw < 100) { // too narrow for columns: one card per thing, each row revealed on its own beat
    let y = pad
    for (const [k, col] of spec.columns.entries()) {
      const rows = spec.rows.map(r => ({ r, text: kit.wrap(r.cells[k] ?? '', W - 2 * pad - 28, TEXT.body) }))
      const cardH = 34 + rows.reduce((s, row) => s + 18 + row.text.length * 16 + 6, 0) + 4
      const title = kit.wrap(col.title, W - 2 * pad - 28, TEXT.label)[0] ?? col.title, tw = kit.width(title, TEXT.label)
      out.push(item(ctx, { tone: col.tone }, null,
        h('rect', { class: 'shape card', x: pad, y: r1(y), width: r1(W - 2 * pad), height: r1(cardH), rx: 10 }),
        h('text', { class: 'label tinted', x: pad + 14, y: r1(y + 18), 'dominant-baseline': 'central', style: tw > W - 2 * pad - 28 ? fontSize(13 * (W - 2 * pad - 28) / tw) : null }, title)))
      let yy = y + 34
      for (const row of rows) {
        out.push(item(ctx, { tone: col.tone, appear: row.r.appear }, null,
          h('text', { class: 'tag', x: pad + 14, y: r1(yy + 6), 'dominant-baseline': 'central' }, row.r.label),
          lines(row.text, pad + 14, yy + 18 + row.text.length * 8, 'body', 16, 'start')))
        yy += 18 + row.text.length * 16 + 6
      }
      y += cardH + 10
    }
    return { width: W, height: y - 10 + pad, kids: out }
  }
  let y = pad
  const heads = spec.columns.map((col, k) => {
    const title = kit.wrap(col.title, cw - 16, TEXT.label)
    return { col, title, x: pad + k * (cw + gap), h: title.length * 16 + 14 }
  })
  const headH = Math.max(...heads.map(c => c.h))
  for (const c of heads) {
    const wide = kit.widest(c.title, TEXT.label)
    out.push(item(ctx, { tone: c.col.tone }, null,
      h('rect', { class: 'shape', x: r1(c.x), y: r1(y), width: r1(cw), height: r1(headH), rx: 9 }),
      lines(c.title, c.x + cw / 2, y + headH / 2, 'label', 16, 'middle', wide > cw - 12 ? fontSize(13 * (cw - 12) / wide) : undefined)))
  }
  y += headH + 14
  spec.rows.forEach(row => {
    const texts = heads.map((_, k) => kit.wrap(row.cells[k] ?? '', cw - 8, TEXT.body)), rowH = Math.max(...texts.map(t => t.length)) * 16
    const tag = kit.width(row.label, TEXT.tag)
    const kids: VNode[] = [h('text', { class: 'tag', x: pad, y: r1(y + 5), 'dominant-baseline': 'central' }, row.label)]
    if (pad + tag + 10 < W - pad) kids.push(h('line', { class: 'rule', x1: r1(pad + tag + 10), x2: r1(W - pad), y1: r1(y + 5), y2: r1(y + 5) }))
    texts.forEach((t, k) => kids.push(h('g', { class: toneClass(heads[k]!.col.tone) }, lines(t, heads[k]!.x + 4, y + 20 + t.length * 8, 'body', 16, 'start'))))
    out.push(item(ctx, { appear: row.appear }, null, kids))
    y += 20 + rowH + 14
  })
  return { width: W, height: y - 14 + pad, kids: out }
}
