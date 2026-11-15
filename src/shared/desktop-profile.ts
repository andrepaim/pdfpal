import path from 'node:path'
import os from 'node:os'

/** Desktop settings live separately from the shared ~/.pdfpal library. */
export function defaultDesktopProfile({ platform = process.platform, env = process.env, home = os.homedir(), preview = false }: {
  platform?: string; env?: NodeJS.ProcessEnv; home?: string; preview?: boolean
} = {}): string {
  const name = preview ? 'pdfpal-cloud-preview' : 'pdfpal-desktop'
  if (env.PDFPAL_DESKTOP_PROFILE) return path.resolve(env.PDFPAL_DESKTOP_PROFILE)
  if (platform === 'win32') return path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), name)
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', name)
  // XDG specifies that relative paths must be ignored.
  return path.join(env.XDG_CONFIG_HOME && path.isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : path.join(home, '.config'), name)
}
