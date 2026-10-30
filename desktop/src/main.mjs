import { app, BrowserWindow, utilityProcess, Tray, Menu, nativeImage, nativeTheme, Notification, dialog, shell, screen, ipcMain } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import { provider, setupScript, trustedSender, recoveryMessage, diagnostics } from './setup.mjs'
import { checkDesktopUpdates, releasePage } from './updates.mjs'
import { preferences, restoreBounds, restoreLibraryRoute, safeRoute, startupArguments } from './preferences.mjs'
import { betaOptions, betaAcceptance } from './beta-acceptance.mjs'

const root = path.dirname(fileURLToPath(import.meta.url))
const metadata = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).pdfpalDesktop ?? {}
const applicationId = metadata.appId ?? 'io.pdfpal.desktop'
let beta
if (process.argv.includes('--beta-acceptance')) {
  try { beta = betaOptions(metadata) }
  catch { console.error('Beta acceptance requires isolated metadata and a matching temporary library/profile.'); app.exit(2) }
}
const installationCheck = process.argv.includes('--installer-acceptance')
const m2 = process.argv.includes('--m2-smoke')
const m1 = m2 || process.argv.includes('--m1-smoke')
const smoke = installationCheck || m1 || process.argv.includes('--m0-smoke')
const temporary = smoke && !installationCheck ? fs.mkdtempSync(path.join(os.tmpdir(), 'pdfpal-desktop-')) : undefined
if (temporary) {
  process.env.PDFPAL_DATA_DIR = temporary
  process.env.PDFPAL_DB = path.join(temporary, 'pdfpal.db')
  process.env.PDFPAL_DESKTOP_PROFILE ??= `${temporary}-profile`
}
for (const [flag, env] of [['--data-dir=', 'PDFPAL_DATA_DIR'], ['--db=', 'PDFPAL_DB'], ['--port=', 'PDFPAL_PORT'], ['--profile=', 'PDFPAL_DESKTOP_PROFILE']]) {
  const arg = process.argv.find(value => value.startsWith(flag))
  if (arg) process.env[env] = arg.slice(flag.length)
}
app.setName('pdfpal')
nativeTheme.themeSource = 'dark'
const profile = process.env.PDFPAL_DESKTOP_PROFILE ?? path.join(app.getPath('appData'), 'pdfpal-desktop')
fs.mkdirSync(profile, { recursive: true })
app.setPath('userData', profile)
if (process.platform === 'win32') app.setAppUserModelId(applicationId)
const prefs = preferences(path.join(app.getPath('userData'), 'desktop.json'))
let backend, window, tray, ready, pendingReceipt, stopping = false, exited = true, booting = false, crashRetries = 0, secondLaunches = 0
const recoveryURL = pathToFileURL(path.join(root, 'recovery.html')).href
const journal = diagnostics(path.join(profile, 'diagnostics.json'))
let lastAgents = [], diagnosticPreview, setupProcess, setupPending = false, loadedOrigin, failureCode = 'STARTING', existingOrigin
let serviceState = { state: 'starting' }
let testing = false, testEpoch = 0
let updateState = { state: 'idle', currentVersion: app.getVersion(), distribution: metadata.distribution ?? 'unsigned' }, updateRequest
let recoveryScreenPassed = false
let recoveryFixture
const shutdownPhases = []
let restoreWindowState = false
const pending = new Map()
let rpcId = 0
let warnedPreferences = false
const ownedOrigin = url => { try { return ready && new URL(url).origin === ready.origin } catch { return false } }

function rpc(command, extra = {}) {
  if (!backend || exited) return Promise.reject(new Error('pdfpal is not running'))
  return new Promise((resolve, reject) => {
    const id = ++rpcId
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('The local service did not respond. Retry.')) }, command === 'test-connection' ? 65000 : 30000)
    pending.set(id, { resolve, reject, timer })
    backend.postMessage({ type: 'rpc', id, command, ...extra })
  })
}
function rejectPending() {
  for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('The local service stopped. Retry.')) }
  pending.clear()
}
function notify(title, body) { if (!smoke && Notification.isSupported()) new Notification({ title, body }).show() }
function savePrefs(patch) {
  try { prefs.update(patch) }
  catch (error) {
    if (smoke) throw error
    journal.record('PREFERENCES_FAILED')
    if (!warnedPreferences) { warnedPreferences = true; notify('pdfpal settings could not be saved', 'Check that your application settings folder is writable.') }
  }
}
function openBrowser(url) {
  const target = new URL(url)
  if (['http:', 'https:'].includes(target.protocol) && !target.username && !target.password) void shell.openExternal(target.toString())
}
function saveWindow() {
  if (restoreWindowState) return
  if (window && !window.isDestroyed()) savePrefs({ bounds: window.getNormalBounds(), maximized: window.isMaximized() })
}
function showWindow() {
  if (!window || window.isDestroyed()) { if (!booting) void boot(); return }
  if (window.isMinimized()) window.restore()
  if (restoreWindowState) { restoreWindowState = false; if (prefs.value.maximized) window.maximize() }
  window.show(); window.focus()
}
async function setAgent(agent) {
  if (!['claude', 'codex', 'opencode'].includes(agent)) throw new Error('Unknown assistant')
  const effective = await rpc('set-agent', { agent })
  ready.agent = effective
  window?.webContents.send('pdfpal:agent-changed', effective)
  updateTray()
  return effective
}
async function aiSettings() {
  if (!ready) return showWindow()
  showWindow()
  const before = await window.webContents.executeJavaScript('({ open: !!document.querySelector(".ai-settings[open]"), id: Number(document.querySelector(".ai-settings")?.dataset.openId ?? 0) })')
  window.webContents.send('pdfpal:open-ai-settings')
  return before
}
async function openUpdates() {
  showWindow()
  if (window.webContents.getURL() === recoveryURL) return
  window.webContents.send('pdfpal:open-updates')
}
async function checkUpdates() {
  if (updateRequest) return updateRequest
  updateRequest = checkDesktopUpdates(app.getVersion()).then(result => {
    updateState = { ...result, distribution: metadata.distribution ?? 'unsigned' }
    return updateState
  }).finally(() => { updateRequest = undefined })
  return updateRequest
}
function startupArgs() {
  if (!ready) return []
  return startupArguments(ready.startup, app.getPath('userData'))
}
function loginEnabled() {
  return process.platform === 'win32' && app.getLoginItemSettings({ path: process.execPath }).launchItems.some(item => item.name === applicationId && item.enabled)
}
function updateTray() {
  if (!tray) return
  tray.setToolTip(ready ? 'pdfpal — running' : 'pdfpal — starting or needs attention')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open pdfpal', click: showWindow },
    { label: 'Open in browser', enabled: !!ready, click: () => openBrowser(ready.origin) },
    { label: 'AI settings', enabled: !!ready, click: () => { void aiSettings().catch(error => dialog.showErrorBox('AI settings', error.message)) } },
    { label: 'Start with Windows', type: 'checkbox', enabled: !!ready && process.platform === 'win32',
      checked: !!ready && loginEnabled(),
      click: item => {
        try { app.setLoginItemSettings({ name: applicationId, openAtLogin: item.checked, path: process.execPath, args: startupArgs() }); savePrefs({ startAtLogin: item.checked }) }
        catch (error) { dialog.showErrorBox('Startup preference', error.message) }
        updateTray()
      } },
    { label: 'Check for updates…', click: () => { void openUpdates() } },
    { label: 'Diagnostics', click: () => { showWindow(); if (loadedOrigin && !window.webContents.getURL().startsWith('file:')) window.webContents.send('pdfpal:open-diagnostics'); else void window.loadURL(recoveryURL) } },
    { label: 'Retry service', enabled: !ready && !booting, click: () => { crashRetries = 0; void boot() } },
    { type: 'separator' },
    { label: 'Quit', click: () => { void requestQuit() } },
  ]))
}
async function requestQuit(testChoice) {
  if (stopping) return
  let active = 0
  if (testChoice !== 'cancel') { try { active = (await rpc('status')).active } catch {} }
  if (active && testChoice !== 'cancel') {
    if (!testChoice) showWindow()
    const choice = testChoice === 'keep' ? { response: 0 } : await dialog.showMessageBox(window, {
      type: 'question', title: 'An answer is still running', message: 'Keep pdfpal running or cancel the active AI requests and quit?',
      buttons: ['Keep running', 'Quit and cancel requests'], defaultId: 0, cancelId: 0,
    })
    if (choice.response === 0) return false
  }
  if (window && !window.isDestroyed() && (ownedOrigin(window.webContents.getURL()) || (loadedOrigin && window.webContents.getURL().startsWith(`${loadedOrigin}/`)))) {
    let timer
    const flushed = await Promise.race([
      window.webContents.executeJavaScript('window.pdfpalFlushPending ? window.pdfpalFlushPending().then(() => true, () => false) : true').catch(() => false),
      new Promise(resolve => { timer = setTimeout(() => resolve(false), testChoice === 'cancel' ? 2000 : 5000) }),
    ])
    clearTimeout(timer)
    if (!flushed && testChoice !== 'cancel') {
      showWindow()
      const choice = await dialog.showMessageBox(window, { type: 'warning', title: 'Some changes could not be saved',
        message: 'Keep editing and retry the save, or quit without saving the pending changes.', buttons: ['Keep editing', 'Quit without saving'], defaultId: 0, cancelId: 0 })
      if (choice.response === 0) return false
    }
  }
  await shutdown()
  return true
}
async function shutdown(code = 0) {
  if (stopping) return
  stopping = true
  saveWindow()
  if (window && !window.isDestroyed()) window.destroy()
  const closed = backend && !exited ? new Promise(resolve => backend.once('exit', resolve)) : Promise.resolve()
  if (backend && !exited) backend.postMessage({ type: 'stop' })
  let forced = false
  const timer = setTimeout(() => { forced = true; backend?.kill() }, 7000)
  const backendCode = await closed; clearTimeout(timer)
  rejectPending()
  if (temporary) {
    try { fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) } catch { code = 1 }
  }
  const failed = forced || (typeof backendCode === 'number' && backendCode !== 0)
  if (failed) code = 1
  if (pendingReceipt) {
    pendingReceipt.shutdownPhases = shutdownPhases
    pendingReceipt.checks.push(failed ? 'backend-stop-failed' : 'backend-graceful-stop')
    if (failed) pendingReceipt.status = 'shutdown_failed'
    fs.writeFileSync(process.env.PDFPAL_M0_RECEIPT, JSON.stringify(pendingReceipt, null, 2))
  }
  tray?.destroy()
  app.exit(code)
}
function ensureWindow() {
  if (!window || window.isDestroyed()) {
      window = new BrowserWindow({ ...restoreBounds(prefs.value.bounds, screen.getAllDisplays()), show: false, minWidth: 600, minHeight: 400,
        backgroundColor: '#0f0f0f', icon: path.join(root, 'frontend/dist/icon-512.png'), webPreferences: { preload: path.join(root, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true } })
      restoreWindowState = true
      window.webContents.setWindowOpenHandler(({ url }) => { openBrowser(url); return { action: 'deny' } })
      window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
      window.webContents.on('will-attach-webview', event => event.preventDefault())
      window.webContents.on('will-navigate', (event, url) => { if (!ownedOrigin(url)) event.preventDefault() })
      const rememberRoute = (_event, url, isMainFrame = true) => { if (isMainFrame && ownedOrigin(url)) { const parsed = new URL(url); savePrefs({ route: safeRoute(parsed.pathname + parsed.search + parsed.hash) }) } }
      window.webContents.on('did-navigate-in-page', rememberRoute)
      window.webContents.on('did-navigate', rememberRoute)
      let boundsTimer
      for (const event of ['move', 'resize', 'maximize', 'unmaximize']) window.on(event, () => { clearTimeout(boundsTimer); boundsTimer = setTimeout(saveWindow, 200) })
      window.on('close', event => {
        saveWindow()
        if (!stopping && tray) {
          event.preventDefault(); window.hide()
          if (!prefs.value.hideNotice) { savePrefs({ hideNotice: true }); notify('pdfpal is still running', 'Reopen pdfpal from the tray. Choose Quit there to stop it.') }
        } else if (!stopping) { event.preventDefault(); void requestQuit() }
      })
      window.on('session-end', () => { void requestQuit('cancel') })
    }
}
function setServiceState(state) {
  serviceState = state
  window?.webContents.send('pdfpal:service-state', state)
}
async function inspectSetup() {
  const started = Date.now()
  const snapshot = await rpc('inspect')
  if (smoke) console.error(`Setup inspection completed in ${Date.now() - started}ms`)
  lastAgents = snapshot.agents
  return { ...snapshot, complete: prefs.value.setupComplete === true,
    agents: snapshot.agents.map(({ fingerprint, ...agent }) => ({ ...agent,
      testedAt: fingerprint && prefs.value.connectionTests?.[agent.id]?.fingerprint === fingerprint ? prefs.value.connectionTests[agent.id].at : undefined })) }
}
async function launchSetup(agent, action) {
  provider(agent)
  if (!['install', 'login', 'docs'].includes(action)) throw new Error('Unknown action')
  if (action === 'docs' || process.platform !== 'win32') { await shell.openExternal(provider(agent).docs); return }
  if (setupPending || setupProcess) throw new Error('Finish or close the existing setup window first, then check again.')
  setupPending = true
  try {
    const binary = action === 'login' ? await rpc('login-command', { agent }) : undefined
    const script = setupScript(agent, action, binary)
    const child = spawn(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoProfile', '-NoExit', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { cwd: os.tmpdir(), detached: true, windowsHide: false, stdio: 'ignore' })
    setupProcess = child
    child.once('exit', () => { if (setupProcess === child) setupProcess = undefined })
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject) })
    child.unref(); journal.record('SETUP_LAUNCHED')
  } catch { setupProcess = undefined; journal.record('SETUP_FAILED'); throw new Error('Could not open setup. Use the official setup guide, then check again.') }
  finally { setupPending = false }
}
async function boot() {
  if (booting || stopping) return
  booting = true; ready = undefined; failureCode = 'STARTING'; existingOrigin = undefined; journal.record('STARTING'); updateTray()
  try {
    ensureWindow()
    setServiceState({ state: 'starting' })
    if (!loadedOrigin) { await window.loadURL(recoveryURL); if (!smoke && (!process.argv.includes('--hidden') || !tray || !prefs.value.setupComplete)) showWindow() }
    const child = utilityProcess.fork(path.join(root, 'backend.mjs'), [], {
      env: { ...process.env, PDFPAL_M0_SMOKE: smoke ? '1' : '0' }, stdio: 'pipe', serviceName: 'pdfpal backend',
    })
    backend = child; exited = false
    child.stdout?.resume()
    if (smoke) child.stderr?.on('data', chunk => process.stderr.write(chunk)); else child.stderr?.resume()
    const initial = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Local service startup timed out. Retry from the tray.')), process.env.PDFPAL_M0_LIVE === '1' ? 270000 : 45000)
      child.on('message', message => {
        if (message.type === 'shutdown-progress') shutdownPhases.push(message.phase)
        if (message.type === 'rpc-result') {
          const request = pending.get(message.id)
          if (request) { clearTimeout(request.timer); pending.delete(message.id); message.error ? request.reject(Object.assign(new Error(message.error), { code: message.code })) : request.resolve(message.result) }
        }
        if (message.type === 'ready') { clearTimeout(timer); resolve(message) }
        if (message.type === 'failure') { clearTimeout(timer); reject(Object.assign(new Error(message.message), { code: message.code, existing: message.existing })) }
      })
      child.once('exit', code => {
        clearTimeout(timer)
        if (backend === child) { exited = true; rejectPending() }
        reject(new Error(`Local service stopped (${code}).`))
        if (!stopping && ready && backend === child && !booting) {
          journal.record('BACKEND_STOPPED'); ready = undefined; updateTray(); setServiceState({ state: 'failed' })
          if (crashRetries++ < 1 && (!smoke || recoveryFixture)) { notify('pdfpal is restarting', 'The local service stopped. Retry any interrupted question.'); void boot() }
          else if (!smoke) showWindow()
        }
      })
    })
    ready = initial
    if (loadedOrigin !== ready.origin || window.webContents.getURL() === recoveryURL) {
      const route = await restoreLibraryRoute(prefs.value.route, ready.origin)
      if (route !== prefs.value.route) savePrefs({ route })
      await window.loadURL(ready.origin + route)
    }
    loadedOrigin = ready.origin
    journal.record('READY'); setServiceState({ state: 'ready', interrupted: crashRetries > 0 })
    if (exited) throw new Error('The local service stopped during startup. Retry.')
    if (!smoke && (!process.argv.includes('--hidden') || !tray || !prefs.value.setupComplete)) showWindow()
    booting = false; updateTray()
    if (beta) {
      await betaAcceptance({ options: beta, app, window, ready, tray, showWindow, requestQuit, secondLaunches: () => secondLaunches })
    } else if (installationCheck) {
      const { installedAcceptance } = await import('./installer-acceptance.mjs')
      await installedAcceptance({ app, window, ready, prefs, requestQuit, shutdown })
    } else if (smoke) await smokeTest()
  } catch (error) {
    booting = false; ready = undefined; updateTray()
    if (backend && !exited) {
      const child = backend
      const closed = new Promise(resolve => child.once('exit', resolve))
      child.postMessage({ type: 'stop' })
      const timer = setTimeout(() => child.kill(), 7000)
      await closed; clearTimeout(timer)
    }
    if (beta) { console.error(`Beta startup failed: ${error.code ?? error.message}`); await shutdown(1); return }
    if (smoke && m2 && process.env.PDFPAL_M2_FAILURE_FIXTURE === '1' && error.code === 'EADDRINUSE') {
      failureCode = error.code
      await window.loadURL(recoveryURL)
      for (let i = 0; i < 100; i++) {
        if (await window.webContents.executeJavaScript('document.getElementById("title").textContent.includes("already running")')) break
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      if (!await window.webContents.executeJavaScript('document.getElementById("title").textContent.includes("already running")')) throw new Error('Startup recovery did not render')
      if (!await window.webContents.executeJavaScript('window.pdfpalDesktop.setAgent("claude").then(() => false, () => true)')) throw new Error('Recovery page received provider privileges')
      recoveryScreenPassed = true
      process.env.PDFPAL_M2_FAILURE_FIXTURE = '0'
      await window.webContents.executeJavaScript('document.getElementById("retry").click()')
      return
    }
    if (smoke) { console.error(`Desktop check failed: ${error.message}`); await shutdown(1); return }
    journal.record('START_FAILED'); failureCode = error.code ?? 'BACKEND_FAILED'; existingOrigin = error.existing
    setServiceState({ state: 'failed' })
    if (!loadedOrigin) await window.loadURL(recoveryURL)
    showWindow()
  }
}
async function smokeTest() {
  const check = (value, message) => { if (!value) throw new Error(message) }
  const ui = await window.webContents.executeJavaScript('({ title: document.title, mounted: !!document.querySelector("#root")?.children.length })')
  check(ui.mounted, 'Packaged reader did not mount')
  pendingReceipt ??= { status: 'passed', platform: process.platform, arch: process.arch, electron: process.versions.electron,
    node: process.versions.node, checks: ready.checks, ui, providers: ready.providers }
  check(process.env.PDFPAL_M0_RECEIPT, 'Set PDFPAL_M0_RECEIPT for evidence')
  if (ready.providers?.agents.some(agent => agent.generation !== 'passed')) pendingReceipt.status = 'provider_gate_failed'
  if (recoveryScreenPassed && !pendingReceipt.checks.includes('startup-recovery-screen-and-retry')) pendingReceipt.checks.push('startup-recovery-screen-and-retry')
  if (m1) {
    check(tray && !tray.isDestroyed(), 'Tray was not created')
    if (m2 && !recoveryFixture) {
      for (let i = 0; i < 350; i++) {
        if (await window.webContents.executeJavaScript('!!document.querySelector(".ai-settings[open][aria-busy=false] input[type=radio]")')) break
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      check(await window.webContents.executeJavaScript('document.querySelector("#ai-settings-title")?.textContent === "Connect your reading assistant"'), 'First-launch setup did not open')
      await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    if (process.env.PDFPAL_SETTINGS_PREVIEW) fs.writeFileSync(process.env.PDFPAL_SETTINGS_PREVIEW.replace('ai-settings.png', 'setup.png'), (await window.webContents.capturePage()).toPNG())
      check((await rpc('status')).active === 0, 'Passive discovery triggered generation')
      await window.webContents.executeJavaScript('Array.from(document.querySelectorAll(".ai-settings button")).find(button => button.textContent === "Test connection").click()')
      for (let i = 0; i < 350; i++) {
        if (await window.webContents.executeJavaScript('!!document.querySelector(".ai-settings-verified")')) break
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      check(await window.webContents.executeJavaScript('!!document.querySelector(".ai-settings-verified")'), 'Explicit connection test failed')
      await window.webContents.executeJavaScript('document.querySelector(".ai-settings-save").click()')
      for (let i = 0; i < 100 && !prefs.value.setupComplete; i++) await new Promise(resolve => setTimeout(resolve, 50))
      check(prefs.value.setupComplete && prefs.value.connectionTests?.claude?.at, 'Setup completion/test did not persist')
      const cancelled = window.webContents.executeJavaScript('window.pdfpalDesktop.testConnection("claude").then(() => false, () => true)')
      for (let i = 0; i < 200; i++) { if ((await rpc('status')).active) break; await new Promise(resolve => setTimeout(resolve, 50)) }
      await window.webContents.executeJavaScript('window.pdfpalDesktop.cancelTest()')
      check(await cancelled, 'Cancelling the explicit test did not reject it')
      const report = await window.webContents.executeJavaScript('window.pdfpalDesktop.diagnostics()')
      check(report.events.some(event => event.code === 'TEST_PASSED') && !JSON.stringify(report).includes(process.env.CLAUDE_BIN), 'Diagnostic report leaked a path or missed the test')
      check(await window.webContents.executeJavaScript('window.pdfpalDesktop.setupAction("invalid", "install").then(() => false, () => true)'), 'Invalid privileged setup action was accepted')
      pendingReceipt.checks.push('first-launch-no-passive-generation', 'explicit-connection-test', 'setup-completion-persisted', 'cancel-connection-test', 'redacted-diagnostics', 'invalid-setup-ipc-rejected')
    }
    const settingsBefore = await aiSettings()
    await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    for (let i = 0; i < 350; i++) {
      if (await window.webContents.executeJavaScript(`(() => { const node = document.querySelector('.ai-settings[open][aria-busy=false]'); return !!node?.querySelector('input[type=radio]') && (${settingsBefore.open} || Number(node.dataset.openId) > ${settingsBefore.id}); })()`)) break
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    const settings = await window.webContents.executeJavaScript(`(() => {
      const modal = document.querySelector('.ai-settings[open]');
      return { open: !!modal, theme: modal && getComputedStyle(modal).backgroundColor,
        options: modal?.querySelectorAll('input[type=radio]').length };
    })()`)
    check(settings.open && settings.theme === 'rgb(26, 26, 26)' && settings.options > 0, 'Themed AI settings did not open')
    await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    if (process.env.PDFPAL_SETTINGS_PREVIEW) fs.writeFileSync(process.env.PDFPAL_SETTINGS_PREVIEW, (await window.webContents.capturePage()).toPNG())
    await window.webContents.executeJavaScript('document.querySelector("[aria-label=\\"Close AI settings\\"]").click()')
    pendingReceipt.checks.push('themed-ai-settings-from-tray')
    if (process.platform === 'win32' && !recoveryFixture) {
      const registration = { name: `pdfpal-acceptance-${process.pid}`, path: process.execPath, args: startupArgs() }
      try {
        app.setLoginItemSettings({ ...registration, openAtLogin: true })
        check(app.getLoginItemSettings({ path: process.execPath }).launchItems.some(item => item.name === registration.name && item.enabled), 'Windows login registration failed')
        pendingReceipt.checks.push('windows-login-registration')
      } finally { app.setLoginItemSettings({ ...registration, openAtLogin: false }) }
    }
    prefs.update({ hideNotice: true })
    const origin = ready.origin
    const ask = (agent = 'claude', message = 'Explain the source briefly.') => fetch(`${origin}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json', connection: 'close' },
      body: JSON.stringify({ message, project_id: ready.fixture.project, source_id: ready.fixture.source, agent }) })
    const waitActive = async () => { for (let i = 0; i < 60; i++) { if ((await rpc('status')).active) return; await new Promise(resolve => setTimeout(resolve, 50)) } throw new Error('AI request did not start') }
    if (recoveryFixture) {
      const restored = await (await fetch(`${origin}/api/projects/${recoveryFixture.project}/sources/${recoveryFixture.source}/chat`)).json()
      check(restored.messages.some(message => message.content === 'M1 background answer'), 'Crash recovery lost the saved answer')
      pendingReceipt.checks.push('backend-crash-recovery-with-history')
      const cancelled = ask(); cancelled.catch(() => {})
      await waitActive(); pendingReceipt.checks.push('quit-cancels-active-request')
      await requestQuit('cancel')
      return
    }
    const answer = ask(); answer.catch(() => {})
    await waitActive()
    window.close(); check(!window.isVisible(), 'Close did not hide to tray')
    const extensionOrigin = 'chrome-extension://billjanehfdgcakkbbefbjobocjlinen'
    const pairing = await (await fetch(`${origin}/api/extension/pair`, { method: 'POST', headers: { 'content-type': 'application/json', origin: extensionOrigin },
      body: JSON.stringify({ code: ready.fixture.pairCode, origin: extensionOrigin }) })).json()
    const extension = await fetch(`${origin}/api/extension/projects`, { headers: { authorization: `Bearer ${pairing.token}`, origin: extensionOrigin } })
    check(extension.ok && (await extension.json()).some(project => project.id === ready.fixture.project), 'Paired extension bridge failed while hidden')
    pendingReceipt.checks.push('paired-extension-access-while-hidden')
    check(await requestQuit('keep') === false, 'Keep running did not preserve the request')
    const response = await answer
    check(response.ok && (await response.text()).includes('M1 background answer'), 'Background chat failed')
    const history = await (await fetch(`${origin}/api/projects/${ready.fixture.project}/sources/${ready.fixture.source}/chat`)).json()
    check(history.messages.some(message => message.content === 'M1 background answer'), 'Background answer was not saved')
    showWindow(); check(window.isVisible(), 'Tray reopen failed')
    pendingReceipt.checks.push('tray-close-background-chat-reopen', 'quit-keeps-active-request')
    const effective = await window.webContents.executeJavaScript('window.pdfpalDesktop.setAgent("claude")')
    check(effective === 'claude', 'Selected assistant was not saved')
    const saved = JSON.parse(fs.readFileSync(path.join(process.env.PDFPAL_DATA_DIR, 'config.json'), 'utf8'))
    check(saved.agent === 'claude', 'Shared agent preference missing')
    check(await window.webContents.executeJavaScript('window.pdfpalDesktop.setAgent("invalid").then(() => false, () => true)'), 'Invalid IPC agent was accepted')
    pendingReceipt.checks.push('shared-agent-preference')
    const route = `/projects/${ready.fixture.project}/sources/${ready.fixture.source}`
    await window.webContents.executeJavaScript(`history.pushState({}, '', ${JSON.stringify(route)})`)
    await new Promise(resolve => setTimeout(resolve, 100))
    check(prefs.value.route === route, 'Last route was not saved')
    saveWindow()
    check(preferences(path.join(app.getPath('userData'), 'desktop.json')).value.bounds.width > 0, 'Window bounds were not saved')
    pendingReceipt.checks.push('window-and-route-preferences')
    if (process.env.PDFPAL_M1_LIVE_CODEX === '1') {
      const live = await ask('codex', 'Reply exactly PDFPAL_CONNECTION_OK. Do not use tools.')
      check(live.ok && (await live.text()).includes('PDFPAL_CONNECTION_OK'), 'Real Codex reader request failed')
      pendingReceipt.checks.push('real-codex-reader-chat')
    }
    const child = spawn(process.execPath, ['--m1-secondary'], { env: process.env, stdio: 'ignore', windowsHide: true })
    const exitCode = await new Promise(resolve => child.once('exit', resolve))
    check(exitCode === 0, 'Second launch did not exit successfully')
    for (let i = 0; i < 40 && !secondLaunches; i++) await new Promise(resolve => setTimeout(resolve, 50))
    check(secondLaunches > 0 && window.isVisible(), 'Second launch did not focus existing window')
    pendingReceipt.checks.push('single-instance-second-launch')
    recoveryFixture = ready.fixture
    backend.kill()
    return
  }
  await shutdown(pendingReceipt.status === 'passed' ? 0 : 1)
}

if (!app.requestSingleInstanceLock()) app.exit(0)
else {
  app.on('second-instance', () => { secondLaunches++; showWindow() })
  app.on('window-all-closed', () => {})
  app.on('before-quit', event => { if (!stopping) { event.preventDefault(); void requestQuit() } })
  app.on('activate', showWindow)
  function handle(name, callback, recovery = false) {
    ipcMain.handle(`pdfpal:${name}`, async (event, ...args) => {
      if (!trustedSender(event, window, ready?.origin ?? loadedOrigin, recovery ? recoveryURL : undefined)) throw new Error('Untrusted sender')
      if (!recovery && !ready) throw new Error('The local service is restarting. Retry shortly.')
      return callback(...args)
    })
  }
  handle('updates-state', () => updateState, true)
  handle('check-updates', checkUpdates, true)
  handle('download-update', () => { if (updateState.state !== 'available') throw new Error('Check for an available update first'); openBrowser(updateState.downloadURL); return true }, true)
  handle('release-notes', () => { openBrowser(updateState.releaseURL ?? releasePage); return true }, true)
  handle('open-licenses', async () => {
    const error = await shell.openPath(path.join(process.resourcesPath, 'THIRD_PARTY_NOTICES.txt'))
    if (error) throw new Error('The license file could not be opened. Find THIRD_PARTY_NOTICES.txt in the application resources folder.')
    return true
  }, true)
  handle('set-agent', setAgent)
  handle('setup-state', inspectSetup)
  handle('setup-status', () => ({ complete: prefs.value.setupComplete === true }))
  handle('complete-setup', () => { prefs.update({ setupComplete: true }); return true })
  handle('setup-action', launchSetup)
  handle('choose-binary', async agent => {
    provider(agent)
    const choice = await dialog.showOpenDialog(window, { title: 'Choose your installed assistant', properties: ['openFile'], filters: [{ name: 'Application', extensions: process.platform === 'win32' ? ['exe'] : ['*'] }] })
    if (choice.canceled || !choice.filePaths[0]) return false
    return rpc('choose-binary', { agent, executable: choice.filePaths[0] })
  })
  handle('test-connection', async agent => {
    provider(agent)
    if (testing) throw new Error('A connection test is already running.')
    testing = true
    const epoch = ++testEpoch
    try {
      // Capture identity before invoking: changing/installing the provider invalidates verification.
      const before = (await rpc('inspect')).agents.find(item => item.id === agent)
      if (epoch !== testEpoch) throw Object.assign(new Error('Connection test cancelled.'), { code: 'AGENT_CANCELLED' })
      const result = await rpc('test-connection', { agent })
      if (epoch !== testEpoch) throw Object.assign(new Error('Connection test cancelled.'), { code: 'AGENT_CANCELLED' })
      prefs.update({ connectionTests: { ...prefs.value.connectionTests, [agent]: { fingerprint: before.fingerprint, at: result.at } } })
      journal.record('TEST_PASSED'); return result
    } catch (error) { journal.record(error.code === 'AGENT_CANCELLED' ? 'TEST_CANCELLED' : 'TEST_FAILED'); throw error }
    finally { testing = false }
  })
  handle('cancel-test', () => { testEpoch++; return rpc('cancel-test') })
  handle('service-state', () => serviceState, true)
  handle('recovery', () => ({ ...recoveryMessage(failureCode), starting: booting, existing: !!existingOrigin }), true)
  handle('retry-service', () => { if (!booting && !ready) { crashRetries = 0; void boot() }; return true }, true)
  handle('open-existing', () => { if (existingOrigin) openBrowser(existingOrigin) }, true)
  handle('diagnostics', () => { diagnosticPreview = journal.preview(app.getVersion(), lastAgents); return diagnosticPreview }, true)
  handle('export-diagnostics', async () => {
    if (!diagnosticPreview) throw new Error('Preview diagnostics first')
    const choice = await dialog.showSaveDialog(window, { title: 'Export diagnostics', defaultPath: 'pdfpal-diagnostics.json', filters: [{ name: 'JSON report', extensions: ['json'] }] })
    if (choice.canceled || !choice.filePath) return false
    fs.writeFileSync(choice.filePath, JSON.stringify(diagnosticPreview, null, 2), { mode: 0o600 }); return true
  }, true)
  handle('quit', () => { void requestQuit(); return true }, true)
  app.whenReady().then(async () => {
    try {
      const icon = nativeImage.createFromPath(path.join(root, 'frontend/dist/favicon-32.png'))
      if (icon.isEmpty()) throw new Error('Tray icon is missing')
      tray = new Tray(icon)
      tray.on('double-click', showWindow); tray.on('click', showWindow)
    } catch { tray = undefined }
    await boot()
  })
}
