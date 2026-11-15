import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'

/** Desktop Entry Exec has two escaping layers and never invokes a shell. */
export function desktopExecArgument(value) {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('Startup paths must not contain control characters.')
  return '"' + value.replace(/%/g, '%%').replace(/[\\"`$]/g, '\\$&').replace(/\\/g, '\\\\') + '"'
}

export function linuxAutostart({ id = 'io.pdfpal.desktop', env = process.env, home = os.homedir() } = {}) {
  if (!/^[A-Za-z0-9.-]+$/.test(id)) throw new Error('Invalid application identifier')
  const directory = path.join(env.XDG_CONFIG_HOME && path.isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : path.join(home, '.config'), 'autostart')
  const filename = path.join(directory, `${id}.desktop`)
  function existingEntry() {
    try {
      const info = fs.lstatSync(filename)
      if (!info.isFile() || info.isSymbolicLink()) throw new Error('The startup entry is not a regular file. Remove it manually before changing this preference.')
      const value = fs.readFileSync(filename, 'utf8')
      if (!/^X-pdfpal-Autostart=true$/m.test(value)) throw new Error('An unmanaged startup entry already exists. Remove it manually before changing this preference.')
      return value
    } catch (error) { if (error.code === 'ENOENT') return; throw error }
  }
  return {
    filename,
    enabled() {
      try { const value = existingEntry(); return !!value && !/^Hidden=true$/m.test(value) }
      catch { return false }
    },
    set(enabled, executable, args = []) {
      existingEntry()
      if (!enabled) { fs.rmSync(filename, { force: true }); return }
      if (!path.isAbsolute(executable)) throw new Error('Startup requires an absolute executable path.')
      // GIO checks the executable's existence before unescaping %% field codes.
      // env avoids that ambiguity for executable names containing literal % (or
      // =, which the Desktop Entry specification forbids in the first token).
      const command = /[%=]/.test(executable) ? ['/usr/bin/env', '--', executable, ...args] : [executable, ...args]
      const exec = command.map(desktopExecArgument).join(' ')
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
      const temporary = `${filename}.${randomUUID()}.tmp`
      try {
        fs.writeFileSync(temporary, `[Desktop Entry]\nType=Application\nName=pdfpal\nComment=Open your local reading library\nExec=${exec}\nTerminal=false\nX-pdfpal-Autostart=true\n`, { mode: 0o600, flag: 'wx' })
        fs.renameSync(temporary, filename)
      } finally { fs.rmSync(temporary, { force: true }) }
    },
  }
}

// Linux tray creation does not establish whether a shell actually displays it.
export const closeToTray = (platform, tray) => platform === 'win32' && !!tray && !tray.isDestroyed()
export const initiallyHidden = (platform, { hidden, tray, setupComplete }) => platform === 'win32' && hidden && !!tray && !tray.isDestroyed() && setupComplete

export function linuxMenuTemplate(actions, { ready = false, starting = false, startup = false } = {}) {
  const item = (label, action, accelerator, enabled = ready) => ({ label, enabled, ...(accelerator ? { accelerator } : {}), click: () => actions[action]() })
  return [
    { label: '&Library', submenu: [
      item('All projects', 'home', 'Ctrl+Shift+H'),
      item('Open in browser', 'browser'),
      { type: 'separator' },
      item('Command line & ChatGPT', 'cli'), item('AI settings', 'ai', 'Ctrl+,'),
      item('Cloud library', 'cloud'), item('Backups & recovery', 'backups'),
      item('Privacy & diagnostics', 'privacy'), item('Kindle extension', 'extensions'),
      { type: 'separator' }, item('Quit pdfpal', 'quit', 'Ctrl+Q', true),
    ] },
    { label: '&Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: '&View', submenu: [
      item('Back', 'back', 'Alt+Left'), item('Forward', 'forward', 'Alt+Right'),
      { type: 'separator' }, item('Zoom in', 'zoomIn', 'Ctrl+='), item('Zoom out', 'zoomOut', 'Ctrl+-'), item('Actual size', 'zoomReset', 'Ctrl+0'),
      item('Full screen', 'fullscreen', 'F11', true), item('Open pdfpal', 'show', undefined, true),
    ] },
    { label: '&Settings', submenu: [
      { label: 'Start at login', type: 'checkbox', checked: startup, enabled: ready, click: item => actions.startup(item.checked) },
      item('Retry service', 'retry', undefined, !ready && !starting),
    ] },
    { label: '&Help', submenu: [item('Software updates', 'updates', undefined, true), item('Diagnostics', 'diagnostics', undefined, true), item('Send feedback', 'feedback', undefined, true), item('Third-party licenses', 'licenses', undefined, true)] },
  ]
}
