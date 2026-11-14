// bars: a few labelled quantities on one scale.
import type { VisualSceneV2 } from '../visual.js'
import { item, lines, type Ctx } from './common.js'
import { TEXT } from './text.js'
import { h, r1, type VNode } from './vnode.js'

type BarsScene = Extract<VisualSceneV2, { kind: 'bars' }>

export function drawBars(ctx: Ctx, spec: BarsScene): { width: number; height: number; kids: VNode[] } {
  const { kit, W } = ctx
  const pad = 18, out: VNode[] = [], max = Math.max(...spec.items.map(i => Math.abs(i.value))) || 1
  let y = pad
  if (spec.label) {
    const rows = kit.wrap(spec.label, W - 2 * pad, TEXT.tag)
    out.push(lines(rows, pad, y + 5 + (rows.length - 1) * 6.5, 'tag', 13, 'start'))
    y += 24 + (rows.length - 1) * 13
  }
  for (const it of spec.items) {
    const value = it.display ?? `${it.value}${spec.unit ? (/^[%°]/.test(spec.unit) ? spec.unit : ` ${spec.unit}`) : ''}`
    const vw = kit.width(value, TEXT.value), label = kit.wrap(it.label, W - 2 * pad - vw - 14, TEXT.label)
    const sub = it.note ? kit.wrap(it.note, W - 2 * pad, TEXT.sub) : [], hh = label.length * 16
    out.push(item(ctx, it, null,
      lines(label, pad, y + hh / 2, 'label', 16, 'start'),
      h('text', { class: 'value', x: r1(W - pad), y: r1(y + hh - 8), 'text-anchor': 'end', 'dominant-baseline': 'central' }, value),
      h('rect', { class: 'track', x: pad, y: r1(y + hh + 5), width: r1(W - 2 * pad), height: 8, rx: 4 }),
      h('rect', { class: 'bar', x: pad, y: r1(y + hh + 5), width: r1(Math.max(4, (W - 2 * pad) * Math.abs(it.value) / max)), height: 8, rx: 4 }),
      sub.length ? lines(sub, pad, y + hh + 20 + sub.length * 7, 'sub', 14, 'start') : null))
    y += hh + 13 + (sub.length ? sub.length * 14 + 6 : 0) + 16
  }
  return { width: W, height: y + pad - 16, kids: out }
}
