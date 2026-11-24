import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dictionaryDirectory, dictionaryNotice } from '../../scripts/prepare-dictionary.mjs'

/** Enumerate installed runtime and bundled UI dependencies, never build/test tooling roots. */
export function writeNotices(stage, sourceRoot) {
  const visited = new Set(), notices = ['pdfpal third-party notices', 'Electron and Chromium licenses are also included beside the application executable.\n']
  function visit(filename, isRoot = false) {
    const resolved = fs.realpathSync(filename)
    if (visited.has(resolved)) return
    visited.add(resolved)
    const pkg = JSON.parse(fs.readFileSync(resolved, 'utf8')), directory = path.dirname(resolved)
    if (!isRoot) {
      notices.push(`\n${'='.repeat(72)}\n${pkg.name} ${pkg.version}\nLicense: ${typeof pkg.license === 'string' ? pkg.license : JSON.stringify(pkg.license ?? pkg.licenses ?? 'See bundled license/repository')}\n`)
      if (typeof pkg.repository === 'string') notices.push(`Repository: ${pkg.repository}\n`)
      else if (pkg.repository?.url) notices.push(`Repository: ${pkg.repository.url}\n`)
      for (const name of fs.readdirSync(directory).filter(name => /^(?:licen[cs]e|copying|notice)(?:[._-].*)?$/i.test(name)).sort()) {
        const file = path.join(directory, name), stat = fs.statSync(file)
        if (stat.isFile() && stat.size < 512 * 1024) notices.push(`\n--- ${name} ---\n${fs.readFileSync(file, 'utf8')}\n`)
      }
    }
    const require = createRequire(resolved)
    for (const name of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies }).sort()) {
      let candidate
      try { candidate = require.resolve(`${name}/package.json`) } catch {
        try {
          let directory = path.dirname(require.resolve(name))
          while (directory !== path.dirname(directory)) {
            const file = path.join(directory, 'package.json')
            if (fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8')).name === name) { candidate = file; break }
            directory = path.dirname(directory)
          }
        } catch {}
      }
      if (candidate) visit(candidate)
      else if (pkg.dependencies?.[name] && !pkg.optionalDependencies?.[name]) throw new Error(`Cannot find runtime license metadata: ${name}`)
    }
  }
  for (const file of [path.join(stage, 'package.json'), ...['frontend', 'extension'].map(name => path.join(sourceRoot, name, 'package.json'))]) visit(file, true)
  const dictionary = path.join(stage, dictionaryDirectory, dictionaryNotice)
  notices.push(`\n${'='.repeat(72)}\nEnglish Wiktionary dictionary data (CC BY-SA 4.0)\n\n--- ${dictionaryNotice} ---\n${fs.readFileSync(dictionary, 'utf8')}\n`)
  // The share-card fonts are files in frontend/public/fonts, not packages, so the walk above does not find
  // them either. The SIL Open Font License asks for its text with every copy.
  for (const [family, file] of [['Inter', 'Inter-OFL.txt'], ['Newsreader', 'Newsreader-OFL.txt']]) {
    const license = path.join(sourceRoot, 'frontend/public/fonts', file)
    if (fs.existsSync(license)) notices.push(`\n${'='.repeat(72)}\n${family} font (SIL Open Font License 1.1)\nUsed to draw share cards.\n\n--- ${file} ---\n${fs.readFileSync(license, 'utf8')}\n`)
    else throw new Error(`Cannot find the font license: ${file}`)
  }
  fs.writeFileSync(path.join(stage, 'THIRD_PARTY_NOTICES.txt'), notices.join('\n'))
  return visited.size - 3
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`Third-party notices generated for ${writeNotices(path.resolve(process.argv[2]), path.resolve(process.argv[3]))} installed packages.`)
}
