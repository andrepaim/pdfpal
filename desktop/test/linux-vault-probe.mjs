// Run only with a private DBus session and temporary HOME/XDG. The launcher is
// desktop/test/run-linux-vault-probe.mjs; no real account credentials.
import { app, safeStorage } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
import { protectedVault } from '../src/chatgpt/vault.mjs'

const root = process.env.PDFPAL_VAULT_TEST_ROOT
if (!root || !root.startsWith(path.join(os.tmpdir(), 'pdfpal-keyring-proof-')) || process.env.HOME !== path.join(root, 'home') || !process.env.DBUS_SESSION_BUS_ADDRESS) throw new Error('The keyring probe requires a dedicated temporary HOME and private DBus session')
app.setName('pdfpal Vault Acceptance')
app.setPath('userData', path.join(root, 'profile'))
app.whenReady().then(async () => { try {
  const available = await safeStorage.isAsyncEncryptionAvailable()
  const ciphertext = await safeStorage.encryptStringAsync('nonsecret synthetic protection probe')
  const prefix = ciphertext.subarray(0, 3).toString('ascii')
  const directory = path.join(root, 'vault-' + process.env.PDFPAL_VAULT_TEST_MODE)
  const vault = protectedVault(directory, safeStorage)
  let accepted = false
  let existingVaultRead = false
  try {
    existingVaultRead = !!await vault.read()
    if (process.env.PDFPAL_VAULT_TEST_EXISTING === '1') assert.equal(existingVaultRead, true)
    await vault.write({ access_token: 'synthetic-vault-acceptance-only' })
    assert.deepEqual(await vault.read(), { access_token: 'synthetic-vault-acceptance-only' })
    accepted = true
  } catch (error) {
    if (process.env.PDFPAL_VAULT_TEST_MODE !== 'fallback') throw error
    assert.match(error.message, /credential storage is unavailable/)
    await assert.rejects(fs.stat(path.join(directory, 'accounts.enc')), { code: 'ENOENT' })
    const saved = await fs.readFile(path.join(root, 'vault-secure', 'accounts.enc'))
    await assert.rejects(protectedVault(path.join(root, 'vault-secure'), safeStorage).read(), /credential storage is unavailable/)
    assert.deepEqual(await fs.readFile(path.join(root, 'vault-secure', 'accounts.enc')), saved)
  }
  if (process.env.PDFPAL_VAULT_TEST_MODE === 'secure') { assert.equal(accepted, true); assert.ok(['v11', 'v12'].includes(prefix)) }
  else { assert.equal(prefix, 'v10'); assert.equal(accepted, false) }
  await fs.writeFile(path.join(root, process.env.PDFPAL_VAULT_TEST_MODE + '.json'), JSON.stringify({ electron: process.versions.electron, available, prefix, vaultAccepted: accepted, existingVaultRead, syntheticCredentialsOnly: true, normalSandbox: !process.argv.includes('--no-sandbox') }, null, 2))
  app.exit(0)
} catch (error) { console.error(error); app.exit(1) } })
