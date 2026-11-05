import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { collectionsApi, type Collection } from '../lib/api'
import './collection-dialog.css'

export default function CollectionDialog({ projectId, parent, onCreated, onClose }: {
  projectId: string
  parent: Collection | null
  onCreated: (collection: Collection) => void
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const pending = useRef(false)
  const id = useId()
  const [name, setName] = useState('New Collection')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const element = dialog.current!
    const trigger = document.activeElement
    element.showModal()
    input.current?.select()
    return () => {
      element.close()
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus()
    }
  }, [])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (pending.current || !name.trim()) return
    pending.current = true
    setSaving(true)
    setError('')
    try {
      const created = await collectionsApi.create(projectId, name.trim(), parent?.id)
      onCreated(created)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create the collection. Try again.')
    } finally {
      pending.current = false
      setSaving(false)
    }
  }

  return <dialog ref={dialog} className="ai-settings collection-dialog" aria-labelledby={`${id}-title`}
    aria-describedby={`${id}-description`} onCancel={event => { event.preventDefault(); if (!pending.current) onClose() }}>
    <form onSubmit={submit} aria-busy={saving}>
      <header className="ai-settings-header">
        <div><h2 id={`${id}-title`}>{parent ? 'New sub-collection' : 'New collection'}</h2>
          <p id={`${id}-description`}>{parent ? `Inside ${parent.name}` : 'Organize your papers into a collection.'}</p></div>
        <button type="button" className="ai-settings-close" aria-label="Close collection dialog" disabled={saving} onClick={onClose}>×</button>
      </header>
      <div className="ai-settings-content collection-dialog-content">
        <label htmlFor={`${id}-name`}>Collection name</label>
        <input ref={input} id={`${id}-name`} name="name" required autoComplete="off" value={name}
          disabled={saving} onChange={event => setName(event.target.value)} />
        {error && <p className="ai-settings-error" role="alert">{error}</p>}
      </div>
      <footer className="ai-settings-footer">
        <button type="button" className="ai-settings-cancel" disabled={saving} onClick={onClose}>Cancel</button>
        <button type="submit" className="ai-settings-save" disabled={saving || !name.trim()}>{saving ? 'Creating…' : 'Create collection'}</button>
      </footer>
    </form>
  </dialog>
}
