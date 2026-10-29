import { app, BrowserWindow, utilityProcess, Tray, Menu, nativeImage, Notification, dialog, shell, screen, ipcMain } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { preferences, restoreBounds, safeRoute } from './preferences.mjs'

const root = path.dirname(fileURLToPath(import.meta.url))
const m1 = process.argv.includes('--m1-smoke')
const smoke = m1 || process.argv.includes('--m0-smoke')
const temporary = smoke ? fs.mkdtempSync(path.join(os.tmpdir(), 'pdfpal-desktop-')) : undefined
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
app.setPath('userData', process.env.PDFPAL_DESKTOP_PROFILE ?? path.join(app.getPath('appData'), 'pdfpal-desktop'))
app.setAppUserModelId('io.pdfpal.desktop')
const prefs = preferences(path.join(app.getPath('userData'), 'desktop.json'))
let backend, window, tray, ready, pendingReceipt, stopping = false, exited = true, booting = false, crashRetries = 0, secondLaunches = 0
let recoveryFixture
let restoreWindowState = false
const pending = new Map()
let rpcId = 0
let warnedPreferences = false
const ownedOrigin = url => { try { return ready && new URL(url).origin === ready.origin } catch { return false } }

function rpc(command, extra = {}) {
  if (!backend || exited) return Promise.reject(new Error('pdfpal is not running'))
  return new Promise((resolve, reject) => {
    const id = ++rpcId
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('The local service did not respond. Retry.')) }, 10000)
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
  const agents = ready.agents.filter(agent => agent.available)
  const choice = await dialog.showMessageBox(window, { type: 'info', title: 'AI settings', message: 'Choose your assistant',
    detail: agents.length ? agents.map(agent => `${agent.label}: ${agent.auth ?? 'installed'}`).join('\n') : 'Install and sign in to Claude Code or Codex, then restart pdfpal. You can keep reading without AI.',
    buttons: [...agents.map(agent => agent.label), 'Cancel'], cancelId: agents.length })
  if (choice.response < agents.length) await setAgent(agents[choice.response].id)
}
function startupArgs() {
  if (!ready) return []
  return ['--hidden', `--data-dir=${ready.startup.dataDir}`, `--db=${ready.startup.dbPath}`, `--port=${ready.startup.port}`, `--profile=${app.getPath('userData')}`]
}
function updateTray() {
  if (!tray) return
  tray.setToolTip(ready ? 'pdfpal — running' : 'pdfpal — starting or needs attention')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open pdfpal', click: showWindow },
    { label: 'Open in browser', enabled: !!ready, click: () => openBrowser(ready.origin) },
    { label: 'AI settings', enabled: !!ready, click: () => { void aiSettings().catch(error => dialog.showErrorBox('AI settings', error.message)) } },
    { label: 'Start with Windows', type: 'checkbox', enabled: !!ready && process.platform === 'win32',
      checked: !!ready && app.getLoginItemSettings({ path: process.execPath, args: startupArgs() }).openAtLogin,
      click: item => {
        try { app.setLoginItemSettings({ openAtLogin: item.checked, path: process.execPath, args: startupArgs() }); savePrefs({ startAtLogin: item.checked }) }
        catch (error) { dialog.showErrorBox('Startup preference', error.message) }
        updateTray()
      } },
    { label: 'Retry service', enabled: !ready && !booting, click: () => { crashRetries = 0; void boot() } },
    { type: 'separator' },
    { label: 'Quit', click: () => { void requestQuit() } },
  ]))
}
async function requestQuit(testChoice) {
  if (stopping) return
  if (testChoice === 'cancel') { await shutdown(); return true }
  let active = 0
  try { active = (await rpc('status')).active } catch {}
  if (active && testChoice !== 'cancel') {
    if (!testChoice) showWindow()
    const choice = testChoice === 'keep' ? { response: 0 } : await dialog.showMessageBox(window, {
      type: 'question', title: 'An answer is still running', message: 'Keep pdfpal running or cancel the active AI requests and quit?',
      buttons: ['Keep running', 'Quit and cancel requests'], defaultId: 0, cancelId: 0,
    })
    if (choice.response === 0) return false
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
  await closed; clearTimeout(timer)
  rejectPending()
  if (temporary) {
    try { fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) } catch { code = 1 }
  }
  if (forced) code = 1
  if (pendingReceipt) {
    pendingReceipt.checks.push(forced ? 'backend-forced-stop' : 'backend-graceful-stop')
    if (forced) pendingReceipt.status = 'shutdown_failed'
    fs.writeFileSync(process.env.PDFPAL_M0_RECEIPT, JSON.stringify(pendingReceipt, null, 2))
  }
  tray?.destroy()
  app.exit(code)
}
async function boot() {
  if (booting || stopping) return
  booting = true; ready = undefined; updateTray()
  try {
    const child = utilityProcess.fork(path.join(root, 'backend.mjs'), [], {
      env: { ...process.env, PDFPAL_M0_SMOKE: smoke ? '1' : '0' }, stdio: 'pipe', serviceName: 'pdfpal backend',
    })
    backend = child; exited = false
    child.stdout?.resume()
    if (smoke) child.stderr?.on('data', chunk => process.stderr.write(chunk)); else child.stderr?.resume()
    const initial = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Local service startup timed out. Retry from the tray.')), process.env.PDFPAL_M0_LIVE === '1' ? 270000 : 45000)
      child.on('message', message => {
        if (message.type === 'rpc-result') {
          const request = pending.get(message.id)
          if (request) { clearTimeout(request.timer); pending.delete(message.id); message.error ? request.reject(new Error(message.error)) : request.resolve(message.result) }
        }
        if (message.type === 'ready') { clearTimeout(timer); resolve(message) }
        if (message.type === 'failure') { clearTimeout(timer); reject(Object.assign(new Error(message.message), { code: message.code, existing: message.existing })) }
      })
      child.once('exit', code => {
        clearTimeout(timer)
        if (backend === child) { exited = true; rejectPending() }
        reject(new Error(`Local service stopped (${code}).`))
        if (!stopping && ready && backend === child && !booting) {
          ready = undefined; updateTray()
          if (crashRetries++ < 1 && (!smoke || recoveryFixture)) { notify('pdfpal is restarting', 'The local service stopped. Retry any interrupted question.'); void boot() }
          else if (!smoke) dialog.showErrorBox('pdfpal service stopped', 'Use Retry service in the tray. Interrupted AI requests are not sent again automatically.')
        }
      })
    })
    ready = initial
    if (!window || window.isDestroyed()) {
      window = new BrowserWindow({ ...restoreBounds(prefs.value.bounds, screen.getAllDisplays()), show: false, minWidth: 600, minHeight: 400,
        backgroundColor: '#0f0f0f', webPreferences: { preload: path.join(root, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true } })
      restoreWindowState = true
      window.webContents.setWindowOpenHandler(({ url }) => { openBrowser(url); return { action: 'deny' } })
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
    await window.loadURL(ready.origin + safeRoute(prefs.value.route))
    if (exited) throw new Error('The local service stopped during startup. Retry.')
    if (!smoke && (!process.argv.includes('--hidden') || !tray)) showWindow()
    booting = false; updateTray()
    if (smoke) await smokeTest()
  } catch (error) {
    booting = false; ready = undefined; updateTray()
    if (backend && !exited) {
      const child = backend
      const closed = new Promise(resolve => child.once('exit', resolve))
      child.postMessage({ type: 'stop' })
      const timer = setTimeout(() => child.kill(), 7000)
      await closed; clearTimeout(timer)
    }
    if (smoke) { console.error(`Desktop check failed: ${error.message}`); await shutdown(1); return }
    const buttons = ['Retry', ...(error.existing ? ['Open existing in browser'] : []), 'Quit']
    const choice = await dialog.showMessageBox({ type: 'error', title: 'pdfpal could not start', message: error.code === 'EADDRINUSE' ? 'Another application is using the local port pdfpal needs. Close the other pdfpal server or application, then retry.' : error.message,
      buttons, cancelId: buttons.length - 1 })
    if (choice.response === 0) void boot()
    else if (error.existing && choice.response === 1) openBrowser(error.existing)
    else await shutdown(1)
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
  if (m1) {
    check(tray && !tray.isDestroyed(), 'Tray was not created')
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
  ipcMain.handle('pdfpal:set-agent', async (event, agent) => {
    if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame || !ownedOrigin(event.senderFrame.url)) throw new Error('Untrusted sender')
    return setAgent(agent)
  })
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
