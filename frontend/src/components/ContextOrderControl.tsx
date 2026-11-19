import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { contextualApi, type ContextualStatus } from '../lib/api'

// "Order meanings by context" in the reader toolbar. Turning it on may need a
// one-time download, which starts only after the reader has seen its size and
// confirmed. The setting applies to new lookups at once.

const MESSAGES: Record<string, string> = {
  DOWNLOAD_FAILED: 'The download failed. Check your connection and try again.',
  DOWNLOAD_STALLED: 'The download stopped responding. Try again.',
  ASSET_CORRUPT: 'The downloaded file did not match the published one, so it was discarded.',
  ASSET_MALFORMED: 'The downloaded file did not match the published one, so it was discarded.',
  ASSET_UNEXPECTED: 'The downloaded file did not match the published one, so it was discarded.',
  ASSET_MISMATCH: 'The downloaded file did not match the published one, so it was discarded.',
  DISK_FULL: 'There is not enough disk space for the download.',
  INSTALL_TARGET_BUSY: 'Another pdfpal window is using the model files. Close it and try again.',
  INSTALL_FAILED: 'The model could not be installed. Try again.',
  ACTIVATION_FAILED: 'The setting could not be saved or the model could not start. Try again.',
  MODEL_MISSING: 'The model files are incomplete.',
  MODEL_MISMATCH: 'The model files have changed since they were installed.',
  RUNTIME_MISSING: 'The model runtime is incomplete.',
  RUNTIME_MISMATCH: 'The model runtime has changed since it was installed.',
}
const TRANSIENT = new Set(['downloading', 'installing', 'loading'])
const megabytes = (bytes: number) => `${Math.max(1, Math.round(bytes / 1_000_000))} MB`

interface Props { buttonStyle: CSSProperties }

export default function ContextOrderControl({ buttonStyle }: Props) {
  const [status, setStatus] = useState<ContextualStatus | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const alive = useRef(true)

  const refresh = useCallback(() => contextualApi.status().then(next => { if (alive.current) setStatus(next) }).catch(() => { /* an older server has no such setting */ }), [])
  useEffect(() => { alive.current = true; void refresh(); return () => { alive.current = false } }, [refresh])
  // Follow a download or a starting model until it settles.
  useEffect(() => {
    if (!status || !TRANSIENT.has(status.state)) return
    const timer = setTimeout(() => void refresh(), 500)
    return () => clearTimeout(timer)
  }, [status, refresh])

  if (!status || (status.state === 'unavailable' && !status.enabled)) return null

  const act = async (work: () => Promise<ContextualStatus>) => {
    setBusy(true); setProblem('')
    try { const next = await work(); if (alive.current) setStatus(next) }
    catch (error) { if (alive.current) setProblem(MESSAGES[(error as { code?: string }).code ?? ''] ?? (error as Error).message) ; void refresh() }
    finally { if (alive.current) setBusy(false) }
  }
  const required = status.download.required_bytes
  const turnOn = () => act(() => required ? contextualApi.download(required) : contextualApi.setEnabled(true))
  const turnOff = () => act(() => contextualApi.setEnabled(false))
  const action = (label: string, onClick: () => void, primary = false) => (
    <button type="button" disabled={busy} onClick={onClick} style={{ ...buttonStyle, width: 'auto', padding: '4px 10px', fontSize: 12, ...(primary ? { background: 'var(--accent)' } : {}) }}>{label}</button>
  )
  const percent = status.download.total_bytes ? Math.floor(100 * status.download.received_bytes / status.download.total_bytes) : 0
  const failure = status.error && status.error !== 'DOWNLOAD_CANCELLED' ? MESSAGES[status.error] ?? `Something went wrong (${status.error}).` : ''

  let body: React.ReactNode
  if (status.locked) body = <p>{status.enabled ? 'On' : 'Off'}, fixed by your startup configuration (PDFPAL_CONTEXTUAL_DEFINITIONS).</p>
  else if (status.state === 'downloading' || status.state === 'installing') body = (
    <>
      <p>{status.state === 'downloading' ? `Downloading ${megabytes(status.download.received_bytes)} of ${megabytes(status.download.total_bytes)}…` : 'Checking and installing the files…'}</p>
      <div role="progressbar" aria-label="Download progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}
        style={{ height: 6, borderRadius: 3, background: 'var(--border)', overflow: 'hidden', margin: '6px 0 10px' }}>
        <div style={{ width: `${percent}%`, height: '100%', background: 'var(--accent)' }} />
      </div>
      {action('Cancel', () => act(contextualApi.cancel))}
    </>
  )
  else if (status.enabled && (status.state === 'ready' || status.state === 'loading')) body = (
    <>
      <p>{status.state === 'ready' ? 'On. Each entry lists the meaning that fits the passage first.' : 'Starting the model… Definitions keep their dictionary order until it is ready.'}</p>
      {action('Turn off', turnOff)}
    </>
  )
  else body = (
    <>
      <p>List each dictionary entry&apos;s meanings with the one that best fits the passage first, using a local English model. Your text stays on this computer.</p>
      {failure && <p role="alert" style={{ color: '#f87171' }}>{failure}</p>}
      {required === null
        ? <p>The model is not available for this computer.</p>
        : required > 0
          ? <p>This needs a one-time download of <strong>{megabytes(required)}</strong> from pdfpal&apos;s GitHub release, shared by all your pdfpal libraries.</p>
          : !status.enabled && <p>The model is already on this computer.</p>}
      <div style={{ display: 'flex', gap: 8 }}>
        {required !== null && action(failure ? (required > 0 ? 'Retry download' : 'Retry') : required > 0 ? 'Download and turn on' : 'Turn on', turnOn, true)}
        {status.enabled ? action('Turn off', turnOff) : action('Not now', () => setOpen(false))}
      </div>
    </>
  )

  return (
    <span style={{ position: 'relative' }}>
      <button
        type="button"
        aria-label="Order meanings by context"
        aria-pressed={status.enabled}
        aria-expanded={open}
        onClick={() => { setOpen(value => !value); setProblem(''); void refresh() }}
        title="Order dictionary meanings by the passage, with a local English model"
        style={{ ...buttonStyle, width: 'auto', padding: '4px 10px', fontSize: 12, background: status.enabled ? 'var(--accent)' : buttonStyle.background }}
      >
        Order by context
      </button>
      {open && (
        <div role="dialog" aria-label="Order meanings by context" style={{
          position: 'absolute', right: 0, top: 'calc(100% + 6px)', width: 300, zIndex: 9999, background: 'var(--panel)', color: 'var(--text)',
          border: '1px solid var(--border)', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.5)', padding: '10px 12px', fontSize: 12, lineHeight: 1.45,
        }}>
          <strong style={{ fontSize: 13 }}>Order meanings by context</strong>
          {body}
          {problem && <p role="alert" style={{ color: '#f87171' }}>{problem}</p>}
        </div>
      )}
    </span>
  )
}
