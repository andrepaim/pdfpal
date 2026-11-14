export const chromeHeight = 44
/**
 * Window frame options. Windows hides the title bar and keeps native caption buttons on the right through the
 * overlay. A Mac uses a hidden-inset title bar: the traffic-light buttons stay on the left, drawn over the
 * in-window chrome, which leaves room for them (see desktop-chrome.css). Other platforms keep their frame.
 */
export function chromeOptions(platform) {
  if (platform === 'win32') return { titleBarStyle: 'hidden', titleBarOverlay: { color: '#171820', symbolColor: '#c9ccd8', height: chromeHeight } }
  // Centre the 14 px buttons in the 44 px bar.
  if (platform === 'darwin') return { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 15 } }
  return {}
}

/**
 * How the shell behaves on each platform.
 * - tray: Windows (and other platforms) keep running in the notification-area tray.
 * - dock: a Mac keeps running in the Dock instead; it never creates a tray (menu bar) icon.
 * - menu: 'none' removes Electron's default menu (Windows uses the in-window chrome), 'application' installs
 *   the native Mac menu bar, 'default' leaves Electron's menu untouched.
 * - inputShortcuts: Windows handles window shortcuts in `before-input-event` (chromeShortcut). A Mac uses only
 *   the application menu's accelerators, so no shortcut is handled twice.
 */
export function desktopShell(platform) {
  if (platform === 'darwin') return { tray: false, dock: true, menu: 'application', inputShortcuts: false, closeNotice: false, loginItems: true }
  return { tray: true, dock: false, menu: platform === 'win32' ? 'none' : 'default', inputShortcuts: platform === 'win32', closeNotice: true, loginItems: platform === 'win32' }
}

/** Skip the startup document and any history entry outside this local reader. */
export function readerHistoryTarget(entries, index, offset, origin) {
  const target = index + offset
  if (!origin || target < 0 || target >= entries.length) return
  try { if (new URL(entries[target].url).origin === origin) return target } catch {}
}

/** Commands the renderer may send through `pdfpal:chrome-command`. None of them carry data. */
export const chromeCommands = ['back','forward','zoom-in','zoom-out','zoom-reset','fullscreen','open-browser','quit','menu','find','home','ai-settings','feedback']

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

/**
 * Window shortcuts read in the main process's `before-input-event` (Windows only). On a Mac the application
 * menu's accelerators (macShortcuts) are the single mechanism, so this returns nothing there: a key is never
 * handled by both the menu and the input hook.
 */
export function chromeShortcut(input, platform = 'win32') {
  if (platform === 'darwin') return
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

/**
 * Mac keyboard shortcuts, as Electron accelerators on application-menu items. Command replaces Control;
 * back and forward use Command-[ and Command-] (Safari and Finder), full screen uses Control-Command-F
 * through the standard role. There is no F10 or F11 dependence.
 */
export const macShortcuts = {
  'ai-settings': 'Command+,', quit: 'Command+Q', find: 'Command+K', home: 'Shift+Command+H',
  back: 'Command+[', forward: 'Command+]', 'zoom-in': 'Command+=', 'zoom-out': 'Command+-', 'zoom-reset': 'Command+0',
}

/**
 * The Mac application menu as plain data. `action` names a handler that main.mjs binds with bindMenu; every
 * handler reuses an existing path (chromeCommand or the tray actions). Roles are Electron's standard items:
 * without the Edit roles, copy and paste shortcuts do not work in a Mac Electron app.
 */
export function applicationMenuTemplate({ name = 'pdfpal', ready = false, booting = false, openAtLogin = false, packaged = true } = {}) {
  const retry = !ready && !booting
  const item = (id, label, extra = {}) => ({ id, label, action: id, ...(macShortcuts[id] ? { accelerator: macShortcuts[id] } : {}), ...extra })
  return [
    { label: name, submenu: [
      { role: 'about', label: `About ${name}` },
      { type: 'separator' },
      item('ai-settings', 'AI Settings…', { enabled: ready }),
      item('updates', 'Check for Updates…'),
      item('open-at-login', 'Open at Login', { type: 'checkbox', checked: ready && openAtLogin, enabled: ready }),
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide', label: `Hide ${name}` }, { role: 'hideOthers' }, { role: 'unhide' },
      { type: 'separator' },
      item('quit', `Quit ${name}`),
    ] },
    { label: 'Edit', submenu: [
      { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'pasteAndMatchStyle' }, { role: 'delete' }, { role: 'selectAll' },
    ] },
    { label: 'View', submenu: [
      item('zoom-reset', 'Actual Size'),
      item('zoom-in', 'Zoom In'),
      // Command-Plus (Shift on most layouts) reaches the same action without a second visible item.
      { id: 'zoom-in-plus', label: 'Zoom In', action: 'zoom-in', accelerator: 'Command+Plus', visible: false, acceleratorWorksWhenHidden: true },
      item('zoom-out', 'Zoom Out'),
      { type: 'separator' },
      { role: 'togglefullscreen' },
      // Development runs only; a packaged build has no reload or developer tools.
      ...(packaged ? [] : [{ type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }]),
    ] },
    { label: 'Go', submenu: [
      item('home', 'All Projects', { enabled: ready }),
      item('find', 'Find a Project…', { enabled: ready }),
      { type: 'separator' },
      item('back', 'Back', { enabled: ready }),
      item('forward', 'Forward', { enabled: ready }),
    ] },
    { label: 'Window', role: 'window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }] },
    { label: 'Help', role: 'help', submenu: [
      item('feedback', 'Send Feedback…'),
      item('diagnostics', 'Diagnostics'),
      item('retry', 'Retry Service', { visible: retry }),
      { type: 'separator' },
      item('open-browser', 'Open in Browser', { enabled: ready }),
      item('licenses', 'Open-Source Licenses'),
    ] },
  ]
}

/** The Dock icon's menu. macOS adds the window list, Options, Hide and Quit itself. */
export function dockMenuTemplate({ ready = false, booting = false } = {}) {
  return [
    { id: 'open-browser', label: 'Open in Browser', action: 'open-browser', enabled: ready },
    { id: 'retry', label: 'Retry Service', action: 'retry', enabled: !ready && !booting },
  ]
}

/** Replace each `action` name with a click handler. An action without a handler is a programming error. */
export function bindMenu(template, handlers) {
  return template.map(({ action, submenu, ...item }) => {
    if (action !== undefined && (!Object.hasOwn(handlers, action) || typeof handlers[action] !== 'function')) throw new Error(`No handler for menu action ${action}`)
    return { ...item, ...(submenu ? { submenu: bindMenu(submenu, handlers) } : {}), ...(action !== undefined ? { click: menuItem => handlers[action](menuItem) } : {}) }
  })
}

/**
 * Offer to move a Mac app into /Applications. macOS runs an app opened from a disk image or from Downloads
 * from a randomised, read-only location (App Translocation) until it is moved. That path changes between
 * launches, so "Open at login" and the ~/.local/bin/pdfpal link to the bundled CLI launcher would point at a
 * location that disappears. Never ask in unpackaged development runs or automated smoke and acceptance runs.
 * `inApplications` is called last, so Electron's Mac-only check runs only when everything else allows a prompt.
 */
export function shouldOfferApplicationsMove({ platform, packaged, automated, declined, inApplications }) {
  if (platform !== 'darwin' || !packaged || automated || declined) return false
  return !(typeof inApplications === 'function' ? inApplications() : inApplications)
}

/** User-visible text from the main process that differs by platform. A Mac never sees "Windows". */
export function desktopText(platform) {
  const mac = platform === 'darwin'
  return {
    chatgptLocked: mac ? 'The saved ChatGPT connection could not be unlocked from your Keychain. Reconnect in AI settings.' : 'Windows could not unlock the saved connection. Reconnect in AI settings.',
    cliCheckFailed: mac ? 'The bundled CLI could not be checked. Reinstall pdfpal from its disk image.' : 'The bundled CLI could not be checked. Repair the Windows installation.',
    actionFailed: 'This action could not finish. Save your changes and try again.',
    ...(mac ? {
      moveMessage: 'Move pdfpal to your Applications folder?',
      moveDetail: 'pdfpal is running from a temporary location. Moving it to Applications lets Open at Login and the pdfpal command keep working after you eject the disk image or empty Downloads.',
      moveButton: 'Move to Applications', moveLater: 'Not Now', moveNeverAsk: 'Do not ask again',
      moveReplace: 'Another copy of pdfpal is already in Applications. Replace it with this version?', moveReplaceButton: 'Replace', moveCancel: 'Cancel',
      moveFailedTitle: 'pdfpal could not be moved', moveFailed: 'Drag pdfpal into your Applications folder in Finder, then open it from there.',
    } : {
      closeNoticeTitle: 'pdfpal is still running', closeNoticeBody: 'Reopen pdfpal from the tray. Choose Quit there to stop it.',
    }),
  }
}
