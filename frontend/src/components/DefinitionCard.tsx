import { useState, type CSSProperties } from 'react'
import { cardPreview } from '@andrepaim/contextual-dictionary-core/card'
import '@andrepaim/contextual-dictionary-core/card.css'
import type { DictionaryDefineResponse } from '../../../src/shared/dictionary'

interface Props {
  result: DictionaryDefineResponse
  style: CSSProperties
}

/** The dictionary meanings of the word selected in the reader. */
export default function DefinitionCard({ result, style }: Props) {
  const [showAll, setShowAll] = useState(false)
  const { entries, canExpand } = cardPreview(result.entries, showAll)

  return (
    <div
      className="dc-card pdf-definition-card"
      role="dialog"
      aria-label={`Definition of ${result.query}`}
      data-definition-card="1"
      // Keep the word selected while the reader expands or collapses its meanings.
      onMouseDown={event => event.preventDefault()}
      style={style}
    >
      <div className="dc-body" role="region" aria-label="Meanings" tabIndex={0}>
        {entries.map(({ entry, senses }, entryIndex) => (
          <section className="dc-entry" key={`${entry.lemma} ${entry.partOfSpeech} ${entryIndex}`}>
            <div className="dc-head">
              <span className="dc-lemma">{entry.lemma}</span>{' '}
              <span className="dc-pos">{entry.partOfSpeech}</span>
            </div>
            {entry.note && <p className="dc-note">{entry.note}</p>}
            <ol className="dc-senses">
              {senses.map(({ sense, examples }, index) => (
                <li key={index}>
                  <span className="dc-definition">{sense.definition}</span>
                  {examples.map((example, exampleIndex) => (
                    <div className="dc-example" key={exampleIndex}>“{example}”</div>
                  ))}
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
      <div className="dc-footer">
        {canExpand && (
          <button
            className="dc-toggle"
            type="button"
            onClick={() => setShowAll(value => !value)}
            aria-expanded={showAll}
          >
            {showAll ? 'Show fewer' : 'Show all meanings'}
          </button>
        )}
        <a
          className="dc-attribution"
          href={result.sourceDetails.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {result.source}
        </a>
      </div>
    </div>
  )
}
