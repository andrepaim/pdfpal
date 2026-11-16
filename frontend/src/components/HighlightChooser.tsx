// "Share several highlights": choosing 2 to SET.maxItems highlights of the open PDF for a carousel, and their order,
// which is the order of their slides. A native <dialog>, keyboard-operable throughout. See "Stage 3" in
// docs/share-posts-plan.md.
import { useEffect, useRef, useState } from 'react'
import { CARD, HIGHLIGHT_COLORS, SET, cleanPassage, highlightColor, type HighlightColor } from '../../../src/shared/share-card'
import { HIGHLIGHT_HEX } from '../lib/share-card/looks'
import { Modal, button, faded, muted, primary } from './SharePostParts'

/** A highlight of the open PDF, as the chooser lists it. */
export type ChooserHighlight = { id: string; page: number; color: string; text: string; y?: number }

/** The highlights that can make a post (the server's passage limits), in page order and top to bottom on a page. */
export function eligibleHighlights<T extends ChooserHighlight>(highlights: T[]): T[] {
  return highlights
    .filter(highlight => { const length = cleanPassage(highlight.text).length; return length >= CARD.passageMin && length <= CARD.passageMax })
    .sort((a, b) => a.page - b.page || (a.y ?? 0) - (b.y ?? 0))
}

const start = (text: string, max = 90) => { const clean = cleanPassage(text); return clean.length > max ? `${clean.slice(0, max).replace(/\s+\S*$/u, '')}…` : clean }
const COLOR_NAMES: Record<HighlightColor, string> = Object.fromEntries(HIGHLIGHT_COLORS.map(color => [color, color[0]!.toUpperCase() + color.slice(1)])) as Record<HighlightColor, string>

/** How many are chosen, against the rule, in words. */
export function chosenStatus(count: number): { text: string; ok: boolean } {
  if (count < SET.minItems) return { text: `${count} chosen. Choose at least ${SET.minItems}.`, ok: false }
  if (count > SET.maxItems) return { text: `${count} chosen. A carousel holds at most ${SET.maxItems}; remove ${count - SET.maxItems}.`, ok: false }
  return { text: `${count} chosen.`, ok: true }
}

type Props = {
  open: boolean
  /** The PDF's eligible highlights, in page order (eligibleHighlights). */
  highlights: ChooserHighlight[]
  /** The chosen IDs in slide order; kept by the caller so a refused start can be tried again with the same choice. */
  chosen: string[]
  onChange: (chosen: string[]) => void
  onCreate: (ids: string[]) => void
  onCancel: () => void
}

export default function HighlightChooser({ open, highlights, chosen, onChange, onCreate, onCancel }: Props) {
  const byId = new Map(highlights.map(highlight => [highlight.id, highlight]))
  const order = chosen.filter(id => byId.has(id))
  const status = chosenStatus(order.length)
  const list = useRef<HTMLOListElement>(null)
  const [focus, setFocus] = useState<{ id: string; direction: 'up' | 'down' } | null>(null)
  const [announcement, setAnnouncement] = useState('')

  // After a move, keep the focus on the same button of the moved highlight, or on the other one at the list's end.
  useEffect(() => {
    if (!focus) return
    const row = list.current?.querySelector(`[data-chosen-id="${focus.id}"]`)
    const wanted = row?.querySelector<HTMLButtonElement>(`[data-move="${focus.direction}"]:not([aria-disabled="true"])`)
      ?? row?.querySelector<HTMLButtonElement>('[data-move]:not([aria-disabled="true"])')
    wanted?.focus()
    setFocus(null)
  }, [focus])

  const toggle = (id: string) => onChange(order.includes(id) ? order.filter(other => other !== id) : [...order, id])
  const move = (id: string, direction: 'up' | 'down') => {
    const index = order.indexOf(id), target = direction === 'up' ? index - 1 : index + 1
    if (index < 0 || target < 0 || target >= order.length) return
    const next = [...order]
    next.splice(index, 1); next.splice(target, 0, id)
    onChange(next)
    setFocus({ id, direction })
    setAnnouncement(`Moved to slide position ${target + 1} of ${next.length}.`)
  }
  const label = (highlight: ChooserHighlight) => `p. ${highlight.page} · ${start(highlight.text, 60)}`

  return (
    <Modal open={open} title="Share several highlights" onClose={onCancel} actions={<>
      <button type="button" onClick={onCancel} style={button}>Cancel</button>
      <button type="button" onClick={() => { if (status.ok) onCreate(order) }} disabled={!status.ok} style={faded(primary, !status.ok)}>Create carousel</button>
    </>}>
      <div data-highlight-chooser style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 'min(70vh, 640px)', overflowY: 'auto', minWidth: 0 }}>
        <p id="chooser-hint" style={{ ...muted, fontSize: 12, margin: 0 }}>
          Choose {SET.minItems} to {SET.maxItems} highlights. Each becomes a slide, in the order below, between a cover and a takeaway.
        </p>
        <fieldset style={{ border: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }} aria-describedby="chooser-hint">
          <legend style={{ fontSize: 12, fontWeight: 600, color: '#e5e7eb', marginBottom: 4, padding: 0 }}>Highlights in this PDF</legend>
          {highlights.map(highlight => {
            const color = highlightColor(highlight.color), checked = order.includes(highlight.id)
            return (
              <label key={highlight.id} data-chooser-id={highlight.id}
                style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 8px', borderRadius: 8, border: `1px solid ${checked ? 'var(--accent)' : 'var(--border)'}`, cursor: 'pointer', minWidth: 0 }}>
                <input type="checkbox" checked={checked} onChange={() => toggle(highlight.id)} style={{ marginTop: 2, flexShrink: 0 }}
                  aria-label={`${COLOR_NAMES[color]} highlight on page ${highlight.page}: ${start(highlight.text)}`} />
                <span aria-hidden="true" title={COLOR_NAMES[color]} style={{ width: 10, height: 10, borderRadius: 3, background: HIGHLIGHT_HEX[color], flexShrink: 0, marginTop: 3 }} />
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <span style={muted}>p. {highlight.page}</span>
                  <span style={{ fontSize: 12, color: '#d1d5db', overflowWrap: 'anywhere' }}>{start(highlight.text)}</span>
                </span>
              </label>
            )
          })}
        </fieldset>
        <p role="status" data-chooser-status style={{ fontSize: 12, margin: 0, color: status.ok ? '#9ca3af' : '#fca5a5' }}>{status.text}</p>
        {order.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
            <h3 id="chooser-order" style={{ fontSize: 12, fontWeight: 600, color: '#e5e7eb', margin: 0 }}>Slide order</h3>
            <ol ref={list} aria-labelledby="chooser-order" style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {order.map((id, index) => {
                const highlight = byId.get(id)!
                const first = index === 0, last = index === order.length - 1
                return (
                  <li key={id} data-chosen-id={id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', borderRadius: 8, background: '#16161c', minWidth: 0 }}>
                    <span aria-hidden="true" style={{ ...muted, width: 16, textAlign: 'right', flexShrink: 0 }}>{index + 1}</span>
                    <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 2, background: HIGHLIGHT_HEX[highlightColor(highlight.color)], flexShrink: 0 }} />
                    <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: '#d1d5db', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label(highlight)}</span>
                    <button type="button" data-move="up" aria-label={`Move up: ${label(highlight)}`} aria-disabled={first}
                      onClick={() => move(id, 'up')} style={faded({ ...button, padding: '2px 8px', flexShrink: 0 }, first)}>↑</button>
                    <button type="button" data-move="down" aria-label={`Move down: ${label(highlight)}`} aria-disabled={last}
                      onClick={() => move(id, 'down')} style={faded({ ...button, padding: '2px 8px', flexShrink: 0 }, last)}>↓</button>
                  </li>
                )
              })}
            </ol>
          </div>
        )}
        <div aria-live="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{announcement}</div>
      </div>
    </Modal>
  )
}
