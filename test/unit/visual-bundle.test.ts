import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

// The web app and the Kindle side panel bundle these modules. A runtime import of the schema module (src/shared/visual.ts)
// pulls zod into both bundles: it added about 900 KB to the side panel, which slowed its start enough to break the side
// panel's tab-following test in CI. Only `import type` may reach the schema module or zod from here.
const root = path.resolve(import.meta.dirname, '../..')
const browserModules = [
  'src/shared/visual-frames.ts',
  ...fs.readdirSync(path.join(root, 'src/shared/visual-kit')).filter(file => file.endsWith('.ts')).map(file => `src/shared/visual-kit/${file}`),
  'frontend/src/components/VisualExplanation.tsx',
  'frontend/src/components/VisualFigure.tsx',
  'frontend/src/lib/visual-html.ts',
  'frontend/src/lib/visual-measure.ts',
]

test('browser-side visual modules import the schema module and zod for types only', () => {
  for (const file of browserModules) {
    const source = fs.readFileSync(path.join(root, file), 'utf8')
    const runtimeImports = [...source.matchAll(/^import\s+(?!type\b)[^;]*?from\s+'([^']+)'/gm)].map(match => match[1]!)
    for (const specifier of runtimeImports) {
      assert.ok(specifier !== 'zod' && !/shared\/visual(\.js)?$/.test(specifier) && !/^\.\.?\/visual(\.js)?$/.test(specifier),
        `${file} imports ${specifier} at runtime; use \`import type\` or a zod-free module`)
    }
  }
})
