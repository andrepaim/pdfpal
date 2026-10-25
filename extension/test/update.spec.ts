import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildServer } from '../../dist/server/app.js';
import { loadConfig } from '../../dist/core/config.js';
import { openDatabase } from '../../dist/core/database.js';
import { randomUUID } from 'node:crypto';
import { visualFixture } from '../../test/fixtures/visual';
import { ExtensionAuth } from '../../dist/core/extension-auth.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('pairing survives reload, an update from another directory and a browser restart', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'pdfpal-pairing-update-'));
  const first = path.join(temporary, 'extracted-v1'), second = path.join(temporary, 'extracted-v2');
  await cp(path.join(root, 'dist'), first, { recursive: true });
  await cp(path.join(root, 'dist'), second, { recursive: true });
  const manifest = JSON.parse(await readFile(path.join(second, 'manifest.json'), 'utf8'));
  const nextVersion = manifest.version.split('.').map(Number); nextVersion[2]++;
  manifest.version = nextVersion.join('.');
  await writeFile(path.join(second, 'manifest.json'), JSON.stringify(manifest));
  const config = loadConfig({ dataDir: path.join(temporary, 'data'), agent: 'codex' });
  const app = await buildServer(config), db = openDatabase(config);
  let context: BrowserContext | undefined;
  const launch = (directory: string) => chromium.launchPersistentContext(path.join(temporary, 'browser'), {
    channel: 'chromium', headless: true,
    ignoreDefaultArgs: ['--disable-extensions'],
    ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}),
    args: [`--disable-extensions-except=${directory}`, `--load-extension=${directory}`, '--enable-unsafe-extension-debugging'],
  });
  const workerFor = async (browser: BrowserContext) => browser.serviceWorkers()[0] ?? browser.waitForEvent('serviceworker');
  const credentials = (page: Page) => page.evaluate(async () => (await chrome.storage.local.get('companionConnection')).companionConnection as { token: string; clientId: string; projectId: string });
  try {
    await app.listen({ host: '127.0.0.1', port: 0 });
    const base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
    const project = (await app.inject({ method: 'POST', url: '/api/projects', payload: { title: 'Pairing must survive updates' } })).json();
    context = await launch(first);
    const worker = await workerFor(context);
    const id = new URL(worker.url()).host;
    expect(id).toBe('billjanehfdgcakkbbefbjobocjlinen');
    const manager = await context.newPage();
    await manager.goto('chrome://extensions');
    const developerMode = manager.locator('#devMode');
    if (!await developerMode.evaluate((toggle: HTMLElement & { checked: boolean }) => toggle.checked)) await developerMode.click();
    let page = await context.newPage();
    // Reproduce slow settings restoration while the user pairs immediately.
    await page.addInitScript(() => {
      if (!chrome.storage?.local) return;
      const storage = chrome.storage.local, get = storage.get.bind(storage);
      Object.defineProperty(storage, 'get', { value: async (keys: string) => {
        const values = await get(keys);
        if (keys === 'companionConnection') await new Promise(resolve => setTimeout(resolve, 800));
        return values;
      } });
    });
    await page.goto(`chrome-extension://${id}/panel.html`);
    await page.getByRole('button', { name: 'Connection and settings', exact: true }).click();
    await page.locator('#advanced-connection').evaluate((e: HTMLDetailsElement) => e.open = true);
    await page.locator('#server-url').fill(base);
    await page.locator('#pair-code').fill(new ExtensionAuth(db).pairCode().code);
    await page.locator('#settings-dialog').getByRole('button', { name: 'Connect to pdfpal', exact: true }).click();
    await expect(page.locator('#connection-status')).toContainText('Connected');
    await expect(page.locator('#project')).toHaveValue(project.id);
    const original = await credentials(page);
    expect(original.projectId).toBe(project.id);
    const visualId = randomUUID(), conversationId = randomUUID(), turnId = randomUUID();
    const metadata = { title: 'Persistent book', author: '', location: '', asin: 'UPDATE0001', url: 'https://read.amazon.com/?asin=UPDATE0001' };
    const capture = { metadata, text: 'A persistent passage', originalText: 'A persistent passage', method: 'text', capturedAt: new Date().toISOString() };
    db.prepare(`INSERT INTO visual_explanations(id,project_id,client_id,request_id,request_hash,question,status,definition_json,references_json,request_json,created_at,updated_at)
      VALUES (?,?,?,?,'hash','Visual question','complete',?,'[]','{}','2020-01-01','2020-01-01')`).run(visualId, project.id, original.clientId, randomUUID(), JSON.stringify(visualFixture));
    db.prepare('INSERT INTO kindle_conversations VALUES (?,?,?,?,?,?)').run(conversationId, original.clientId, project.id, 'https://read.amazon.com/UPDATE0001', 'Persistent book', '2020-01-01');
    db.prepare(`INSERT INTO kindle_turns(id,client_id,conversation_id,request_id,request_hash,capture_json,question,status,answer,created_at,updated_at,visual_id)
      VALUES (?,?,?,?,'hash',?,'Question','complete','Existing answer','2020-01-01','2020-01-01',?)`).run(turnId, original.clientId, conversationId, randomUUID(), JSON.stringify(capture), visualId);
    const historySurvived = async (panel: Page) => {
      const current = await credentials(panel); expect(current.clientId).toBe(original.clientId); expect(current.projectId).toBe(original.projectId);
      const result = await panel.evaluate(async ({ base, metadata, visualId }) => {
        const value = (await chrome.storage.local.get('companionConnection')).companionConnection as { token: string; projectId: string };
        const headers = { authorization: `Bearer ${value.token}`, 'content-type': 'application/json' };
        const history = await (await fetch(`${base}/api/extension/history`, { method: 'POST', headers, body: JSON.stringify({ project_id: value.projectId, metadata }) })).json();
        const visual = await (await fetch(`${base}/api/extension/projects/${value.projectId}/visuals/${visualId}`, { headers })).json();
        return { answer: history.turns[0]?.answer, visual: visual.definition?.title };
      }, { base, metadata, visualId });
      expect(result).toEqual({ answer: 'Existing answer', visual: visualFixture.title });
    };

    const reopen = async () => {
      const panel = await context!.newPage();
      await expect(async () => {
        await panel.goto(`chrome-extension://${id}/panel.html`);
        await expect(panel.locator('#connection-status')).toContainText('Connected');
      }).toPass({ timeout: 15_000 });
      return panel;
    };
    await manager.locator('#dev-reload-button').click();
    page = await reopen();
    expect((await credentials(page)).token === original.token).toBe(true);
    await historySurvived(page);

    const cdp = await context.browser()!.newBrowserCDPSession();
    const installed = await cdp.send('Extensions.loadUnpacked', { path: second });
    expect(installed.id).toBe(id);
    page = await reopen();
    expect(await page.evaluate(() => chrome.runtime.getManifest().version)).toBe(manifest.version);
    await expect(page.locator('#settings-dialog')).not.toBeVisible();
    expect((await credentials(page)).token === original.token).toBe(true);
    await historySurvived(page);

    await context.close(); context = await launch(second);
    page = await reopen();
    expect(await page.evaluate(() => chrome.runtime.id)).toBe(id);
    await expect(page.locator('#project')).toHaveValue(project.id);
    expect((await credentials(page)).token === original.token).toBe(true);
    await historySurvived(page);
    expect((db.prepare('SELECT COUNT(*) n FROM extension_clients').get() as { n: number }).n).toBe(1);
  } finally {
    await context?.close(); await app.close(); db.close();
    await rm(temporary, { recursive: true, force: true });
  }
});
