// quadrant: two questions, four answers. Items stack in the middle of their quarter; the poles name the axes.
import type { VisualSceneV2 } from '../visual.js'
import { hint, hotspot, item, lines, type Ctx } from './common.js'
import { TEXT } from './text.js'
import { h, r1, type VNode } from './vnode.js'

type QuadrantScene = Extract<VisualSceneV2, { kind: 'quadrant' }>
type Item = QuadrantScene['items'][number]
type Key = Item['quadrant']
type Sized = { it: Item; label: string[]; sub: string[]; w: number; h: number }
const KEYS: Key[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right']

export function drawQuadrant(ctx: Ctx, spec: QuadrantScene): { width: number; height: number; kids: VNode[] } {
  const { kit, W } = ctx
  const out: VNode[] = [], pad = 16, top = pad + 20, left = pad, size = W - 2 * pad, half = size / 2
  const sized = (it: Item): Sized => {
    const label = kit.wrap(it.label, half - 34, TEXT.label), sub = it.sub ? kit.wrap(it.sub, half - 34, TEXT.sub) : []
    return { it, label, sub, w: Math.min(half - 14, Math.max(kit.widest(label, TEXT.label), kit.widest(sub, TEXT.sub)) + 22), h: label.length * 16 + (sub.length ? sub.length * 14 + 3 : 0) + 16 }
  }
  const cells = new Map<Key, Sized[]>(KEYS.map(key => [key, spec.items.filter(it => it.quadrant === key).map(sized)]))
  const need = (key: Key) => cells.get(key)!.reduce((sum, c) => sum + c.h + 8, 22)
  const rowTop = Math.max(92, need('top-left'), need('top-right')), rowBottom = Math.max(92, need('bottom-left'), need('bottom-right'))
  const H = top + rowTop + rowBottom + 26 + pad, cx = left + half, cy = top + rowTop
  out.push(h('path', { class: 'axis', d: `M${r1(cx)} ${r1(top)}V${r1(top + rowTop + rowBottom)}M${r1(left)} ${r1(cy)}H${r1(left + size)}` }))
  const pole = (text: string, x: number, y: number, anchor: 'start' | 'middle' | 'end') =>
    out.push(h('text', { class: 'tag halo', x: r1(x), y: r1(y), 'text-anchor': anchor, 'dominant-baseline': 'central' }, text))
  pole(spec.y.high, cx, top - 10, 'middle'); pole(spec.y.low, cx, top + rowTop + rowBottom + 12, 'middle')
  // The x poles sit above the horizontal axis at its ends; when they would meet in the middle they shrink to fit a half.
  const xLow = kit.width(spec.x.low, TEXT.tag), xHigh = kit.width(spec.x.high, TEXT.tag)
  const tooLong = xLow > half - 12 || xHigh > half - 12
  if (!tooLong) { pole(spec.x.low, left + 2, cy - 11, 'start'); pole(spec.x.high, left + size - 2, cy - 11, 'end') }
  else {
    const rowsLow = kit.wrap(spec.x.low, half - 14, TEXT.tag), rowsHigh = kit.wrap(spec.x.high, half - 14, TEXT.tag)
    out.push(lines(rowsLow, left + 2, cy - 11 - (rowsLow.length - 1) * 6.5, 'tag halo', 13, 'start'), lines(rowsHigh, left + size - 2, cy - 11 - (rowsHigh.length - 1) * 6.5, 'tag halo', 13, 'end'))
  }
  for (const key of KEYS) {
    const list = cells.get(key)!
    const isTop = key.startsWith('top'), isLeft = key.endsWith('left'), mid = left + (isLeft ? half / 2 : half * 1.5), room = isTop ? rowTop : rowBottom
    let y = (isTop ? top : cy) + (room - list.reduce((sum, c) => sum + c.h + 8, -8)) / 2 + (isTop ? -4 : 6)
    for (const c of list) {
      const block = c.label.length * 16 + (c.sub.length ? c.sub.length * 14 + 3 : 0), ty = y + (c.h - block) / 2
      const node = item(ctx, c.it, null,
        h('rect', { class: 'shape', x: r1(mid - c.w / 2), y: r1(y), width: r1(c.w), height: r1(c.h), rx: 9 }),
        lines(c.label, mid, ty + c.label.length * 8, 'label', 16),
        c.sub.length ? lines(c.sub, mid, ty + c.label.length * 16 + 3 + c.sub.length * 7, 'sub', 14) : null,
        c.it.detail ? hint(mid + c.w / 2 - 2, y + 2) : null)
      if (c.it.detail) hotspot(ctx, node, c.it.id, c.it.label, c.it.detail)
      out.push(node); y += c.h + 8
    }
  }
  return { width: W, height: H, kids: out }
}
