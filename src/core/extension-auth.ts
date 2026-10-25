import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { Database } from 'better-sqlite3'
import { PAIRING_TTL_MS, type ExtensionConnection, type PairingRequest } from '../shared/extension-pairing.js'

export const digest = (value: string) => createHash('sha256').update(value).digest('hex')
export class ExtensionError extends Error {
  constructor(public readonly status: number, message: string, public readonly code = 'CONNECTION_ERROR') { super(message) }
}
export type ExtensionClient = ExtensionConnection
type RequestRow = Omit<PairingRequest, 'expires_at'> & { expires_at: number; proof_hash: string; server_origin: string; client_id: string | null }

export class ExtensionAuth {
  constructor(private readonly db: Database) {}

  pairCode(): { code: string; expires_at: string } {
    const code = randomBytes(16).toString('hex'), expires = Date.now() + 5 * 60_000
    this.db.prepare('DELETE FROM extension_pair_codes WHERE expires_at<?').run(Date.now())
    this.db.prepare('INSERT INTO extension_pair_codes VALUES (?,?)').run(digest(code), expires)
    return { code, expires_at: new Date(expires).toISOString() }
  }

  exchange(code: string, origin: string): { token: string; client_id: string } {
    if (!/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) throw new ExtensionError(400, 'Invalid extension identity.')
    return this.db.transaction(() => {
      const found = this.db.prepare('SELECT expires_at FROM extension_pair_codes WHERE code_hash=?').get(digest(code)) as { expires_at: number } | undefined
      if (!found || found.expires_at < Date.now()) throw new ExtensionError(401, 'Pairing code is invalid or expired. Run pdfpal extension pair for a new code.')
      const token = randomBytes(32).toString('base64url'), id = randomUUID()
      this.db.prepare('DELETE FROM extension_pair_codes WHERE code_hash=?').run(digest(code))
      this.db.prepare('INSERT INTO extension_clients(id,token_hash,origin,created_at) VALUES (?,?,?,?)').run(id, digest(token), origin, new Date().toISOString())
      return { token, client_id: id }
    })()
  }

  authenticate(token: string, origin?: string): ExtensionClient {
    const client = this.db.prepare('SELECT id,origin,label,created_at,revoked_at FROM extension_clients WHERE token_hash=? AND revoked_at IS NULL').get(digest(token)) as ExtensionClient | undefined
    if (!client || (origin && client.origin !== origin)) throw new ExtensionError(401, 'Connect the extension to pdfpal again. This connection is invalid or revoked.')
    return client
  }

  list(): ExtensionClient[] {
    return this.db.prepare('SELECT id,origin,label,created_at,revoked_at FROM extension_clients ORDER BY created_at DESC').all() as ExtensionClient[]
  }

  revoke(id: string): void {
    const result = this.db.prepare('UPDATE extension_clients SET revoked_at=? WHERE id=?').run(new Date().toISOString(), id)
    if (!result.changes) throw new ExtensionError(404, 'Extension connection not found.')
  }

  rename(id: string, label: string): void {
    if (!this.db.prepare('UPDATE extension_clients SET label=? WHERE id=?').run(label || null, id).changes)
      throw new ExtensionError(404, 'Extension connection not found.')
  }

  createRequest(id: string, proof: string, origin: string, serverOrigin: string): PairingRequest {
    return this.db.transaction(() => {
      // Retain terminal requests for one day for diagnostics/replay detection. Bounded request creation
      // and this indexed cleanup keep the table bounded without timers or raw credentials.
      this.db.prepare('DELETE FROM extension_pairing_requests WHERE expires_at<?').run(Date.now() - 86_400_000)
      const existing = this.db.prepare('SELECT id FROM extension_pairing_requests WHERE id=?').get(id)
      if (existing) return this.inspect(id, serverOrigin, proof, origin)
      this.db.prepare(`INSERT INTO extension_pairing_requests(id,proof_hash,origin,server_origin,status,created_at,expires_at)
        VALUES (?,?,?,?,'pending',?,?)`).run(id, digest(proof), origin, serverOrigin, new Date().toISOString(), Date.now() + PAIRING_TTL_MS)
      return this.inspect(id, serverOrigin, proof, origin)
    })()
  }

  private request(id: string, serverOrigin: string, proof?: string, origin?: string): RequestRow {
    const row = this.db.prepare('SELECT * FROM extension_pairing_requests WHERE id=?').get(id) as RequestRow | undefined
    if (!row || row.server_origin !== serverOrigin) throw new ExtensionError(404, 'Connection request not found. Start again in the extension.', 'REQUEST_NOT_FOUND')
    if (proof !== undefined && (digest(proof) !== row.proof_hash || origin !== row.origin))
      throw new ExtensionError(403, 'Connection request proof does not match.', 'INVALID_PROOF')
    if (row.expires_at <= Date.now() && ['pending', 'approved'].includes(row.status)) {
      row.status = 'expired'
      this.db.prepare("UPDATE extension_pairing_requests SET status='expired' WHERE id=?").run(id)
    }
    return row
  }

  inspect(id: string, serverOrigin: string, proof?: string, origin?: string): PairingRequest {
    const row = this.request(id, serverOrigin, proof, origin)
    return { id: row.id, origin: row.origin, status: row.status, created_at: row.created_at, expires_at: new Date(row.expires_at).toISOString() }
  }

  decide(id: string, serverOrigin: string, allow: boolean): PairingRequest {
    return this.db.transaction(() => {
      const row = this.request(id, serverOrigin), status = allow ? 'approved' : 'denied'
      if (row.status === 'pending') this.db.prepare('UPDATE extension_pairing_requests SET status=? WHERE id=?').run(status, id)
      else if (row.status !== status && !(allow && row.status === 'claimed'))
        throw new ExtensionError(409, `Connection request is ${row.status}.`, 'REQUEST_TERMINAL')
      return this.inspect(id, serverOrigin)
    })()
  }

  cancel(id: string, serverOrigin: string, proof: string, origin: string): PairingRequest {
    return this.db.transaction(() => {
      const row = this.request(id, serverOrigin, proof, origin)
      if (row.status === 'claimed') throw new ExtensionError(409, 'Already connected. Disconnect to revoke this connection.', 'ALREADY_CLAIMED')
      if (['pending', 'approved'].includes(row.status)) this.db.prepare("UPDATE extension_pairing_requests SET status='cancelled' WHERE id=?").run(id)
      return this.inspect(id, serverOrigin, proof, origin)
    })()
  }

  claim(id: string, serverOrigin: string, proof: string, origin: string, token: string): { client_id: string } {
    return this.db.transaction(() => {
      const row = this.request(id, serverOrigin, proof, origin)
      // A claimed request may be retried after expiry, but only with BOTH original secrets and a
      // still-valid connection. After cleanup the extension can recover through authenticated /status.
      if (row.status === 'claimed') {
        const client = this.authenticate(token, origin)
        if (client.id !== row.client_id) throw new ExtensionError(409, 'This request was claimed with another credential.', 'CLAIM_CONFLICT')
        return { client_id: client.id }
      }
      if (row.status !== 'approved') throw new ExtensionError(409, `Connection request is ${row.status}.`, 'REQUEST_NOT_APPROVED')
      if (this.db.prepare('SELECT id FROM extension_clients WHERE token_hash=?').get(digest(token)))
        throw new ExtensionError(409, 'Use a fresh connection credential.', 'CLAIM_CONFLICT')
      const clientId = randomUUID()
      this.db.prepare('INSERT INTO extension_clients(id,token_hash,origin,created_at) VALUES (?,?,?,?)').run(clientId, digest(token), origin, new Date().toISOString())
      this.db.prepare("UPDATE extension_pairing_requests SET status='claimed',client_id=? WHERE id=?").run(clientId, id)
      return { client_id: clientId }
    })()
  }
}
