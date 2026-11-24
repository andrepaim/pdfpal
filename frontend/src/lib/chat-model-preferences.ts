import { useEffect, useMemo, useState } from 'react'

function useLocalPreference(key: string | undefined) {
  const [localChanges, setLocalChanges] = useState(() => new Map<string, string | undefined>())
  let value: string | undefined
  if (key) {
    if (localChanges.has(key)) value = localChanges.get(key)
    else {
      try { value = localStorage.getItem(key) ?? undefined }
      catch { /* Storage can be unavailable in the reader. */ }
    }
  }

  function setValue(value: string | undefined) {
    if (!key) return
    setLocalChanges(previous => new Map(previous).set(key, value))
    try {
      if (value === undefined) localStorage.removeItem(key)
      else localStorage.setItem(key, value)
    } catch { /* Keep the current reader usable when browser storage is unavailable. */ }
  }

  return { value, setValue }
}

export function useChatModelPreference(projectId: string | null | undefined, sourceId: string | null | undefined, agent: string, accountId?: string) {
  // The browser's origin scopes standalone preferences. Desktop recovery copies
  // can have identical project and source IDs, so include the active library ID.
  const [library, setLibrary] = useState<string | null | undefined>(() => window.pdfpalDesktop?.libraryState ? undefined : 'browser')

  useEffect(() => {
    const desktop = window.pdfpalDesktop
    if (!desktop?.libraryState) return
    let pending = true
    const finish = (library: string | null) => {
      if (pending) setLibrary(library)
      pending = false
      clearTimeout(timeout)
    }
    const timeout = setTimeout(() => finish(null), 2000)
    void desktop.libraryState().then(state => finish(state.active || null), () => finish(null))
    return () => { pending = false; clearTimeout(timeout) }
  }, [])

  const account = agent === 'chatgpt' ? accountId : ''
  const key = library && projectId && sourceId && agent && account !== undefined
    ? `pdfpal:paper-chat-model:${JSON.stringify([library, projectId, sourceId, agent, account])}`
    : undefined
  const model = useLocalPreference(key)

  return { key, value: model.value ?? '', setValue: (value: string) => model.setValue(value || undefined),
    loading: library === undefined, unavailable: library === null }
}

export function useChatEffortPreference(modelPreferenceKey: string | undefined, model: string | undefined) {
  // One entry per paper and assistant is enough to know whether a send needs
  // to wait for model discovery, including when the paper uses the default model.
  const stored = useLocalPreference(modelPreferenceKey && `${modelPreferenceKey}:efforts`)
  const efforts = useMemo(() => {
    try {
      const value: unknown = stored.value ? JSON.parse(stored.value) : undefined
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return new Map(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
      }
    } catch { /* Ignore a malformed local preference. */ }
    return new Map<string, string>()
  }, [stored.value])

  function setValue(effort: string | undefined) {
    if (!model) return
    const updated = new Map(efforts)
    if (effort === undefined) updated.delete(model)
    else updated.set(model, effort)
    stored.setValue(updated.size ? JSON.stringify(Object.fromEntries(updated)) : undefined)
  }

  return { value: model ? efforts.get(model) : undefined, setValue, hasSaved: efforts.size > 0 }
}
