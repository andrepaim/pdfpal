import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

/** This file-control harness is unavailable in production metadata/profiles. */
export function betaOptions(metadata, env = process.env, temporary = os.tmpdir()) {
  const directory = env.PDFPAL_BETA_DIRECTORY
  const same = (a, b) => typeof a === 'string' && (process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b))
  if (metadata.appId !== 'io.pdfpal.desktop.installer-acceptance' || !directory || !path.isAbsolute(directory) ||
      !same(path.dirname(directory), temporary) || !/^pdfpal-beta-[a-f0-9-]{36}$/i.test(path.basename(directory)) ||
      !same(env.PDFPAL_DATA_DIR, path.join(directory, 'library')) || !same(env.PDFPAL_DB, path.join(directory, 'library/pdfpal.db')) ||
      !same(env.PDFPAL_DESKTOP_PROFILE, path.join(directory, 'profile'))) throw new Error('Beta acceptance requires isolated build metadata and a dedicated temporary library/profile')
  return { directory, control: path.join(directory, 'control.json'), state: path.join(directory, 'state.json') }
}

export async function betaAcceptance({ options, app, window, ready, tray, showWindow, requestQuit, secondLaunches }) {
  const wait = async (condition, description) => {
    const deadline = Date.now() + 30000
    while (!await condition()) {
      if (Date.now() > deadline) throw new Error(description)
      await new Promise(resolve => setTimeout(resolve, 50))
    }
  }
  const evaluate = code => window.webContents.executeJavaScript(code)
  const libraryReady = () => evaluate(`!!window.pdfpalDesktop && document.querySelector('h1')?.textContent === 'My Projects' && !document.body.innerText.includes('Loading projects…')`)
  const publish = async state => {
    await fs.promises.writeFile(options.state + '.tmp', JSON.stringify({ version: app.getVersion(), ...state }))
    for (let attempt = 0; ; attempt++) {
      try { await fs.promises.rename(options.state + '.tmp', options.state); return }
      catch (error) {
        if (!['EPERM','EACCES','EBUSY'].includes(error.code) || attempt >= 20) throw error
        await new Promise(resolve => setTimeout(resolve, 50))
      }
    }
  }
  const request = async (url, method = 'GET', data) => {
    const response = await fetch(ready.origin + url, { method, headers: { connection: 'close', ...(data ? { 'content-type': 'application/json' } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}), signal: AbortSignal.timeout(30000) })
    if (!response.ok) throw new Error(`Beta fixture HTTP ${response.status}`)
    return response.json()
  }
  await publish({ state: 'starting', phase: 'library' })
  await wait(libraryReady, 'Library did not become usable')
  await publish({ state: 'starting', phase: 'paint' })
  // A hosted/locked Windows desktop can stop compositor callbacks completely.
  // Record that limitation instead of hanging or claiming a painted frame.
  let paintTimer
  const paintObserved = await Promise.race([
    evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))'),
    new Promise(resolve => { paintTimer = setTimeout(() => resolve(false), 1000) }),
  ])
  clearTimeout(paintTimer)
  let fixture
  const fixtureFile = path.join(options.directory, 'fixture.json')
  if (fs.existsSync(fixtureFile)) fixture = JSON.parse(fs.readFileSync(fixtureFile, 'utf8'))
  let lastId, busy = false
  const execute = async command => {
    switch (command.action) {
      case 'setup': {
        await wait(() => evaluate('!!document.querySelector(".ai-settings[open]") && document.querySelector(".ai-settings").getAttribute("aria-busy") === "false"'), 'Setup did not finish loading')
        const snapshot = await evaluate('window.pdfpalDesktop.setupState()')
        if (!snapshot.agents.every(agent => !agent.available && (agent.id === 'opencode' || agent.state === 'missing'))) throw new Error('Missing-provider fixture reached an unexpected state')
        await evaluate(`Array.from(document.querySelectorAll('.ai-settings button')).find(button => button.textContent === 'Continue without AI').click()`)
        await wait(() => evaluate('!document.querySelector(".ai-settings[open]")'), 'Read-only continuation did not close setup')
        return { checks: ['missing-providers-visible', 'continue-without-ai'], providerStates: snapshot.agents.map(({ id, state, available }) => ({ id, state, available })) }
      }
      case 'prepare': {
        if (!fixture) {
          const project = await request('/api/projects', 'POST', { title: 'Beta synthetic reading' })
          const form = new FormData()
          form.append('file', new Blob([fs.readFileSync(path.join(app.getAppPath(), 'sample.pdf'))], { type: 'application/pdf' }), 'sample.pdf')
          const response = await fetch(`${ready.origin}/api/projects/${project.id}/sources/upload`, { method: 'POST', body: form, signal: AbortSignal.timeout(30000) })
          if (!response.ok) throw new Error('Synthetic PDF import failed')
          fixture = { project: project.id, source: (await response.json()).id }
          fs.writeFileSync(fixtureFile, JSON.stringify(fixture))
        }
        return { checks: ['synthetic-pdf-imported'] }
      }
      case 'hide':
        if (!tray) throw new Error('Tray unavailable')
        window.close()
        if (window.isVisible()) throw new Error('Close did not hide the window')
        return { visible: false }
      case 'show':
        showWindow()
        await wait(() => window.isVisible(), 'Tray reopen failed')
        return { visible: true, secondLaunches: secondLaunches() }
      case 'cycle': {
        if (!fixture || !tray) throw new Error('Prepare the fixture and tray first')
        const before = (await request(`/api/projects/${fixture.project}/sources/${fixture.source}/chat`)).messages.filter(item => item.role === 'assistant').length
        const answer = fetch(ready.origin + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json', connection: 'close' },
          body: JSON.stringify({ message: 'Explain the synthetic PDF briefly.', project_id: fixture.project, source_id: fixture.source, agent: 'claude' }), signal: AbortSignal.timeout(30000) })
        window.close()
        if (window.isVisible()) throw new Error('Close did not hide during answer')
        const response = await answer
        if (!response.ok || !(await response.text()).includes('M1 background answer')) throw new Error('Background fixture answer failed')
        const messages = (await request(`/api/projects/${fixture.project}/sources/${fixture.source}/chat`)).messages
        if (messages.filter(item => item.role === 'assistant').length !== before + 1) throw new Error('Background answer lost or duplicated')
        await window.loadURL(`${ready.origin}/projects/${fixture.project}/sources/${fixture.source}`)
        showWindow()
        await wait(() => evaluate(`document.body.innerText.includes('M1 background answer')`), 'Saved answer did not restore in the reader')
        // Return to the same home view for the next startup measurement.
        await window.loadURL(ready.origin + '/')
        await wait(libraryReady, 'Home did not restore')
        return { checks: ['answer-completes-hidden', 'history-persisted-once', 'reopened-reader-restores-answer'], answers: before + 1 }
      }
      case 'quit':
        watcher.close()
        await requestQuit()
        return undefined
      default: throw new Error('Unknown beta fixture command')
    }
  }
  const read = async () => {
    if (busy) return
    let command
    try { command = JSON.parse(fs.readFileSync(options.control, 'utf8')) } catch { return }
    if (typeof command.id !== 'string' || command.id === lastId) return
    lastId = command.id; busy = true
    try {
      const result = await execute(command)
      if (result) await publish({ state: 'complete', id: command.id, ...result })
    } catch (error) {
      console.error(`Beta fixture ${command.action} failed: ${error.message}`)
      await publish({ state: 'failed', id: command.id, action: command.action })
    }
    finally { busy = false }
  }
  const watcher = fs.watch(options.directory, (_event, name) => { if (name === 'control.json') void read() })
  watcher.unref()
  await publish({ state: 'ready', tray: !!tray, visible: window.isVisible(), paintObserved })
}
