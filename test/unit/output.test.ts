import test from 'node:test'
import assert from 'node:assert/strict'
import { confirm, print } from '../../src/cli/output.js'
import { PdfpalError } from '../../src/core/types.js'

test('print emits JSON when requested', () => {
  let output = ''
  const original = process.stdout.write
  process.stdout.write = ((chunk: string | Uint8Array) => { output += chunk.toString(); return true }) as typeof process.stdout.write
  try { print({ answer: 'ok' }, true); assert.equal(JSON.parse(output).answer, 'ok') }
  finally { process.stdout.write = original }
})

test('destructive confirmation is required for noninteractive execution', async () => {
  await assert.rejects(() => confirm('Delete project', false, false), (error: unknown) => error instanceof PdfpalError && error.code === 'CONFIRMATION_REQUIRED')
  await confirm('Delete project', true, false)
})
