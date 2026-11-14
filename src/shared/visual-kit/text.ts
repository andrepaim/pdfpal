// Text styles shared by the layout (which measures) and the stylesheet (which draws), so the two never disagree.
import type { Measure } from './vnode.js'

export type TextStyle = { size: number; weight: number; spacing?: number }

/** Every text class the kit draws, with the size, weight and letter spacing (px per character) the CSS uses. */
export const TEXT = {
  label: { size: 13, weight: 600 },
  sub: { size: 11, weight: 450 },
  tag: { size: 11, weight: 600, spacing: 0.165 },
  chip: { size: 11, weight: 600 },
  tick: { size: 10.5, weight: 450 },
  direct: { size: 12, weight: 600 },
  note: { size: 12, weight: 500 },
  value: { size: 13, weight: 650 },
  cell: { size: 12, weight: 550 },
  body: { size: 12.5, weight: 450 },
} as const satisfies Record<string, TextStyle>

/** Measuring helpers bound to one measurer. */
export type Kit = {
  measure: Measure
  /** Width of one line in a style. */
  width: (text: string, style: TextStyle) => number
  /** Greedy word wrap to `max` px; a single word longer than `max` keeps its own line. */
  wrap: (text: string, max: number, style: TextStyle) => string[]
  /** Width of the widest line. */
  widest: (lines: string[], style: TextStyle) => number
}

export function makeKit(measure: Measure): Kit {
  const cache = new Map<string, number>()
  const width = (text: string, style: TextStyle) => {
    const key = `${style.size}|${style.weight}|${text}`
    let w = cache.get(key)
    if (w === undefined) { w = measure(text, style.size, style.weight); cache.set(key, w) }
    return w + (style.spacing ?? 0) * [...text].length
  }
  const wrap = (text: string, max: number, style: TextStyle) => {
    const lines: string[] = []
    let current = ''
    for (const word of String(text ?? '').trim().split(/\s+/).filter(Boolean)) {
      const next = current ? `${current} ${word}` : word
      if (!current || width(next, style) <= max) current = next
      else { lines.push(current); current = word }
    }
    if (current) lines.push(current)
    return lines
  }
  const widest = (lines: string[], style: TextStyle) => lines.reduce((w, line) => Math.max(w, width(line, style)), 0)
  return { measure, width, wrap, widest }
}
