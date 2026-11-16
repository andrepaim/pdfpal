// Small pieces of the Post tab (SharePostPanel.tsx): its button styles, a native <dialog> modal, the ⋯ menu, a row
// of radio buttons and a switch. No share-card logic lives here.
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'

export const button: CSSProperties = { background: 'none', border: '1px solid var(--border)', color: '#d1d5db', borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }
export const primary: CSSProperties = { ...button, background: 'var(--accent)', borderColor: 'var(--accent)', color: '#fff', fontWeight: 600 }
export const muted: CSSProperties = { fontSize: 11, color: '#9ca3af' }
export const field: CSSProperties = { width: '100%', boxSizing: 'border-box', background: 'var(--bg)', color: '#e5e7eb', border: '1px solid var(--border)', borderRadius: 8, padding: 10, fontSize: 13, fontFamily: 'inherit' }
export const heading: CSSProperties = { fontSize: 12, margin: 0, color: '#e5e7eb', fontWeight: 600 }
/** A button's style, faded while it is disabled. */
export const faded = (style: CSSProperties, disabled: boolean | undefined): CSSProperties => disabled ? { ...style, opacity: 0.5, cursor: 'default' } : style
export const alert: CSSProperties = { color: '#f87171', fontSize: 12, margin: 0 }

export function Modal({ open, title, onClose, children, actions }: { open: boolean; title: string; onClose: () => void; children?: ReactNode; actions: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])
  return (
    <dialog ref={ref} aria-label={title} onClose={onClose} onCancel={onClose} className="share-dialog"
      style={{ margin: 'auto', background: 'var(--panel)', color: '#e5e7eb', border: '1px solid var(--border)', borderRadius: 12, padding: 20, width: 'min(520px, 90vw)', boxSizing: 'border-box' }}>
      {open && <>
        <h2 style={{ fontSize: 15, margin: '0 0 12px' }}>{title}</h2>
        {children}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>{actions}</div>
      </>}
    </dialog>
  )
}

export type MenuItem = { label: string; onSelect: () => void; disabled?: boolean; danger?: boolean }

export function PostMenu({ items }: { items: Array<MenuItem | false> }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    root.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled])')?.focus()
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  const entries = items.filter((item): item is MenuItem => !!item)
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); return }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const buttons = [...(root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ?? [])]
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    buttons[(index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus()
  }
  return (
    <div ref={root} style={{ position: 'relative' }} onKeyDown={onKeyDown}>
      <button ref={trigger} aria-haspopup="menu" aria-expanded={open} aria-label="More post actions" onClick={() => setOpen(value => !value)} style={{ ...button, padding: '4px 10px' }}>⋯</button>
      {open && (
        <div role="menu" style={{ position: 'absolute', right: 0, top: '100%', marginTop: 4, zIndex: 20, background: '#111114', border: '1px solid var(--border)', borderRadius: 8, padding: 4, minWidth: 200, boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
          {entries.map(item => (
            <button key={item.label} role="menuitem" disabled={item.disabled} onClick={() => { setOpen(false); trigger.current?.focus(); item.onSelect() }}
              style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', color: item.disabled ? '#4b5563' : item.danger ? '#fca5a5' : '#e5e7eb', padding: '7px 10px', fontSize: 12, borderRadius: 6, cursor: item.disabled ? 'default' : 'pointer' }}
              onMouseEnter={event => { if (!item.disabled) event.currentTarget.style.background = '#1f1f27' }} onMouseLeave={event => { event.currentTarget.style.background = 'none' }}>
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export type Choice<T extends string> = { value: T; label: string; disabled?: boolean; title?: string }

/**
 * A row of radio buttons; only the checked option is in the tab order. The arrow keys move the choice, as in a native
 * radio group, or only the focus when `chooseOnArrow` is false (for a choice that costs a request), so Enter or Space
 * chooses. `onChoose` runs for a click on the checked option too when `rechoose` is set.
 */
export function ChoiceRow<T extends string>({ label, options, value, onChoose, disabled, rechoose, compact, chooseOnArrow = true }: {
  label: string; options: Array<Choice<T>>; value: T | null; onChoose: (value: T) => void; disabled?: boolean; rechoose?: boolean; compact?: boolean; chooseOnArrow?: boolean
}) {
  const root = useRef<HTMLDivElement>(null)
  const enabled = options.filter(option => !option.disabled && !disabled)
  const focusable = enabled.some(option => option.value === value) ? value : enabled[0]?.value
  const onKeyDown = (event: KeyboardEvent) => {
    const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp']
    if (!keys.includes(event.key) || !enabled.length) return
    event.preventDefault()
    const index = enabled.findIndex(option => option.value === (document.activeElement as HTMLElement | null)?.dataset.value)
    const next = enabled[(index + (event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : enabled.length - 1)) % enabled.length]!
    root.current?.querySelector<HTMLButtonElement>(`[data-value="${next.value}"]`)?.focus()
    if (chooseOnArrow) onChoose(next.value)
  }
  return (
    <div ref={root} role="radiogroup" aria-label={label} onKeyDown={onKeyDown} style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {options.map(option => {
        const selected = option.value === value, off = disabled || option.disabled
        return (
          <button key={option.value} type="button" role="radio" aria-checked={selected} data-value={option.value} disabled={off} title={option.title}
            tabIndex={option.value === focusable ? 0 : -1}
            onClick={() => { if (!selected || rechoose) onChoose(option.value) }}
            style={{ ...button, borderRadius: 16, padding: compact ? '4px 10px' : '5px 12px', background: selected ? '#1e1b4b' : 'none', borderColor: selected ? 'var(--accent)' : 'var(--border)',
              color: selected ? '#c7d2fe' : '#d1d5db', opacity: off ? (selected ? 0.75 : 0.45) : 1, cursor: off ? 'default' : 'pointer', maxWidth: '100%' }}>
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

/** An on/off switch with a visible label. */
export function Switch({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', padding: '2px 0', color: '#d1d5db', fontSize: 12, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.45 : 1 }}>
      <span aria-hidden="true" style={{ position: 'relative', width: 30, height: 18, borderRadius: 9, background: checked ? 'var(--accent)' : '#374151', transition: 'background 120ms', flexShrink: 0 }}>
        <span style={{ position: 'absolute', top: 2, left: checked ? 14 : 2, width: 14, height: 14, borderRadius: '50%', background: '#fff', transition: 'left 120ms' }} />
      </span>
      {label}
    </button>
  )
}
