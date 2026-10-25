import { useEffect, useRef, useState } from 'react'
import type { VisualElement, VisualRecord } from '../../../src/shared/visual'
import { arrowHead, downloadVisual, visualColors, wrapLabel } from '../lib/visual-html'
import './visual.css'

export type VisualTransport = { get: (id: string) => Promise<VisualRecord>; save: (id: string) => Promise<{ id: string }>; retry?: (id: string, requestId: string) => Promise<VisualRecord>; noteUrl: (id: string) => string }

function Shape({ element: e, reveal }: { element: VisualElement; reveal: (text: string) => void }) {
  const color = visualColors[e.color]
  if (e.type === 'node') {
    const lines = wrapLabel(e.label, e.width)
    return <g role={e.detail ? 'button' : undefined} tabIndex={e.detail ? 0 : undefined} aria-label={e.label}
      className={e.detail ? 'visual-hotspot' : undefined} onClick={() => e.detail && reveal(e.detail)}
      onKeyDown={event => { if (e.detail && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); reveal(e.detail) } }}>
      {e.shape === 'ellipse'
        ? <ellipse cx={e.x + e.width / 2} cy={e.y + e.height / 2} rx={e.width / 2} ry={e.height / 2} fill={color} fillOpacity={.12} stroke={color} strokeWidth={1.5} />
        : <rect x={e.x} y={e.y} width={e.width} height={e.height} rx={12} fill={color} fillOpacity={.12} stroke={color} strokeWidth={1.5} />}
      <text fill="#f1f5f9" fontSize={18} textAnchor="middle" pointerEvents="none">{lines.map((line, i) =>
        <tspan key={i} x={e.x + e.width / 2} y={e.y + e.height / 2 + (i - (lines.length - 1) / 2) * 22 + 6}>{line}</tspan>)}</text>
    </g>
  }
  if (e.type === 'text') return <text x={e.x} y={e.y} fill={color} stroke="#10121c" strokeWidth={4} paintOrder="stroke" strokeLinejoin="round" fontSize={e.size} textAnchor="middle">{e.text}</text>
  if (e.type === 'path') return <path d={e.points.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ') + (e.closed ? ' Z' : '')} fill={e.closed ? color : 'none'} fillOpacity={.15} stroke={color} strokeWidth={2.5} />
  return <g stroke={color} fill={color}><line x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} strokeWidth={2} /><polygon points={arrowHead(e)} />
    {e.label && <text x={(e.x1 + e.x2) / 2} y={(e.y1 + e.y2) / 2 - 10} stroke="none" fontSize={16} textAnchor="middle">{e.label}</text>}</g>
}

export function VisualStory({ record, expanded = false, stepIndex, onStepChange }: { record: VisualRecord; expanded?: boolean; stepIndex?: number; onStepChange?: (index: number) => void }) {
  const [localIndex, setLocalIndex] = useState(0), [detail, setDetail] = useState('')
  const index = stepIndex ?? localIndex
  const v = record.definition!
  const step = v.steps[index] || v.steps[0]
  function move(next: number) { (onStepChange || setLocalIndex)(next); setDetail('') }
  return <div className={`visual-story${expanded ? ' visual-story-expanded' : ''}`}>
    <p className="visual-eyebrow">Visual explanation</p><h3>{v.title}</h3><p className="visual-summary">{v.summary}</p>
    <nav className="visual-navigation" aria-label="Explanation steps">
      <button type="button" aria-label="Previous step" disabled={index === 0} onClick={() => move(index - 1)}>←</button>
      <span aria-live="polite">{index + 1} / {v.steps.length}</span>
      <button type="button" aria-label="Next step" disabled={index === v.steps.length - 1} onClick={() => move(index + 1)}>→</button>
    </nav>
    <h4>{step.title}</h4><p className="visual-basis">{step.basis === 'source' ? 'Based on supplied text' : step.basis === 'illustration' ? 'Illustrative example' : 'Background knowledge'}</p>
    <figure><svg viewBox={`0 0 360 ${step.scene.height}`} role="group" aria-label={step.title}>
      {step.scene.elements.map(element => <Shape key={element.id} element={element} reveal={setDetail} />)}
    </svg><figcaption>{step.caption}</figcaption></figure>
    {step.scene.elements.some(e => e.type === 'node' && e.detail) && <p className="visual-hint">Select a shape to explore it.</p>}
    {detail && <p className="visual-detail" aria-live="polite">{detail}</p>}
    <details><summary>Read the explanation</summary><p>{step.explanation}</p></details>
    {step.referenceIds.length > 0 && <p className="visual-references">{step.referenceIds.map(id => record.references.find(ref => ref.id === id)?.label).filter(Boolean).join('; ')}</p>}
    <details className="visual-takeaways"><summary>Takeaways &amp; full transcript</summary><ul>{v.takeaways.map((text, i) => <li key={i}>{text}</li>)}</ul>
      {v.steps.map((s, i) => <section key={i}><strong>{i + 1}. {s.title}</strong><p>{s.caption}</p><p>{s.explanation}</p>
        <ul>{s.scene.elements.flatMap(e => e.type === 'node' ? [<li key={e.id}>{e.label}{e.detail ? `: ${e.detail}` : ''}</li>] : [])}</ul></section>)}
    </details>
  </div>
}

export default function VisualExplanation({ id, initial, transport, onFollowUp, onRetry }: {
  id: string; initial?: VisualRecord; transport: VisualTransport; onFollowUp?: (question: string) => void; onRetry?: () => void;
}) {
  const [record, setRecord] = useState<VisualRecord | undefined>(initial), [error, setError] = useState(''), [saving, setSaving] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [activeId, setActiveId] = useState(id)
  const [stepIndex, setStepIndex] = useState(0)
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
  return <article className="visual-card" aria-label="Visual explanation">
    {error && <p className="visual-error" role="alert">{error} <button type="button" onClick={() => setRefresh(n => n + 1)}>Reconnect</button></p>}
    {!record || record.status === 'pending' || record.status === 'running' ? <p className="visual-loading" role="status"><span className="spinner" /> Creating your visual explanation…</p>
      : record.status === 'failed' ? <div role="alert"><p>{record.error || 'The explanation could not be generated.'}</p>{(onRetry || transport.retry) && <button type="button" disabled={saving} onClick={onRetry || retry}>Retry visual explanation</button>}</div>
      : record.definition && <>
        <VisualStory record={record} stepIndex={stepIndex} onStepChange={setStepIndex} />
        <div className="visual-actions"><button type="button" onClick={() => dialog.current?.showModal()}>Expand</button>
          <button type="button" onClick={() => downloadVisual(record)}>Export HTML</button>
          {record.note_id ? <a href={transport.noteUrl(record.note_id)} target="_blank" rel="noreferrer">Open saved note</a>
            : <button type="button" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save to project'}</button>}
          {onFollowUp && <button type="button" onClick={() => onFollowUp(`Explain this part of “${record.definition!.title}” in more detail: `)}>Ask a follow-up</button>}
        </div>
        <dialog className="visual-dialog" ref={dialog}><div className="visual-dialog-header"><span>pdfpal · Explain visually</span><button type="button" aria-label="Close visual explanation" onClick={() => dialog.current?.close()}>×</button></div><VisualStory key={record.id} record={record} expanded stepIndex={stepIndex} onStepChange={setStepIndex} /></dialog>
      </>}
  </article>
}
