import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildServer } from '../../dist/server/app.js';
import { loadConfig } from '../../dist/core/config.js';
import { openDatabase } from '../../dist/core/database.js';
import { ExtensionAuth } from '../../dist/core/extension-auth.js';

const extensionPath = fileURLToPath(new URL('../dist', import.meta.url));
async function setup() {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'pdfpal-guided-'));
  const fixture = path.join(temporary, 'agent');
  await writeFile(fixture, '#!/usr/bin/env node\nprocess.stdin.resume();process.stdin.on("end",()=>process.stdout.write("A useful explanation of the book."));\n', { mode: 0o700 });
  const config = loadConfig({ dataDir: path.join(temporary, 'data'), agent: 'codex', codexBin: fixture });
  let app = await buildServer(config);
  const db = openDatabase(config);
  await app.listen({ host: '127.0.0.1', port: 0 });
  const port = (app.server.address() as { port: number }).port, base = `http://127.0.0.1:${port}`;
  const launch = () => chromium.launchPersistentContext(path.join(temporary, 'browser'), { channel: 'chromium', headless: true,
    ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}),
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`] });
  let context = await launch();
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  const panel = async () => { const page = await context.newPage(); await page.goto(`chrome-extension://${id}/panel.html`); return page; };
  const begin = async (page: Page) => {
    await page.getByRole('button', { name: 'Connection and settings', exact: true }).click();
    await page.locator('#advanced-connection').evaluate((element: HTMLDetailsElement) => element.open = true);
    await page.locator('#server-url').fill(base);
    const opened = context.waitForEvent('page');
    await page.locator('#connect').click();
    const approval = await opened; await approval.waitForLoadState();
    await expect(approval.getByRole('button', { name: 'Allow connection' })).toBeVisible();
    return approval;
  };
  return { base, db, panel, begin, get context() { return context; },
    async project(title: string) { return (await app.inject({ method: 'POST', url: '/api/projects', payload: { title } })).json(); },
    async removeProject(id: string) { await app.inject({ method: 'DELETE', url: `/api/projects/${id}` }); },
    async restartServer() { await app.close(); app = await buildServer(config); await app.listen({ host: '127.0.0.1', port }); },
    async restartBrowser() { await context.close(); context = await launch(); },
    async close() { await context.close(); await app.close(); db.close(); await rm(temporary, { recursive: true, force: true }); } };
}

for (const method of ['guided', 'manual'] as const) test(`${method} pairing refreshes the empty conversation without an open book`, async () => {
  const s = await setup();
  try {
    const project = await s.project('Reading');
    const panel = await s.panel();
    const empty = panel.locator('#messages .empty-state');
    const connect = empty.getByRole('button', { name: 'Connect to pdfpal', exact: true });
    await expect(connect).toBeVisible();
    if (method === 'guided') {
      const approval = await s.begin(panel);
      await approval.getByRole('button', { name: 'Allow connection' }).click();
    } else {
      await panel.getByRole('button', { name: 'Connection and settings', exact: true }).click();
      await panel.locator('#advanced-connection').evaluate((element: HTMLDetailsElement) => element.open = true);
      await panel.locator('#server-url').fill(s.base);
      await panel.locator('#pair-code').fill(new ExtensionAuth(s.db).pairCode().code);
      await panel.locator('#connect').click();
    }
    await expect(panel.locator('#project')).toHaveValue(project.id);
    await expect(connect).toHaveCount(0);
    await expect(empty).not.toContainText('Connect to your local pdfpal');
    await expect(empty).toContainText('Explore an idea');
    await panel.reload();
    await expect(panel.locator('#project')).toHaveValue(project.id);
    await expect(connect).toHaveCount(0);
    await expect(empty).toContainText('Explore an idea');
    await panel.getByRole('button', { name: 'Connection and settings', exact: true }).click();
    await panel.locator('#connection-label').click();
    await panel.locator('#disconnect').click();
    await panel.locator('#close-settings').click();
    await expect(connect).toBeVisible();
    await expect(empty).toContainText('Connect to your local pdfpal');
  } finally { await s.close(); }
});

test('guided approval survives a closed panel and restart; empty library creates a project; management revokes', async ({}, info) => {
  const s = await setup();
  try {
    let panel = await s.panel();
    const approval = await s.begin(panel);
    const requestUrl = approval.url();
    await approval.screenshot({ path: info.outputPath('extension-approval.png'), fullPage: true });
    expect([...new URL(requestUrl).searchParams.keys()]).toEqual(['request']);
    await approval.reload();
    await expect(approval.getByRole('button', { name: 'Allow connection' })).toBeVisible();
    expect((s.db.prepare('SELECT COUNT(*) n FROM extension_clients').get() as { n: number }).n).toBe(0);
    await panel.close();
    await s.restartServer();
    await approval.reload();
    await approval.getByRole('button', { name: 'Allow connection' }).click();
    await expect(approval.getByRole('status')).toContainText('Approved');
    await s.restartBrowser();
    panel = await s.panel();
    await expect(panel.locator('#connection-status')).toContainText('Connected');
    await expect(panel.locator('#new-project-form')).toBeVisible();
    await panel.locator('#project-title').fill('Reading notebook');
    await panel.getByRole('button', { name: 'Create project' }).click();
    await expect(panel.locator('#settings-dialog')).not.toBeVisible();
    await expect(panel.locator('#project')).not.toHaveValue('');
    const metadata = await panel.evaluate(async () => { const value = (await chrome.storage.local.get('companionConnection')).companionConnection as { clientId: string; projectId: string }; return { clientId: value.clientId, projectId: value.projectId }; });
    const web = await s.context.newPage(); await web.goto(`${s.base}/extensions`);
    await expect(web.getByRole('link', { name: 'Download Chrome extension' })).toBeVisible();
    await web.getByLabel('Connection name').fill('My reading browser');
    await web.getByRole('button', { name: 'Save name' }).click();
    await expect.poll(() => (s.db.prepare('SELECT label FROM extension_clients WHERE id=?').get(metadata.clientId) as { label: string }).label).toBe('My reading browser');
    await web.screenshot({ path: info.outputPath('extension-setup.png'), fullPage: true });
    await web.goto(requestUrl);
    await expect(web.getByRole('status')).toContainText('Connected');
    await web.screenshot({ path: info.outputPath('extension-connected.png'), fullPage: true });
    await panel.reload(); await expect(panel.locator('#project')).toHaveValue(metadata.projectId);
    await web.goto(`${s.base}/extensions`); await web.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await expect(web.getByText(/Paired .*Disconnected/)).toBeVisible();
    await panel.reload(); await expect(panel.locator('#connection-status')).toContainText('invalid or revoked');
    expect((s.db.prepare('SELECT COUNT(*) n FROM extension_clients').get() as { n: number }).n).toBe(1);
  } finally { await s.close(); }
});

for (const fault of ['claim response', 'credential storage'] as const) test(`lost ${fault} recovers the same client and multiple projects require a choice`, async () => {
  const s = await setup();
  try {
    const first = await s.project('First project'); const second = await s.project('Second project');
    const panel = await s.panel();
    if (fault === 'claim response') await panel.route('**/api/extension/pairing-requests/*/claim', async route => { await route.fetch(); await route.abort(); });
    else await panel.evaluate(() => {
      const set = chrome.storage.local.set.bind(chrome.storage.local); let fail = true;
      Object.defineProperty(chrome.storage.local, 'set', { value: async (values: Record<string, unknown>) => {
        if (fail && values.companionConnection) { fail = false; throw new Error('Fixture storage interrupted'); }
        return set(values);
      } });
    });
    const approval = await s.begin(panel); await approval.getByRole('button', { name: 'Allow connection' }).click();
    await expect(panel.locator('#connection-status')).toContainText(fault === 'claim response' ? 'Cannot reach pdfpal' : 'Fixture storage interrupted');
    expect((s.db.prepare('SELECT COUNT(*) n FROM extension_clients').get() as { n: number }).n).toBe(1);
    await panel.unroute('**/api/extension/pairing-requests/*/claim');
    await panel.reload(); await expect(panel.locator('#connection-status')).toContainText('Connected');
    await expect(panel.locator('#project')).toHaveValue('');
    await panel.locator('#project').selectOption(second.id);
    await panel.reload(); await expect(panel.locator('#project')).toHaveValue(second.id);
    await s.removeProject(second.id); await panel.reload(); await expect(panel.locator('#project')).toHaveValue(first.id);
    for (const width of [320, 390]) {
      await panel.setViewportSize({ width, height: 850 });
      expect(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    expect((s.db.prepare('SELECT COUNT(*) n FROM extension_clients').get() as { n: number }).n).toBe(1);
  } finally { await s.close(); }
});

test('deny, cancel and expired requests do not pair; a fresh retry works', async () => {
  const s = await setup();
  try {
    await s.project('Reading');
    const panel = await s.panel(); let approval = await s.begin(panel);
    await approval.getByRole('button', { name: 'Deny', exact: true }).click();
    await expect(panel.locator('#connection-status')).toContainText('denied');
    let opened = s.context.waitForEvent('page'); await panel.locator('#connect').click(); approval = await opened;
    await expect(approval.getByRole('button', { name: 'Allow connection' })).toBeVisible();
    await panel.locator('#cancel-connect').click();
    await expect(panel.locator('#pairing-status')).toContainText('cancelled');
    opened = s.context.waitForEvent('page'); await panel.locator('#connect').click(); approval = await opened;
    await expect(approval.getByRole('button', { name: 'Allow connection' })).toBeVisible();
    s.db.prepare("UPDATE extension_pairing_requests SET expires_at=0 WHERE status='pending'").run();
    await expect(panel.locator('#connection-status')).toContainText('expired');
    expect((s.db.prepare('SELECT COUNT(*) n FROM extension_clients').get() as { n: number }).n).toBe(0);
    opened = s.context.waitForEvent('page'); await panel.locator('#connect').click(); approval = await opened;
    await approval.getByRole('button', { name: 'Allow connection' }).click();
    await expect(panel.locator('#connection-status')).toContainText('Connected');
  } finally { await s.close(); }
});

test('lost request creation can reopen approval; offline retry keeps the existing connection', async () => {
  const s = await setup();
  try {
    await s.project('Reading');
    const panel = await s.panel();
    await panel.route('**/api/extension/pairing-requests', async route => { await route.fetch(); await route.abort(); });
    await panel.getByRole('button', { name: 'Connection and settings', exact: true }).click();
    await panel.locator('#advanced-connection').evaluate((e: HTMLDetailsElement) => e.open = true);
    await panel.locator('#server-url').fill(s.base); await panel.locator('#connect').click();
    await expect(panel.locator('#connection-status')).toContainText('Cannot reach pdfpal');
    await panel.unroute('**/api/extension/pairing-requests');
    await panel.reload();
    await expect(panel.locator('#connection-status')).toContainText('Waiting for approval');
    await panel.getByRole('button', { name: 'Connection and settings', exact: true }).click();
    const opened = s.context.waitForEvent('page'); await panel.locator('#open-approval').click(); const approval = await opened;
    await approval.getByRole('button', { name: 'Allow connection' }).click();
    await expect(panel.locator('#connection-status')).toContainText('Connected');
    const id = await panel.evaluate(async () => ((await chrome.storage.local.get('companionConnection')).companionConnection as { clientId: string }).clientId);
    await panel.route('**/api/extension/status', route => route.abort()); await panel.reload();
    await expect(panel.locator('#connection-status')).toContainText('Cannot reach pdfpal');
    expect(await panel.evaluate(async () => ((await chrome.storage.local.get('companionConnection')).companionConnection as { clientId: string }).clientId)).toBe(id);
    await panel.unroute('**/api/extension/status'); await panel.locator('#connect').click();
    await expect(panel.locator('#connection-status')).toContainText('Connected');
    expect((s.db.prepare('SELECT COUNT(*) n FROM extension_clients').get() as { n: number }).n).toBe(1);
  } finally { await s.close(); }
});

test('older server offers manual fallback without creating a guided request', async () => {
  const s = await setup();
  try {
    await s.project('Reading');
    const panel = await s.panel();
    await panel.route('**/api/extension/capabilities', route => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ detail: 'Connect the extension to pdfpal first.' }) }));
    await panel.getByRole('button', { name: 'Connection and settings', exact: true }).click();
    await panel.locator('#advanced-connection').evaluate((e: HTMLDetailsElement) => e.open = true);
    await panel.locator('#server-url').fill(s.base); await panel.locator('#connect').click();
    await expect(panel.locator('#connection-status')).toContainText('use a pairing code');
    expect((s.db.prepare('SELECT COUNT(*) n FROM extension_pairing_requests').get() as { n: number }).n).toBe(0);
  } finally { await s.close(); }
});
