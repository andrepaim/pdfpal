// Scores several variants in one go and prints a compact comparison with the
// keep-rule checks. Usage: npx tsx scripts/retrieval-eval/compare-all.ts [NAME...] [--against NAME] [--json FILE]
// Holdout questions are never included.
import fs from 'node:fs'
import { CATEGORIES } from './corpus.js'
import { runEvaluation, type EvaluationReport, type ScopeReport } from './harness.js'
import type { Summary } from './metrics.js'
import { variants } from './variants.js'

const args = process.argv.slice(2)
const option = (flag: string) => args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined
const jsonPath = option('--json')
const against = option('--against') ?? 'baseline'
const names = args.filter((arg, index) => !arg.startsWith('--') && !['--json', '--against'].includes(args[index - 1] ?? ''))
const selected = (names.length ? names : Object.keys(variants)).filter(name => name !== against)
const reports: EvaluationReport[] = []
for (const name of [against, ...selected]) {
  const variant = variants[name]
  if (!variant) throw new Error(`Unknown variant ${name}`)
  reports.push(runEvaluation(variant))
}
const base = reports[0]!
const fmt = (s: Summary) => `${s.recall_at_6.toFixed(3)} ${s.recall_at_16.toFixed(3)} ${s.mrr.toFixed(3)} ${String(s.context_chars_at_6).padStart(6)} ${String(s.context_chars_at_16).padStart(6)}`
const hits = (scope: ScopeReport, category: string, key: 'hit_at_6' | 'hit_at_16') => scope.results.filter(r => r.category === category && r[key]).length
for (const report of reports) {
  console.log(`\n== ${report.variant.name}: ${report.variant.description}`)
  for (const scopeName of ['product', 'library'] as const) {
    const scope = report[scopeName], before = base[scopeName]
    console.log(`  ${scopeName.padEnd(8)} overall ${fmt(scope.overall)} | pt ${fmt(scope.portuguese)}`)
    const changes = [...CATEGORIES, 'portuguese'].map(category => {
      const d6 = hits(scope, category, 'hit_at_6') - hits(before, category, 'hit_at_6'), d16 = hits(scope, category, 'hit_at_16') - hits(before, category, 'hit_at_16')
      const mrr = (category === 'portuguese' ? scope.portuguese : scope.categories[category]!).mrr - (category === 'portuguese' ? before.portuguese : before.categories[category]!).mrr
      return d6 || d16 || Math.abs(mrr) > 1e-9 ? `${category} ${d6 >= 0 ? '+' : ''}${d6}@6 ${d16 >= 0 ? '+' : ''}${d16}@16 mrr${mrr >= 0 ? '+' : ''}${mrr.toFixed(3)}` : ''
    }).filter(Boolean)
    if (report !== base) console.log(`           vs ${base.variant.name}: ${changes.join('; ') || 'no change'}`)
    const fixed = scope.results.filter(r => r.hit_at_16 && !before.results.find(b => b.id === r.id)?.hit_at_16).map(r => r.id)
    const lost = scope.results.filter(r => !r.hit_at_16 && before.results.find(b => b.id === r.id)?.hit_at_16).map(r => r.id)
    if (report !== base && (fixed.length || lost.length)) console.log(`           @16 fixed: ${fixed.join(', ') || '-'}; lost: ${lost.join(', ') || '-'}`)
  }
}
if (jsonPath) fs.writeFileSync(jsonPath, JSON.stringify(reports.map(report => ({ variant: report.variant, product: { overall: report.product.overall, categories: report.product.categories, portuguese: report.product.portuguese }, library: { overall: report.library.overall, categories: report.library.categories, portuguese: report.library.portuguese } })), null, 2))
