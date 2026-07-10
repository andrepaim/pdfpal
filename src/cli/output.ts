import readline from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { PdfpalError } from '../core/types.js'

export function print(value: unknown, json = false): void {
  if (json) stdout.write(`${JSON.stringify(value, null, 2)}\n`)
  else if (Array.isArray(value)) {
    if (!value.length) stdout.write('No results.\n')
    else console.table(value)
  } else if (typeof value === 'string') stdout.write(`${value}\n`)
  else console.table([value])
}

export async function confirm(action: string, yes: boolean, json: boolean): Promise<void> {
  if (yes) return
  if (!stdin.isTTY || json) throw new PdfpalError('CONFIRMATION_REQUIRED', `${action}; pass --yes to confirm`, 2)
  const rl = readline.createInterface({ input: stdin, output: stdout })
  const answer = await rl.question(`${action}? [y/N] `)
  rl.close()
  if (!/^y(es)?$/i.test(answer.trim())) throw new PdfpalError('CANCELLED', 'Cancelled', 2)
}

export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of stdin) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8').trim()
}

export function reportError(error: unknown, json: boolean): never {
  const known = error instanceof PdfpalError ? error : new PdfpalError('UNEXPECTED_ERROR', error instanceof Error ? error.message : String(error))
  const body = { error: { code: known.code, message: known.message, ...(known.details === undefined ? {} : { details: known.details }) } }
  process.stderr.write(json ? `${JSON.stringify(body)}\n` : `pdfpal: ${known.message}\n`)
  process.exit(known.exitCode)
}
