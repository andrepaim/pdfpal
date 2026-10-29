import { useEffect, useRef, useState } from 'react'
import type { DesktopServiceState } from '../desktop'

export default function DesktopStatus() {
  const bridge = window.pdfpalDesktop
  const [state, setState] = useState<DesktopServiceState>({ state: 'ready' })
  const [dismissed, setDismissed] = useState(false)
  const [report, setReport] = useState<unknown>()
  const [error, setError] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    let active = true
    const update = (value: DesktopServiceState) => { if (active) { setState(value); setDismissed(false) } }
    const unsubscribe = bridge?.onServiceState?.(update)
    void bridge?.serviceState?.().then(update).catch(() => {})
    return () => { active = false; unsubscribe?.() }
  }, [bridge])
  useEffect(() => bridge?.onOpenDiagnostics?.(() => {
    dialog.current?.showModal(); setError(''); setReport(undefined)
    void bridge.diagnostics?.().then(setReport).catch(() => setError('Could not prepare diagnostics. Retry from the tray.'))
  }), [bridge])
  if (!bridge) return null
  const visible = !dismissed && (state.state !== 'ready' || state.interrupted)
  return <>
    {visible && <div className="desktop-status" role="status">
      {state.state === 'starting' ? 'The local service is restarting. Your reading view stays open.' : state.state === 'failed' ? 'The local service stopped. Retry to save changes and ask questions again.' : 'The local service restarted. Retry any interrupted question; it was not sent again automatically.'}
      {state.state === 'failed' && <button onClick={() => { void bridge.retryService?.().catch(() => {}) }}>Retry service</button>}
      {state.state === 'ready' && <button onClick={() => setDismissed(true)}>Dismiss</button>}
    </div>}
    <dialog ref={dialog} className="ai-settings" aria-labelledby="diagnostics-title">
      <header className="ai-settings-header"><div><h2 id="diagnostics-title">Diagnostic preview</h2><p>Review exactly what will be exported.</p></div><button className="ai-settings-close" aria-label="Close diagnostics" onClick={() => dialog.current?.close()}>×</button></header>
      <div className="ai-settings-content"><p className="ai-settings-help">Includes app and assistant versions, status, and recent event codes. Excludes documents, prompts, answers, passwords, tokens, and personal file paths.</p>
        {error && <p role="alert" className="ai-settings-error">{error}</p>}
        <pre>{report ? JSON.stringify(report, null, 2) : 'Preparing report…'}</pre>
      </div>
      <footer className="ai-settings-footer"><button className="ai-settings-cancel" onClick={() => dialog.current?.close()}>Close</button><button className="ai-settings-save" disabled={!report} onClick={() => { void bridge.exportDiagnostics?.().catch(() => setError('Could not export the report. Choose a writable folder and retry.')) }}>Export report</button></footer>
    </dialog>
  </>
}
