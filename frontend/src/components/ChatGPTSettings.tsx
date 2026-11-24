import { useCallback, useEffect, useRef, useState } from 'react'
import { notifyAgentModelsChanged, type AgentModel } from '../hooks/useAgentModels'
import EffortSelect from './EffortSelect'
import ModelSelect from './ModelSelect'

export type ChatGPTState = {
  connected: boolean
  busy: boolean
  active: string | null
  accounts: { id: string; label: string; connected: boolean }[]
  models: AgentModel[]
  model: string
  effortDefaults?: Record<string, string>
  message: string
}
interface Props {
  active: boolean
  refreshKey: number
  selected: boolean
  disabled: boolean
  effortDrafts: Record<string, Record<string, string> | undefined>
  onSelect: () => void
  onEffortChange: (account: string, model: string, effort: string) => void
  onStateChange: (state: ChatGPTState | undefined, working: boolean) => void
}
const errorMessage = (cause: unknown) => cause instanceof Error
  ? cause.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
  : 'Could not update the ChatGPT connection. Try again.'

export default function ChatGPTSettings({ active, refreshKey, selected, disabled, effortDrafts, onSelect, onEffortChange, onStateChange }: Props) {
  const bridge = window.pdfpalDesktop
  const [state, setState] = useState<ChatGPTState>()
  const [error, setError] = useState('')
  const [working, setWorking] = useState(false)
  const mounted = useRef(false)
  const sequence = useRef(0)
  const workingRef = useRef(false)
  const lastModelState = useRef('')
  const apply = useCallback((next: ChatGPTState) => {
    setState(next)
    const current = JSON.stringify([next.connected, next.busy, next.active, next.model, next.models, next.effortDefaults])
    if (lastModelState.current !== current) {
      lastModelState.current = current
      notifyAgentModelsChanged('chatgpt')
    }
  }, [])
  useEffect(() => {
    onStateChange(state, working)
  }, [state, working, onStateChange])
  useEffect(() => {
    if (!active || !bridge?.chatgpt) return
    mounted.current = true
    let disposed = false
    const refresh = async () => {
      if (workingRef.current) return
      const version = ++sequence.current
      try {
        const next = await bridge.chatgpt!('state')
        if (!disposed && version === sequence.current) apply(next)
      } catch {
        if (!disposed && version === sequence.current) setError('Could not check the ChatGPT connection. Choose Check again to retry.')
      }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 2000)
    return () => {
      disposed = true
      mounted.current = false
      workingRef.current = false
      setWorking(false)
      clearInterval(timer)
    }
  }, [active, bridge, refreshKey, apply])

  async function act(action: string, ...args: unknown[]) {
    if (!bridge?.chatgpt || (workingRef.current && action !== 'cancel')) return
    const version = ++sequence.current
    workingRef.current = true
    setWorking(true)
    setError('')
    if (action === 'connect') onSelect()
    try {
      const next = await bridge.chatgpt(action, ...args)
      if (mounted.current && version === sequence.current) apply(next)
    } catch (cause) {
      if (mounted.current && version === sequence.current) setError(errorMessage(cause))
    } finally {
      if (mounted.current && version === sequence.current) {
        workingRef.current = false
        setWorking(false)
      }
    }
  }
  async function usage() {
    setError('')
    try { await bridge?.chatgpt?.('usage') }
    catch (cause) { setError(errorMessage(cause)) }
  }
  if (!bridge?.chatgpt) return null
  const busy = disabled || working || state?.busy
  const model = state?.models.find(item => item.id === state.model)
  const account = state?.active
  const description = !state ? 'Checking connection…' : state.busy ? 'Waiting for browser sign-in' : state.connected
    ? model ? 'Account connected · uses your ChatGPT plan' : 'Account connected · choose an available model'
    : 'Sign-in needed · no agent installation required'
  return <div className={`ai-settings-card${selected ? ' is-selected' : ''}`} data-provider="chatgpt">
    <label className={`ai-settings-option${selected ? ' is-selected' : ''}${!state?.connected ? ' is-unavailable' : ''}`}>
      <input type="radio" name="assistant" value="chatgpt" checked={selected}
        disabled={disabled || working || state?.busy || !state?.connected} onChange={onSelect} />
      <span className="ai-settings-option-text"><strong>ChatGPT</strong><span>{description}</span></span>
      {selected && state?.connected && <span className="ai-settings-selected">Selected</span>}
    </label>
    <div className="ai-settings-actions">
      {state?.busy ? <button type="button" disabled={disabled} onClick={() => void act('cancel')}>Cancel sign-in</button>
        : <button type="button" disabled={disabled || working || !state} onClick={() => void act('connect', state?.active || undefined)}>{state?.connected ? 'Sign in again' : 'Continue with ChatGPT'}</button>}
      <button type="button" disabled={disabled || working} onClick={() => void usage()}>Manage usage ↗</button>
    </div>
    {(selected || !!error || state?.busy) && <div className="ai-settings-provider-body">
      {error && <p role="alert" className="ai-settings-error">{error}</p>}
      {state?.message && <p role="status" className="ai-settings-provider-message">{state.message}</p>}
      {!!state?.accounts.length && <div className="ai-settings-provider-fields">
        <label className="ai-settings-provider-account">Account<select aria-label="ChatGPT account" value={account || ''} disabled={busy} onChange={event => void act('select', event.target.value)}>
          <option value="" disabled>Choose an account</option>
          {state.accounts.map(account => <option key={account.id} value={account.id}>{account.label}{account.connected ? '' : ' · sign-in needed'}</option>)}
        </select></label>
        {state.connected && <label>Model<ModelSelect label="ChatGPT model" value={state.model} models={state.models}
          allowUnlisted={false} disabled={busy || !state.models.length}
          placeholder={state.models.length ? 'Choose a model' : 'Refresh to load available models'}
          onChange={next => void act('select', account, next)} /></label>}
        {selected && state.connected && account && model && <EffortSelect label="Default reasoning effort" showLabel
          efforts={model.efforts} defaultEffort={model.defaultEffort} disabled={busy}
          value={effortDrafts[account]?.[model.id] ?? state.effortDefaults?.[model.id]}
          onChange={next => onEffortChange(account, model.id, next ?? '')} />}
      </div>}
      {!!state?.accounts.length && <div className="ai-settings-actions">
        <button type="button" disabled={busy} onClick={() => void act('connect')}>Add account</button>
        {state.connected && <><button type="button" disabled={busy} onClick={() => void act('models')}>Refresh models</button><button type="button" disabled={busy} onClick={() => void act('disconnect')}>Disconnect</button></>}
      </div>}
      <p className="ai-settings-provider-help">Eligible requests use your ChatGPT plan. Provider usage limits apply.</p>
    </div>}
  </div>
}
