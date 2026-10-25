import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { buildServer } from '../../src/server/app.js'
import { openDatabase } from '../../src/core/database.js'
import { ExtensionAuth, digest } from '../../src/core/extension-auth.js'
import { EXTENSION_ORIGIN } from '../../src/shared/extension-pairing.js'
import { testConfig } from '../helpers/test-utils.js'

const base = 'http://127.0.0.1:8200', host = '127.0.0.1:8200'
const secret = () => randomBytes(32).toString('base64url')
async function setup() {
  const config = testConfig(), app = await buildServer(config), db = openDatabase(config), auth = new ExtensionAuth(db)
  const id = randomUUID(), proof = secret(), token = secret()
  const extension = { host, origin: EXTENSION_ORIGIN, 'x-extension-origin': EXTENSION_ORIGIN, 'x-pairing-proof': proof }
  const web = { host, origin: base, 'content-type': 'application/json' }
  const create = () => app.inject({ method: 'POST', url: '/api/extension/pairing-requests', headers: extension, payload: { id } })
  const decide = (allow = true) => app.inject({ method: 'POST', url: `/api/extensions/requests/${id}/decision`, headers: web, payload: { allow } })
  const claim = (value = token) => app.inject({ method: 'POST', url: `/api/extension/pairing-requests/${id}/claim`, headers: extension, payload: { token: value } })
  return { app, db, auth, id, proof, token, extension, web, create, decide, claim,
    async close() { await app.close(); db.close(); fs.rmSync(config.dataDir, { recursive: true, force: true }) } }
}

test('approval, claim and lost-response retries create one hashed credential; revoke cannot be replayed', async () => {
  const s = await setup()
  try {
    assert.equal((await s.create()).json().status, 'pending')
    assert.equal((await s.create()).json().id, s.id)
    assert.equal((await s.claim()).statusCode, 409)
    const publicState = await s.app.inject({ url: `/api/extensions/requests/${s.id}`, headers: s.web })
    assert.equal(publicState.headers['cache-control'], 'no-store')
    assert.deepEqual(Object.keys(publicState.json()).sort(), ['created_at', 'expires_at', 'id', 'origin', 'status'])
    assert.equal((await s.decide()).json().status, 'approved')
    const [first, second] = await Promise.all([s.claim(), s.claim()])
    assert.equal(first.statusCode, 200); assert.deepEqual(second.json(), first.json())
    assert.equal(s.auth.list().length, 1)
    assert.equal(s.auth.authenticate(s.token).id, first.json().client_id)
    const stored = JSON.stringify(s.db.prepare('SELECT * FROM extension_pairing_requests').all()) + JSON.stringify(s.db.prepare('SELECT * FROM extension_clients').all())
    assert.ok(!stored.includes(s.token) && !stored.includes(s.proof))
    assert.ok(stored.includes(digest(s.proof)))
    assert.equal((await s.claim(secret())).statusCode, 401)
    s.db.prepare('UPDATE extension_pairing_requests SET expires_at=0').run()
    assert.equal((await s.claim()).statusCode, 200)
    assert.equal((await s.decide()).json().status, 'claimed')
    const cid = first.json().client_id
    assert.equal((await s.app.inject({ method: 'PATCH', url: `/api/extensions/connections/${cid}`, headers: s.web, payload: { label: 'Reading laptop' } })).statusCode, 200)
    assert.equal((await s.app.inject({ url: '/api/extensions/connections', headers: s.web })).json()[0].label, 'Reading laptop')
    assert.equal((await s.app.inject({ method: 'DELETE', url: `/api/extensions/connections/${cid}`, headers: s.web, payload: {} })).statusCode, 200)
    assert.equal((await s.claim()).statusCode, 401)
    assert.equal((await s.app.inject({ url: '/api/extension/status', headers: { host, authorization: `Bearer ${s.token}` } })).statusCode, 401)
  } finally { await s.close() }
})

test('denial, cancellation, expiry and wrong proofs never grant access', async () => {
  const s = await setup()
  try {
    await s.create()
    const url = `/api/extension/pairing-requests/${s.id}`
    assert.equal((await s.app.inject({ url, headers: { ...s.extension, 'x-pairing-proof': secret() } })).statusCode, 403)
    assert.equal((await s.app.inject({ url, headers: { host, origin: EXTENSION_ORIGIN } })).statusCode, 400)
    assert.equal((await s.app.inject({ url, headers: { ...s.extension, host: 'localhost:8200' } })).statusCode, 404)
    assert.equal((await s.decide(false)).json().status, 'denied')
    assert.equal((await s.decide(false)).statusCode, 200)
    assert.equal((await s.decide()).statusCode, 409)
    assert.equal((await s.claim()).statusCode, 409)
    s.db.prepare('DELETE FROM extension_pairing_requests').run(); await s.create()
    assert.equal((await s.app.inject({ method: 'DELETE', url, headers: s.extension })).json().status, 'cancelled')
    assert.equal((await s.claim()).statusCode, 409)
    s.db.prepare('DELETE FROM extension_pairing_requests').run(); await s.create()
    s.db.prepare('UPDATE extension_pairing_requests SET expires_at=0').run()
    assert.equal((await s.app.inject({ url, headers: s.extension })).json().status, 'expired')
    assert.equal((await s.decide()).statusCode, 409)
    assert.equal((await s.claim()).statusCode, 409)
    assert.equal(s.auth.list().length, 0)
  } finally { await s.close() }
})

test('web mutations require loopback, exact origin and JSON; ordinary pages cannot use the bridge', async () => {
  const s = await setup()
  try {
    await s.create()
    const url = `/api/extensions/requests/${s.id}/decision`
    for (const origin of ['', 'null', 'https://read.amazon.com', 'http://127.0.0.1:8201', 'http://localhost:8200']) {
      const headers: Record<string,string> = { ...s.web }; if (origin) headers.origin = origin; else delete headers.origin
      assert.equal((await s.app.inject({ method: 'POST', url, headers, payload: { allow: true } })).statusCode, 403, origin)
    }
    assert.equal((await s.app.inject({ method: 'POST', url, headers: { ...s.web, 'content-type': 'text/plain' }, payload: '{"allow":true}' })).statusCode, 415)
    for (const options of [{ headers: { ...s.web, host: 'attacker.test' } }, { headers: s.web, remoteAddress: '192.168.1.20' }]) {
      assert.equal((await s.app.inject({ url: '/api/extensions/connections', ...options })).statusCode, 403)
    }
    assert.equal((await s.app.inject({ url: '/api/extension/capabilities', headers: s.web })).statusCode, 403)
    assert.equal((await s.app.inject({ method: 'POST', url: '/api/extension/pairing-requests', headers: { ...s.extension, 'x-extension-origin': `chrome-extension://${'a'.repeat(32)}` }, payload: { id: randomUUID() } })).statusCode, 403)
    assert.equal((await s.app.inject({ url: '/api/extensions/connections', headers: { ...s.web, 'sec-fetch-site': 'cross-site' } })).statusCode, 403)
    assert.equal((await s.app.inject({ url: '/api/extension/capabilities', headers: s.extension })).json().pairing_protocol, 1)
    assert.equal((await s.app.inject({ url: '/api/extension/projects', headers: s.extension })).statusCode, 401)
    assert.equal((await s.app.inject({ url: '/api/extension/pairing-requests/not-an-id', headers: s.extension })).statusCode, 400)
  } finally { await s.close() }
})

test('creation is bounded and manual pairing stays compatible', async () => {
  const s = await setup()
  try {
    for (let i = 0; i < 10; i++) assert.equal((await s.create()).statusCode, 200)
    assert.equal((await s.create()).statusCode, 429)
    const code = s.auth.pairCode().code
    const paired = s.auth.exchange(code, EXTENSION_ORIGIN)
    assert.equal(s.auth.authenticate(paired.token).id, paired.client_id)
  } finally { await s.close() }
})

test('pending and claimed requests survive a new auth service; cleanup retains usable clients', async () => {
  const s = await setup()
  try {
    await s.create(); await s.decide()
    const restored = new ExtensionAuth(s.db)
    const first = restored.claim(s.id, base, s.proof, EXTENSION_ORIGIN, s.token)
    assert.equal((await s.app.inject({ method: 'DELETE', url: `/api/extension/pairing-requests/${s.id}`, headers: s.extension })).statusCode, 409)
    s.db.prepare('UPDATE extension_pairing_requests SET expires_at=0').run()
    restored.createRequest(randomUUID(), secret(), EXTENSION_ORIGIN, base)
    assert.equal(restored.authenticate(s.token).id, first.client_id)
    assert.throws(() => restored.inspect(s.id, base), /not found/)
  } finally { await s.close() }
})

test('packaged download matches metadata and approval pages cannot be framed', async () => {
  const s = await setup()
  try {
    const { createHash } = await import('node:crypto')
    const pkg = await s.app.inject({ url: '/api/extensions/package', headers: s.web })
    assert.equal(pkg.statusCode, 200)
    const download = await s.app.inject({ url: '/api/extensions/download', headers: s.web })
    assert.equal(download.headers['content-type'], 'application/zip')
    assert.equal(download.rawPayload.length, pkg.json().size)
    assert.equal(createHash('sha256').update(download.rawPayload).digest('hex'), pkg.json().sha256)
    const page = await s.app.inject({ url: '/extensions/connect?request=public-id', headers: { host } })
    assert.equal(page.headers['content-security-policy'], "frame-ancestors 'none'")
    assert.equal(page.headers['referrer-policy'], 'no-referrer')
  } finally { await s.close() }
})

test('missing or incomplete package has an explicit recoverable error', async () => {
  const { extensionPackage } = await import('../../src/server/extension-management.js')
  const config = testConfig()
  try {
    await assert.rejects(extensionPackage(config.dataDir), { status: 503, code: 'PACKAGE_MISSING' })
    fs.writeFileSync(`${config.dataDir}/metadata.json`, '{"size":100}')
    fs.writeFileSync(`${config.dataDir}/companion.zip`, 'incomplete')
    await assert.rejects(extensionPackage(config.dataDir), { status: 503, code: 'PACKAGE_MISSING' })
  } finally { fs.rmSync(config.dataDir, { recursive: true, force: true }) }
})
