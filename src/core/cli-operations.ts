import { createHash, randomUUID } from 'node:crypto'
import type { Database } from 'better-sqlite3'
import { PdfpalError } from './types.js'
import type { CliReceipt } from '../shared/cli-protocol.js'

export function installCliOperations(db: Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS cli_operations (
    id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, resource_id TEXT NOT NULL,
    state TEXT NOT NULL, result_json TEXT, error_json TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );`)
}

interface Row { id: string; fingerprint: string; resource_id: string; state: CliReceipt['state']; result_json: string | null; error_json: string | null; created_at: string; updated_at: string }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => JSON.stringify(key) + ':' + canonical(item)).join(',') + '}'
  return JSON.stringify(value)
}

/** Receipts are local only. Compact anti-replay records survive result expiry. */
export class CliOperations {
  private lastPrune = 0
  constructor(private readonly db: Database, private readonly library: string) {
    db.prepare("UPDATE cli_operations SET state='interrupted',updated_at=? WHERE state='running'").run(new Date().toISOString())
    this.prune()
  }
  private prune() {
    if (Date.now() - this.lastPrune < 60000) return
    this.lastPrune = Date.now()
    this.db.prepare(`UPDATE cli_operations SET result_json=NULL,error_json=NULL WHERE state!='running' AND (result_json IS NOT NULL OR error_json IS NOT NULL) AND
      (updated_at<? OR id NOT IN (SELECT id FROM cli_operations ORDER BY updated_at DESC LIMIT 1000))`)
      .run(new Date(Date.now() - 30 * 86400000).toISOString())
  }
  private row(id: string) { return this.db.prepare('SELECT * FROM cli_operations WHERE id=?').get(id) as Row | undefined }
  get(id: string): CliReceipt {
    const row = this.row(id)
    if (!row) throw new PdfpalError('OPERATION_NOT_FOUND', 'No receipt was found. Do not assume a timed-out action failed; inspect the library before submitting a new operation.', 3)
    return { operationId: id, library: this.library, state: row.state, createdAt: row.created_at, updatedAt: row.updated_at,
      ...(row.result_json ? { result: JSON.parse(row.result_json) } : row.state === 'completed' ? { resultExpired: true } : {}), ...(row.error_json ? { error: JSON.parse(row.error_json) } : {}) }
  }
  begin(id: string, action: string, args: unknown, retry: boolean): { fresh: boolean; resourceId: string; receipt: CliReceipt } {
    this.prune()
    const fingerprint = createHash('sha256').update(canonical({ action, args })).digest('hex')
    return this.db.transaction(() => {
      const old = this.row(id)
      if (old) {
        if (old.fingerprint !== fingerprint) throw new PdfpalError('OPERATION_CONFLICT', 'This operation ID was already used with different arguments.', 4)
        if (old.state === 'completed' && !old.result_json) throw new PdfpalError('OPERATION_EXPIRED', 'This operation completed, but its detailed receipt expired. Inspect the library; it will not be run again.', 4)
        if (retry && ['interrupted', 'failed'].includes(old.state)) {
          this.db.prepare("UPDATE cli_operations SET state='running',error_json=NULL,updated_at=? WHERE id=?").run(new Date().toISOString(), id)
          return { fresh: true, resourceId: old.resource_id, receipt: this.get(id) }
        }
        return { fresh: false, resourceId: old.resource_id, receipt: this.get(id) }
      }
      if (retry) throw new PdfpalError('OPERATION_NOT_FOUND', 'An explicit retry requires an existing receipt.', 3)
      const time = new Date().toISOString(), resourceId = randomUUID()
      this.db.prepare("INSERT INTO cli_operations VALUES(?,?,?,'running',NULL,NULL,?,?)").run(id, fingerprint, resourceId, time, time)
      return { fresh: true, resourceId, receipt: this.get(id) }
    }).immediate()
  }
  complete(id: string, result: unknown) {
    this.db.prepare("UPDATE cli_operations SET state='completed',result_json=?,error_json=NULL,updated_at=? WHERE id=? AND state='running'")
      .run(JSON.stringify(result), new Date().toISOString(), id)
  }
  fail(id: string, error: unknown) {
    const known = error instanceof PdfpalError ? error : new PdfpalError('CLI_OPERATION_FAILED', 'The operation could not finish. Inspect its receipt and retry explicitly.')
    this.db.prepare("UPDATE cli_operations SET state='failed',error_json=?,updated_at=? WHERE id=? AND state='running'")
      .run(JSON.stringify({ code: known.code, message: known.message, exitCode: known.exitCode, ...(known.details === undefined ? {} : { details: known.details }) }), new Date().toISOString(), id)
  }
}
