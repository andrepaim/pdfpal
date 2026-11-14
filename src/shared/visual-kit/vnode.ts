// The virtual SVG tree the kit draws into, and its serialiser. The kit never touches the DOM.

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

export type Attr = string | number | null | undefined | false
export type Kid = VNode | string | null | undefined | false | Kid[]

/** Rounds to one decimal, which is all an SVG coordinate needs. */
export const r1 = (n: number): number => { const v = Math.round(n * 10) / 10; return Object.is(v, -0) ? 0 : v }

/** Builds a node, dropping null/false attributes and children and flattening nested child arrays. */
export function h(tag: string, attrs: Record<string, Attr> = {}, ...kids: Kid[]): VNode {
  const clean: Record<string, string | number> = {}
  for (const [key, value] of Object.entries(attrs)) if (value !== null && value !== undefined && value !== false) clean[key] = value
  const children: Array<VNode | string> = []
  const add = (kid: Kid) => {
    if (kid === null || kid === undefined || kid === false) return
    if (Array.isArray(kid)) { for (const k of kid) add(k); return }
    children.push(kid)
  }
  for (const kid of kids) add(kid)
  return { tag, attrs: clean, children }
}

/** Appends children to an existing node (the kit's equivalent of element.append). */
export function append(node: VNode, ...kids: Kid[]): void {
  const extra = h('g', {}, ...kids).children
  node.children.push(...extra)
}

/** Adds a class to a node's class attribute. */
export function addClass(node: VNode, name: string): void {
  const current = String(node.attrs.class ?? '').trim()
  if (!current.split(/\s+/).includes(name)) node.attrs.class = current ? `${current} ${name}` : name
}

/** True when a drawn item belongs to a later beat than `beat`. */
export function hiddenAt(node: VNode, beat: number): boolean {
  const at = Number(node.attrs['data-at'])
  return Number.isFinite(at) && at > beat
}

const escapeMap: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
/** Escapes text and attribute values for XML/HTML. */
export const escapeXml = (value: string): string => value.replace(/[&<>"']/g, ch => escapeMap[ch] ?? ch)
const safeName = /^[a-zA-Z][a-zA-Z0-9:_.-]*$/

/**
 * Serialises a VNode tree to SVG markup, escaping all text and attribute values. With `beat`, items whose data-at is
 * greater than `beat` get the class "is-hidden".
 */
export function svgMarkup(node: VNode, beat?: number): string {
  const write = (n: VNode, root: boolean): string => {
    if (!safeName.test(n.tag)) return ''
    const attrs: Record<string, string | number> = root && n.tag === 'svg' ? { xmlns: 'http://www.w3.org/2000/svg', ...n.attrs } : { ...n.attrs }
    if (beat !== undefined && hiddenAt(n, beat)) {
      const current = String(attrs.class ?? '').trim()
      attrs.class = current ? `${current} is-hidden` : 'is-hidden'
    }
    let out = `<${n.tag}`
    for (const [key, value] of Object.entries(attrs)) {
      if (!safeName.test(key) || /^on/i.test(key)) continue
      out += ` ${key}="${escapeXml(String(value))}"`
    }
    let inner = ''
    for (const kid of n.children) inner += typeof kid === 'string' ? escapeXml(kid) : write(kid, false)
    return inner ? `${out}>${inner}</${n.tag}>` : `${out}/>`
  }
  return write(node, true)
}

/** Walks a tree depth-first, calling `visit` with each node and its ancestors (nearest last). */
export function walk(node: VNode, visit: (node: VNode, ancestors: VNode[]) => void, ancestors: VNode[] = []): void {
  visit(node, ancestors)
  const next = [...ancestors, node]
  for (const kid of node.children) if (typeof kid !== 'string') walk(kid, visit, next)
}

/** The concatenated text content of a node. */
export function textContent(node: VNode): string {
  return node.children.map(kid => typeof kid === 'string' ? kid : textContent(kid)).join('')
}
