import http from 'node:http'

/** Local HTTP over a private pipe or loopback; never proxies or follows redirects. */
export function localJson(url: string, headers: Record<string, string>, body?: unknown, timeout = 120000, socketPath?: string): Promise<{ status: number; ok: boolean; value: any }> {
  const target = new URL(url)
  if (target.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) || target.username || target.password) throw new Error('Invalid loopback address')
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : Buffer.from(JSON.stringify(body), 'utf8')
    let finished = false
    const fail = (error: unknown) => { if (!finished) { finished = true; clearTimeout(timer); reject(error) } }
    const request = http.request(target, { method: data ? 'POST' : 'GET', agent: false, ...(socketPath ? { socketPath } : {}),
      headers: { ...headers, connection: 'close', ...(data ? { 'content-type': 'application/json', 'content-length': String(data.length) } : {}) } }, response => {
      const chunks: Buffer[] = []
      let length = 0
      response.on('data', (chunk: Buffer) => {
        length += chunk.length
        if (length > 16 * 1024 * 1024) request.destroy(Object.assign(new Error('The local response is too large. Request fewer results.'), { code: 'RESPONSE_TOO_LARGE' }))
        else chunks.push(chunk)
      })
      response.on('error', fail)
      response.on('aborted', () => fail(Object.assign(new Error('The local response was interrupted.'), { code: 'ECONNRESET' })))
      response.on('end', () => {
        if (finished) return
        try {
          const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          finished = true; clearTimeout(timer)
          resolve({ status: response.statusCode ?? 500, ok: (response.statusCode ?? 500) >= 200 && (response.statusCode ?? 500) < 300, value })
        } catch { fail(Object.assign(new Error('The local service returned an invalid JSON response.'), { code: 'INVALID_LOCAL_JSON' })) }
      })
    })
    const timer = setTimeout(() => request.destroy(Object.assign(new Error('The local request timed out.'), { code: 'ETIMEDOUT' })), timeout)
    request.on('error', fail)
    request.end(data)
  })
}
