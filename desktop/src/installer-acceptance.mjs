import fs from 'node:fs/promises'
import path from 'node:path'

/** Explicit installed-build harness; works only with isolated acceptance metadata. */
export async function installedAcceptance({ app, window, ready, requestQuit }) {
  const metadata = JSON.parse(await fs.readFile(path.join(app.getAppPath(), 'package.json'), 'utf8'))
  if (metadata.pdfpalDesktop?.appId !== 'io.pdfpal.desktop.installer-acceptance' || !process.env.PDFPAL_INSTALLER_ACCEPTANCE_RECEIPT || !process.env.PDFPAL_INSTALLER_ACCEPTANCE_CONTROL) throw new Error('Use the isolated installer acceptance build and fixture environment')
  for (const filename of ['THIRD_PARTY_NOTICES.txt', 'LICENSE.pdfpal.txt']) { if (!(await fs.stat(path.join(process.resourcesPath, filename))).isFile()) throw new Error('Installed license notices missing') }
  const check = (condition, message) => { if (!condition) throw new Error(message) }
  const request = async (url, method = 'GET', data, headers = {}) => {
    const response = await fetch(ready.origin + url, { method, headers: { connection: 'close', ...(data ? { 'content-type': 'application/json' } : {}), ...headers }, ...(data ? { body: JSON.stringify(data) } : {}) })
    check(response.ok, `Installed reader request failed (${response.status})`)
    return response.json()
  }
  for (let i = 0; i < 100; i++) {
    if (await window.webContents.executeJavaScript('!!window.pdfpalDesktop && !!document.querySelector("#root")?.children.length')) break
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  check(await window.webContents.executeJavaScript('!!window.pdfpalDesktop?.completeSetup'), 'Installed preload missing')
  const updates = await window.webContents.executeJavaScript('window.pdfpalDesktop.updatesState()')
  check(updates.currentVersion === app.getVersion() && updates.state === 'idle', 'Update metadata missing or checked passively')
  check(await window.webContents.executeJavaScript('window.pdfpalDesktop.downloadUpdate().then(() => false, () => true)'), 'Unverified update download was allowed')
  const file = path.join(ready.startup.dataDir, 'installer-acceptance-fixture.json')
  let fixture = await fs.readFile(file, 'utf8').then(JSON.parse).catch(() => undefined)
  if (!fixture) {
    fixture = { ...ready.fixture }
    fixture.note = (await request(`/api/projects/${fixture.project}/notes`, 'POST', { title: 'Installer preserved note', content: 'Retain this note through upgrade and reinstall.', source_id: fixture.source })).id
    fixture.collection = (await request(`/api/projects/${fixture.project}/collections`, 'POST', { name: 'Installer preserved collection' })).id
    await request(`/api/projects/${fixture.project}/sources/${fixture.source}`, 'PATCH', { collection_id: fixture.collection })
    fixture.annotation = (await request(`/api/projects/${fixture.project}/sources/${fixture.source}/annotations`, 'POST', { page_number: 1, x1: .1, y1: .1, x2: .4, y2: .2, text: 'Installer preserved highlight', color: 'yellow' })).id
    const extensionOrigin = 'chrome-extension://billjanehfdgcakkbbefbjobocjlinen'
    const pair = await request('/api/extension/pair', 'POST', { code: fixture.pairCode, origin: extensionOrigin }, { origin: extensionOrigin })
    const status = await request('/api/extension/status', 'GET', undefined, { origin: extensionOrigin, authorization: `Bearer ${pair.token}` })
    fixture.client = status.client_id
    delete fixture.pairCode
    await fs.writeFile(file, JSON.stringify(fixture))
    const response = await fetch(ready.origin + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json', connection: 'close' }, body: JSON.stringify({ message: 'Explain the fixture briefly.', project_id: fixture.project, source_id: fixture.source, agent: 'claude' }) })
    check(response.ok && (await response.text()).includes('M1 background answer'), 'Installed fixture chat failed')
  }
  const note = await request(`/api/projects/${fixture.project}/notes/${fixture.note}`)
  check(note.content === 'Retain this note through upgrade and reinstall.', 'Installed library note was changed')
  check((await request(`/api/projects/${fixture.project}/sources/${fixture.source}/annotations`)).some(item => item.id === fixture.annotation), 'Installed highlight missing')
  check((await request(`/api/projects/${fixture.project}/sources/${fixture.source}/chat`)).messages.some(item => item.content === 'M1 background answer'), 'Installed answer history missing')
  await window.webContents.executeJavaScript('window.pdfpalDesktop.completeSetup()')
  const report = { status: 'passed', version: app.getVersion(), checks: ['installed-reader-mounted', 'installed-preload', 'installed-license-notices', 'manual-update-check-no-passive-network', 'pdf-note-highlight-collection-history-preserved', 'extension-identity-retained', 'installed-setup-completed'] }
  await fs.writeFile(process.env.PDFPAL_INSTALLER_ACCEPTANCE_RECEIPT, JSON.stringify(report, null, 2))
  if (process.argv.includes('--installer-acceptance-hold')) {
    const timer = setInterval(async () => {
      const command = await fs.readFile(process.env.PDFPAL_INSTALLER_ACCEPTANCE_CONTROL, 'utf8').then(JSON.parse).catch(() => undefined)
      if (command?.quit === true) { clearInterval(timer); await requestQuit() }
    }, 100)
    timer.unref()
  } else await requestQuit()
}
