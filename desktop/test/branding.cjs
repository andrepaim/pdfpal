// Native Electron supplies real .lnk property stores in an isolated test folder.
const { app, shell, nativeImage } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
app.whenReady().then(() => {
  const [source, root] = process.argv.slice(2)
  const local = path.join(root, 'local')
  const alpha = path.join(local, 'pdfpal-alpha-m1', 'pdfpal Alpha.exe')
  for (const [name, target, appUserModelId] of [
    ['owned', alpha, 'io.pdfpal.desktop'],
    ['foreign-target', path.join(local, 'another-app', 'electron.exe'), 'io.pdfpal.desktop'],
    ['foreign-id', alpha, 'another.application'],
    ['similar-path', path.join(local, 'pdfpal-alpha-m1-copy', 'pdfpal Alpha.exe'), 'io.pdfpal.desktop'],
  ]) {
    const directory = path.join(root, name)
    fs.mkdirSync(directory, { recursive: true })
    if (!shell.writeShortcutLink(path.join(directory, 'Electron.lnk'), { target, appUserModelId, description: 'Synthetic branding fixture' })) throw new Error('Could not create shortcut fixture')
  }
  const logo = nativeImage.createFromPath(path.join(source, 'frontend/public/icon-512.png'))
  for (const size of [16, 20, 24, 32, 40, 48, 64]) fs.writeFileSync(path.join(root, `${size}-reference.png`), logo.resize({ width: size, height: size, quality: 'best' }).toPNG())
  app.exit(0)
}).catch(error => { console.error(error); app.exit(1) })
