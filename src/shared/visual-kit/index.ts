// CONTRACT STUB — to be implemented by the renderer work (port of the study prototype's kit.js).
// Pure functions: no DOM, no canvas. The caller passes a text measurer, so layout runs in the browser, in Node tests
// and in the HTML export alike.
import type { VisualSceneV2, VisualStepV1 } from '../visual.js'

/** Width in px of `text` set in the visual typeface (Inter) at `size` px and `weight`. */
export type Measure = (text: string, size: number, weight: number) => number

/** A tiny virtual SVG tree. Attribute values are already rounded and escaped only at serialisation. */
export type VNode = { tag: string; attrs: Record<string, string | number>; children: Array<VNode | string> }

/** Something the reader can tap for more (a flow node or quadrant item with `detail`, a v1 node with `detail`). */
export type Hotspot = { id: string; label: string; detail: string }

/**
 * A laid-out figure. `svg` is the root <svg> node (viewBox 0 0 width height, class "vx-svg").
 * Conventions every consumer relies on:
 *  - a drawn item is a <g class="el t-<tone> ..."> with data-at="<beat, 1-based>"; it is visible on beats >= data-at;
 *  - a tappable item also has data-hotspot="<Hotspot.id>" (and a visible "has more" marker drawn by the kit);
 *  - all styling comes from classes defined in VISUAL_KIT_CSS (no inline colours), so themes are pure CSS.
 */
export type Drawing = { width: number; height: number; svg: VNode; beats: number; hotspots: Hotspot[] }

export type DrawOptions = { width: number; measure: Measure }

/** Lays out one v2 scene at the given width. */
export function drawSceneV2(_scene: VisualSceneV2, _options: DrawOptions): Drawing { throw new Error('visual-kit: not implemented') }

/** Restyles one stored v1 step (absolute coordinates on a 360-wide canvas) with the same visual language. */
export function drawStepV1(_step: VisualStepV1, _options: Pick<DrawOptions, 'measure'>): Drawing { throw new Error('visual-kit: not implemented') }

/**
 * Serialises a VNode tree to SVG markup, escaping all text and attribute values. With `beat`, items whose data-at is
 * greater than `beat` get the class "is-hidden".
 */
export function svgMarkup(_node: VNode, _beat?: number): string { throw new Error('visual-kit: not implemented') }

/** The stylesheet for figures: tokens (dark default, [data-theme=paper]), SVG classes, @font-face is NOT included. */
export const VISUAL_KIT_CSS = ''

/** A rough Inter-like measurer for Node tests and as a fallback before fonts load. */
export function approximateMeasure(text: string, size: number, _weight: number): number { return text.length * size * 0.56 }
