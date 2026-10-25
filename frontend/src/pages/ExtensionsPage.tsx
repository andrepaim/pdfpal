import { useEffect, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { extensionApi, type ExtensionPackage } from '../lib/extension-api'
import type { ExtensionConnection, PairingRequest } from '../../../src/shared/extension-pairing'
import './extensions.css'

function ConnectionCard({ connection, refresh, report }: { connection: ExtensionConnection; refresh: () => Promise<void>; report: (message: string) => void }) {
  const [label, setLabel] = useState(connection.label || ''), [busy, setBusy] = useState(false)
  useEffect(() => setLabel(connection.label || ''), [connection.label])
  async function perform(action: () => Promise<unknown>) {
    setBusy(true)
    try { await action(); await refresh() } catch (error) { report((error as Error).message) } finally { setBusy(false) }
  }
  return <article className="extension-connection">
    <form onSubmit={event => { event.preventDefault(); void perform(() => extensionApi.rename(connection.id, label)) }}>
      <label htmlFor={`label-${connection.id}`}>Connection name</label>
      <div className="extension-actions"><input id={`label-${connection.id}`} value={label} placeholder={`Browser connection ${connection.id.slice(0, 8)}`} maxLength={80} onChange={event => setLabel(event.target.value)} /><button disabled={busy}>Save name</button></div>
    </form>
    <p className="extension-muted">{connection.id.slice(0, 8)} · Paired {new Date(connection.created_at).toLocaleDateString()} · {connection.revoked_at ? 'Disconnected' : 'Active'}</p>
    {!connection.revoked_at && <button disabled={busy} onClick={() => void perform(() => extensionApi.revoke(connection.id))}>Disconnect</button>}
  </article>
}

function Approval() {
  const [params] = useSearchParams(), id = params.get('request') || ''
  const [state, setState] = useState<PairingRequest>(), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  useEffect(() => {
    let stopped = false, timer: ReturnType<typeof setTimeout>
    setState(undefined); setError('')
    async function poll() {
      try {
        const next = await extensionApi.pairing(id)
        if (!stopped) { setState(next); setError(''); if (['pending', 'approved'].includes(next.status)) timer = setTimeout(poll, 1500) }
      } catch (e) { if (!stopped) { setError((e as Error).message); timer = setTimeout(poll, 5000) } }
    }
    if (/^[0-9a-f-]{36}$/i.test(id)) void poll(); else setError('This connection link is invalid. Start Connect to pdfpal in the extension.')
    return () => { stopped = true; clearTimeout(timer) }
  }, [id])
  async function decide(allow: boolean) {
    setBusy(true); setError('')
    try { setState(await extensionApi.decide(id, allow)) } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  const messages = { pending: 'Allow this browser extension to connect?', approved: 'Approved. Return to the extension to finish connecting.', claimed: 'Connected. Return to your Kindle book and choose a project.', denied: 'Connection denied. No access was granted.', cancelled: 'Connection cancelled. Start again in the extension when you are ready.', expired: 'This request expired. Start Connect to pdfpal again in the extension.' }
  return <section className="extension-card" aria-labelledby="approval-title">
    <div className="extension-symbol" aria-hidden="true">↔</div><h1 id="approval-title">Connect Kindle to pdfpal</h1>
    <p className="extension-muted">{window.location.origin}</p>
    <p role="status">{state ? messages[state.status] : error ? '' : 'Loading connection request…'}</p>
    {error && <p role="alert" className="extension-error">{error}</p>}
    {state?.status === 'pending' && <>
      <p>The pdfpal Kindle Companion will be able to access your projects, send reviewed passages and questions to your configured AI agent, and save notes. Project selection chooses chat context; it does not restrict access to that project.</p>
      <p className="extension-muted">Extension: <code>{state.origin.replace('chrome-extension://', '')}</code><br />Expires at {new Date(state.expires_at).toLocaleTimeString()}.</p>
      <div className="extension-actions"><button className="extension-primary" disabled={busy} onClick={() => void decide(true)}>Allow connection</button><button disabled={busy} onClick={() => void decide(false)}>Deny</button></div>
    </>}
    {state && state.status !== 'pending' && <Link to="/extensions">Extension setup &amp; connections</Link>}
  </section>
}

function Setup() {
  const [pkg, setPackage] = useState<ExtensionPackage>(), [packageError, setPackageError] = useState(''), [connections, setConnections] = useState<ExtensionConnection[]>([]), [error, setError] = useState('')
  async function refresh() { setConnections(await extensionApi.connections()) }
  useEffect(() => {
    let stopped = false
    void extensionApi.package().then(value => { if (!stopped) setPackage(value) }).catch(e => { if (!stopped) setPackageError(e.message) })
    void extensionApi.connections().then(value => { if (!stopped) setConnections(value) }).catch(e => { if (!stopped) setError(e.message) })
    return () => { stopped = true }
  }, [])
  return <>
    <section className="extension-card">
      <div className="extension-symbol" aria-hidden="true">▤</div><h1>Read Kindle with pdfpal</h1>
      <p>Ask about your book, explore a selected passage, or type <code>/visual</code> for a visual explanation. Keep useful answers in your project notes.</p>
      {pkg ? <><a className="extension-primary extension-download" href="/api/extensions/download">Download Chrome extension</a><p className="extension-muted">Version {pkg.version} · {(pkg.size / 1024 / 1024).toFixed(1)} MB · Bundled with this pdfpal</p></> : <p role="status" className={packageError ? 'extension-error' : ''}>{packageError || 'Checking extension package…'}</p>}
      <ol className="extension-steps">
        <li><strong>Install once.</strong> Extract the ZIP to a folder you will keep. Open <code>chrome://extensions</code>, enable Developer mode, choose <strong>Load unpacked</strong>, and select the folder containing <code>manifest.json</code>.</li>
        <li><strong>Open your book.</strong> Pin pdfpal to the toolbar, open <a href="https://read.amazon.com/" target="_blank" rel="noreferrer">Kindle for Web</a>, and refresh the book tab. Click the pdfpal toolbar icon.</li>
        <li><strong>Connect and approve.</strong> Click <strong>Connect to pdfpal</strong> in the panel, then <strong>Allow connection</strong> in the local tab. Return to Kindle and choose or create a project.</li>
      </ol>
      <p className="extension-muted">Your server address is <code>{window.location.origin}</code>. If needed, enter it under Address &amp; manual pairing in the extension.</p>
      <details><summary>Updates and troubleshooting</summary><p>For updates, replace the files in the existing extension folder, click Reload in Chrome, then refresh Kindle. Keep the same extension entry: removing it clears its stored connection.</p><p>Keep pdfpal running while chatting. If it stops, start <code>pdfpal serve</code> and Retry. An older server can still pair using <code>pdfpal extension pair</code>. Use the same data directory as your running server.</p><p>Supported readers: read.amazon.com, ler.amazon.com.br, and read.amazon.co.uk. English OCR runs locally; check recognized passages before asking. Book questions use metadata and captured excerpts, not the full book. AI requests use your configured provider.</p></details>
    </section>
    <section className="extension-card" aria-labelledby="connections-title"><h2 id="connections-title">Paired connections</h2>
      <p className="extension-muted">Name each connection so you can recognize it. Disconnecting revokes access and keeps saved notes. A new pairing has its own conversation history.</p>
      {error && <p className="extension-error" role="alert">{error}</p>}
      <button onClick={() => void refresh().catch(e => setError(e.message))}>Refresh connections</button>
      {!connections.length && <p>No browsers connected yet.</p>}
      {connections.map(connection => <ConnectionCard key={connection.id} connection={connection} refresh={refresh} report={setError} />)}
    </section>
  </>
}

export default function ExtensionsPage() {
  const location = useLocation()
  return <main className="extensions-page"><nav><Link to="/">← All projects</Link><span>pdfpal · Kindle Companion</span></nav>{location.pathname.endsWith('/connect') ? <Approval /> : <Setup />}</main>
}
