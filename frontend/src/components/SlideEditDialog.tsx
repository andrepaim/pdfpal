// "Edit slide": the words of the slide in view and, on a slide that can carry them, its numbers. A cover takes the
// post's key number; a study or method up to four stat tiles; a result its key number and a comparison of two to four
// rows. Values and labels are checked here as the server checks them (a digit in every value, the lengths, the row
// count), so a problem shows next to its field; a refusal from the server shows in the dialog too. One Save is one
// request and one Undo step, except a cover whose headline and number both changed: those are two edits on the
// server. See "Stage 6" in docs/share-posts-plan.md.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { CARD, PAPER, SET, collapse, type Row, type SlideSpec, type Stat } from '../../../src/shared/share-card'
import { slideText } from '../lib/share-card/slides'
import { Modal, alert, button, faded, field, muted, primary } from './SharePostParts'
import { slideName } from './SlideViewer'

/** The longest text a slide holds, and whether emptying it removes the slide. A page slide's words are not edited here. */
export const SLIDE_FIELDS: Record<Exclude<SlideSpec['kind'], 'page'>, { label: string; max: number; removable: boolean; required?: string }> = {
  cover: { label: 'Headline', max: CARD.headlineMax, removable: false },
  lead: { label: 'Headline', max: CARD.headlineMax, removable: false },
  question: { label: 'The question', max: PAPER.questionMax, removable: false },
  method: { label: 'The method', max: PAPER.methodMax, removable: false },
  result: { label: 'The result', max: PAPER.resultMax, removable: false, required: 'A result cannot be empty: a paper post keeps at least one.' },
  study: { label: 'The study', max: SET.studyMax, removable: true },
  point: { label: 'Claim', max: SET.pointMax, removable: false },
  takeaway: { label: 'The takeaway', max: Math.min(SET.takeawayMax, CARD.takeawayMax), removable: false },
  limitations: { label: 'Limits', max: SET.limitationsMax, removable: true },
}

/** What a Save sends: the sentence, and the numbers of the slide's kind (absent for a kind without them). */
export type SlideEdit = { text: string; stat?: Stat | null; stats?: Stat[]; rows?: Row[] }

/** Which numbers a slide's kind carries. */
const numbersOf = (slide: SlideSpec) => ({
  stat: slide.kind === 'cover' || slide.kind === 'result',
  stats: slide.kind === 'study' || slide.kind === 'method',
  rows: slide.kind === 'result',
})

/** Why a value cannot be saved, or ''. As the server: 1 to `max` characters with a digit. */
export function valueProblem(value: string, max: number): string {
  const text = collapse(value)
  if (!text) return 'Enter a value, like 41% or 312.'
  if (text.length > max) return `At most ${max} characters.`
  if (!/\p{N}/u.test(text)) return 'A value needs a digit, like 41% or 312.'
  return ''
}
/** Why a label cannot be saved, or ''. */
export function labelProblem(label: string, max: number): string {
  const text = collapse(label)
  if (!text) return 'Enter what the number counts.'
  if (text.length > max) return `At most ${max} characters.`
  return ''
}
/** Why a comparison cannot be saved, or ''. */
export const rowsProblem = (count: number) => count === 1 ? 'A comparison needs two to four rows, or none: add a row or remove this one.' : ''

type Pair = { value: string; label: string }
const clean = (pair: Pair): Stat => ({ value: collapse(pair.value), label: collapse(pair.label) })

const small: CSSProperties = { ...button, padding: '4px 9px', flexShrink: 0 }
const hidden: CSSProperties = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }
const input = (invalid: boolean): CSSProperties => ({ ...field, padding: '7px 9px', borderColor: invalid ? '#f87171' : 'var(--border)', minWidth: 0 })

/** A labelled input with its error under it. */
function Field({ id, label, value, max, problem, show, onChange, onBlur, width, placeholder }: {
  id: string; label: string; value: string; max: number; problem: string; show: boolean; onChange: (value: string) => void; onBlur: () => void
  width?: CSSProperties['flex']; placeholder?: string
}) {
  const invalid = show && !!problem
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: width ?? '1 1 120px', minWidth: 0 }}>
      <input id={id} data-field={id} value={value} maxLength={max} placeholder={placeholder} aria-label={label} aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${id}-problem` : undefined} onChange={event => onChange(event.target.value)} onBlur={onBlur} style={input(invalid)} />
      {invalid && <span id={`${id}-problem`} role="alert" style={{ ...alert, fontSize: 11 }}>{problem}</span>}
    </div>
  )
}

function Section({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  const id = `slide-numbers-${title.toLowerCase().replace(/\W+/gu, '-')}`
  return (
    <section aria-labelledby={id} style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid var(--border)', paddingTop: 10, minWidth: 0 }}>
      <h3 id={id} style={{ fontSize: 12, fontWeight: 600, color: '#e5e7eb', margin: 0 }}>{title}</h3>
      <p style={{ ...muted, margin: 0 }}>{hint}</p>
      {children}
    </section>
  )
}

/**
 * Edits the slide in view. `onSave` returns the server's refusal, or null when the edit was saved; the dialog stays
 * open on a refusal and shows it. `title` replaces the dialog's title, as "Add a takeaway" does.
 */
export function SlideEditDialog({ open, slide, index, count, title, onSave, onCancel }: {
  open: boolean; slide: SlideSpec | null; index: number; count: number; title?: string
  onSave: (edit: SlideEdit) => Promise<string | null>; onCancel: () => void
}) {
  const [text, setText] = useState('')
  const [stat, setStat] = useState<Pair | null>(null)
  const [stats, setStats] = useState<Pair[]>([])
  const [rows, setRows] = useState<Pair[]>([])
  const [shown, setShown] = useState<Set<string>>(new Set())
  const [attempted, setAttempted] = useState(false)
  const [refusal, setRefusal] = useState('')
  const [saving, setSaving] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const [focus, setFocus] = useState<string | null>(null)
  const root = useRef<HTMLDivElement>(null)

  // Fill the fields from the slide each time the dialog opens.
  useEffect(() => {
    if (!open || !slide) return
    setText(slideText(slide))
    setStat(slide.kind === 'cover' || slide.kind === 'result' ? slide.stat ? { ...slide.stat } : null : null)
    setStats(slide.kind === 'study' || slide.kind === 'method' ? (slide.stats ?? []).map(each => ({ ...each })) : [])
    setRows(slide.kind === 'result' ? (slide.rows ?? []).map(row => ({ value: row.value, label: row.label })) : [])
    setShown(new Set()); setAttempted(false); setRefusal(''); setSaving(false); setAnnouncement('')
  }, [open, slide])

  // After an add, a remove or a move, put the focus where the reader expects it.
  useEffect(() => {
    if (!focus) return
    root.current?.querySelector<HTMLElement>(`[data-field="${focus}"]`)?.focus()
    setFocus(null)
  }, [focus])

  const spec = slide && slide.kind !== 'page' ? SLIDE_FIELDS[slide.kind] : null
  const has = slide ? numbersOf(slide) : { stat: false, stats: false, rows: false }
  const words = collapse(text)
  const empty = !words, textOk = !!spec && (!empty || spec.removable) && words.length <= spec.max

  // Every problem by field ID, as the server would refuse it.
  const problems: Record<string, string> = {}
  if (has.stat && stat) {
    problems['stat-value'] = valueProblem(stat.value, PAPER.statValueMax)
    problems['stat-label'] = labelProblem(stat.label, PAPER.statLabelMax)
  }
  stats.forEach((each, at) => {
    problems[`stats-${at}-value`] = valueProblem(each.value, PAPER.statValueMax)
    problems[`stats-${at}-label`] = labelProblem(each.label, PAPER.statLabelMax)
  })
  rows.forEach((row, at) => {
    problems[`rows-${at}-label`] = labelProblem(row.label, PAPER.rowLabelMax)
    problems[`rows-${at}-value`] = valueProblem(row.value, PAPER.rowValueMax)
  })
  const rowsMessage = has.rows ? rowsProblem(rows.length) : ''
  const firstProblem = Object.entries(problems).find(([, problem]) => problem)?.[0]
  const show = (id: string) => attempted || shown.has(id)
  const touch = (id: string) => setShown(previous => previous.has(id) ? previous : new Set(previous).add(id))

  const save = async () => {
    if (!slide || !textOk || saving) return
    setAttempted(true)
    if (firstProblem || rowsMessage) {
      setFocus(firstProblem ?? 'rows-add')
      return
    }
    const edit: SlideEdit = { text: words }
    if (has.stat) edit.stat = stat ? clean(stat) : null
    if (has.stats) edit.stats = stats.map(clean)
    if (has.rows) edit.rows = rows.map(row => ({ label: collapse(row.label), value: collapse(row.value) }))
    setSaving(true); setRefusal('')
    const problem = await onSave(edit)
    setSaving(false)
    if (problem) setRefusal(problem)
  }

  const addStat = () => {
    if (stats.length >= PAPER.maxStats) return
    setStats(previous => [...previous, { value: '', label: '' }])
    setAnnouncement(`Stat ${stats.length + 1} added.`); setFocus(`stats-${stats.length}-value`)
  }
  const removeStat = (at: number) => {
    setStats(previous => previous.filter((_, position) => position !== at))
    setAnnouncement(`Stat ${at + 1} removed.`)
    setFocus(stats.length > 1 ? `stats-${Math.min(at, stats.length - 2)}-value` : 'stats-add')
  }
  const addRow = () => {
    if (rows.length >= PAPER.maxRows) return
    setRows(previous => [...previous, { value: '', label: '' }])
    setAnnouncement(`Row ${rows.length + 1} added.`); setFocus(`rows-${rows.length}-label`)
  }
  const removeRow = (at: number) => {
    setRows(previous => previous.filter((_, position) => position !== at))
    setAnnouncement(`Row ${at + 1} removed.`)
    setFocus(rows.length > 1 ? `rows-${Math.min(at, rows.length - 2)}-label` : 'rows-add')
  }
  const moveRow = (at: number, step: -1 | 1) => {
    const target = at + step
    if (target < 0 || target >= rows.length) return
    setRows(previous => { const next = [...previous]; const [row] = next.splice(at, 1); next.splice(target, 0, row!); return next })
    setAnnouncement(`Row moved to position ${target + 1} of ${rows.length}.`)
    // The same button on the moved row, or the other one when the row reached the end it was moving towards.
    const end = step < 0 ? target === 0 : target === rows.length - 1
    setFocus(`rows-${target}-${(step < 0) !== end ? 'up' : 'down'}`)
  }

  const canSave = textOk && !saving
  const removing = empty && !!spec?.removable

  return (
    <Modal open={open && !!spec} title={title ?? (slide ? `Edit slide ${index + 1} of ${count}: ${slideName(slide)}` : 'Edit slide')} onClose={onCancel} actions={<>
      <button type="button" onClick={onCancel} style={button}>Cancel</button>
      <button type="button" onClick={() => void save()} disabled={!canSave} aria-busy={saving} style={faded(primary, !canSave)}>
        {removing ? 'Remove slide' : saving ? 'Saving…' : 'Save'}
      </button>
    </>}>
      {slide && spec && (
        <div ref={root} data-slide-edit style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 'min(64vh, 620px)', overflowY: 'auto', overflowX: 'hidden', minWidth: 0 }}>
          <div>
            <p id="slide-edit-hint" style={{ ...muted, margin: '0 0 8px' }}>
              Up to {spec.max} characters.{spec.removable ? ' Leave it empty to remove this slide; Undo brings it back.' : ''}
            </p>
            {empty && spec.required && <p role="note" style={{ fontSize: 12, color: '#fca5a5', margin: '0 0 8px' }}>{spec.required}</p>}
            <textarea value={text} onChange={event => setText(event.target.value.slice(0, spec.max))} maxLength={spec.max} rows={spec.max > 100 ? 4 : 2} autoFocus
              aria-label={spec.label} aria-describedby="slide-edit-hint" style={field} />
            <div style={{ ...muted, textAlign: 'right' }}>{text.length}/{spec.max}</div>
          </div>

          {has.stat && (
            <Section title="Key number" hint={slide.kind === 'cover'
              ? `Shown large with the headline. Value up to ${PAPER.statValueMax} characters with a digit; label up to ${PAPER.statLabelMax}.`
              : `Shown very large over its label, above the sentence, when there is no comparison. Value up to ${PAPER.statValueMax} characters; label up to ${PAPER.statLabelMax}.`}>
              {stat ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 6 }}>
                  <Field id="stat-value" label="Key number value" value={stat.value} max={PAPER.statValueMax} problem={problems['stat-value']!} show={show('stat-value')}
                    onChange={value => setStat({ ...stat, value })} onBlur={() => touch('stat-value')} width="0 1 96px" placeholder="41%" />
                  <Field id="stat-label" label="Key number label" value={stat.label} max={PAPER.statLabelMax} problem={problems['stat-label']!} show={show('stat-label')}
                    onChange={label => setStat({ ...stat, label })} onBlur={() => touch('stat-label')} placeholder="what it counts" />
                  <button type="button" data-field="stat-remove" onClick={() => { setStat(null); setAnnouncement('Key number removed.'); setFocus('stat-add') }} style={small}>Remove</button>
                </div>
              ) : (
                <div><button type="button" data-field="stat-add" onClick={() => { setStat({ value: '', label: '' }); setAnnouncement('Key number added.'); setFocus('stat-value') }} style={small}>Add a key number</button></div>
              )}
            </Section>
          )}

          {has.stats && (
            <Section title="Stats" hint={`Shown as tiles above the sentence, up to ${PAPER.maxStats}. The assistant gives none or two to four; you may keep one. Value up to ${PAPER.statValueMax} characters with a digit; label up to ${PAPER.statLabelMax}.`}>
              <ol aria-label="Stats" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {stats.map((each, at) => (
                  <li key={at} data-stat={at} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 6 }}>
                    <Field id={`stats-${at}-value`} label={`Stat ${at + 1} value`} value={each.value} max={PAPER.statValueMax} problem={problems[`stats-${at}-value`]!}
                      show={show(`stats-${at}-value`)} onChange={value => setStats(previous => previous.map((item, position) => position === at ? { ...item, value } : item))}
                      onBlur={() => touch(`stats-${at}-value`)} width="0 1 96px" placeholder="312" />
                    <Field id={`stats-${at}-label`} label={`Stat ${at + 1} label`} value={each.label} max={PAPER.statLabelMax} problem={problems[`stats-${at}-label`]!}
                      show={show(`stats-${at}-label`)} onChange={label => setStats(previous => previous.map((item, position) => position === at ? { ...item, label } : item))}
                      onBlur={() => touch(`stats-${at}-label`)} placeholder="what it counts" />
                    <button type="button" data-field={`stats-${at}-remove`} onClick={() => removeStat(at)} aria-label={`Remove stat ${at + 1}`} style={small}>✕</button>
                  </li>
                ))}
              </ol>
              <div><button type="button" data-field="stats-add" onClick={addStat} disabled={stats.length >= PAPER.maxStats} style={faded(small, stats.length >= PAPER.maxStats)}>Add a stat</button></div>
            </Section>
          )}

          {has.rows && (
            <Section title="Comparison" hint={`Shown as a small table; use the same measure in every row. None, or two to ${PAPER.maxRows} rows. Label up to ${PAPER.rowLabelMax} characters; value up to ${PAPER.rowValueMax}, with a digit.`}>
              <ol aria-label="Comparison rows" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {rows.map((row, at) => (
                  <li key={at} data-row={at} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 6 }}>
                    <Field id={`rows-${at}-label`} label={`Row ${at + 1} label`} value={row.label} max={PAPER.rowLabelMax} problem={problems[`rows-${at}-label`]!}
                      show={show(`rows-${at}-label`)} onChange={label => setRows(previous => previous.map((item, position) => position === at ? { ...item, label } : item))}
                      onBlur={() => touch(`rows-${at}-label`)} placeholder="group or model" />
                    <Field id={`rows-${at}-value`} label={`Row ${at + 1} value`} value={row.value} max={PAPER.rowValueMax} problem={problems[`rows-${at}-value`]!}
                      show={show(`rows-${at}-value`)} onChange={value => setRows(previous => previous.map((item, position) => position === at ? { ...item, value } : item))}
                      onBlur={() => touch(`rows-${at}-value`)} width="0 1 96px" placeholder="41%" />
                    <span style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                      <button type="button" data-field={`rows-${at}-up`} onClick={() => moveRow(at, -1)} aria-disabled={at === 0} aria-label={`Move row ${at + 1} up`} style={faded(small, at === 0)}>↑</button>
                      <button type="button" data-field={`rows-${at}-down`} onClick={() => moveRow(at, 1)} aria-disabled={at === rows.length - 1} aria-label={`Move row ${at + 1} down`} style={faded(small, at === rows.length - 1)}>↓</button>
                      <button type="button" data-field={`rows-${at}-remove`} onClick={() => removeRow(at)} aria-label={`Remove row ${at + 1}`} style={small}>✕</button>
                    </span>
                  </li>
                ))}
              </ol>
              {(attempted || rows.length === 1) && rowsMessage && <span role="alert" style={{ ...alert, fontSize: 11 }}>{rowsMessage}</span>}
              <div><button type="button" data-field="rows-add" onClick={addRow} disabled={rows.length >= PAPER.maxRows} style={faded(small, rows.length >= PAPER.maxRows)}>Add a row</button></div>
            </Section>
          )}

          {refusal && <p role="alert" style={alert}>{refusal}</p>}
          <div aria-live="polite" style={hidden}>{announcement}</div>
        </div>
      )}
    </Modal>
  )
}
