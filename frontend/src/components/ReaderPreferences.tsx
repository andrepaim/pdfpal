import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type Ref } from 'react'
import { contextualApi, type ContextualStatus } from '../lib/api'
import './reader-preferences.css'

const TITLE = 'Reading preferences'
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
const sizeFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 })
const megabytes = (bytes: number) => `${sizeFormat.format(bytes / 1_000_000)} MB`

interface SwitchProps {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  busy?: boolean
  description?: string
  title?: string
  inputRef?: Ref<HTMLInputElement>
}

function PreferenceSwitch({ label, checked, onChange, disabled, busy, description, title, inputRef }: SwitchProps) {
  return (
    <label className="reading-preferences-switch" title={title}>
      {label}
      <span className="reading-preferences-track">
        <input
          ref={inputRef}
          type="checkbox"
          role="switch"
          checked={checked}
          disabled={disabled}
          aria-disabled={busy || undefined}
          aria-describedby={description}
          onChange={event => { if (!busy) onChange(event.target.checked) }}
        />
        <span aria-hidden="true" />
      </span>
    </label>
  )
}

interface Props {
  definitions: boolean
  onDefinitionsChange: (enabled: boolean) => void
  darkPages: boolean
  onDarkPagesChange: (enabled: boolean) => void
}

export default function ReaderPreferences({ definitions, onDefinitionsChange, darkPages, onDarkPagesChange }: Props) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<ContextualStatus | null>()
  const [confirmation, setConfirmation] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const groupRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const definitionsRef = useRef<HTMLInputElement>(null)
  const contextRef = useRef<HTMLInputElement>(null)
  const actionRef = useRef<HTMLButtonElement>(null)
  const lastFocusedAction = useRef<EventTarget | null>(null)

  const close = useCallback((returnFocus: boolean) => {
    if (returnFocus) triggerRef.current?.focus({ preventScroll: true })
    setOpen(false)
    setConfirmation(false)
    lastFocusedAction.current = null
  }, [])

  useLayoutEffect(() => {
    if (!open) return
    const group = groupRef.current!
    const trigger = triggerRef.current!
    const panel = panelRef.current!
    const position = () => {
      const { top, right, bottom } = trigger.getBoundingClientRect()
      const viewHeight = window.innerHeight
      const width = panel.getBoundingClientRect().width
      const roomBelow = viewHeight - bottom
      const above = roomBelow < 160 && top > roomBelow
      panel.style.left = `${Math.max(8, right - width)}px`
      panel.style.top = above ? 'auto' : `${bottom + 6}px`
      panel.style.bottom = above ? `${viewHeight - top + 6}px` : 'auto'
      panel.style.maxHeight = `${Math.max(0, (above ? top : roomBelow) - 14)}px`
    }
    position()
    definitionsRef.current?.focus({ preventScroll: true })
    const observer = new ResizeObserver(position)
    observer.observe(group.parentElement!)
    const dismissOutside = (event: Event) => {
      if (event.target instanceof Node && !group.contains(event.target)) close(false)
    }
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      close(true)
    }
    window.addEventListener('resize', position)
    document.addEventListener('pointerdown', dismissOutside, true)
    document.addEventListener('focusin', dismissOutside)
    document.addEventListener('keydown', dismissOnEscape, true)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', position)
      document.removeEventListener('pointerdown', dismissOutside, true)
      document.removeEventListener('focusin', dismissOutside)
      document.removeEventListener('keydown', dismissOnEscape, true)
    }
  }, [open, close])

  const downloading = status?.state === 'downloading' || status?.state === 'installing'
  const tracking = downloading || status?.state === 'loading'
  // Refresh on open and keep following a download or a starting model until it settles.
  useEffect(() => {
    if ((!open && !tracking) || busy) return
    let active = true
    let timer: number | undefined
    const refresh = async () => {
      try {
        const next = await contextualApi.status()
        if (active) setStatus(next)
      } catch {
        if (active) setStatus(previous => previous ?? null)
      }
      if (active && tracking) timer = window.setTimeout(refresh, 500)
    }
    if (tracking) timer = window.setTimeout(refresh, 500)
    else void refresh()
    return () => { active = false; window.clearTimeout(timer) }
  }, [busy, open, tracking])

  const required = status?.download.required_bytes ?? null
  const enabled = status?.enabled ?? false
  const contextDisabled = !definitions || !status || status.locked || downloading || (required === null && !enabled)
  const failure = status?.error && status.error !== 'DOWNLOAD_CANCELLED'
    ? MESSAGES[status.error] ?? `Something went wrong (${status.error}).`
    : ''
  const error = problem || failure
  const canRecover = definitions && status && !status.locked && !downloading
  const showDownload = canRecover && required !== null && required > 0 && (confirmation || !!error || enabled)
  const showRetry = canRecover && required === 0 && !!error
  const contextDescription = open && (downloading || (definitions && (!status || status.locked || required === null
    || status.state === 'loading' || showDownload || showRetry || error))) ? `${id}-context` : undefined

  const focusContext = () => (contextDisabled ? definitionsRef.current : contextRef.current)?.focus({ preventScroll: true })

  useLayoutEffect(() => {
    if (open && confirmation) actionRef.current?.focus({ preventScroll: true })
  }, [confirmation, open])
  // A progress, confirmation, or retry action can be replaced as the server state changes.
  useLayoutEffect(() => {
    const previous = lastFocusedAction.current
    if (!open || !(previous instanceof HTMLElement) || previous.isConnected || document.activeElement !== document.body) return
    if (actionRef.current) actionRef.current.focus({ preventScroll: true })
    else (contextDisabled ? definitionsRef.current : contextRef.current)?.focus({ preventScroll: true })
  })

  const act = async (work: () => Promise<ContextualStatus>) => {
    if (busy) return
    setBusy(true)
    setProblem('')
    try {
      setStatus(await work())
    } catch (error) {
      const { code, message } = error as Error & { code?: string }
      setProblem(MESSAGES[code ?? ''] ?? message)
    } finally {
      setConfirmation(false)
      setBusy(false)
    }
  }

  const changeContext = (checked: boolean) => {
    if (checked && required !== null && required > 0) {
      setConfirmation(true)
      return
    }
    void act(() => contextualApi.setEnabled(checked))
  }

  const progress = status?.download
  const percent = progress?.total_bytes
    ? Math.min(100, Math.floor(100 * progress.received_bytes / progress.total_bytes))
    : 0

  return (
    <div
      ref={groupRef}
      className="reading-preferences"
      data-reading-preferences
      onMouseDown={event => {
        // Keep the reader's selection while operating the toolbar.
        const selection = window.getSelection()
        if (selection && !selection.isCollapsed && selection.anchorNode?.parentElement?.closest('.textLayer')) {
          if ((event.target as Element).closest('button, label')) event.preventDefault()
        }
      }}
    >
      <button
        ref={triggerRef}
        className="reading-preferences-trigger"
        type="button"
        aria-label={TITLE}
        title={TITLE}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => { if (open) close(true); else setOpen(true) }}
      >
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
          <path d="M4 6h5m4 0h7M4 12h10m4 0h2M4 18h2m4 0h10M11 3.5v5M16 9.5v5M8 15.5v5" />
        </svg>
      </button>
      {open && (
        <div ref={panelRef} className="reading-preferences-panel" id={id} role="dialog" aria-labelledby={`${id}-title`}>
          <h2 id={`${id}-title`}>{TITLE}</h2>
          <PreferenceSwitch
            label="Show definitions on selection"
            checked={definitions}
            onChange={checked => { setConfirmation(false); onDefinitionsChange(checked) }}
            inputRef={definitionsRef}
          />
          <div className="reading-preferences-context">
            <PreferenceSwitch
              label="Show the best-fitting meaning first"
              checked={enabled}
              disabled={contextDisabled}
              busy={busy}
              description={contextDescription}
              onChange={changeContext}
              inputRef={contextRef}
            />
            {contextDescription && (
              <div className="reading-preferences-detail" onFocus={event => { lastFocusedAction.current = event.target }}>
                <div id={contextDescription}>
                  {status === undefined && <p>Checking model availability…</p>}
                  {status === null && <p>Contextual ordering is unavailable.</p>}
                  {status?.locked && <p>This setting is fixed by your startup configuration (PDFPAL_CONTEXTUAL_DEFINITIONS).</p>}
                  {status && required === null && !downloading && <p>The model is unavailable on this computer.</p>}
                  {status?.state === 'loading' && <p role="status">Starting the model… Definitions keep their dictionary order until it is ready.</p>}
                  {downloading && <p>{status.state === 'downloading'
                    ? `Downloading ${megabytes(status.download.received_bytes)} of ${megabytes(status.download.total_bytes)}…`
                    : 'Checking and installing the files…'}</p>}
                  {error && <p className="reading-preferences-error" role="alert">{error}</p>}
                  {showDownload && <p>One-time download of about <strong>{megabytes(required)}</strong> from pdfpal&apos;s GitHub release. The English model runs locally and is shared by all your pdfpal libraries.</p>}
                </div>
                {downloading && (
                  <div className="reading-preferences-progress" role="progressbar" aria-label="Download progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
                    <div style={{ width: `${percent}%` }} />
                  </div>
                )}
                {(downloading || showDownload || showRetry) && (
                  <div className="reading-preferences-actions">
                    {downloading
                      ? <button key="cancel" type="button" ref={actionRef} aria-disabled={busy || undefined} onClick={() => void act(contextualApi.cancel)}>Cancel</button>
                      : <button key="activate" type="button" className="reading-preferences-primary" ref={actionRef} aria-disabled={busy || undefined}
                          onClick={() => void act(() => showDownload ? contextualApi.download(required) : contextualApi.setEnabled(true))}>
                          {showDownload ? error ? 'Retry download' : 'Download and turn on' : 'Retry'}
                        </button>}
                    {confirmation && !downloading && (
                      <button type="button" aria-disabled={busy || undefined} onClick={() => { if (!busy) { setConfirmation(false); focusContext() } }}>Not now</button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
          <section className="reading-preferences-appearance" aria-labelledby={`${id}-appearance`}>
            <h3 id={`${id}-appearance`}>Appearance</h3>
            <PreferenceSwitch
              label="Dark pages"
              checked={darkPages}
              title="Use dark page colors. Figure and photo colors will also change."
              onChange={onDarkPagesChange}
            />
          </section>
        </div>
      )}
    </div>
  )
}
