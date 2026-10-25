import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildServer } from '../../dist/server/app.js';
import { loadConfig } from '../../dist/core/config.js';
import { openDatabase } from '../../dist/core/database.js';
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
    await page.locator('#server-url').fill(base);
    await page.locator('#pair-code').fill(new ExtensionAuth(db).pairCode().code);
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(page.locator('#connection-status')).toContainText('Connected');
    await expect(page.locator('#project')).toHaveValue(project.id);
    const original = await credentials(page);
    expect(original.projectId).toBe(project.id);

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

    const cdp = await context.browser()!.newBrowserCDPSession();
    const installed = await cdp.send('Extensions.loadUnpacked', { path: second });
    expect(installed.id).toBe(id);
    page = await reopen();
    expect(await page.evaluate(() => chrome.runtime.getManifest().version)).toBe(manifest.version);
    await expect(page.locator('#settings-dialog')).not.toBeVisible();
    expect((await credentials(page)).token === original.token).toBe(true);

    await context.close(); context = await launch(second);
    page = await reopen();
    expect(await page.evaluate(() => chrome.runtime.id)).toBe(id);
    await expect(page.locator('#project')).toHaveValue(project.id);
    expect((await credentials(page)).token === original.token).toBe(true);
    expect((db.prepare('SELECT COUNT(*) n FROM extension_clients').get() as { n: number }).n).toBe(1);
  } finally {
    await context?.close(); await app.close(); db.close();
    await rm(temporary, { recursive: true, force: true });
  }
});
