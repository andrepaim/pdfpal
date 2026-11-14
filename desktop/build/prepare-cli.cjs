const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

// The macOS executable is Contents/MacOS/<productFilename>; acceptance builds use another name.
function macExecutableName(packager) {
  const name = packager.appInfo?.productFilename ?? packager.config.executableName ?? 'pdfpal'
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) throw new Error('Invalid application executable name for the macOS CLI launcher.')
  return name
}
function macLauncher(executable) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(executable)) throw new Error('Invalid application executable name for the macOS CLI launcher.')
  return fs.readFileSync(path.join(__dirname, 'pdfpal-cli.sh'), 'utf8').replaceAll('__PDFPAL_EXECUTABLE__', executable)
}
// Written to stage/cli-bin, which electron-builder.yml serves as Contents/Resources/bin on macOS only.
function writeMacLauncher(projectDir, executable) {
  const directory = path.join(projectDir, 'stage/cli-bin')
  fs.rmSync(directory, { recursive: true, force: true })
  fs.mkdirSync(directory, { recursive: true })
  const file = path.join(directory, 'pdfpal')
  fs.writeFileSync(file, macLauncher(executable), { mode: 0o755 })
  fs.chmodSync(file, 0o755)
  return file
}

module.exports = async context => {
  if (context.electronPlatformName === 'darwin') {
    writeMacLauncher(context.packager.projectDir, macExecutableName(context.packager))
    return
  }
  if (context.electronPlatformName !== 'win32') return
  if (process.platform !== 'win32') throw new Error('Build the Windows CLI under native Windows.')
  const result = spawnSync(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'build-cli-launcher.ps1'),
    '-Output', path.join(context.packager.projectDir, 'stage/cli-bin/pdfpal.exe'),
    '-ApplicationExecutable', (context.packager.config.executableName ?? 'pdfpal') + '.exe',
  ], { encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) throw new Error('Windows CLI compilation failed: ' + (result.stderr ?? ''))
}
module.exports.macExecutableName = macExecutableName
module.exports.macLauncher = macLauncher
module.exports.writeMacLauncher = writeMacLauncher
