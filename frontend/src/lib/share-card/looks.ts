// The three share-card looks: ground, text, accent and how an emphasised phrase is marked. Pure data and colour
// arithmetic, no DOM. See "Looks" in docs/share-cards-plan.md.
import type { HighlightColor, ShareLook } from '../../../../src/shared/share-card'

/** The reader's highlight colours, solid: the emphasis box on Ink and Paper, and the highlight on a Page crop. */
export const HIGHLIGHT_HEX: Record<HighlightColor, string> = { yellow: '#fde047', green: '#4ade80', blue: '#60a5fa', pink: '#f472b6' }
/**
 * Marker grounds. Blue and pink are a shade lighter than the highlight (#60a5fa, #f472b6): at those, the credit line
 * at 72% opacity reached only 4.40:1 and 4.31:1. These reach 4.58:1 and 4.56:1.
 */
export const MARKER_GROUND: Record<HighlightColor, string> = { yellow: '#fde047', green: '#4ade80', blue: '#6aaafb', pink: '#f580bd' }

export type RadialFill = { kind: 'radial'; cx: number; cy: number; rx: number; ry: number; stops: Array<[number, string]> }
export type Fill = string | RadialFill

export type Palette = {
  look: ShareLook
  ground: Fill
  /** Solid colours the ground passes through, for contrast checks. */
  groundTones: string[]
  text: string
  accent: string
  /** The emphasised phrase: its text colour, and the box behind it. */
  emphasis: { text: string; box: string; boxAlpha: number }
}

const INK_TEXT = '#f1f0f6'
const INK_EMPHASIS_TEXT = '#16171f'
const PAPER_TEXT = '#17181d'
const MARKER_TEXT = '#17140a'
const INK_STOPS: Array<[number, string]> = [[0, '#2a2860'], [0.45, '#14141c'], [1, '#0f0f13']]

/**
 * The palette for a look on a card of `width` × `height`. Ink's ground is a radial gradient centred on the
 * top-right corner, an ellipse of 120% × 80% of the card. Every text and ground pair reaches 4.5:1
 * (test/unit/share-card-layout.test.ts); the PDFPAL wordmark is deliberately low-contrast and is not held to it.
 */
export function palette(look: ShareLook, color: HighlightColor, width: number, height: number): Palette {
  const highlight = HIGHLIGHT_HEX[color]
  if (look === 'paper') return { look, ground: '#f7f7f3', groundTones: ['#f7f7f3'], text: PAPER_TEXT, accent: '#4f46e5', emphasis: { text: PAPER_TEXT, box: highlight, boxAlpha: 0.62 } }
  if (look === 'marker') {
    const ground = MARKER_GROUND[color]
    return { look, ground, groundTones: [ground], text: MARKER_TEXT, accent: MARKER_TEXT, emphasis: { text: ground, box: MARKER_TEXT, boxAlpha: 1 } }
  }
  return {
    look, ground: { kind: 'radial', cx: width, cy: 0, rx: 1.2 * width, ry: 0.8 * height, stops: INK_STOPS }, groundTones: INK_STOPS.map(([, tone]) => tone),
    text: INK_TEXT, accent: '#a5b4fc', emphasis: { text: INK_EMPHASIS_TEXT, box: highlight, boxAlpha: 1 },
  }
}

const channels = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))

/** `foreground` at `alpha` over an opaque `background`, as a hex colour. */
export function mix(foreground: string, background: string, alpha: number): string {
  const f = channels(foreground), b = channels(background)
  return '#' + f.map((value, i) => Math.round(value * alpha + b[i]! * (1 - alpha)).toString(16).padStart(2, '0')).join('')
}

/** WCAG 2 relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map(value => {
    const c = value / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG 2 contrast ratio, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (light + 0.05) / (dark + 0.05)
}
