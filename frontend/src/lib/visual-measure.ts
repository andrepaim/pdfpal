// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- an ambient declaration both bundlers' type checks need
/// <reference path="../assets/fonts/fonts.d.ts" />
// Text measurement for figures in the bundled Inter font. Importable under Node (tests): nothing touches the DOM until
// a function is called, and without a canvas the per-character approximation is used.
import { approximateMeasure, VISUAL_FONT_FAMILY, type Measure } from '../../../src/shared/visual-kit'

const STACK = `"${VISUAL_FONT_FAMILY}", Inter, "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif`
let loading: Promise<void> | undefined
let ready = false
let context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null | undefined
const cache = new Map<string, number>()

// Loaded lazily so Node can import this module: the asset import only exists inside a bundler.
const fontUrl = async (): Promise<string> => (await import('../assets/fonts/inter-latin-wght-normal.woff2')).default

/** Resolves once the bundled Inter font is registered and loaded (document.fonts), so measurements are final. */
export function ensureVisualFont(): Promise<void> {
  if (typeof document === 'undefined' || typeof FontFace === 'undefined' || !document.fonts) return Promise.resolve()
  loading ??= (async () => {
    try {
      const face = new FontFace(VISUAL_FONT_FAMILY, `url("${await fontUrl()}") format("woff2")`, { weight: '100 900', style: 'normal', display: 'swap' })
      document.fonts.add(face)
      await face.load()
    } catch {
      // The system font stack takes over; measurements follow whatever is drawn.
    } finally {
      ready = true
      cache.clear()
    }
  })()
  return loading
}

/** True once ensureVisualFont() has settled (loaded or given up). */
export const visualFontReady = (): boolean => ready

function canvas(): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null {
  if (context !== undefined) return context
  try {
    if (typeof document !== 'undefined') context = document.createElement('canvas').getContext('2d')
    else if (typeof OffscreenCanvas !== 'undefined') context = new OffscreenCanvas(1, 1).getContext('2d')
    else context = null
  } catch { context = null }
  return context ?? null
}

/** Measures text in Inter on a canvas; falls back to the approximate measurer where no canvas exists. */
export const measureVisualText: Measure = (text, size, weight) => {
  const ctx = canvas()
  if (!ctx) return approximateMeasure(text, size, weight)
  const key = `${weight} ${size} ${text}`
  let width = cache.get(key)
  if (width === undefined) {
    ctx.font = `${weight} ${size}px ${STACK}`
    width = ctx.measureText(text).width
    cache.set(key, width)
  }
  return width
}

/** The bundled font as a data: URL, for embedding into exported HTML. */
export async function visualFontDataUrl(): Promise<string | undefined> {
  try {
    const url = await fontUrl()
    if (url.startsWith('data:')) return url
    const response = await fetch(url)
    if (!response.ok) return undefined
    const bytes = new Uint8Array(await response.arrayBuffer())
    let binary = ''
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return `data:font/woff2;base64,${btoa(binary)}`
  } catch {
    return undefined
  }
}
