import { useEffect, useRef, useState } from 'react'
import type { DesktopUpdateState } from '../desktop'

export default function DesktopUpdates() {
  const bridge = window.pdfpalDesktop
  const dialog = useRef<HTMLDialogElement>(null)
  const generation = useRef(0)
  const [state, setState] = useState<DesktopUpdateState>()
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState('')
  const check = async () => {
    const current = ++generation.current
    setChecking(true); setError('')
    try {
      const result = await bridge?.checkUpdates?.()
      if (current === generation.current) setState(result)
    } catch { if (current === generation.current) setError('Could not check for updates. Check your connection and try again.') }
    finally { if (current === generation.current) setChecking(false) }
  }
  useEffect(() => bridge?.onOpenUpdates?.(() => {
    if (dialog.current?.open) return
    dialog.current?.showModal()
    void check()
  }), [bridge])
  if (!bridge?.checkUpdates) return null
  const action = async (callback?: () => Promise<boolean>) => {
    try { await callback?.() } catch { setError('Could not open this item. Please try again.') }
  }
  return <dialog ref={dialog} className="ai-settings desktop-updates" aria-labelledby="desktop-updates-title" onClose={() => { generation.current++ }}>
    <header className="ai-settings-header"><div><span className="ai-settings-eyebrow">PDFPAL</span><h2 id="desktop-updates-title">Software updates</h2><p>{state ? `Version ${state.currentVersion}${state.distribution === 'unsigned' ? ' · Unsigned preview' : ''}` : 'Checking your desktop version…'}</p></div><button className="ai-settings-close" aria-label="Close software updates" onClick={() => dialog.current?.close()}>×</button></header>
    <div className="ai-settings-content">
      {checking ? <p role="status" className="ai-settings-help">Checking official desktop releases…</p> : <>
        {state?.state === 'available' && <><h3>pdfpal {state.version} is available</h3><p className="ai-settings-help">Download the installer, quit pdfpal from its tray menu, then run the installer. Your library is kept.</p><p className="ai-settings-help">Publisher: {state.publisher}</p>{state.notes && <div className="desktop-update-notes">{state.notes}</div>}</>}
        {state?.state === 'current' && <p role="status" className="ai-settings-notice">You’re up to date.</p>}
        {state?.state === 'unpublished' && <p role="status" className="ai-settings-help">No signed desktop release has been published yet. This preview can still be used for testing.</p>}
        {state?.state === 'error' && <p role="alert" className="ai-settings-error">{state.message}</p>}
        <div className="ai-settings-actions"><button onClick={() => { void action(bridge.releaseNotes) }}>Release notes</button><button onClick={() => { void action(bridge.openLicenses) }}>Open-source licenses</button></div>
      </>}
      {error && <p role="alert" className="ai-settings-error">{error}</p>}
    </div>
    <footer className="ai-settings-footer"><button className="ai-settings-cancel" onClick={() => dialog.current?.close()}>Close</button><button className="ai-settings-cancel" disabled={checking} onClick={() => { void check() }}>Check again</button>{state?.state === 'available' && !checking && <button className="ai-settings-save" onClick={() => { void action(bridge.downloadUpdate) }}>Download installer</button>}</footer>
  </dialog>
}
