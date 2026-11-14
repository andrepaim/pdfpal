// Retrieval quality evaluation over the committed fixture corpus.
// Usage: npm run eval:retrieval -- [--json] [--include-holdout] [--variant NAME] [--compare REPORT.json]
//
// Needs the corpus text cache once: `npm run eval:retrieval:fetch`.
// Indexes the cached corpus into a temporary library through the real
// RetrievalService and prints recall@6, recall@16, MRR and context size per
// question category. Offline and deterministic; separate from `npm test`.
// --include-holdout scores the held-out questions too: only for the final
// before/after check (RET-09), never while tuning.
import fs from 'node:fs'
import { formatReport, runEvaluation, type EvaluationReport } from './retrieval-eval/harness.js'
import { variants } from './retrieval-eval/variants.js'

const args = process.argv.slice(2)
const option = (name: string) => {
  const index = args.indexOf(name)
  if (index < 0) return undefined
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} needs a value`)
  return value
}
const known = new Set(['--json', '--include-holdout', '--variant', '--compare'])
const unknown = args.filter((arg, index) => arg.startsWith('--') ? !known.has(arg) : !['--variant', '--compare'].includes(args[index - 1] ?? ''))
if (unknown.length) {
  console.error(`Unknown argument(s): ${unknown.join(' ')}\nUsage: npm run eval:retrieval -- [--json] [--include-holdout] [--variant ${Object.keys(variants).join('|')}] [--compare REPORT.json]`)
  process.exit(2)
}
const name = option('--variant') ?? 'current'
const variant = variants[name]
if (!variant) {
  console.error(`Unknown variant "${name}". Available: ${Object.keys(variants).join(', ')}`)
  process.exit(2)
}
// Never let an environment override point the temporary library at a real one.
delete process.env.PDFPAL_DB
delete process.env.PDFPAL_DATA_DIR

const comparePath = option('--compare')
const compare = comparePath ? JSON.parse(fs.readFileSync(comparePath, 'utf8')) as EvaluationReport : undefined
let report: EvaluationReport
try {
  report = runEvaluation(variant, { includeHoldout: args.includes('--include-holdout') })
} catch (error) {
  console.error((error as Error).message)
  process.exit(1)
}
for (const warning of report.corpus.warnings) console.error(`WARNING: ${warning}`)
process.stdout.write(args.includes('--json') ? `${JSON.stringify(report, null, 2)}\n` : formatReport(report, compare))
