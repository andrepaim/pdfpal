import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { discoverAgent, runProbe } from '../../dist/core/agent-discovery.js'

// Run explicitly: generation consumes allowance. Never print raw auth or model output.
export async function checkProviders(live = false, only) {
  if (only && !['claude', 'codex'].includes(only)) throw new Error('Unknown agent')
  const report = { platform: process.platform, arch: process.arch, checkedAt: new Date().toISOString(), live, agents: [] }
  for (const agent of only ? [only] : ['claude', 'codex']) {
    const detected = await discoverAgent(agent, process.env[agent === 'claude' ? 'CLAUDE_BIN' : 'CODEX_BIN'])
    const { executable, ...safe } = detected
    const result = { ...safe, generation: 'not_requested' }
    if (live && detected.state === 'installed' && detected.auth === 'account') {
      const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfpal-provider-m0-'))
      try {
        const prompt = 'Reply with exactly PDFPAL_CONNECTION_OK. Do not use any tools.'
        const args = agent === 'claude' ? ['--print', '--tools', ''] : ['--ask-for-approval', 'never', 'exec', '--skip-git-repo-check', '--sandbox', 'read-only', '-']
        const answer = await runProbe(executable, args, { stdin: prompt, cwd, timeoutMs: 120000 })
        result.generation = answer.code === 0 && answer.stdout.trim() === 'PDFPAL_CONNECTION_OK' ? 'passed' : answer.failure ?? 'failed'
        if (result.generation === 'failed' && /OAuth session expired|Failed to authenticate/i.test(`${answer.stdout}\n${answer.stderr}`)) result.generation = 'authentication_expired'
      } finally { await fs.rm(cwd, { recursive: true, force: true, maxRetries: 5 }) }
    }
    report.agents.push(result)
  }
  return report
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const live = process.argv.includes('--live')
  const report = await checkProviders(live, process.argv.find(arg => arg.startsWith('--agent='))?.split('=')[1])
  console.log(JSON.stringify(report, null, 2))
  if (live && report.agents.some(agent => agent.generation !== 'passed')) process.exitCode = 1
}
