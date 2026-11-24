import { useEffect, useState } from 'react'

export function useChatModelPreference(projectId: string | null | undefined, sourceId: string | null | undefined, agent: string, accountId?: string) {
  // The browser's origin scopes standalone preferences. Desktop recovery copies
  // can have identical project and source IDs, so include the active library ID.
  const [library, setLibrary] = useState<string | null | undefined>(() => window.pdfpalDesktop?.libraryState ? undefined : 'browser')
  const [localChanges, setLocalChanges] = useState(() => new Map<string, string>())

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
  let value = key ? localChanges.get(key) : ''
  if (key && value === undefined) {
    try { value = localStorage.getItem(key) ?? '' }
    catch { value = '' }
  }

  function setValue(model: string) {
    if (!key) return
    setLocalChanges(previous => new Map(previous).set(key, model))
    try {
      if (model) localStorage.setItem(key, model)
      else localStorage.removeItem(key)
    } catch { /* Keep the current reader usable when browser storage is unavailable. */ }
  }

  return { key, value: value ?? '', setValue, loading: library === undefined }
}
