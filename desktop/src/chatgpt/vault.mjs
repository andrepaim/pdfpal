import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const unavailable = platform => platform === 'linux'
  ? 'Secure credential storage is unavailable. Unlock or configure your desktop Secret Service keyring, then reconnect in settings.'
  : `${platform === 'win32' ? 'Windows' : 'System'} credential protection is unavailable. Reconnect in settings.`

// Electron 45's asynchronous availability check also accepts Chromium's POSIX
// hardcoded-key fallback. Its synchronous backend name describes a different
// encryptor. Inspect the *asynchronous ciphertext*: v10 is the fallback; v11 is
// Secret Service/KWallet; v12 is the Secret portal. Unknown formats fail closed.
// See Electron v45.1.0 browser_process_impl.cc and Chromium's async key providers.
function secureCiphertext(value, platform) {
  if (!Buffer.isBuffer(value) || !value.length || (platform === 'linux' && !['v11', 'v12'].includes(value.subarray(0, 3).toString('ascii')))) throw new Error(unavailable(platform))
  return value
}

export function protectedVault(directory, storage, { platform = process.platform } = {}) {
  const filename = path.join(directory, 'accounts.enc')
  async function checkAvailable() {
    if (!await storage.isAsyncEncryptionAvailable()) throw new Error(unavailable(platform))
    // Probe without secrets; availability can change after keyring lock/unlock.
    if (platform === 'linux') secureCiphertext(await storage.encryptStringAsync('pdfpal credential protection check'), platform)
  }
  async function write(value) {
    await checkAvailable()
    const encrypted = secureCiphertext(await storage.encryptStringAsync(JSON.stringify(value)), platform)
    await fs.mkdir(directory, { recursive: true, mode: 0o700 })
    const temporary = `${filename}.${randomUUID()}.tmp`
    try {
      await fs.writeFile(temporary, encrypted, { mode: 0o600, flag: 'wx' })
      await fs.rename(temporary, filename)
    } finally { await fs.rm(temporary, { force: true }) }
  }
  return {
    async read() {
      let encrypted
      try { encrypted = await fs.readFile(filename) } catch (error) { if (error.code === 'ENOENT') return null; throw new Error('The saved connection could not be read. Reconnect in settings.') }
      await checkAvailable()
      secureCiphertext(encrypted, platform)
      try {
        const decrypted = await storage.decryptStringAsync(encrypted)
        const value = JSON.parse(decrypted.result)
        if (decrypted.shouldReEncrypt) await write(value)
        return value
      } catch { throw new Error('The saved connection could not be unlocked. Unlock your system credential store and reconnect in settings.') }
    },
    write,
  }
}
