/** Local command protocol. Independent of package and SQLite schema versions. */
export const CLI_PROTOCOL = 1
export const cliPipeName = (instance: string) => '\\\\.\\pipe\\pdfpal-cli-' + instance
export const CLI_CAPABILITIES = ['projects', 'sources', 'collections', 'notes', 'search', 'highlights', 'source-text', 'trash', 'backups', 'operation-receipts', 'change-revision', 'json-argv'] as const
export interface RuntimeIdentity { protocol: number; instance: string; library: string }
export interface CliReceipt {
  operationId: string
  library: string
  state: 'running' | 'completed' | 'failed' | 'interrupted'
  result?: unknown
  resultExpired?: boolean
  error?: { code: string; message: string; exitCode: number; details?: unknown }
  createdAt: string
  updatedAt: string
}
