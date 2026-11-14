// The figure renderer for "Explain visually". The assistant names WHAT to draw (a flow, a plot, bars, cells, a
// comparison, a quadrant); this kit decides WHERE everything goes and how it looks.
// Pure functions: no DOM, no canvas. The caller passes a text measurer, so layout runs in the browser, in Node tests
// and in the HTML export alike.
import type { VisualSceneV2, VisualStepV1 } from '../visual.js'
import { drawBars } from './bars.js'
import { drawCells } from './cells.js'
import type { Ctx } from './common.js'
import { drawCompare } from './compare.js'
import { drawFlow } from './flow.js'
import { drawPlot } from './plot.js'
import { drawQuadrant } from './quadrant.js'
import { makeKit } from './text.js'
import { drawV1 } from './v1.js'
import { h, r1, type DrawOptions, type Drawing, type VNode } from './vnode.js'

export type { DrawOptions, Drawing, Hotspot, Measure, VNode } from './vnode.js'
export { svgMarkup, escapeXml, hiddenAt, walk, textContent } from './vnode.js'
export { VISUAL_KIT_CSS, VISUAL_FONT_FAMILY } from './css.js'
export { approximateMeasure } from './metrics.js'
export { TEXT, makeKit, type Kit, type TextStyle } from './text.js'

type Drawn = { width: number; height: number; kids: VNode[] }

function finish(ctx: Ctx, drawn: Drawn, title: string): Drawing {
  const width = r1(drawn.width), height = r1(drawn.height)
  const svg = h('svg', { class: 'vx-svg', viewBox: `0 0 ${width} ${height}`, width, height, role: 'img', 'aria-label': title }, drawn.kids)
  return { width, height, svg, beats: ctx.beats, hotspots: ctx.hotspots }
}

/** Lays out one v2 scene at the given width. */
export function drawSceneV2(scene: VisualSceneV2, options: DrawOptions): Drawing {
  const W = Math.max(240, Math.round(options.width))
  const ctx: Ctx = { kit: makeKit(options.measure), W, beats: Math.max(1, scene.beats.length), hotspots: [] }
  const drawn = scene.kind === 'flow' ? drawFlow(ctx, scene)
    : scene.kind === 'plot' ? drawPlot(ctx, scene)
    : scene.kind === 'bars' ? drawBars(ctx, scene)
    : scene.kind === 'cells' ? drawCells(ctx, scene)
    : scene.kind === 'compare' ? drawCompare(ctx, scene)
    : drawQuadrant(ctx, scene)
  return finish(ctx, drawn, scene.title)
}

/** Restyles one stored v1 step (absolute coordinates on a 360-wide canvas) with the same visual language. */
export function drawStepV1(step: VisualStepV1, options: Pick<DrawOptions, 'measure'>): Drawing {
  const ctx: Ctx = { kit: makeKit(options.measure), W: 360, beats: 1, hotspots: [] }
  return finish(ctx, drawV1(ctx, step), step.title)
}

/** A plain figure saying the drawing failed, for callers that must show something. */
export function fallbackDrawing(message: string, width = 360): Drawing {
  const height = 120
  return { width, height, beats: 1, hotspots: [], svg: h('svg', { class: 'vx-svg', viewBox: `0 0 ${width} ${height}`, width, height, role: 'img', 'aria-label': message },
    h('text', { class: 'fallback', x: width / 2, y: height / 2, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, message)) }
}

