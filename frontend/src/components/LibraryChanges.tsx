import { useEffect } from 'react'

/** Refresh data without reloading the document or discarding an editor draft. */
export default function LibraryChanges() {
  useEffect(() => {
    let active = true, previous = '', checking = false
    let timer: ReturnType<typeof setTimeout>
    const controller = new AbortController()
    async function tick() {
      if (!active || checking) return
      clearTimeout(timer)
      checking = true
      try {
        if (document.visibilityState !== 'hidden') {
          const response = await fetch('/api/library/revision', { signal: controller.signal })
          if (response.ok) {
            const value = await response.json() as { instance: string; revision: number }
            const next = value.instance + ':' + value.revision
            if (previous && previous !== next) {
              window.dispatchEvent(new Event('pdfpal:library-changed'))
              window.dispatchEvent(new Event('pdfpal:sources-changed'))
            }
            previous = next
          }
        }
      } catch { /* The normal service status UI handles interruptions. */ }
      finally { checking = false; if (active) timer = setTimeout(() => void tick(), 1500) }
    }
    const visible = () => { if (document.visibilityState === 'visible') void tick() }
    document.addEventListener('visibilitychange', visible)
    void tick()
    return () => { active = false; clearTimeout(timer); controller.abort(); document.removeEventListener('visibilitychange', visible) }
  }, [])
  return null
}
