// Builds the offline dictionary (dist/dictionary/wordnet.sqlite) from the
// WordNet text database in the wordnet-db dev dependency and the
// irregular-form lists in data/wordnet. Runs after tsc as part of
// `npm run build:server`; it is skipped when the file is already up to date.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { buildDictionary } from '../dist/core/dictionary-build.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const dictDir = path.join(path.dirname(createRequire(import.meta.url).resolve('wordnet-db/package.json')), 'dict')
const outputDir = path.join(root, 'dist/dictionary')
const started = Date.now()
const result = buildDictionary({ dictDir, exceptionsDir: path.join(root, 'data/wordnet'), output: path.join(outputDir, 'wordnet.sqlite') })
// WordNet's licence requires its notice on every copy of the database.
fs.copyFileSync(path.join(root, 'data/wordnet/LICENSE'), path.join(outputDir, 'WORDNET-LICENSE.txt'))
console.log(result.built
  ? `Dictionary built: ${result.synsets} meanings, ${result.senses} word senses, ${result.exceptions} irregular forms (${Date.now() - started} ms)`
  : 'Dictionary is up to date')
