import fs from 'node:fs'
import { defaultDesktopProfile } from './dist/shared/desktop-profile.js'
const metadata = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
process.env.PDFPAL_CLI_DESKTOP = '1'
process.env.PDFPAL_DESKTOP_BUILD = metadata.version
process.env.PDFPAL_DESKTOP_PROFILE ??= defaultDesktopProfile({ preview: !!metadata.pdfpalDesktop?.cloudPreview })
await import('./dist/cli/index.js')
