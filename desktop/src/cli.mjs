import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
const metadata = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
process.env.PDFPAL_CLI_DESKTOP = '1'
process.env.PDFPAL_DESKTOP_BUILD = metadata.version
process.env.PDFPAL_DESKTOP_PROFILE ??= path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), metadata.pdfpalDesktop?.cloudPreview ? 'pdfpal-cloud-preview' : 'pdfpal-desktop')
await import('./dist/cli/index.js')
