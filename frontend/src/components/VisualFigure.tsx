// A laid-out "Explain visually" figure as React SVG. The layout comes from src/shared/visual-kit (pure functions); this
// file measures the container, loads the bundled Inter font, converts the kit's virtual tree to React elements, hides
// items of later beats and turns hotspots into focusable buttons.
import { createElement, useEffect, useInsertionEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import type { VisualSceneV2, VisualStepV1 } from '../../../src/shared/visual'
import { drawSceneV2, drawStepV1, fallbackDrawing, hiddenAt, VISUAL_KIT_CSS, type Drawing, type Hotspot, type VNode } from '../../../src/shared/visual-kit'
import { ensureVisualFont, measureVisualText, visualFontReady } from '../lib/visual-measure'

export type FigureInput = { version: 2; scene: VisualSceneV2 } | { version: 1; step: VisualStepV1 }

const STYLE_ID = 'vx-kit-css'
function injectStyles() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = VISUAL_KIT_CSS
  document.head.appendChild(style)
}

/**
 * Lays out a figure for the width of the element `container` points at (re-laid out on resize and once the bundled
 * Inter font has loaded). Returns null until the first layout is ready.
 */
// eslint-disable-next-line react-refresh/only-export-components -- the hook and the component are one contract
export function useVisualDrawing(input: FigureInput, container: RefObject<HTMLElement | null>, options?: { minWidth?: number; maxWidth?: number }): Drawing | null {
  const minWidth = options?.minWidth ?? 320, maxWidth = Math.max(minWidth, options?.maxWidth ?? 720)
  const [fontReady, setFontReady] = useState(visualFontReady)
  const [measured, setMeasured] = useState<number | null>(null)
  const [checked, setChecked] = useState(false)
  const observed = useRef<HTMLElement | null>(null), observer = useRef<ResizeObserver | null>(null)
  useEffect(() => {
    if (fontReady) return
    let live = true
    void ensureVisualFont().then(() => { if (live) setFontReady(true) })
    return () => { live = false }
  }, [fontReady])
  // Runs after every render on purpose: it follows the container element, which may appear or change after the first
  // render, and only sets state when something changed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const element = container.current
    if (checked && element === observed.current) return
    observer.current?.disconnect(); observer.current = null
    observed.current = element
    if (element) {
      const read = () => { const width = Math.round(element.getBoundingClientRect().width); if (width > 0) setMeasured(width) }
      read()
      if (typeof ResizeObserver !== 'undefined') { observer.current = new ResizeObserver(read); observer.current.observe(element) }
    }
    setChecked(true)
  })
  useEffect(() => () => observer.current?.disconnect(), [])
  const width = Math.max(minWidth, Math.min(maxWidth, measured ?? maxWidth))
  // Keyed on the scene or step itself: the input wrapper object may be recreated on every render.
  const scene = input.version === 2 ? input.scene : undefined, step = input.version === 1 ? input.step : undefined
  return useMemo(() => {
    if (!fontReady || !checked) return null
    try {
      if (scene) return drawSceneV2(scene, { width, measure: measureVisualText })
      return step ? drawStepV1(step, { measure: measureVisualText }) : null
    } catch (error) {
      console.error('Could not lay out the figure', error)
      return fallbackDrawing('This figure could not be drawn.', width)
    }
  }, [scene, step, width, fontReady, checked])
}

const reactName = (key: string) => key === 'class' ? 'className' : key.startsWith('data-') || key.startsWith('aria-') ? key : key.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
function styleObject(value: string): Record<string, string> {
  const style: Record<string, string> = {}
  for (const rule of value.split(';')) {
    const at = rule.indexOf(':')
    if (at < 1) continue
    const name = rule.slice(0, at).trim(), body = rule.slice(at + 1).trim()
    style[name.startsWith('--') ? name : reactName(name)] = body
  }
  return style
}

type RenderState = { beat: number; selected?: string; onSelect?: (hotspot: Hotspot) => void; hotspots: Map<string, Hotspot> }

function toReact(node: VNode, key: number, state: RenderState, hiddenParent: boolean): ReactNode {
  const props: Record<string, unknown> = { key }
  for (const [name, value] of Object.entries(node.attrs)) {
    if (name === 'xmlns' || /^on/i.test(name)) continue
    props[name === 'style' ? 'style' : reactName(name)] = name === 'style' ? styleObject(String(value)) : value
  }
  const classes = String(node.attrs.class ?? '').split(/\s+/).filter(Boolean)
  const hidden = hiddenParent || hiddenAt(node, state.beat)
  if (hiddenAt(node, state.beat)) { classes.push('is-hidden'); props['aria-hidden'] = true }
  const spot = node.attrs['data-hotspot'] !== undefined ? state.hotspots.get(String(node.attrs['data-hotspot'])) : undefined
  const onSelect = state.onSelect
  if (spot && onSelect) {
    const isSelected = state.selected === spot.id
    if (isSelected) classes.push('is-selected')
    props.role = 'button'
    props.tabIndex = hidden ? -1 : 0
    props['aria-label'] = spot.label
    props['aria-pressed'] = isSelected
    props.focusable = hidden ? 'false' : 'true'
    props.onClick = () => { if (!hidden) onSelect(spot) }
    props.onKeyDown = (event: KeyboardEvent) => {
      if (hidden || (event.key !== 'Enter' && event.key !== ' ')) return
      event.preventDefault()
      onSelect(spot)
    }
  }
  if (classes.length) props.className = classes.join(' ')
  const children = node.children.map((kid, i) => typeof kid === 'string' ? kid : toReact(kid, i, state, hidden))
  return createElement(node.tag, props, ...children)
}

/**
 * Draws a laid-out figure as React SVG. Items with data-at > beat are hidden; hotspots are focusable buttons that call
 * onSelect. Injects the figure stylesheet (VISUAL_KIT_CSS) into the document once and registers the bundled Inter font.
 */
export function VisualFigure({ drawing, beat, label, selected, onSelect }: { drawing: Drawing; beat: number; label: string; selected?: string; onSelect?: (hotspot: Hotspot) => void }) {
  useInsertionEffect(injectStyles, [])
  useEffect(() => { void ensureVisualFont() }, [])
  const hotspots = useMemo(() => new Map(drawing.hotspots.map(spot => [spot.id, spot])), [drawing])
  const state: RenderState = { beat, selected, onSelect, hotspots }
  const interactive = !!onSelect && drawing.hotspots.length > 0
  const root = drawing.svg
  const props: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(root.attrs)) if (name !== 'xmlns' && name !== 'role' && name !== 'aria-label') props[reactName(name)] = value
  return <svg {...props} role={interactive ? 'group' : 'img'} aria-label={label}>
    {root.children.map((kid, i) => typeof kid === 'string' ? kid : toReact(kid, i, state, false))}
  </svg>
}
