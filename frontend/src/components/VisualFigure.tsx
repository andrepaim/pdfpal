// CONTRACT STUB — the renderer work replaces this with the real component (VNode -> React, hotspots, font loading).
// The props and the hook signature are the contract the player (VisualExplanation.tsx) codes against.
import type { VisualSceneV2, VisualStepV1 } from '../../../src/shared/visual'
import type { Drawing, Hotspot } from '../../../src/shared/visual-kit'

export type FigureInput = { version: 2; scene: VisualSceneV2 } | { version: 1; step: VisualStepV1 }

/**
 * Lays out a figure for the width of the element `container` points at (re-laid out on resize and once the bundled
 * Inter font has loaded). Returns null until the first layout is ready.
 */
export function useVisualDrawing(_input: FigureInput, _container: React.RefObject<HTMLElement | null>, _options?: { minWidth?: number; maxWidth?: number }): Drawing | null {
  return { width: 360, height: 200, beats: 1, hotspots: [], svg: { tag: 'svg', attrs: { viewBox: '0 0 360 200' }, children: [] } }
}

/**
 * Draws a laid-out figure as React SVG. Items with data-at > beat are hidden; hotspots are focusable buttons that call
 * onSelect. Injects the figure stylesheet (VISUAL_KIT_CSS) and the Inter @font-face into the document once.
 */
export function VisualFigure({ drawing, label }: { drawing: Drawing; beat: number; label: string; selected?: string; onSelect?: (hotspot: Hotspot) => void }) {
  return <svg className="vx-svg" viewBox={`0 0 ${drawing.width} ${drawing.height}`} role="img" aria-label={label}><rect x={8} y={8} width={drawing.width - 16} height={drawing.height - 16} rx={10} fill="none" stroke="currentColor" strokeDasharray="4 4" /></svg>
}
