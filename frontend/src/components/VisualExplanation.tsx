import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { visualFrames, type VisualDefinition, type VisualFrame, type VisualRecord } from '../../../src/shared/visual'
import type { Hotspot } from '../../../src/shared/visual-kit'
import { downloadVisual, figureWords, visualBasisLabel } from '../lib/visual-html'
import { measureVisualText, visualFontDataUrl } from '../lib/visual-measure'
import { useVisualDrawing, VisualFigure, type FigureInput } from './VisualFigure'
import './visual.css'

export type VisualTransport = { get: (id: string) => Promise<VisualRecord>; save: (id: string) => Promise<{ id: string }>; retry?: (id: string, requestId: string) => Promise<VisualRecord>; noteUrl: (id: string) => string }

const sceneCount = (definition: VisualDefinition) => definition.version === 2 ? definition.scenes.length : definition.steps.length
function figureInput(definition: VisualDefinition, scene: number): FigureInput {
  return definition.version === 2 ? { version: 2, scene: definition.scenes[scene] } : { version: 1, step: definition.steps[scene] }
}
const referenceLabels = (ids: string[], record: VisualRecord) => ids.map(id => record.references.find(ref => ref.id === id)?.label || id)
const clamp = (index: number, frames: number) => Math.max(0, Math.min(frames - 1, index))

/** Arrow keys move between frames; ignored while typing or with a modifier held. */
function navigationKey(event: ReactKeyboardEvent): number | undefined {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
  if ((event.target as HTMLElement).closest?.('input, textarea, select, [contenteditable="true"]')) return
  return event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : undefined
}

function Transcript({ record, definition, frames }: { record: VisualRecord; definition: VisualDefinition; frames: VisualFrame[] }) {
  const scenes = Array.from({ length: sceneCount(definition) }, (_, scene) => frames.filter(frame => frame.scene === scene))
  return <details className="visual-transcript">
    <summary>Takeaways and full transcript</summary>
    <p className="visual-transcript-summary">{definition.summary}</p>
    {definition.takeaways.length > 0 && <><h4>Takeaways</h4><ul>{definition.takeaways.map((text, i) => <li key={i}>{text}</li>)}</ul></>}
    {scenes.map((beats, scene) => {
      const words = figureWords(definition, scene)
      return <section key={scene}>
        <h4>{scene + 1}. {beats[0]?.sceneTitle}</h4>
        {beats.map(frame => <div key={frame.beat} className="visual-transcript-beat">
          <p><span className="visual-transcript-basis">{visualBasisLabel(frame.basis)}.</span> {frame.caption}</p>
          <p>{frame.explanation}</p>
          {frame.referenceIds.length > 0 && <p className="visual-references">Sources: {referenceLabels(frame.referenceIds, record).join('; ')}</p>}
        </div>)}
        {words.length > 0 && <ul className="visual-transcript-words">{words.map((text, i) => <li key={i}>{text}</li>)}</ul>}
      </section>
    })}
  </details>
}

/** The height the expanded dialog leaves for its figure; mirrors the max-height rules in visual.css. */
function useExpandedFigureHeight(expanded: boolean): number | undefined {
  const read = () => typeof window === 'undefined' ? 400 : Math.max(window.innerWidth < 640 ? 160 : 200, window.innerHeight - (window.innerWidth < 640 ? 430 : 500))
  const [height, setHeight] = useState(read)
  useEffect(() => {
    if (!expanded) return
    const update = () => setHeight(read())
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [expanded])
  return expanded ? height : undefined
}

export function VisualStory({ record, expanded = false, stepIndex, onStepChange }: { record: VisualRecord; expanded?: boolean; stepIndex?: number; onStepChange?: (index: number) => void }) {
  const definition = record.definition!
  const frames = useMemo(() => visualFrames(definition), [definition])
  const [localIndex, setLocalIndex] = useState(0)
  const [selection, setSelection] = useState<{ frame: number; hotspot: Hotspot }>()
  const index = clamp(stepIndex ?? localIndex, frames.length)
  const frame = frames[index]
  const scenes = sceneCount(definition)
  const canvas = useRef<HTMLDivElement>(null), progress = useRef<HTMLDivElement>(null), focusSegment = useRef(false)
  const input = useMemo(() => figureInput(definition, frame.scene), [definition, frame.scene])
  const roomHeight = useExpandedFigureHeight(expanded)
  const drawing = useVisualDrawing(input, canvas, { minWidth: 280, maxWidth: expanded ? 900 : 640, maxHeight: roomHeight })
  const selected = selection?.frame === index ? selection.hotspot : undefined

  // A stored or retried record can have fewer frames than the index the parent holds.
  useEffect(() => { if (stepIndex !== undefined && stepIndex !== index) onStepChange?.(index) }, [stepIndex, index, onStepChange])
  useEffect(() => {
    if (!focusSegment.current) return
    focusSegment.current = false
    progress.current?.querySelector<HTMLButtonElement>(`[data-frame="${index}"]`)?.focus()
  }, [index])

  function move(next: number) {
    const target = clamp(next, frames.length)
    if (target !== index) (onStepChange || setLocalIndex)(target)
  }
  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const step = navigationKey(event)
    if (!step) return
    event.preventDefault()
    focusSegment.current = !!(event.target as HTMLElement).closest?.('.visual-progress')
    move(index + step)
  }
  const label = `Figure ${frame.scene + 1} of ${scenes}: ${frame.sceneTitle}`
  const references = referenceLabels(frame.referenceIds, record)

  return <div className={`visual-story${expanded ? ' visual-story-expanded' : ''}`} role="group" tabIndex={0} onKeyDown={onKeyDown} aria-keyshortcuts="ArrowLeft ArrowRight"
    aria-label={`${definition.title}. Use the left and right arrow keys to move between steps.`}>
    <header className="visual-head">
      <p className="visual-eyebrow">Explain visually</p>
      <h3>{definition.title}</h3>
      <p className="visual-summary" title={definition.summary}>{definition.summary}</p>
    </header>
    <div className="visual-stage">
      <div className="visual-stage-head"><span>{frame.scene + 1} / {scenes}</span><h4>{frame.sceneTitle}</h4></div>
      <div className="visual-canvas" ref={canvas}>
        {drawing ? <VisualFigure drawing={drawing} beat={frame.beat} label={label} selected={selected?.id}
          onSelect={hotspot => setSelection(current => current?.frame === index && current.hotspot.id === hotspot.id ? undefined : { frame: index, hotspot })} />
          : <div className="visual-canvas-placeholder" role="img" aria-label={label} />}
      </div>
    </div>
    <div className="visual-progress" ref={progress} role="group" aria-label="Steps">
      {Array.from({ length: scenes }, (_, scene) => {
        const members = frames.flatMap((item, i) => item.scene === scene ? [i] : [])
        return <div key={scene} className="visual-progress-scene" style={{ flexGrow: members.length }}>
          {members.map(i => <button key={i} type="button" data-frame={i} tabIndex={i === index ? 0 : -1}
            className={i === index ? 'is-now' : i < index ? 'is-done' : undefined} aria-current={i === index ? 'step' : undefined}
            aria-label={`Step ${i + 1} of ${frames.length}: figure ${scene + 1}, ${frames[i].sceneTitle}${frames[i].beats > 1 ? `, part ${frames[i].beat} of ${frames[i].beats}` : ''}`}
            onClick={() => move(i)} />)}
        </div>
      })}
    </div>
    <p className="visual-caption" aria-live="polite">{frame.caption}</p>
    <div className="visual-meta">
      <span className="visual-basis" data-basis={frame.basis}>{visualBasisLabel(frame.basis)}</span>
      {references.length > 0 && <span className="visual-references" title={references.join('; ')}>{references.join(' · ')}</span>}
    </div>
    {selected && <div className="visual-detail" aria-live="polite">
      <p><b>{selected.label}.</b> {selected.detail}</p>
      <button type="button" className="visual-detail-close" aria-label="Close detail" onClick={() => setSelection(undefined)}>×</button>
    </div>}
    {!selected && drawing && drawing.hotspots.length > 0 && <p className="visual-hint">Items marked with a dot have more to say. Select one.</p>}
    <details className="visual-more"><summary>Read more</summary><p>{frame.explanation}</p></details>
    <nav className="visual-navigation" aria-label="Step navigation">
      <button type="button" aria-label="Previous step" disabled={index === 0} onClick={() => move(index - 1)}>← Back</button>
      <span>Step {index + 1} of {frames.length}</span>
      <button type="button" className="is-primary" aria-label="Next step" disabled={index === frames.length - 1} onClick={() => move(index + 1)}>Next →</button>
    </nav>
    {!expanded && <Transcript record={record} definition={definition} frames={frames} />}
  </div>
}

function elapsedLabel(seconds: number) { return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` }

function InProgress({ since }: { since?: string }) {
  const [mounted] = useState(() => Date.now())
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [])
  // The server is local, so its clock is ours; ignore a stamp from the future rather than show a negative time.
  const started = Date.parse(since || '')
  const start = Number.isFinite(started) && started <= now + 2000 ? started : mounted
  const seconds = Math.max(0, Math.floor((now - start) / 1000))
  return <div className="visual-working" role="status">
    <span className="visual-working-mark" aria-hidden="true" />
    <div>
      <p className="visual-working-title">Creating your visual explanation… <span className="visual-elapsed" aria-live="off">{elapsedLabel(seconds)}</span></p>
      <p className="visual-working-note">{seconds < 180 ? 'This usually takes one to two minutes.' : 'Still working. A long or complex question can take up to five minutes.'}</p>
    </div>
  </div>
}

export default function VisualExplanation({ id, initial, transport, onFollowUp, onRetry }: {
  id: string; initial?: VisualRecord; transport: VisualTransport; onFollowUp?: (question: string) => void; onRetry?: () => void;
}) {
  const [record, setRecord] = useState<VisualRecord | undefined>(initial), [error, setError] = useState(''), [saving, setSaving] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [activeId, setActiveId] = useState(id)
  const [stepIndex, setStepIndex] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const [exporting, setExporting] = useState(false)
  const retryId = useRef<string | undefined>(undefined)
  const dialog = useRef<HTMLDialogElement>(null), transportRef = useRef(transport)
  transportRef.current = transport
  useEffect(() => {
    let active = true, timer: ReturnType<typeof setTimeout> | undefined
    setRecord(activeId === initial?.id ? initial : undefined); setError(''); setStepIndex(0)
    const poll = async () => {
      try {
        const next = await transportRef.current.get(activeId)
        if (!active) return
        setRecord(next); setError('')
        if (next.status === 'pending' || next.status === 'running') timer = setTimeout(poll, 1000)
      } catch (e) { if (active) setError(e instanceof Error ? e.message : 'Cannot load the explanation.') }
    }
    void poll()
    return () => { active = false; clearTimeout(timer) }
  }, [activeId, refresh])
  async function retry() {
    if (!transport.retry) return
    setError(''); setSaving(true)
    try {
      retryId.current ||= crypto.randomUUID()
      const next = await transport.retry(activeId, retryId.current)
      setRecord(next); setActiveId(next.id); retryId.current = undefined
    } catch (e) { setError(e instanceof Error ? e.message : 'Cannot retry the explanation.') }
    finally { setSaving(false) }
  }
  async function save() {
    setSaving(true); setError('')
    try { const note = await transportRef.current.save(activeId); setRecord(current => current ? { ...current, note_id: note.id } : current) }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save the explanation.') }
    finally { setSaving(false) }
  }
  async function exportHtml(value: VisualRecord) {
    setExporting(true)
    try { downloadVisual(value, { measure: measureVisualText, fontDataUrl: await visualFontDataUrl().catch(() => undefined) }) }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not export the explanation.') }
    finally { setExporting(false) }
  }
  function openExpanded() { setExpanded(true); dialog.current?.showModal() }
  function onDialogKeyDown(event: ReactKeyboardEvent<HTMLDialogElement>) {
    const step = navigationKey(event)
    if (!step || !record?.definition) return
    event.preventDefault()
    setStepIndex(index => clamp(index + step, visualFrames(record.definition!).length))
  }
  const working = !record || record.status === 'pending' || record.status === 'running'
  return <article className="visual-card" aria-label="Visual explanation" aria-busy={working || undefined}>
    {error && <p className="visual-error" role="alert">{error} <button type="button" onClick={() => setRefresh(n => n + 1)}>Reconnect</button></p>}
    {working ? <InProgress since={record?.created_at} />
      : record.status === 'failed' ? <div className="visual-failed" role="alert">
        <p className="visual-failed-title">The visual explanation could not be created.</p>
        <p className="visual-failed-reason">{record.error || 'The assistant did not return a usable explanation.'}</p>
        {(onRetry || transport.retry) && <button type="button" disabled={saving} onClick={onRetry || retry}>Retry visual explanation</button>}
      </div>
      : record.definition && <>
        <VisualStory record={record} stepIndex={stepIndex} onStepChange={setStepIndex} />
        <div className="visual-actions"><button type="button" onClick={openExpanded}>Expand</button>
          <button type="button" disabled={exporting} onClick={() => void exportHtml(record)}>Export HTML</button>
          {record.note_id ? <a href={transport.noteUrl(record.note_id)} target="_blank" rel="noreferrer">Open saved note</a>
            : <button type="button" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save to project'}</button>}
          {onFollowUp && <button type="button" onClick={() => onFollowUp(`Explain this part of “${record.definition!.title}” in more detail: `)}>Ask a follow-up</button>}
        </div>
        <dialog className="visual-dialog" ref={dialog} aria-label={record.definition.title} onClose={() => setExpanded(false)} onKeyDown={onDialogKeyDown}
          onClick={event => { if (event.target === event.currentTarget) dialog.current?.close() }}>
          <div className="visual-dialog-header"><span>pdfpal · Explain visually</span><button type="button" aria-label="Close visual explanation" onClick={() => dialog.current?.close()}>×</button></div>
          <div className="visual-dialog-body">{expanded && <VisualStory key={record.id} record={record} expanded stepIndex={stepIndex} onStepChange={setStepIndex} />}</div>
        </dialog>
      </>}
  </article>
}
