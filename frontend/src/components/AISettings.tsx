import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import type { DesktopAssistant, DesktopSetupState } from '../desktop'

const supported = (id: string) => id === 'claude' || id === 'codex'
const label = (agent: DesktopAssistant) => agent.id === 'claude' ? 'Claude Code' : agent.id === 'opencode' ? 'OpenCode' : agent.label
function status(assistant: DesktopAssistant): string {
  if (assistant.state === 'unsupported') return 'Update needed'
  if (assistant.state === 'unusable') return 'Installation needs attention'
  if (!assistant.available) return 'Not installed'
  switch (assistant.auth) {
    case 'account': return 'Account sign-in detected'
    case 'api': return 'API credentials · billed separately'
    case 'external': return 'External provider configured · check billing'
    case 'signed_out': return 'Sign-in needed'
    default: return 'Installed · sign-in status unavailable'
  }
}

export default function AISettings() {
  const bridge = window.pdfpalDesktop
  const dialog = useRef<HTMLDialogElement>(null)
  const generation = useRef(0)
  const [openId, setOpenId] = useState(0)
  const [agents, setAgents] = useState<DesktopAssistant[]>([])
  const [selected, setSelected] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const testingRef = useRef(false)
  const [firstRun, setFirstRun] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [billingAccepted, setBillingAccepted] = useState(false)
  const [consent, setConsent] = useState<{ agent: string; action: 'install' | 'login' }>()
  const current = agents.find(item => item.id === selected)
  const needsBilling = current?.auth === 'api' || current?.auth === 'external'
  const canUse = current?.available && (!needsBilling || billingAccepted)

  const refresh = useCallback(async () => {
    const version = ++generation.current
    setLoading(true); setError(''); setConsent(undefined)
    try {
      let data: DesktopSetupState
      if (window.pdfpalDesktop?.setupState) data = await window.pdfpalDesktop.setupState()
      else {
        const response = await fetch('/api/agents')
        if (!response.ok) throw new Error('Could not check your assistants. Try again.')
        data = await response.json()
      }
      if (version !== generation.current) return
      setAgents(data.agents)
      // Preserve explicit preferences. Only preselect a single signed-in assistant for a new user.
      const ready = data.agents.filter(item => item.available && item.auth === 'account')
      setSelected(!data.explicit && data.complete === false ? (ready.length === 1 ? ready[0]!.id : '') : data.default)
      setBillingAccepted(false)
    } catch {
      if (version === generation.current) setError('Could not check your assistants. Check that the local service is running, then try again.')
    } finally { if (version === generation.current) setLoading(false) }
  }, [])

  const open = useCallback((welcome = false) => {
    if (dialog.current?.open) { dialog.current.focus(); return }
    setOpenId(value => value + 1); setFirstRun(welcome); setNotice(''); setConsent(undefined)
    dialog.current?.showModal()
    void refresh()
  }, [refresh])

  useEffect(() => bridge?.onOpenAISettings?.(() => open()), [bridge, open])
  useEffect(() => {
    let active = true
    void bridge?.setupStatus?.().then(state => { if (active && !state.complete) open(true) }).catch(() => {})
    return () => { active = false }
  }, [bridge, open])
  useEffect(() => {
    const listener = () => open()
    window.addEventListener('pdfpal-open-ai-settings', listener)
    return () => window.removeEventListener('pdfpal-open-ai-settings', listener)
  }, [open])

  const close = () => {
    if (saving) return
    generation.current++
    if (testingRef.current) void bridge?.cancelTest?.().catch(() => {})
    testingRef.current = false; setTesting(false)
    dialog.current?.close()
  }
  const finishWithoutAI = async () => {
    if (saving) return
    setSaving(true)
    try { await bridge?.completeSetup?.(); closeAfterSave() }
    catch { setError('Setup could not be saved. You can close this window and keep reading.') }
    finally { setSaving(false) }
  }
  const closeAfterSave = () => { generation.current++; dialog.current?.close() }
  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!selected || saving || testing || !bridge || !canUse) return
    setSaving(true); setError('')
    try {
      const effective = await bridge.setAgent(selected)
      if (effective !== selected) {
        setSelected(effective)
        setError('Your startup configuration keeps another assistant as the default. Update that configuration to change it here.')
      } else {
        if (firstRun) await bridge.completeSetup?.()
        closeAfterSave()
      }
    } catch { setError('Your choice could not be saved. Check that pdfpal is running, then try again.') }
    finally { setSaving(false) }
  }
  const test = async () => {
    if (!bridge?.testConnection || !canUse || testingRef.current) return
    const version = ++generation.current
    setTesting(true); testingRef.current = true; setError(''); setNotice('')
    try {
      const result = await bridge.testConnection(selected)
      if (version === generation.current) {
        setAgents(items => items.map(item => item.id === selected ? { ...item, testedAt: result.at } : item))
        setNotice('Connection verified. You’re ready to ask a question about your PDF.')
      }
    } catch (cause) {
      if (version === generation.current) setError(cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : 'Connection test failed. Try the official setup guide.')
    } finally { if (version === generation.current) { setTesting(false); testingRef.current = false } }
  }
  const cancelTest = async () => {
    generation.current++
    try { await bridge?.cancelTest?.(); setNotice('Connection test cancelled.') }
    catch { setError('The service stopped. Retry from the tray when it is available.') }
    finally { setTesting(false); testingRef.current = false }
  }
  const launch = async () => {
    if (!consent) return
    setSaving(true); setError('')
    try {
      await bridge?.setupAction?.(consent.agent, consent.action)
      setNotice('An official setup window has opened. Finish there, close it, then choose Check again here.')
      setConsent(undefined)
    } catch (cause) { setError(cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : 'Could not open setup. Use the official guide instead.') }
    finally { setSaving(false) }
  }
  const choose = async (agent: string) => {
    setSaving(true); setError('')
    try { if (await bridge?.chooseBinary?.(agent)) await refresh() }
    catch { setError('That application could not be verified or your startup configuration fixes its location. Use the official setup guide.') }
    finally { setSaving(false) }
  }

  if (!bridge) return null
  return <dialog ref={dialog} className="ai-settings" data-open-id={openId} aria-busy={loading} aria-labelledby="ai-settings-title" aria-describedby="ai-settings-description"
    onCancel={event => { event.preventDefault(); close() }}>
    <form onSubmit={save}>
      <header className="ai-settings-header">
        <div><span className="ai-settings-eyebrow">{firstRun ? 'WELCOME TO PDFPAL' : 'SETTINGS'}</span>
          <h2 id="ai-settings-title">{firstRun ? 'Connect your reading assistant' : 'AI assistant'}</h2>
          <p id="ai-settings-description">{firstRun ? 'Bring your existing AI account. Your PDFs and notes stay in your local library.' : 'Choose the assistant you want beside your reading.'}</p>
        </div>
        <button type="button" className="ai-settings-close" onClick={close} disabled={saving} aria-label="Close AI settings">×</button>
      </header>
      <div className="ai-settings-content">
        {error && <p role="alert" className="ai-settings-error">{error}</p>}
        {notice && <p role="status" className="ai-settings-notice">{notice}</p>}
        {loading ? <p role="status" className="ai-settings-loading">Checking installed assistants…</p> : <>
          <fieldset className="ai-settings-options" disabled={saving || testing}>
            <legend className="sr-only">Default assistant</legend>
            {agents.filter(item => !firstRun || supported(item.id) || item.available || item.id === selected).map(assistant => <div key={assistant.id} className={`ai-settings-card${selected === assistant.id ? ' is-selected' : ''}`}>
              <label className={`ai-settings-option${selected === assistant.id ? ' is-selected' : ''}${!assistant.available ? ' is-unavailable' : ''}`}>
                <input type="radio" name="assistant" value={assistant.id} checked={selected === assistant.id}
                  disabled={!assistant.available} onChange={() => { setSelected(assistant.id); setBillingAccepted(false); setError(''); setNotice('') }} />
                <span className="ai-settings-option-text"><strong>{label(assistant)}</strong><span>{status(assistant)}{assistant.version && ` · ${assistant.version}`}</span></span>
                {selected === assistant.id && assistant.available && <span className="ai-settings-selected">Selected</span>}
              </label>
              {supported(assistant.id) && bridge.setupAction && <div className="ai-settings-actions">
                <button type="button" onClick={() => setConsent({ agent: assistant.id, action: assistant.available ? 'login' : 'install' })}>
                  {assistant.available ? `Sign in${assistant.auth === 'account' ? ' again' : ''}` : `${assistant.state === 'unsupported' ? 'Update' : assistant.state === 'unusable' ? 'Repair' : 'Install'} ${label(assistant)}`}
                </button>
                <button type="button" onClick={() => { void bridge.setupAction?.(assistant.id, 'docs').catch(() => setError('Could not open the official setup guide.')) }}>Official setup guide</button>
                <details><summary>Advanced</summary><button type="button" onClick={() => { void choose(assistant.id) }}>Choose application…</button></details>
              </div>}
            </div>)}
          </fieldset>
          {!agents.some(assistant => assistant.available) && <p className="ai-settings-help">Install Claude Code or Codex and sign in with your account, then check again. You can keep reading without AI.</p>}
        </>}
        {consent && <section className="ai-settings-confirm" aria-label="Confirm assistant setup">
          <h3>{consent.action === 'install' ? `Install ${consent.agent === 'claude' ? 'Claude Code' : 'Codex'}?` : 'Sign in with your account?'}</h3>
          <p>{consent.action === 'install' ? 'This opens a PowerShell window and runs the provider’s official installer. It downloads and installs the assistant for your Windows user. No separate Node.js installation is required.' : 'This opens the assistant’s official sign-in flow in a separate window. Choose your Claude or ChatGPT account to use its included allowance. Your password is entered only with the provider.'}</p>
          <div className="ai-settings-actions"><button type="button" onClick={() => { void launch() }} disabled={saving}>Open {consent.action === 'install' ? 'official installer' : 'sign-in'}</button><button type="button" onClick={() => setConsent(undefined)} disabled={saving}>Back</button></div>
        </section>}
        {needsBilling && <label className="ai-settings-billing"><input type="checkbox" checked={billingAccepted} disabled={saving || testing} onChange={event => setBillingAccepted(event.target.checked)} />I understand this configuration may charge separately from my subscription.</label>}
        {current?.available && supported(current.id) && bridge.testConnection && <section className="ai-settings-test">
          <h3>Check the connection <span>Optional</span></h3>
          <p>Sends a short fixed test using your provider allowance. No document contents are included.</p>
          {current.testedAt && <p className="ai-settings-verified">Last verified: {new Date(current.testedAt).toLocaleString()}</p>}
          {testing ? <div className="ai-settings-actions"><span role="status">Testing connection…</span><button type="button" onClick={() => { void cancelTest() }}>Cancel test</button></div> : <button type="button" className="ai-settings-cancel" disabled={saving || loading || !canUse} onClick={() => { void test() }}>Test connection</button>}
        </section>}
        <p className="ai-settings-help">Uses your installed assistant and its current account. Provider usage limits apply. Sign-in detection does not verify remaining allowance.</p>
        <button type="button" className="ai-settings-refresh" onClick={() => { setNotice(''); void refresh() }} disabled={loading || saving || testing}>Check again</button>
      </div>
      <footer className="ai-settings-footer">
        <button type="button" className="ai-settings-cancel" onClick={firstRun ? () => { void finishWithoutAI() } : close} disabled={saving || testing}>{firstRun ? 'Continue without AI' : 'Cancel'}</button>
        <button type="submit" className="ai-settings-save" disabled={loading || saving || testing || !canUse}>{saving ? 'Saving…' : firstRun ? 'Start reading' : 'Use assistant'}</button>
      </footer>
    </form>
  </dialog>
}
