export const chromeHeight = 44
/** Shared app navigation is independent of the operating system's window frame. */
export function chromeCapabilities(platform) {
  return { sharedMenu: platform === 'win32' || platform === 'linux', titleBarOverlay: platform === 'win32' }
}
/** The Linux recovery document retains its native menu when the shared reader is absent. */
export function nativeMenuRequired(platform, readerActive) {
  return !chromeCapabilities(platform).sharedMenu || (platform === 'linux' && !readerActive)
}
export function chromeOptions(platform) {
  return platform === 'win32' ? { titleBarStyle: 'hidden', titleBarOverlay: { color: '#171820', symbolColor: '#c9ccd8', height: chromeHeight } } : {}
}

/** Skip the startup document and any history entry outside this local reader. */
export function readerHistoryTarget(entries, index, offset, origin) {
  const target = index + offset
  if (!origin || target < 0 || target >= entries.length) return
  try { if (new URL(entries[target].url).origin === origin) return target } catch {}
}

/** Commands the renderer may send through `pdfpal:chrome-command`. None of them carry data. */
export const chromeCommands = ['back','forward','zoom-in','zoom-out','zoom-reset','fullscreen','open-browser','quit','menu','find','home','ai-settings','feedback','diagnostics','licenses','startup-toggle']

export const feedbackIssueBase = 'https://github.com/andrepaim/pdfpal/issues/new'
const versionToken = value => typeof value === 'string' && /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$/.test(value) ? value : 'unknown'

/** Name the operating system from the platform and its version number only (e.g. "Windows 11 (10.0.22631)"). */
export function systemDescription(platform, release) {
  const version = versionToken(release)
  if (platform === 'win32') {
    const build = Number(version.split('.')[2])
    return `${version.startsWith('10.') && build >= 22000 ? 'Windows 11' : version.startsWith('10.') ? 'Windows 10' : 'Windows'} (${version})`
  }
  return `${({ darwin: 'macOS', linux: 'Linux' })[platform] ?? 'Other'} ${version}`
}

/**
 * Build the prefilled "Send feedback" issue. It carries only the pdfpal version, the operating system
 * version and fixed template text; the reader reviews and edits it on GitHub before anything is sent.
 */
export function feedbackIssueURL({ version, platform, release }) {
  const url = new URL(feedbackIssueBase)
  url.searchParams.set('title', 'Feedback: ')
  url.searchParams.set('body', [
    '**What happened?**',
    '<!-- Describe what you were doing and what you saw. Please do not paste private document text, file paths, or account details. -->',
    '',
    '',
    '**What did you expect?**',
    '',
    '',
    '---',
    `pdfpal version: ${versionToken(version)}`,
    `Operating system: ${systemDescription(platform, release)}`,
  ].join('\n'))
  return url.toString()
}

export function chromeShortcut(input) {
  if (input.type !== 'keyDown') return
  const key = input.key.toLowerCase()
  if (!input.control && !input.meta && !input.alt && !input.shift) {
    if (key === 'f10') return 'menu'
    if (key === 'f11') return 'fullscreen'
  }
  if (input.alt && !input.control && !input.meta && !input.shift) {
    if (key === 'arrowleft') return 'back'
    if (key === 'arrowright') return 'forward'
  }
  if (!input.control || input.alt || input.meta) return
  if (input.shift && key === 'h') return 'home'
  if (['+','='].includes(key)) return 'zoom-in'
  if (key === '-') return 'zoom-out'
  if (input.shift) return
  return ({ k:'find', ',':'ai-settings', q:'quit', '0':'zoom-reset' })[key]
}
