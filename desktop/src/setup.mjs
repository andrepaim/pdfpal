import fs from 'node:fs'
import path from 'node:path'

export const providers = {
  claude: { label: 'Claude Code', docs: 'https://code.claude.com/docs/en/setup', installer: 'https://claude.ai/install.ps1', login: ['auth', 'login'] },
  codex: { label: 'Codex', docs: 'https://learn.chatgpt.com/docs/codex/cli', installer: 'https://chatgpt.com/codex/install.ps1', login: ['login'] },
}
export function provider(id) {
  if (!Object.hasOwn(providers, id)) throw new Error('Unsupported assistant')
  return providers[id]
}
const psQuote = value => `'${value.replaceAll("'", "''")}'`
/** Only main-process discovered paths and fixed, official commands reach PowerShell. */
export function setupScript(id, action, executable) {
  const item = provider(id)
  if (!['install', 'login'].includes(action)) throw new Error('Unsupported action')
  if (action === 'login' && (!path.win32.isAbsolute(executable ?? '') || !/\.exe$/i.test(executable))) throw new Error('Choose an installed executable first')
  const command = action === 'install'
    ? `Invoke-RestMethod ${psQuote(item.installer)} | Invoke-Expression`
    : `& ${psQuote(executable)} ${item.login.join(' ')}`
  return `$ErrorActionPreference = 'Stop'\ntry {\n${command}\nWrite-Host '\nReturn to pdfpal and choose Check again.'\n} catch { Write-Host 'Setup did not complete. See the official setup guide in pdfpal.' }\n`
}
export function trustedSender(event, window, origin, recoveryURL) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) return false
  try { return !!((origin && new URL(event.senderFrame.url).origin === origin) || (recoveryURL && event.senderFrame.url === recoveryURL)) } catch { return false }
}
export function recoveryMessage(code) {
  if (['EADDRINUSE', 'SERVER_ALREADY_RUNNING'].includes(code)) return { title: 'Another local service is already running', detail: 'Close the other pdfpal server or the application using its port, then retry. Your library has not been replaced.' }
  if (['EACCES', 'EPERM', 'SQLITE_CANTOPEN', 'SQLITE_READONLY'].includes(code)) return { title: 'Your library could not be opened', detail: 'Check that your library folder is available and writable, then retry.' }
  if (/SCHEMA|DATABASE_VERSION|NEWER_DATABASE/.test(code ?? '')) return { title: 'This library needs a newer pdfpal', detail: 'Open the library with the same or a newer version of pdfpal. Your library has not been changed.' }
  if (code === 'STARTING') return { title: 'Starting pdfpal…', detail: 'Opening your library. This can take a little longer after an update.' }
  return { title: 'The local service needs attention', detail: 'Retry to reopen your library. Saved notes and answers remain in your library. Interrupted questions are not sent again automatically.' }
}
const eventCodes = new Set(['STARTING', 'READY', 'BACKEND_STOPPED', 'START_FAILED', 'TEST_PASSED', 'TEST_FAILED', 'TEST_CANCELLED', 'SETUP_LAUNCHED', 'SETUP_FAILED', 'PREFERENCES_FAILED'])
/** A small allowlisted event log. Never accepts messages, URLs, paths or provider output. */
export function diagnostics(filename) {
  let events = []
  try { events = JSON.parse(fs.readFileSync(filename, 'utf8')).filter(event => eventCodes.has(event.code) && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(event.at)).slice(-50).map(({ at, code }) => ({ at, code })) } catch {}
  return {
    record(code) {
      if (!eventCodes.has(code)) return
      events.push({ at: new Date().toISOString(), code }); events = events.slice(-50)
      try { fs.writeFileSync(filename, JSON.stringify(events), { mode: 0o600 }) } catch {}
    },
    preview(version, agents = []) {
      return { format: 1, appVersion: version, platform: process.platform, arch: process.arch, electron: process.versions.electron,
        agents: agents.filter(item => Object.hasOwn(providers, item.id)).map(item => ({ id: item.id,
          state: ['installed', 'unusable', 'missing', 'unsupported'].includes(item.state) ? item.state : 'unknown',
          auth: ['account', 'api', 'external', 'signed_out'].includes(item.auth) ? item.auth : 'unknown',
          version: /^\d+\.\d+\.\d+(?:[-+][\w.]+)?$/.test(item.version ?? '') ? item.version : undefined })), events: [...events] }
    },
  }
}
