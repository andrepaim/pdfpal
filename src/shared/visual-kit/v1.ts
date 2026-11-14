// Compatibility skin: draws stored format-1 scenes (model-chosen coordinates on a 360-wide canvas) in the new style.
import type { VisualElement, VisualStepV1 } from '../visual.js'
import { chip, fontSize, head, hint, hotspot, item, lines, smooth, type Ctx, type Pt } from './common.js'
import { TEXT } from './text.js'
import { h, r1, type VNode } from './vnode.js'

const V1_TONE = { indigo: 'primary', teal: 'secondary', amber: 'accent', rose: 'negative', slate: 'neutral' } as const
type V1Node = Extract<VisualElement, { type: 'node' }>

export function drawV1(ctx: Ctx, step: VisualStepV1): { width: number; height: number; kids: VNode[] } {
  const { kit } = ctx
  const scene = step.scene, out: VNode[] = [], nodes = scene.elements.filter((e): e is V1Node => e.type === 'node')
  const inside = (n: V1Node, x: number, y: number, pad: number) => x >= n.x - pad && x <= n.x + n.width + pad && y >= n.y - pad && y <= n.y + n.height + pad
  const clip = (n: V1Node, fx: number, fy: number, tx: number, ty: number): Pt => { // where the segment from (fx,fy) leaves node n (plus a small gap)
    const g = 3, x0 = n.x - g, x1 = n.x + n.width + g, y0 = n.y - g, y1 = n.y + n.height + g, dx = tx - fx, dy = ty - fy
    let best = 1
    for (const [p, q] of [[dx, x0 - fx], [dx, x1 - fx], [dy, y0 - fy], [dy, y1 - fy]] as const) {
      if (!p) continue
      const t = q / p, x = fx + dx * t, y = fy + dy * t
      if (t > 0 && t < best && x >= x0 - 0.5 && x <= x1 + 0.5 && y >= y0 - 0.5 && y <= y1 + 0.5) best = t
    }
    return [fx + dx * best, fy + dy * best]
  }
  for (const e of scene.elements) {
    const spec = { tone: V1_TONE[e.color] }
    if (e.type === 'node') {
      let size = 13, rows = kit.wrap(e.label, e.width - 14, TEXT.label)
      const small = { size: 11, weight: TEXT.label.weight }
      if (rows.length * 16 > e.height - 6 || kit.widest(rows, TEXT.label) > e.width - 8) { size = 11; rows = kit.wrap(e.label, e.width - 10, small) }
      const wide = kit.widest(rows, size === 13 ? TEXT.label : small)
      if (size === 11 && wide > e.width - 6) size = Math.max(8, 11 * (e.width - 6) / wide)
      const ellipse = e.shape === 'ellipse'
      const g = item(ctx, spec, null,
        ellipse ? h('ellipse', { class: 'shape', cx: r1(e.x + e.width / 2), cy: r1(e.y + e.height / 2), rx: r1(e.width / 2), ry: r1(e.height / 2) })
          : h('rect', { class: 'shape', x: r1(e.x), y: r1(e.y), width: r1(e.width), height: r1(e.height), rx: 9 }),
        lines(rows, e.x + e.width / 2, e.y + e.height / 2, 'label', size + 3, 'middle', size === 13 ? undefined : fontSize(size)),
        e.detail && e.width >= 70 ? hint(e.x + e.width - (ellipse ? e.width * 0.15 : 2), e.y + (ellipse ? e.height * 0.15 : 2)) : null)
      if (e.detail) hotspot(ctx, g, e.id, e.label, e.detail)
      out.push(g)
    } else if (e.type === 'arrow') {
      let a: Pt = [e.x1, e.y1], b: Pt = [e.x2, e.y2]
      const na = nodes.find(n => inside(n, a[0], a[1], 4)), nb = nodes.find(n => inside(n, b[0], b[1], 4))
      // an end that sits inside a box slides out along the arrow's own direction, so the arrow keeps its angle
      const a0 = a, b0 = b
      if (na && na !== nb && inside(na, a0[0], a0[1], 2)) a = clip(na, a0[0], a0[1], b0[0], b0[1])
      if (nb && na !== nb && inside(nb, b0[0], b0[1], 2)) b = clip(nb, b0[0], b0[1], a0[0], a0[1])
      const n = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, ux = (b[0] - a[0]) / n, uy = (b[1] - a[1]) / n
      const kids: VNode[] = [h('path', { class: 'edge', d: `M${r1(a[0])} ${r1(a[1])}L${r1(b[0] - ux * 5)} ${r1(b[1] - uy * 5)}` }), head(b[0], b[1], ux, uy)]
      if (e.label) { // beside the line, not on it
        const w = kit.width(e.label, TEXT.chip) / 2 + 9, mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, vertical = Math.abs(uy) > Math.abs(ux)
        let lx = vertical ? mx + w : mx
        const ly = vertical ? my : my - 12
        if (lx + w > 356) lx = mx - w
        lx = Math.max(w + 2, Math.min(358 - w, lx))
        kids.push(...chip(kit, e.label, lx, ly))
      }
      out.push(item(ctx, spec, null, kids))
    } else if (e.type === 'text') {
      const size = e.size >= 24 ? 16 : e.size >= 20 ? 14 : 12, w = kit.width(e.text, { size, weight: 600 })
      const fit = w > 344 ? fontSize(size * 344 / w) : size === 12 ? undefined : fontSize(size)
      const x = Math.max(8 + Math.min(w, 344) / 2, Math.min(352 - Math.min(w, 344) / 2, e.x))
      out.push(item(ctx, spec, null, h('text', { class: 'direct', x: r1(x), y: r1(e.y), 'text-anchor': 'middle', style: fit }, e.text)))
    } else {
      const pts: Pt[] = e.points.map(p => [p.x, p.y]), axisLike = pts.every((p, i) => !i || p[0] === pts[i - 1]![0] || p[1] === pts[i - 1]![1])
      const straight = pts.map((p, i) => `${i ? 'L' : 'M'}${r1(p[0])} ${r1(p[1])}`).join('')
      out.push(item(ctx, spec, null, e.closed ? h('path', { class: 'area outlined', d: `${straight}Z` })
        : h('path', { class: axisLike ? 'axis' : 'curve', d: axisLike || pts.length < 4 ? straight : smooth(pts) })))
    }
  }
  return { width: 360, height: scene.height, kids: out }
}
