import type { FastifyRequest } from 'fastify'
import { ExtensionError } from '../core/extension-auth.js'

export function localOrigin(request: FastifyRequest): string {
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.ip) ||
    !/^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?$/.test(request.headers.host || ''))
    throw new ExtensionError(403, 'Extension connections are available on this computer only.', 'LOCAL_ONLY')
  return `http://${request.headers.host}`
}

export function localWeb(request: FastifyRequest): string {
  const expected = localOrigin(request), origin = request.headers.origin
  const mutation = !['GET', 'HEAD'].includes(request.method)
  if ((origin && origin !== expected) || (mutation && origin !== expected) || request.headers['sec-fetch-site'] === 'cross-site')
    throw new ExtensionError(403, 'Open this page directly in your local pdfpal.', 'SAME_ORIGIN_REQUIRED')
  if (mutation && !/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || ''))
    throw new ExtensionError(415, 'Send a JSON request.', 'JSON_REQUIRED')
  return expected
}

export function rateLimit(maximum: number, interval = 60_000) {
  let start = 0, count = 0
  return () => {
    if (Date.now() - start >= interval) { start = Date.now(); count = 0 }
    if (++count > maximum) throw new ExtensionError(429, 'Too many connection attempts. Wait a minute and retry.', 'RATE_LIMITED')
  }
}
