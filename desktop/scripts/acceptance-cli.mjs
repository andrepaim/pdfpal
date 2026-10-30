// Run the real compiled CLI during installer acceptance and stop it via its SIGINT handler.
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const [stage, data, port, ready, control] = process.argv.slice(2)
if (!stage || !data || !ready || !control || !/^\d+$/.test(port ?? '')) throw new Error('Missing isolated CLI acceptance arguments')
process.env.PDFPAL_DATA_DIR = data; process.env.PDFPAL_DB = path.join(data, 'pdfpal.db')
const cli = path.join(stage, 'dist/cli/index.js')
process.argv = [process.execPath, cli, 'serve', '--no-open', '--port', port]
await import(pathToFileURL(cli).href)
const origin = `http://127.0.0.1:${port}`
let listening = false
for (let i = 0; i < 100; i++) {
  if (await fetch(origin + '/api/health').then(response => response.ok).catch(() => false)) { listening = true; break }
  await new Promise(resolve => setTimeout(resolve, 100))
}
if (!listening) throw new Error('The acceptance CLI did not start')
await fs.writeFile(ready, JSON.stringify({ origin }))
const timer = setInterval(async () => {
  const command = await fs.readFile(control, 'utf8').then(JSON.parse).catch(() => undefined)
  if (command?.quit === true) { clearInterval(timer); process.emit('SIGINT') }
}, 100)
