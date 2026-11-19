import type { FastifyInstance } from 'fastify'
import { DictionaryService } from '../core/dictionary.js'
import type { ContextualDefinitions } from '../core/contextual-definitions.js'
import { PdfpalError } from '../core/types.js'

// Definitions for the reader's definition card, from the offline WordNet
// file. `before` and `after` are the text around the selection; they stay on
// this machine. They recognise a compound around the word and, when
// contextual definitions are on, are read by the local word-sense model to
// order each entry's meanings. The answer is sent once, in its final order.
const DICTIONARY_TEXT_LIMIT = 120, DICTIONARY_CONTEXT_LIMIT = 200

export function registerDictionaryRoutes(app: FastifyInstance, contextual?: ContextualDefinitions, dictionary = new DictionaryService()) {
  app.addHook('onClose', async () => { dictionary.close(); await contextual?.close() })
  app.get('/api/dictionary/define', async (request, reply) => {
    const query = request.query as Record<string, unknown>
    const text = String(query.text ?? '')
    if (!text.trim()) throw new PdfpalError('WORD_REQUIRED', 'Choose a word to define.', 2)
    if (text.length > DICTIONARY_TEXT_LIMIT) throw new PdfpalError('WORD_TOO_LONG', 'Choose a shorter word or phrase to define.', 2)
    const selection = {
      text,
      before: String(query.before ?? '').slice(-DICTIONARY_CONTEXT_LIMIT),
      after: String(query.after ?? '').slice(0, DICTIONARY_CONTEXT_LIMIT),
    }
    const result = dictionary.define(text, selection)
    if (!contextual || !result.entries.length) return result
    // The reader cancels a lookup it no longer needs; stop waiting for the model then.
    const cancelled = new AbortController()
    reply.raw.once('close', () => { if (!reply.raw.writableFinished) cancelled.abort() })
    return contextual.order(result, selection, cancelled.signal)
  })
}
