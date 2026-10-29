import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

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
  fs.writeFileSync(path.join(stage, 'THIRD_PARTY_NOTICES.txt'), notices.join('\n'))
  return visited.size - 3
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`Third-party notices generated for ${writeNotices(path.resolve(process.argv[2]), path.resolve(process.argv[3]))} installed packages.`)
}
