import { useEffect, useState, type CSSProperties } from 'react'
import type { DictionaryResult } from '../lib/api'

// How much shows before "Show all": a word like "run" has 57 meanings.
const ENTRIES_SHOWN = 3
const SENSES_SHOWN = 3

interface Props {
  result: DictionaryResult
  style: CSSProperties
  onClose: () => void
}

/** The dictionary meanings of the word selected in the reader. */
export default function DefinitionCard({ result, style, onClose }: Props) {
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const entries = showAll ? result.entries : result.entries.slice(0, ENTRIES_SHOWN)
  const hidden = result.entries.length > ENTRIES_SHOWN || result.entries.some(entry => entry.senses.length > SENSES_SHOWN)

  return (
    <div
      role="dialog"
      aria-label={`Definition of ${result.query}`}
      data-definition-card="1"
      // Keeps the word selected while the card is used, so Highlight and Ask still apply to it.
      onMouseDown={event => event.preventDefault()}
      style={{
        position: 'absolute', width: 340, maxWidth: 'calc(100% - 16px)', maxHeight: 320, overflowY: 'auto',
        background: 'var(--panel)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 10,
        boxShadow: '0 8px 24px rgba(0,0,0,0.5)', padding: '10px 12px 8px', fontSize: 13, lineHeight: 1.45, zIndex: 9998,
        ...style,
      }}
    >
      {entries.map(entry => {
        const senses = showAll ? entry.senses : entry.senses.slice(0, SENSES_SHOWN)
        return (
          <section key={`${entry.lemma} ${entry.part_of_speech}`} style={{ marginBottom: 8 }}>
            <div>
              <span style={{ fontWeight: 600 }}>{entry.lemma}</span>{' '}
              <span style={{ color: 'var(--muted)', fontStyle: 'italic', fontSize: 12 }}>{entry.part_of_speech}</span>
            </div>
            <ol style={{ margin: '2px 0 0', paddingLeft: 22, listStyle: 'decimal' }}>
              {senses.map((sense, index) => (
                <li key={index} style={{ marginBottom: 2 }}>
                  {sense.definition}
                  {sense.examples[0] && <div style={{ color: 'var(--muted)', fontSize: 12 }}>“{sense.examples[0]}”</div>}
                </li>
              ))}
            </ol>
          </section>
        )
      })}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--muted)', fontSize: 11 }}>
        {hidden && (
          <button
            type="button"
            onClick={() => setShowAll(value => !value)}
            style={{ background: 'none', border: 'none', padding: 0, color: 'var(--accent)', fontSize: 12, cursor: 'pointer' }}
          >
            {showAll ? 'Show fewer' : 'Show all meanings'}
          </button>
        )}
        <span style={{ marginLeft: 'auto' }}>{result.source}</span>
      </div>
    </div>
  )
}
