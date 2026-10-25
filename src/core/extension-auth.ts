import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { Database } from 'better-sqlite3'

export const digest = (value: string) => createHash('sha256').update(value).digest('hex')
export class ExtensionError extends Error {
  constructor(public readonly status: number, message: string) { super(message) }
}
export type ExtensionClient = { id: string; origin: string; created_at: string; revoked_at: string | null }

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
    const client = this.db.prepare('SELECT id,origin,created_at,revoked_at FROM extension_clients WHERE token_hash=? AND revoked_at IS NULL').get(digest(token)) as ExtensionClient | undefined
    if (!client || (origin && client.origin !== origin)) throw new ExtensionError(401, 'Connect the extension to pdfpal again. This connection is invalid or revoked.')
    return client
  }

  list(): ExtensionClient[] {
    return this.db.prepare('SELECT id,origin,created_at,revoked_at FROM extension_clients ORDER BY created_at DESC').all() as ExtensionClient[]
  }

  revoke(id: string): void {
    const result = this.db.prepare('UPDATE extension_clients SET revoked_at=? WHERE id=?').run(new Date().toISOString(), id)
    if (!result.changes) throw new ExtensionError(404, 'Extension connection not found.')
  }
}
