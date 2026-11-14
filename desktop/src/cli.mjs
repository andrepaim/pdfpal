import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
const metadata = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
process.env.PDFPAL_CLI_DESKTOP = '1'
process.env.PDFPAL_DESKTOP_BUILD = metadata.version
// Electron's appData folder, as used by main.mjs for the app profile.
const appData = process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support') : process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming')
process.env.PDFPAL_DESKTOP_PROFILE ??= path.join(appData, metadata.pdfpalDesktop?.cloudPreview ? 'pdfpal-cloud-preview' : 'pdfpal-desktop')
await import('./dist/cli/index.js')
