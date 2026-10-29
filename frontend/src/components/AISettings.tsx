import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'

interface Assistant {
  id: string
  label: string
  available: boolean
  auth?: string
}

function status(assistant: Assistant): string {
  if (!assistant.available) return 'Not installed'
  switch (assistant.auth) {
    case 'account': return 'Account sign-in detected'
    case 'api': return 'API credentials · billed separately'
    case 'external': return 'External provider configured'
    case 'signed_out': return 'Sign-in needed'
    default: return 'Installed'
  }
}

export default function AISettings() {
  const dialog = useRef<HTMLDialogElement>(null)
  const generation = useRef(0)
  const [agents, setAgents] = useState<Assistant[]>([])
  const [selected, setSelected] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    const current = ++generation.current
    setLoading(true); setError('')
    try {
      const response = await fetch('/api/agents')
      if (!response.ok) throw new Error('Could not check your assistants. Try again.')
      const data = await response.json() as { default: string; agents: Assistant[] }
      if (current !== generation.current) return
      setAgents(data.agents)
      setSelected(data.default)
    } catch (cause) {
      if (current === generation.current) setError(cause instanceof Error ? cause.message : 'Could not check assistants.')
    } finally { if (current === generation.current) setLoading(false) }
  }, [])

  useEffect(() => window.pdfpalDesktop?.onOpenAISettings?.(() => {
    if (dialog.current?.open) { dialog.current.focus(); return }
    dialog.current?.showModal()
    void refresh()
  }), [refresh])

  const close = () => {
    if (saving) return
    generation.current++
    dialog.current?.close()
  }
  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!selected || saving || !window.pdfpalDesktop) return
    setSaving(true); setError('')
    try {
      const effective = await window.pdfpalDesktop.setAgent(selected)
      if (effective !== selected) {
        setSelected(effective)
        setError('Your startup configuration keeps another assistant as the default. Update that configuration to change it here.')
      } else dialog.current?.close()
    } catch {
      setError('Your choice could not be saved. Check that pdfpal is running, then try again.')
    } finally { setSaving(false) }
  }

  if (!window.pdfpalDesktop) return null
  return <dialog ref={dialog} className="ai-settings" aria-labelledby="ai-settings-title" aria-describedby="ai-settings-description"
    onCancel={event => { if (saving) event.preventDefault(); else generation.current++ }}>
    <form onSubmit={save}>
      <header className="ai-settings-header">
        <div>
          <h2 id="ai-settings-title">AI assistant</h2>
          <p id="ai-settings-description">Choose the assistant you want beside your reading.</p>
        </div>
        <button type="button" className="ai-settings-close" onClick={close} disabled={saving} aria-label="Close AI settings">×</button>
      </header>
      <div className="ai-settings-content">
        {error && <p role="alert" className="ai-settings-error">{error}</p>}
        {loading ? <p role="status" className="ai-settings-loading">Checking installed assistants…</p> : <>
          <fieldset className="ai-settings-options" disabled={saving}>
            <legend className="sr-only">Default assistant</legend>
            {agents.map(assistant => <label key={assistant.id} className={`ai-settings-option${selected === assistant.id ? ' is-selected' : ''}${!assistant.available ? ' is-unavailable' : ''}`}>
              <input type="radio" name="assistant" value={assistant.id} checked={selected === assistant.id}
                disabled={!assistant.available} onChange={() => setSelected(assistant.id)} />
              <span className="ai-settings-option-text"><strong>{assistant.id === 'claude' ? 'Claude Code' : assistant.id === 'opencode' ? 'OpenCode' : assistant.label}</strong><span>{status(assistant)}</span></span>
              {selected === assistant.id && assistant.available && <span className="ai-settings-selected">Selected</span>}
            </label>)}
          </fieldset>
          {!agents.some(assistant => assistant.available) && <p className="ai-settings-help">Install Claude Code or Codex and sign in with your account, then check again. You can keep reading without AI.</p>}
        </>}
        <p className="ai-settings-help">Uses your installed assistant and its current account. Provider usage limits apply.</p>
        <button type="button" className="ai-settings-refresh" onClick={() => { void refresh() }} disabled={loading || saving}>Check again</button>
      </div>
      <footer className="ai-settings-footer">
        <button type="button" className="ai-settings-cancel" onClick={close} disabled={saving}>Cancel</button>
        <button type="submit" className="ai-settings-save" disabled={loading || saving || !agents.some(assistant => assistant.id === selected && assistant.available)}>{saving ? 'Saving…' : 'Use assistant'}</button>
      </footer>
    </form>
  </dialog>
}
