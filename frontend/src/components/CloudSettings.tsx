import {useSettingsPanel} from '../lib/settings-panels'
import { useCallback, useEffect, useRef, useState } from 'react'
import { beginOperation } from '../lib/telemetry'
import './cloud-settings.css'
import PdfSyncSettings from './PdfSyncSettings'

interface Status {
  configured: boolean
  pdfStorage: boolean
  pdfFiles?: {enabled:boolean}
  conversations: boolean
  account: { uid: string; email: string } | null
  libraryId?: string
  owner?: string
  enabled: boolean
  running: boolean
  pending: number
  conflicts: number
  error: string
  lastSync: string | null
}
interface Conflict { id: string; operation: string; remote: string }
interface SavedVersion { title?: string; content?: string; text?: string }

async function request<T>(route: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/cloud/${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await response.json()
  if (!response.ok) throw Error(data.detail || 'This action could not finish. Please try again.')
  return data as T
}
const CloudIcon = () => <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 18h11a4 4 0 0 0 .5-7.97A6.5 6.5 0 0 0 6 9a4.5 4.5 0 0 0 1 9Z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
function version(conflict: Conflict) {
  try {
    const local = JSON.parse(conflict.operation), remote = JSON.parse(conflict.remote)
    return { type: String(local.entityType), local: local.payload as SavedVersion | null, remote: remote?.payload as SavedVersion | null }
  } catch { return null }
}
function NoteVersion({ label, value }: { label: string; value: SavedVersion | null }) {
  return <div className="cloud-version"><span>{label}</span><strong>{value?.title || 'Untitled note'}</strong><pre>{value?.content || value?.text || (value ? 'Empty note' : 'Deleted')}</pre></div>
}
export default function CloudSettings() {
  const dialog = useRef<HTMLDialogElement>(null)
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<Status | null>(null)
  const [statusError, setStatusError] = useState('')
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [libraries, setLibraries] = useState<Array<{ id: string; title: string }>>([])
  const [selected, setSelected] = useState('')
  const [canonicalId, setCanonicalId] = useState<string | null>(null)
  const [librariesLoaded, setLibrariesLoaded] = useState(false)
  const [title, setTitle] = useState('My pdfpal library')
  const [conflicts, setConflicts] = useState<Conflict[]>([])
  const sequence = useRef(0)
  const refresh = useCallback(async () => {
    const current = ++sequence.current
    try {
      const next = await request<Status>('status')
      if (current === sequence.current) { setStatus(next); setStatusError('') }
    } catch { if (current === sequence.current) setStatusError('Could not check cloud status. Check that the local app is running, then try again.') }
  }, [])
  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    if (!open) return
    void refresh()
    const timer = setInterval(() => void refresh(), 3000)
    return () => { clearInterval(timer); sequence.current++ }
  }, [open, refresh])
  useEffect(() => {
    setLibrariesLoaded(false); setCanonicalId(null); setLibraries([]); setSelected('')
    if (!open || !status?.account) return
    let active = true
    void Promise.all([request<Array<{ id: string; title: string }>>('libraries'), request<{ libraryId: string | null }>('canonical')]).then(([items, canonical]) => {
      if (!active) return
      setLibraries(items); setCanonicalId(canonical.libraryId)
      setSelected(canonical.libraryId || (items.length === 1 ? items[0]!.id : ''))
      setLibrariesLoaded(true)
    }).catch(() => { if (active) setActionError('Could not load your account library. Close and reopen this window to try again.') })
    return () => { active = false }
  }, [open, status?.account?.uid, status?.libraryId])
  useEffect(() => {
    if (!open || !status?.conflicts) { setConflicts([]); return }
    let active = true
    void request<Conflict[]>('conflicts').then(items => { if (active) setConflicts(items) }).catch(() => { if (active) setActionError('Could not load the saved versions. Please try again.') })
    return () => { active = false }
  }, [open, status?.conflicts])
  useSettingsPanel('cloud',show)
  function show() { setOpen(true); setActionError(''); setNotice(''); dialog.current?.showModal() }
  function close() { setOpen(false); dialog.current?.close() }
  async function action(route: string, body: unknown = {}) {
    setBusy(true); setActionError(''); setNotice('')
    const finish = route === 'sync' ? beginOperation('sync_batch') : undefined
    try {
      if (route === 'restore-account') await window.pdfpalFlushPending?.()
      const result = await request<{ url?: string; error?:string; libraryId?: string; id?: string; missingFiles?: number }>(route, body)
      if (route === 'restore-account') {
        if (!result.id) throw Error('The recovery copy could not be opened. Please check Backups before trying again.')
        setNotice(`Your account library is ready as a separate recovery copy. Your original library is preserved. ${result.missingFiles ? `${result.missingFiles} PDF ${result.missingFiles === 1 ? 'file is' : 'files are'} not downloaded. ` : ''}PDF transfers stay off until you enable them in the restored library. Open Backups to find the recovery copy.`)
        if (window.pdfpalDesktop?.openRecoveredLibrary) await window.pdfpalDesktop.openRecoveredLibrary(result.id)
      }
      if (route === 'canonical' && result.libraryId) { setCanonicalId(result.libraryId); setSelected(result.libraryId); setNotice('Your account library is selected. Other cloud libraries and their data have been preserved.') }
      if (result.url) { window.open(result.url, '_blank', 'noopener,noreferrer'); setNotice('Finish Google sign-in in your browser, then return here.') }
      await refresh(); finish?.(result.error?'failed':'completed')
    } catch (error) { finish?.('failed'); setActionError((error as Error).message) }
    finally { setBusy(false) }
  }
  const account = status?.account
  const bound = !!status?.libraryId
  const wrongAccount = !!account && !!status?.owner && account.uid !== status.owner
  const needsCanonicalChoice = librariesLoaded && !canonicalId && libraries.length > 1
  const differentLibrary = !!canonicalId && bound && status?.libraryId !== canonicalId
  const unavailableLibrary = !!account && (!librariesLoaded || needsCanonicalChoice || differentLibrary)
  const blocked = busy || !!status?.running
  const issue = actionError || statusError || status?.error
  const needsAttention = !!issue || !!status?.conflicts || wrongAccount || differentLibrary || needsCanonicalChoice
  const stateLabel = !status ? 'Checking connection' : !account ? 'Not signed in' : wrongAccount ? 'Different account' : !bound ? 'Account connected' : needsAttention ? 'Needs attention' : status.running ? 'Syncing changes' : !status.enabled ? 'Sync paused' : status.pending ? 'Changes waiting to sync' : status.lastSync ? 'Up to date' : 'Ready to sync'
  const stateTone = needsAttention ? 'warning' : bound && status?.enabled ? 'connected' : 'neutral'
  const primaryLabel = busy ? 'Working…' : !status ? 'Check again' : !account ? 'Sign in with Google' : needsCanonicalChoice ? 'Choose account library' : differentLibrary ? 'Account library differs' : !bound ? selected ? 'Connect account library' : 'Enable sync' : !status.enabled ? 'Resume sync' : issue ? 'Retry sync' : 'Sync now'
  const primary = () => {
    if (!status) { void refresh(); return }
    if (!account) { void action('login'); return }
    if (unavailableLibrary) return
    if (!bound) { void action('connect', { title: title.trim() || 'My pdfpal library', ...(selected ? { libraryId: selected } : {}) }); return }
    if (!status.enabled) { void action('pause', { paused: false }); return }
    void action('sync')
  }
  return <>
    <button type="button" className="cloud-launcher" onClick={show} aria-haspopup="dialog" aria-label="Cloud library" title={needsAttention ? "Cloud library needs attention" : "Cloud library"}>
      <CloudIcon /><span>Cloud library</span>{needsAttention && <span className="cloud-launcher-dot" aria-hidden="true" />}
    </button>
    <dialog ref={dialog} className="ai-settings cloud-settings" aria-labelledby="cloud-settings-title" aria-describedby="cloud-settings-description" onCancel={event => { event.preventDefault(); close() }} onClose={() => setOpen(false)}>
      <header className="ai-settings-header cloud-header">
        <span className="cloud-header-icon"><CloudIcon /></span>
        <div><span className="ai-settings-eyebrow">ACCOUNT & SYNC</span><h2 id="cloud-settings-title">Your cloud library</h2><p id="cloud-settings-description">Keep your reading organized across devices.</p></div>
        <button type="button" className="ai-settings-close" aria-label="Close cloud settings" onClick={close}>×</button>
      </header>
      <div className="ai-settings-content cloud-content">
        {status && !status.configured && <div className="cloud-callout"><strong>Cloud sign-in is not configured</strong><p>You can keep reading locally. This installation needs cloud setup before connecting a Google account.</p></div>}
        <section className="cloud-section" aria-labelledby="cloud-account-title">
          <div className="cloud-section-heading"><h3 id="cloud-account-title">Google account</h3><span className={`cloud-status ${account ? 'cloud-status--connected' : ''}`}><i />{account ? 'Signed in' : 'Not connected'}</span></div>
          {account ? <div className="cloud-account"><span className="cloud-avatar" aria-hidden="true">{(account.email || 'G')[0]!.toUpperCase()}</span><div><strong>{account.email || 'Google account connected'}</strong><p>Library account · separate from your AI account</p></div><button type="button" className="cloud-text-button" disabled={blocked} onClick={() => void action('logout')}>Sign out</button></div> : <p className="cloud-description">Sign in with Google to connect a private cloud library. Signing in alone does not upload your papers.</p>}
        </section>
        {account && (!bound || needsCanonicalChoice) && <section className="cloud-section" aria-labelledby="cloud-choose-title">
          <h3 id="cloud-choose-title">Your account library</h3>
          <p className="cloud-description">Each Google account uses one cloud library across all devices.</p>
          {!librariesLoaded ? <p className="cloud-field-help">Checking your account library…</p> : needsCanonicalChoice ? <>
            <p className="cloud-description">Older versions created multiple cloud libraries for this account. Choose the main library to use on every device. All other libraries and their data will be preserved.</p>
            <label className="cloud-field">Main cloud library<select value={selected} onChange={event => setSelected(event.target.value)} disabled={blocked || wrongAccount}><option value="" disabled>Choose your main library</option>{libraries.map(item => <option key={item.id} value={item.id}>{item.title} · {item.id}</option>)}</select></label>
            <p className="cloud-field-help">This choice applies to your Google account and cannot be changed here. Check the cloud library ID on the device with your complete library.</p>
            <button type="button" className="cloud-secondary" disabled={blocked || wrongAccount || !selected} onClick={() => void action('canonical', { libraryId: selected })}>Use as account library</button>
          </> : selected ? <>
            <p className="cloud-description">{libraries.find(item => item.id === selected)?.title || 'Your cloud library'}</p>
            <p className="cloud-field-help">Cloud library ID: {selected}</p>
            <p className="cloud-field-help">Connect this account library to an empty local library to restore it. Existing local data is preserved and will not be merged automatically.</p>
          </> : <label className="cloud-field">Library name<input value={title} maxLength={200} onChange={event => setTitle(event.target.value)} disabled={blocked} /></label>}
        </section>}
        {differentLibrary && <div className="cloud-callout cloud-callout--error" role="alert"><strong>This device uses a different cloud library</strong><p>Your account library is {canonicalId}. Your current local and cloud data have been preserved. Open an empty local library and connect this Google account to restore the account library.</p><p>Or restore it as a separate local library. pdfpal first backs up this library, then downloads the account library into a recovery copy. Your current library stays available in Backups. PDF transfers stay off in the restored library. Turn them on there to download PDF files available in the cloud.</p><button type="button" className="cloud-secondary" disabled={blocked || wrongAccount} onClick={() => void action('restore-account')}>Restore account library separately</button></div>}
        {bound && <section className="cloud-section" aria-labelledby="cloud-sync-title"><div className="cloud-section-heading"><h3 id="cloud-sync-title">Synchronization</h3><span className={`cloud-status cloud-status--${stateTone}`} role="status"><i />{stateLabel}</span></div><div className="cloud-metrics"><div><strong>{status?.pending ?? 0}</strong><span>Pending changes</span></div><div><strong>{status?.conflicts ?? 0}</strong><span>Conflicts to review</span></div></div><p className="cloud-field-help">Cloud library ID: {status?.libraryId}</p><div className="cloud-sync-details"><span>{status?.lastSync ? `Last synced ${new Date(status.lastSync).toLocaleString()}` : 'No successful sync yet'}</span>{status?.enabled && <button type="button" className="cloud-text-button" disabled={blocked || wrongAccount} onClick={() => void action('pause', { paused: true })}>Pause sync</button>}</div>{!status?.enabled && <p className="cloud-description">Your changes stay saved on this device and wait until you resume.</p>}</section>}
        {wrongAccount && <div className="cloud-callout cloud-callout--error" role="alert"><strong>This library belongs to another account</strong><p>Sign out and connect the original Google account. Your local library stays on this device.</p></div>}
        {issue && <div className="cloud-callout cloud-callout--error" role="alert"><strong>Cloud sync needs attention</strong><p>Your changes are saved on this device. {bound ? 'Retry sync to send the pending changes.' : 'Please try again.'}</p><details><summary>Show details</summary><p>{issue}</p></details>{statusError && <button type="button" className="cloud-text-button" onClick={() => void refresh()}>Check connection</button>}</div>}
        {notice && <p className="cloud-notice" role="status">{notice}</p>}
        {conflicts.map(conflict => {
          const saved = version(conflict)
          return <section className="cloud-conflict" key={conflict.id}><h3>{saved?.type === 'notes' ? 'Choose a note version' : 'A saved change needs review'}</h3><p>Both versions have been preserved. Choose the one you want to keep.</p>{saved?.type === 'notes' && saved.remote ? <><div className="cloud-versions"><NoteVersion label="On this device" value={saved.local} /><NoteVersion label="In the cloud" value={saved.remote} /></div><div className="cloud-conflict-actions"><button type="button" className="cloud-secondary" disabled={blocked} onClick={() => void action(`conflicts/${conflict.id}/resolve`, { choice: 'local' })}>Keep device version</button><button type="button" className="cloud-secondary" disabled={blocked} onClick={() => void action(`conflicts/${conflict.id}/resolve`, { choice: 'remote' })}>Keep cloud version</button></div></> : <p>These saved versions need manual recovery before synchronization can continue.</p>}</section>
        })}
        <section className="cloud-scope" aria-labelledby="cloud-scope-title"><div className="cloud-section-heading"><h3 id="cloud-scope-title">What syncs</h3>{!status?.pdfFiles?.enabled && <span className="cloud-scope-tag">{status?.conversations ? 'PDF files stay local' : 'Metadata sync only'}</span>}</div><ul><li>Projects and collections</li><li>Notes and highlights</li><li>Paper details and reading progress</li>{status?.conversations && <li>Saved PDF and project conversations</li>}{status?.pdfFiles?.enabled && <li>PDF files</li>}</ul><p>{!status?.pdfFiles?.enabled && 'PDF file transfers are off. '}{status?.conversations ? 'Kindle extension history and interactive visuals stay local.' : 'Saved questions and answers stay local until you include conversations.'}</p>
        <PdfSyncSettings active={open} connected={bound && !wrongAccount && !unavailableLibrary} running={busy || !!status?.running} onChange={refresh} />
          {bound && !status?.conversations && <div className="cloud-callout"><strong>Bring your saved conversations</strong><p>This uploads existing and future PDF and project questions and answers to your private cloud library. Devices using this library will need pdfpal 2.4 or later. You can pause all synchronization at any time.</p><button type="button" className="cloud-secondary" disabled={blocked || !account || wrongAccount || unavailableLibrary || !status?.enabled} onClick={() => void action('conversations', { enabled: true })}>Include saved conversations</button></div>}
        </section>
      </div>
      <footer className="ai-settings-footer cloud-footer"><button type="button" className="cloud-secondary" onClick={close}>Done</button><button type="button" className="cloud-primary" disabled={blocked || wrongAccount || unavailableLibrary || (!!status && !status.configured) || (!!account && !bound && !selected && !title.trim())} onClick={primary}>{status?.running ? 'Syncing…' : primaryLabel}</button></footer>
    </dialog>
  </>
}
