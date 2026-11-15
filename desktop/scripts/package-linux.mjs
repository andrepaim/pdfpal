import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const desktop = fileURLToPath(new URL('../', import.meta.url))
/** Extend the pinned builder's hooks, preserving sandbox/AppArmor and menu setup. */
export async function linuxHooks(directory, templates) {
  const hooks = {}
  for (const [setting, name] of [['afterInstall', 'after-install'], ['afterRemove', 'after-remove']]) {
    const upstream = await fs.readFile(path.join(templates, `${name}.tpl`), 'utf8')
    const extension = await fs.readFile(path.join(desktop, `build/linux-${name}.sh`), 'utf8')
    const filename = path.join(directory, `linux-${name}.sh`)
    await fs.writeFile(filename, upstream + '\n# pdfpal bundled CLI integration\n' + extension, { mode: 0o700 })
    hooks[setting] = filename
  }
  return hooks
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.platform !== 'linux') throw new Error('Build Linux packages on Linux')
  const { build, Platform, Arch } = await import('electron-builder')
  const require = createRequire(import.meta.url)
  const templates = path.join(path.dirname(require.resolve('app-builder-lib/package.json')), 'templates/linux')
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfpal-linux-hooks-'))
  try {
    const hooks = await linuxHooks(temporary, templates)
    await build({ projectDir: desktop, targets: Platform.LINUX.createTarget(['dir', 'deb'], Arch.x64),
      config: { extends: path.join(desktop, 'electron-builder.yml'), deb: hooks }, publish: 'never' })
  } finally { await fs.rm(temporary, { recursive: true, force: true }) }
}
