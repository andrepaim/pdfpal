import fs from 'node:fs'
import path from 'node:path'
export function registeredLibrary(libraries,id){
  if(typeof id!=='string'||!(id==='original'||/^[a-f0-9-]{36}$/.test(id))||!libraries||!Object.hasOwn(libraries,id))return
  const item=libraries[id]
  if(!item||typeof item.dataDir!=='string'||typeof item.dbPath!=='string'||!path.isAbsolute(item.dataDir)||!path.isAbsolute(item.dbPath)||typeof item.label!=='string')return
  return item
}

export function safeRoute(route) {
  return typeof route === 'string' && route.startsWith('/') && !route.startsWith('//') && !/[\\\u0000-\u001f]/.test(route) ? route : '/'
}

export function startupArguments(startup, profile) {
  // Electron's Windows login registration joins args into a command line.
  const quote = value => /[\s"]/.test(value) ? `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"` : value
  return ['--hidden', ...[
    `--data-dir=${startup.dataDir}`, `--db=${startup.dbPath}`, `--port=${startup.port}`, `--profile=${profile}`,
  ].map(quote)]
}

/**
 * Login-item settings for Electron. Windows registers a named Run entry with the executable and the startup
 * arguments that pin the library. On a Mac only `openAtLogin` applies (name/path/args are Windows-only); the
 * app then starts without arguments and reads the selected library from `activeLibrary` in its preferences.
 */
export function loginItemSettings(platform, { openAtLogin, name, path: executable, args }) {
  return platform === 'win32' ? { name, openAtLogin, path: executable, args } : { openAtLogin }
}
export function loginItemQuery(platform, executable) { return platform === 'win32' ? { path: executable } : undefined }
export function loginItemEnabled(platform, settings, name) {
  if (platform === 'win32') return settings.launchItems.some(item => item.name === name && item.enabled)
  return platform === 'darwin' && settings?.openAtLogin === true
}

export function restoreBounds(saved, displays) {
  const fallback = { width: Math.min(1250, displays[0]?.workArea.width ?? 1250), height: Math.min(850, displays[0]?.workArea.height ?? 850) }
  if (!saved || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(saved[key]))) return fallback
  const display = displays.find(({ workArea: a }) => saved.x < a.x + a.width && saved.x + saved.width > a.x && saved.y < a.y + a.height && saved.y + saved.height > a.y) ?? displays[0]
  if (!display) return fallback
  const a = display.workArea
  const width = Math.min(a.width, Math.max(800, saved.width)), height = Math.min(a.height, Math.max(600, saved.height))
  return { width, height, x: Math.max(a.x, Math.min(saved.x, a.x + a.width - width)), y: Math.max(a.y, Math.min(saved.y, a.y + a.height - height)) }
}

export function preferences(filename) {
  let value = {}
  try { value = JSON.parse(fs.readFileSync(filename, 'utf8')); if (!value || typeof value !== 'object' || Array.isArray(value)) value = {} } catch {}
  value.route = safeRoute(value.route)
  return {
    get value() { return value },
    update(patch) {
      value = { ...value, ...patch, version: 1 }
      fs.mkdirSync(path.dirname(filename), { recursive: true })
      const temporary = `${filename}.${process.pid}.tmp`
      fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
      fs.renameSync(temporary, filename)
    },
  }
}

/** An alpha launcher may have last opened a project in another library. */
export async function restoreLibraryRoute(saved, origin, request = fetch) {
  const route = safeRoute(saved)
  const project = route.match(/^\/projects\/([a-f0-9-]{36})(?:\/|$)/i)?.[1]
  if (!project) return route
  try {
    const response = await request(`${origin}/api/projects/${project}`, { signal: AbortSignal.timeout(2000) })
    await response.body?.cancel().catch(() => {})
    return response.status === 404 ? '/' : route
  } catch { return route }
}
