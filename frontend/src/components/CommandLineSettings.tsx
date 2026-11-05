import { useCallback, useRef, useState } from 'react'
import type { DesktopCliSetup } from '../desktop'
import { useSettingsPanel } from '../lib/settings-panels'
import './cloud-settings.css'
import './command-line-settings.css'

export default function CommandLineSettings() {
  const dialog = useRef<HTMLDialogElement>(null)
  const [state, setState] = useState<DesktopCliSetup>(), [busy, setBusy] = useState(false)
  const [error, setError] = useState(''), [notice, setNotice] = useState('')
  const action = useCallback(async (value: 'status'|'install'|'check') => {
    setBusy(true); setError(''); setNotice('')
    try {
      const next = await window.pdfpalDesktop?.cliSetup?.(value)
      if (!next) throw new Error('Use the Windows desktop app to set up local commands.')
      setState(next)
      if (value === 'install') setNotice('Skill installed. Start a new ChatGPT conversation and select pdfpal-cli from Skills.')
      if (value === 'check') setNotice(next.check?.ok ? next.check.pathConflict ? 'The CLI can reach this library, but another pdfpal command comes first on PATH. Use the bundled command path shown here.' : next.check.pathReady === false ? 'The CLI can reach this library. Open a new terminal or restart ChatGPT to refresh PATH, then try the example.' : 'The CLI can reach this library. Try the example in ChatGPT to finish verification.' : next.check?.error?.message ?? 'Setup needs attention.')
    } catch (caught) { setError((caught as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, '')) }
    finally { setBusy(false) }
  }, [])
  const show = useCallback(() => { dialog.current?.showModal(); void action('status') }, [action])
  useSettingsPanel('cli', show)
  if (!window.pdfpalDesktop?.cliSetup) return null
  return <dialog ref={dialog} className="ai-settings cloud-settings cli-settings" aria-labelledby="cli-settings-title">
    <header className="ai-settings-header cloud-header"><span className="cli-header-icon" aria-hidden="true">&gt;_</span><div><span className="ai-settings-eyebrow">LOCAL TOOLS</span><h2 id="cli-settings-title">Command line &amp; ChatGPT</h2><p>Manage your reading library from a conversation.</p></div><button type="button" className="ai-settings-close" aria-label="Close command line settings" onClick={() => dialog.current?.close()}>×</button></header>
    <div className="ai-settings-content cloud-content">
      <section className="cloud-section"><div className="cloud-section-heading"><h3>Windows command</h3><span className={`cloud-status ${state?.available?'cloud-status--connected':''}`}>{state?.available?'Available':busy?'Checking…':'Needs setup'}</span></div><p className="cloud-description">The command uses your active pdfpal library. Keep pdfpal running in the tray while ChatGPT works.</p>{state&&<><dl className="cli-details"><div><dt>Version</dt><dd>{state.version}</dd></div><div><dt>Library</dt><dd>{state.library}</dd></div></dl><code className="cli-path">{state.launcher}</code></>}</section>
      <section className="cloud-section"><div className="cloud-section-heading"><h3>pdfpal skill</h3><span className={`cloud-status ${state?.skill.installed?'cloud-status--connected':''}`}>{state?.skill.installed?state.skill.edited?'Customized':'Installed':'Not installed'}</span></div><p className="cloud-description">Install the instructions ChatGPT uses to find projects, add papers, write notes, and undo removals. Your ChatGPT session needs local tool access.</p>{!!state?.skill.legacy.length&&<p className="cloud-field-help">A skill also exists in a legacy location. Keep one discoverable copy to avoid conflicting instructions.</p>}<div className="cli-actions"><button type="button" className="cloud-primary" disabled={busy||!state?.available||state?.skill.edited} onClick={()=>void action('install')}>{state?.skill.installed?'Update skill':'Install skill'}</button><button type="button" className="cloud-secondary" disabled={busy||!state} onClick={()=>void navigator.clipboard.writeText(state!.setupCommand).then(()=>setNotice('Setup command copied.')).catch(()=>setError('The command could not be copied.'))}>Copy setup command</button><button type="button" className="cloud-secondary" disabled={busy||!state?.available} onClick={()=>void action('check')}>Check setup</button></div></section>
      <section className="cloud-section"><h3>Try it in ChatGPT</h3><p className="cloud-description">Open a new local conversation, select <strong>pdfpal-cli</strong> from Skills, and ask:</p><blockquote className="cli-example">Show my pdfpal projects and list the papers in one of them.</blockquote><p className="cloud-field-help">A new terminal or app restart may be needed after installation. Setup checks verify the CLI connection; the first successful ChatGPT request verifies the complete workflow.</p></section>
      {notice&&<p className="cloud-callout" role="status">{notice}</p>}{error&&<p className="cloud-callout" role="alert">{error}</p>}
    </div>
  </dialog>
}
