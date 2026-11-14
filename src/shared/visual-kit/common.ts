// Drawing primitives shared by every figure kind.
import type { VisualTone } from '../visual.js'
import { TEXT, type Kit } from './text.js'
import { h, r1, type Hotspot, type Kid, type VNode } from './vnode.js'

export type Pt = [number, number]
const TONES = new Set<string>(['neutral', 'primary', 'secondary', 'accent', 'positive', 'negative'])
export const toneClass = (tone: string | undefined | null): string => `t-${tone && TONES.has(tone) ? tone : 'neutral'}`

/** Everything a figure kind needs while drawing: the measurer, the width, and the beat count to clamp reveals to. */
export type Ctx = { kit: Kit; W: number; beats: number; hotspots: Hotspot[] }

export type ItemSpec = { tone?: VisualTone | string; appear?: number }

/** The beat (1-based) an item first shows on, clamped to the scene's beats so nothing stays hidden forever. */
export const beatOf = (ctx: Ctx, ...appear: Array<number | undefined>): number =>
  Math.max(1, Math.min(ctx.beats, Math.max(1, ...appear.map(a => a ?? 1))))

/** A drawn item: <g class="el t-<tone> [extra]" data-at="<beat>">. */
export function item(ctx: Ctx, spec: ItemSpec, extra: string | null, ...kids: Kid[]): VNode {
  return h('g', { class: `el ${toneClass(spec.tone)}${extra ? ` ${extra}` : ''}`, 'data-at': beatOf(ctx, spec.appear) }, ...kids)
}

/** A plain reveal group without a tone (frames, row names). */
export function plain(ctx: Ctx, appear: number | undefined, ...kids: Kid[]): VNode {
  return h('g', { class: 'el', 'data-at': beatOf(ctx, appear) }, ...kids)
}

/** Marks an item as tappable and records it (aria-label = its label). The marker is a small dot on the item's top-right corner. */
export function hotspot(ctx: Ctx, node: VNode, id: string, label: string, detail: string): void {
  node.attrs['data-hotspot'] = id
  node.attrs['aria-label'] = label
  node.attrs.class = `${node.attrs.class} hot`
  if (!ctx.hotspots.some(spot => spot.id === id)) ctx.hotspots.push({ id, label, detail })
}
export const hint = (x: number, y: number): VNode => h('circle', { class: 'hint', cx: r1(x), cy: r1(y), r: 3.5 })

/** A block of lines whose middle sits on y. */
export function lines(list: string[], x: number, y: number, cls: string, lineHeight: number, anchor: 'start' | 'middle' | 'end' = 'middle', style?: string): VNode {
  return h('text', { class: cls, 'text-anchor': anchor, style },
    list.map((line, i) => h('tspan', { x: r1(x), y: r1(y + (i - (list.length - 1) / 2) * lineHeight), 'dominant-baseline': 'central' }, line)))
}

/** An arrowhead whose tip is at (x, y), pointing along (dx, dy). */
export function head(x: number, y: number, dx: number, dy: number, size = 7): VNode {
  const n = Math.hypot(dx, dy) || 1, ux = dx / n, uy = dy / n, bx = x - ux * size, by = y - uy * size, w = size * 0.46
  return h('path', { class: 'head', d: `M${r1(x)} ${r1(y)}L${r1(bx - uy * w)} ${r1(by + ux * w)}L${r1(bx + uy * w)} ${r1(by - ux * w)}Z` })
}

/** A label on a small canvas-coloured plate, so a line under it is masked. */
export function chip(kit: Kit, text: string, x: number, y: number): VNode[] {
  const w = kit.width(text, TEXT.chip) + 10
  return [h('rect', { class: 'chip', x: r1(x - w / 2), y: r1(y - 8), width: r1(w), height: 16, rx: 4 }),
    h('text', { class: 'chiptext', x: r1(x), y: r1(y), 'text-anchor': 'middle', 'dominant-baseline': 'central' }, text)]
}

/** Smooth curve through points (Catmull-Rom as cubic Béziers). */
export function smooth(points: Pt[]): string {
  const first = points[0]
  if (!first) return ''
  if (points.length < 3) return points.map((p, i) => `${i ? 'L' : 'M'}${r1(p[0])} ${r1(p[1])}`).join('')
  let d = `M${r1(first[0])} ${r1(first[1])}`
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i]!, p2 = points[i + 1]!, p0 = points[i - 1] ?? p1, p3 = points[i + 2] ?? p2
    d += `C${r1(p1[0] + (p2[0] - p0[0]) / 6)} ${r1(p1[1] + (p2[1] - p0[1]) / 6)} ${r1(p2[0] - (p3[0] - p1[0]) / 6)} ${r1(p2[1] - (p3[1] - p1[1]) / 6)} ${r1(p2[0])} ${r1(p2[1])}`
  }
  return d
}

/** Points along the same Catmull-Rom curve, for collision tests. */
export function densify(pts: Pt[]): Pt[] {
  const fine: Pt[] = []
  for (let i = 0; i < pts.length - 1; i++) {
    const p1 = pts[i]!, p2 = pts[i + 1]!, p0 = pts[i - 1] ?? p1, p3 = pts[i + 2] ?? p2
    const c1: Pt = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2: Pt = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
    for (let t = 0; t < 1; t += 0.125) {
      const a = 1 - t
      fine.push([a * a * a * p1[0] + 3 * a * a * t * c1[0] + 3 * a * t * t * c2[0] + t * t * t * p2[0], a * a * a * p1[1] + 3 * a * a * t * c1[1] + 3 * a * t * t * c2[1] + t * t * t * p2[1]])
    }
  }
  const last = pts[pts.length - 1]
  if (last) fine.push(last)
  return fine
}

/** Font-size override for text squeezed to fit; the only inline style the kit ever writes. */
export const fontSize = (px: number): string => `font-size:${r1(px)}px`

export type Box = { x: number; y: number; w: number; h: number }
export const overlapArea = (a: Box, b: Box): number =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
