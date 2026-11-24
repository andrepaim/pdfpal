import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { DictionaryResult } from '@andrepaim/contextual-dictionary-core'
import type { DictionaryDefineResponse } from '../shared/dictionary.js'
import { DictionaryService } from '../core/dictionary.js'
import type { ContextualDefinitions } from '../core/contextual-definitions.js'
import { ContextualError, type ContextualService } from '../core/contextual-service.js'
import { PdfpalError } from '../core/types.js'

// Definitions for the reader's definition card, from the offline Wiktionary
// pack. `before` and `after` are the text around the selection; they stay on
// this machine. They recognise a compound around the word and, when
// contextual definitions are on, are read by the local word-sense model to
// order each entry's meanings. The answer is sent once, in its final order.
const DICTIONARY_TEXT_LIMIT = 120, DICTIONARY_CONTEXT_LIMIT = 200

/**
 * State changes must come from pdfpal's own page: a same-origin JSON request.
 * The server-wide hook already refuses foreign Host and Origin headers; this
 * also refuses same-site pages on other ports and the simple form or
 * text/plain requests a page can send without a preflight. It runs before
 * the body is read.
 */
async function sameOriginJson(request: FastifyRequest, reply: FastifyReply) {
  const origin = request.headers.origin, site = request.headers['sec-fetch-site']
  if ((origin !== undefined && origin !== `http://${request.headers.host}`) || (site !== undefined && site !== 'same-origin' && site !== 'none'))
    return reply.code(403).send({ code: 'FORBIDDEN', detail: 'Open this action from pdfpal.' })
  if (!/^application\/json\s*(;|$)/i.test(String(request.headers['content-type'] ?? '')))
    return reply.code(415).send({ code: 'JSON_REQUIRED', detail: 'Send this request as JSON from pdfpal.' })
}

const legacyPartOfSpeech = new Map([['adj', 'adjective'], ['adv', 'adverb']])

function defineResponse({ query, entries, source }: DictionaryResult): DictionaryDefineResponse {
  return {
    query,
    entries: entries.map(entry => ({
      ...entry,
      part_of_speech: legacyPartOfSpeech.get(entry.partOfSpeech) ?? entry.partOfSpeech,
    })),
    source: `${source.name} · ${source.license}`,
    sourceDetails: source,
  }
}

export function registerDictionaryRoutes(app: FastifyInstance, contextual?: ContextualService | ContextualDefinitions, dictionary = new DictionaryService()) {
  const service = contextual && 'current' in contextual ? contextual : undefined
  const ranker = () => service ? service.current() : contextual as ContextualDefinitions | undefined
  app.addHook('onClose', async () => { await Promise.all([dictionary.close(), contextual?.close()]) })
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
    let result = await dictionary.define(selection)
    const current = ranker()
    if (current && result.entries.length && !reply.raw.destroyed) {
      // The reader cancels a lookup it no longer needs. Stop waiting for the model then.
      const cancelled = new AbortController()
      reply.raw.once('close', () => { if (!reply.raw.writableFinished) cancelled.abort() })
      result = await current.order(result, selection, cancelled.signal).catch(() => result)
    }
    return defineResponse(result)
  })
  if (!service) return

  // "Order meanings by context": status, the setting, and the one-time download.
  const answer = async (reply: FastifyReply, work: () => unknown, status = 200) => {
    try { return reply.code(status).send(await work()) } catch (error) {
      if (error instanceof ContextualError) return reply.code(error.status).send({ code: error.code, detail: error.message, details: error.details })
      throw error
    }
  }
  const body = (request: FastifyRequest) => (request.body ?? {}) as Record<string, unknown>
  app.get('/api/dictionary/contextual', async () => service.status())
  app.post('/api/dictionary/contextual', { onRequest: sameOriginJson }, async (request, reply) => {
    const { enabled } = body(request)
    if (typeof enabled !== 'boolean') return reply.code(400).send({ code: 'INVALID_REQUEST', detail: 'enabled must be true or false.' })
    return answer(reply, () => service.setEnabled(enabled))
  })
  app.post('/api/dictionary/contextual/download', { onRequest: sameOriginJson }, async (request, reply) => {
    const accept = body(request).accept_bytes
    if (!Number.isSafeInteger(accept) || (accept as number) < 0) return reply.code(400).send({ code: 'INVALID_REQUEST', detail: 'accept_bytes must be the download size you confirmed.' })
    return answer(reply, () => service.startDownload(accept as number), 202)
  })
  app.post('/api/dictionary/contextual/download/cancel', { onRequest: sameOriginJson }, async (_request, reply) => answer(reply, () => service.cancelDownload()))
}
