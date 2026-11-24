import { useCallback, useEffect, useMemo, useState } from 'react'

export { isCustomAgentModel, MAX_AGENT_MODEL_LENGTH } from '../../../src/shared/agent-model-id'

export interface AgentModel {
  id: string
  name: string
  efforts?: string[]
  defaultEffort?: string
}

interface AgentModels {
  models: AgentModel[]
  model: string
  accountId?: string
  effortDefaults?: Record<string, string>
}

interface ModelSnapshot {
  agent: string
  requestKey: object
  data?: AgentModels
  error?: string
}

const empty: AgentModels = { models: [], model: '' }
const modelsChanged = 'pdfpal-agent-models-changed'

export const hasAgentModelPreference = (agent: string): agent is 'claude' | 'codex' =>
  agent === 'claude' || agent === 'codex'

export function notifyAgentModelsChanged(agent: string) {
  window.dispatchEvent(new CustomEvent(modelsChanged, { detail: agent }))
}

export async function loadChatGPTModels(signal?: AbortSignal): Promise<AgentModels> {
  const bridge = window.pdfpalDesktop
  if (!bridge?.chatgpt) return empty
  if (signal?.aborted) throw signal.reason

  let abort: (() => void) | undefined
  let timeout: number | undefined
  const interrupted = new Promise<never>((_resolve, reject) => {
    abort = () => reject(signal?.reason)
    signal?.addEventListener('abort', abort, { once: true })
    timeout = window.setTimeout(() => reject(new Error('Could not check your ChatGPT account.')), 2500)
  })
  try {
    const state = await Promise.race([bridge.chatgpt('state'), interrupted])
    if (!state.connected || !state.active || state.busy) return empty
    return { models: state.models, model: state.model, accountId: state.active, effortDefaults: state.effortDefaults }
  } finally {
    window.clearTimeout(timeout)
    if (abort) signal?.removeEventListener('abort', abort)
  }
}

async function loadAgentModels(agent: string, signal: AbortSignal): Promise<AgentModels> {
  if (agent === 'chatgpt') return loadChatGPTModels(signal)
  // Cold discovery may refresh Windows PATH, inspect the installed CLI, and read its bundled model catalogue.
  const response = await fetch(`/api/agent-models/${agent}`, { signal: AbortSignal.any([signal, AbortSignal.timeout(26_000)]) })
  if (!response.ok) throw new Error('Could not load available models.')
  return await response.json()
}

export function useAgentModels(agent: string, enabled = true) {
  const [snapshot, setSnapshot] = useState<ModelSnapshot>()
  const [revision, setRevision] = useState(0)
  const refresh = useCallback(() => setRevision(version => version + 1), [])
  const supported = enabled && (hasAgentModelPreference(agent) || (agent === 'chatgpt' && !!window.pdfpalDesktop?.chatgpt))
  const requestKey = useMemo(() => ({ agent, supported, revision }), [agent, supported, revision])

  useEffect(() => {
    if (!supported) return
    const listener = (event: Event) => {
      if ((event as CustomEvent<string>).detail === agent) refresh()
    }
    window.addEventListener(modelsChanged, listener)
    return () => window.removeEventListener(modelsChanged, listener)
  }, [agent, supported, refresh])

  useEffect(() => {
    if (!supported) return
    const request = new AbortController()
    void loadAgentModels(agent, request.signal).then(data => {
      if (!request.signal.aborted) setSnapshot({ agent, requestKey, data })
    }).catch(() => {
      if (!request.signal.aborted) setSnapshot(previous => ({
        agent, requestKey, error: 'Could not load available models.',
        data: agent !== 'chatgpt' && previous?.agent === agent ? previous.data : undefined,
      }))
    })
    return () => request.abort()
  }, [agent, requestKey, supported])

  const current = supported && snapshot?.agent === agent ? snapshot : undefined
  const loading = supported && current?.requestKey !== requestKey
  const data = agent === 'chatgpt' && loading ? undefined : current?.data
  return { ...(data ?? empty), effortDefaults: data?.effortDefaults ?? {}, loaded: !!data, loading, error: loading ? undefined : current?.error, refresh }
}
