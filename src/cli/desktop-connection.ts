import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { PdfpalError } from '../core/types.js'
import { CLI_PROTOCOL, cliPipeName, type RuntimeIdentity } from '../shared/cli-protocol.js'
import { localJson } from './local-http.js'
import { identityProof } from '../shared/cli-auth.js'

export interface DesktopOptions { profile?: string; library?: string; expectLibrary?: string }
export interface DesktopLibrary { id: string; label: string; dataDir: string; dbPath: string }
export function desktopProfile(explicit?: string): string {
  if (explicit) return path.resolve(explicit)
  if (process.env.PDFPAL_DESKTOP_PROFILE) return path.resolve(process.env.PDFPAL_DESKTOP_PROFILE)
  if (process.platform !== 'win32') throw new PdfpalError('WINDOWS_HOST_REQUIRED', 'Use the native Windows pdfpal launcher for the Windows library. In WSL, use the Windows adapter.', 2)
  return path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'pdfpal-desktop')
}
export function desktopLibraries(options: DesktopOptions) {
  const profile = desktopProfile(options.profile)
  let settings: any
  try { settings = JSON.parse(fs.readFileSync(path.join(profile, 'desktop.json'), 'utf8')) }
  catch { throw new PdfpalError('DESKTOP_PROFILE_NOT_FOUND', 'Open the updated pdfpal Windows app once to register its library.', 3) }
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new PdfpalError('INVALID_DESKTOP_PROFILE', 'The desktop library settings are invalid.', 2)
  const active = settings.activeLibrary ?? 'original', known = settings.libraries ?? {}
  const libraries: DesktopLibrary[] = Object.entries(known).flatMap(([id, item]: [string, any]) => {
    if (!(id === 'original' || /^[a-f0-9-]{36}$/.test(id)) || !item || typeof item.label !== 'string' || typeof item.dataDir !== 'string' || typeof item.dbPath !== 'string' || !path.isAbsolute(item.dataDir) || !path.isAbsolute(item.dbPath)) return []
    return [{ id, label: item.label, dataDir: item.dataDir, dbPath: item.dbPath }]
  })
  const selected = libraries.find(item => item.id === (options.library ?? active))
  if (!selected) throw new PdfpalError('LIBRARY_NOT_REGISTERED', 'The selected library is not registered. Open the updated desktop app and check its library settings.', 3)
  if (selected.id !== active) throw new PdfpalError('LIBRARY_NOT_ACTIVE', 'Switch to the requested library in pdfpal before using it from ChatGPT.', 4)
  return { profile, active, libraries, selected }
}

export interface DesktopStatus extends RuntimeIdentity { cliProtocol: number; build: string; schema: number; capabilities: string[] }
export class DesktopConnection {
  private constructor(readonly selection: ReturnType<typeof desktopLibraries>, readonly status: DesktopStatus,
    private readonly origin: string, private readonly token: string, private readonly pipe?: string) {}
  get transport() { return this.pipe ? 'windows-pipe' : 'loopback-http' }
  static async connect(options: DesktopOptions) {
    if (process.env.PDFPAL_DATA_DIR || process.env.PDFPAL_DB) throw new PdfpalError('CONFLICTING_LIBRARY_OPTIONS', 'Desktop mode uses the app profile. Remove PDFPAL_DATA_DIR/PDFPAL_DB or select standalone mode.', 2)
    const selection = desktopLibraries(options)
    let canonical: string, owner: any
    try {
      canonical = fs.realpathSync.native(selection.selected.dbPath)
      owner = JSON.parse(fs.readFileSync(canonical + '.server.json', 'utf8'))
    } catch { throw new PdfpalError('DESKTOP_NOT_RUNNING', 'Start pdfpal for this library, then retry. The tray app can stay in the background.', 3) }
    const library = createHash('sha256').update(canonical).digest('hex')
    if (options.expectLibrary && options.expectLibrary !== library) throw new PdfpalError('LIBRARY_MISMATCH', 'The active desktop library changed. Check status before continuing.', 4)
    let url: URL
    try { url = new URL(owner.origin) } catch { throw new PdfpalError('INVALID_RUNTIME', 'The local runtime discovery record is invalid.', 4) }
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash || owner.library !== library || typeof owner.secret !== 'string' || typeof owner.instance !== 'string')
      throw new PdfpalError('INVALID_RUNTIME', 'The local runtime does not match this library.', 4)
    let pipe: string | undefined
    if (process.platform === 'win32') {
      if (!/^[a-f0-9-]{36}$/.test(owner.instance) || owner.cliPipe !== cliPipeName(owner.instance)) throw new PdfpalError('CLI_UPGRADE_REQUIRED', 'Install the Windows pdfpal update that includes the private CLI channel.', 4)
      pipe = owner.cliPipe
    }
    let identity: RuntimeIdentity & { proof?: string }
    const challenge = randomBytes(32).toString('hex')
    try {
      const response = await localJson(url.origin + '/api/runtime/identity', { 'x-pdfpal-challenge': challenge }, undefined, 8000, pipe)
      if (!response.ok) throw new PdfpalError('LIBRARY_MISMATCH', 'The runtime discovery record no longer matches the running app. Check status again.', 4)
      identity = response.value
    } catch (error) {
      if (error instanceof PdfpalError) throw error
      const failure = error as { name?: string; code?: string; cause?: { code?: string } }
      const code = failure.code ?? failure.cause?.code ?? ''
      throw new PdfpalError('DESKTOP_NOT_RUNNING', 'The registered pdfpal service did not respond. Open pdfpal and check its status.', 3,
        { reason: failure.code === 'ETIMEDOUT' || failure.name === 'TimeoutError' ? 'TIMEOUT' : /^[A-Z_0-9]{1,60}$/.test(code) ? code : 'CONNECTION_FAILED' })
    }
    if (identity?.library !== library || identity.instance !== owner.instance || identity.protocol !== 1 || typeof identity.proof !== 'string' || !/^[a-f0-9]{64}$/.test(identity.proof)
      || !timingSafeEqual(Buffer.from(identity.proof, 'hex'), Buffer.from(identityProof(owner.secret, challenge, identity), 'hex')))
      throw new PdfpalError('LIBRARY_MISMATCH', 'The running service could not prove its identity. Check status before continuing.', 4)
    if (typeof owner.cliSecret !== 'string' || !/^[a-f0-9-]{36}$/.test(owner.cliSecret)) throw new PdfpalError('CLI_UPGRADE_REQUIRED', 'Install the Windows pdfpal update that includes CLI integration.', 4)
    const connection = new DesktopConnection(selection, { ...identity, cliProtocol: CLI_PROTOCOL, schema: 0, build: '', capabilities: [] }, url.origin, owner.cliSecret, pipe)
    const status = await connection.request('/status') as DesktopStatus
    if (status.cliProtocol !== CLI_PROTOCOL) throw new PdfpalError('CLI_PROTOCOL_MISMATCH', 'Update the CLI and Windows app together.', 4)
    if (process.env.PDFPAL_DESKTOP_BUILD && status.build !== process.env.PDFPAL_DESKTOP_BUILD) throw new PdfpalError('CLI_BUILD_MISMATCH', 'This launcher and the running desktop app have different builds. Restart the updated pdfpal app.', 4)
    return new DesktopConnection(selection, status, url.origin, owner.cliSecret, pipe)
  }
  async request(route: string, body?: unknown, operationId?: string): Promise<any> {
    try {
      const response = await localJson(this.origin + '/api/cli/v1' + route,
        { 'x-pdfpal-cli': this.token, 'x-pdfpal-library': this.status.library, 'x-pdfpal-instance': this.status.instance }, body, 120000, this.pipe)
      const result = response.value
      if (!response.ok) throw new PdfpalError(result.code ?? 'CLI_REQUEST_FAILED', result.detail ?? 'The local command failed.', [1,2,3,4].includes(result.exitCode) ? result.exitCode : response.status === 404 ? 3 : response.status >= 500 ? 1 : response.status === 409 ? 4 : 2, result.details)
      return result
    } catch (error) {
      if (error instanceof PdfpalError) throw error
      throw new PdfpalError('CLI_CONNECTION_LOST', operationId ? 'The local request did not finish. Check its operation receipt before retrying; it may already have succeeded.' : 'The local service did not respond. Check pdfpal and retry this read command.', operationId ? 4 : 3, operationId ? { operationId, library: this.status.library } : undefined)
    }
  }
}
