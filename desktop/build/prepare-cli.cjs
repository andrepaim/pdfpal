const path = require('node:path')
const { spawnSync } = require('node:child_process')
module.exports = async context => {
  if (context.electronPlatformName !== 'win32') return
  if (process.platform !== 'win32') throw new Error('Build the Windows CLI under native Windows.')
  const result = spawnSync(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'build-cli-launcher.ps1'),
    '-Output', path.join(context.packager.projectDir, 'stage/cli-bin/pdfpal.exe'),
    '-ApplicationExecutable', (context.packager.config.executableName ?? 'pdfpal') + '.exe',
  ], { encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) throw new Error('Windows CLI compilation failed: ' + (result.stderr ?? ''))
}
