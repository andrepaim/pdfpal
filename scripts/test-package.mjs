import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { unzipSync } from 'fflate';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(new URL('../extension/package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'pdfpal package smoke '));
let server, browser;
try {
  const output = execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', temporary], { cwd: root, encoding: 'utf8' });
  // Some npm versions still run prepare and mix build output into stdout. The final JSON
  // array starts at column zero; parse it without depending on lifecycle logging behavior.
  const packed = JSON.parse(output.slice(output.lastIndexOf('\n[') + 1))[0];
  assert.ok(!packed.files.some(file => /\.pdf$|Zone.Identifier|test-results|playwright-report|\.db$/.test(file.path)));
  for (const name of ['dist/cli/index.js', 'frontend/dist/index.html', 'extension/package/companion.zip', 'extension/dist/manifest.json'])
    assert.ok(packed.files.some(file => file.path === name), name);
  const prefix = path.join(temporary, 'installed application');
  execFileSync('npm', ['install', '--prefix', prefix, '--omit=dev', '--no-audit', '--no-fund', path.join(temporary, packed.filename)], { stdio: 'pipe' });
  const cwd = path.join(temporary, 'unrelated directory'); await mkdir(cwd);
  const cli = path.join(prefix, 'node_modules/pdfpal/dist/cli/index.js');
  assert.match(execFileSync(process.execPath, [cli, '--help'], { cwd, encoding: 'utf8', env: { ...process.env, PDFPAL_DATA_DIR: path.join(temporary, 'data') } }), /Kindle/);
  const fixture = path.join(temporary, 'fixture-agent');
  await writeFile(fixture, '#!/usr/bin/env node\nprocess.stdin.resume();process.stdin.on("end",()=>process.stdout.write("A useful explanation of the book."));\n', { mode: 0o700 });
  const socket = createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [cli, 'serve', '--no-open', '--port', String(port)], { cwd,
    env: { ...process.env, PDFPAL_DATA_DIR: path.join(temporary, 'data'), PDFPAL_AGENT: 'codex', CODEX_BIN: fixture }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; server.stdout.on('data', data => { log = (log + data).slice(-4000); }); server.stderr.on('data', data => { log = (log + data).slice(-4000); });
  let ready = false;
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`${base}/api/health`)).ok) { ready = true; break; } } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
  assert.ok(ready, `Installed server did not start: ${log}`);
  const index = await (await fetch(base)).text(); const asset = index.match(/src="([^\"]+\.js)"/)[1];
  assert.match((await fetch(new URL(asset, base))).headers.get('content-type'), /javascript/);
  const metadata = await (await fetch(`${base}/api/extensions/package`)).json();
  const download = await fetch(`${base}/api/extensions/download`);
  assert.equal(download.headers.get('content-type'), 'application/zip');
  const zip = Buffer.from(await download.arrayBuffer());
  assert.equal(createHash('sha256').update(zip).digest('hex'), metadata.sha256);
  const extracted = path.join(temporary, 'extracted extension');
  for (const [name, content] of Object.entries(unzipSync(zip))) {
    assert.ok(!name.split('/').includes('..') && !path.isAbsolute(name));
    const destination = path.join(extracted, name); await mkdir(path.dirname(destination), { recursive: true }); await writeFile(destination, content);
  }
  const manifest = JSON.parse(await readFile(path.join(extracted, 'manifest.json'), 'utf8'));
  assert.equal(manifest.version, metadata.version);
  const project = await (await fetch(`${base}/api/projects`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Packaged reading' }) })).json();
  browser = await chromium.launchPersistentContext(path.join(temporary, 'browser'), { channel: 'chromium', headless: true,
    ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}),
    args: [`--disable-extensions-except=${extracted}`, `--load-extension=${extracted}`] });
  const worker = browser.serviceWorkers()[0] ?? await browser.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host; assert.equal(id, metadata.extension_id);
  const reader = await browser.newPage();
  await reader.route('https://read.amazon.com/**', route => route.fulfill({ contentType: 'text/html', body: '<title>A Test Book - Kindle</title><h1 data-testid="book-title">A Test Book</h1><p>Reading connects new ideas.</p>' }));
  await reader.goto('https://read.amazon.com/?asin=PACKAGE001');
  const tabId = await worker.evaluate(async () => (await chrome.tabs.query({ url: 'https://read.amazon.com/*' }))[0].id);
  const panel = await browser.newPage(); await panel.goto(`chrome-extension://${id}/panel.html?tabId=${tabId}`);
  await panel.getByRole('button', { name: 'Connection and settings', exact: true }).click();
  await panel.locator('#advanced-connection').evaluate(element => element.open = true);
  await panel.locator('#server-url').fill(base);
  const opened = browser.waitForEvent('page'); await panel.locator('#connect').click();
  const approval = await opened; await approval.getByRole('button', { name: 'Allow connection' }).click();
  await panel.waitForFunction(() => !document.querySelector('#question').disabled);
  await panel.locator('#question').fill('What idea does this book explore?'); await panel.locator('#ask').click();
  await panel.getByRole('button', { name: 'Save answer', exact: true }).click();
  await panel.locator('#saved-note').waitFor({ state: 'visible' });
  const notes = await (await fetch(`${base}/api/projects/${project.id}/notes`)).json();
  assert.equal(notes.length, 1);
  console.log(`Installed tarball verified outside checkout: ${(packed.size / 1024 / 1024).toFixed(1)} MB, ${packed.files.length} files; guided pairing, fixture chat and saved note passed.`);
} finally {
  await browser?.close();
  if (server && server.exitCode === null) { const exited = once(server, 'exit'); server.kill('SIGTERM'); await exited; }
  await rm(temporary, { recursive: true, force: true });
}
