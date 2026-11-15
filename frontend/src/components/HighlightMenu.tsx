import { useEffect, useRef } from 'react'
import type { Annotation } from '../lib/api'

export type HighlightMenuState = { annotation: Annotation; x: number; y: number }

const COLORS: Array<{ id: string; label: string; hex: string }> = [
  { id: 'yellow', label: 'Yellow', hex: '#fde047' }, { id: 'green', label: 'Green', hex: '#4ade80' },
  { id: 'blue', label: 'Blue', hex: '#60a5fa' }, { id: 'pink', label: 'Pink', hex: '#f472b6' },
]
const WIDTH = 220

const item: React.CSSProperties = { display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', color: '#e5e7eb', padding: '7px 10px', fontSize: 12, borderRadius: 6, cursor: 'pointer' }

/** What a click on a highlight offers: ask about it, make or open its post, recolour it, or delete it. */
export default function HighlightMenu({ menu, hasPost, onClose, onAsk, onPost, onColor, onDelete }: {
  menu: HighlightMenuState; hasPost: boolean; onClose: () => void
  onAsk: () => void; onPost: () => void; onColor: (color: string) => void; onDelete: () => void
}) {
  const root = useRef<HTMLDivElement>(null)
  const opener = useRef(document.activeElement as HTMLElement | null)
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    root.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const dismiss = () => close.current()
    const outside = (event: Event) => { if (!root.current?.contains(event.target as Node)) dismiss() }
    document.addEventListener('mousedown', outside)
    document.addEventListener('scroll', outside, true)
    window.addEventListener('resize', dismiss)
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('scroll', outside, true); window.removeEventListener('resize', dismiss) }
  }, [menu])
  const choose = (action: () => void) => () => { onClose(); opener.current?.focus?.(); action() }
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); opener.current?.focus?.(); return }
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return
    event.preventDefault()
    const buttons = [...(root.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const forward = event.key === 'ArrowDown' || event.key === 'ArrowRight'
    buttons[(index + (forward ? 1 : buttons.length - 1)) % buttons.length]?.focus()
  }
  const left = Math.max(8, Math.min(menu.x, window.innerWidth - WIDTH - 8))
  const top = Math.max(8, Math.min(menu.y + 6, window.innerHeight - 190))
  return (
    <div ref={root} role="menu" aria-label="Highlight" data-highlight-menu onKeyDown={onKeyDown}
      style={{ position: 'fixed', left, top, width: WIDTH, zIndex: 10000, background: '#111114', border: '1px solid var(--border)', borderRadius: 10, padding: 4, boxShadow: '0 10px 30px rgba(0,0,0,0.55)' }}>
      <button role="menuitem" style={item} onClick={choose(onAsk)}>💬 Ask</button>
      <button role="menuitem" style={item} onClick={choose(onPost)}>✦ {hasPost ? 'Open post' : 'Create post'}</button>
      <div role="group" aria-label="Colour" style={{ display: 'flex', gap: 8, padding: '6px 10px' }}>
        {COLORS.map(color => (
          <button key={color.id} role="menuitemradio" aria-checked={menu.annotation.color === color.id} aria-label={`${color.label} highlight`} title={color.label}
            onClick={choose(() => onColor(color.id))}
            style={{ width: 20, height: 20, borderRadius: '50%', background: color.hex, cursor: 'pointer', padding: 0,
              border: menu.annotation.color === color.id ? '2px solid #fff' : '2px solid transparent', boxShadow: '0 0 0 1px rgba(0,0,0,0.4)' }} />
        ))}
      </div>
      <button role="menuitem" style={{ ...item, color: '#fca5a5' }} onClick={choose(onDelete)}>🗑 Delete</button>
    </div>
  )
}
