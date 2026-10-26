import { test, expect, chromium, type BrowserContext } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildServer } from '../../dist/server/app.js';
import { loadConfig } from '../../dist/core/config.js';
import { openDatabase } from '../../dist/core/database.js';
import { ExtensionAuth } from '../../dist/core/extension-auth.js';
import { kindleLaunchUrl } from '../../src/shared/kindle-book';

test('project links select the right project; the companion saves books and respects manual choices', async ({}, info) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'pdfpal-kindle-books-'));
  const config = loadConfig({ dataDir: path.join(temporary, 'data'), agent: 'codex' });
  const app = await buildServer(config), db = openDatabase(config);
  let context: BrowserContext | undefined;
  try {
    await app.listen({ host: '127.0.0.1', port: 0 });
    const base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
    const createProject = async (title: string) => (await app.inject({ method: 'POST', url: '/api/projects', payload: { title } })).json();
    const first = await createProject('Previously selected');
    const target = await createProject('Books from pdfpal');
    const other = await createProject('Another collection');
    const missing = await createProject('No matching book');
    const book = { url: 'https://read.amazon.com/?asin=TESTBOOK01', title: 'A book to revisit', author: 'Reader Author' };
    await app.inject({ method: 'POST', url: `/api/projects/${other.id}/kindle-books`, payload: book });
    const extensionPath = fileURLToPath(new URL('../dist', import.meta.url));
    context = await chromium.launchPersistentContext(path.join(temporary, 'browser'), {
      channel: 'chromium', headless: true,
      ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}),
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    await context.route('https://read.amazon.com/**', route => route.fulfill({ contentType: 'text/html', body: '<title>A book to revisit - Kindle</title><h1 data-testid="book-title">A book to revisit</h1><p data-testid="book-author">Reader Author</p>' }));
    await context.route('https://ler.amazon.com.br/**', route => route.fulfill({ contentType: 'text/html', body: '<title>Regional book - Kindle</title><h1 data-testid="book-title">Regional book</h1>' }));
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).host;
    const auth = new ExtensionAuth(db), credentials = auth.exchange(auth.pairCode().code, `chrome-extension://${extensionId}`);
    await worker.evaluate(connection => chrome.storage.local.set({ companionConnection: connection }), { base, token: credentials.token, clientId: credentials.client_id, projectId: first.id });

    const web = await context.newPage();
    await web.goto(`${base}/projects/${target.id}`);
    await web.getByRole('button', { name: /Add Source/ }).click();
    await web.getByRole('button', { name: 'Kindle book', exact: true }).click();
    await web.getByLabel('Kindle reader URL').fill('https://example.org/not-kindle');
    await web.getByLabel('Book title', { exact: true }).fill(book.title);
    await web.getByRole('button', { name: 'Add Kindle book', exact: true }).click();
    await expect(web.getByRole('alert')).toContainText('supported Kindle reader');
    await web.getByLabel('Kindle reader URL').fill(book.url);
    await web.getByLabel('Author (optional)').fill(book.author);
    await web.getByRole('button', { name: 'Add Kindle book', exact: true }).click();
    await expect(web.getByRole('heading', { name: 'Add a source' })).toHaveCount(0);
    await expect(web.getByText(book.title, { exact: true })).toBeVisible();
    await expect(web.getByText(book.author, { exact: true })).toBeVisible();
    await expect(web.getByText('⚠ Failed', { exact: true })).toHaveCount(0);
    await web.reload();
    await web.screenshot({ path: info.outputPath('kindle-project-source.png'), fullPage: true });
    const opened = context.waitForEvent('page');
    await web.getByRole('link', { name: 'Open in Kindle' }).click();
    const reader = await opened;
    await expect(reader).toHaveURL(book.url);
    const tabId = await worker.evaluate(async () => (await chrome.tabs.query({ url: 'https://read.amazon.com/*' }))[0].id!);
    await expect.poll(() => worker.evaluate(async tabId => (await chrome.storage.session.get(`kindle-project:${tabId}`))[`kindle-project:${tabId}`], tabId)).toMatchObject({ projectId: target.id });
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/panel.html?tabId=${tabId}`);
    await expect(panel.locator('#project')).toHaveValue(target.id);
    await expect(panel.locator('#question')).toBeEnabled();
    await panel.reload();
    await expect(panel.locator('#project')).toHaveValue(target.id);

    // A manual choice is retained on reopen, even with a project launch hint.
    await expect(panel.locator('#project')).toBeEnabled();
    await panel.locator('#project').selectOption(first.id);
    await panel.reload();
    await expect(panel.locator('#project')).toHaveValue(first.id);
    await expect(panel.locator('#question')).toBeEnabled();
    await panel.getByRole('button', { name: 'Book details and captured passage' }).click();
    await panel.locator('#title').fill('Saved from the companion');
    await panel.getByRole('button', { name: 'Add book to project', exact: true }).click();
    await expect(panel.locator('#companion-status')).toContainText('Book added');
    await expect(panel.locator('#preview')).not.toBeVisible();
    let saved = (await app.inject({ url: `/api/projects/${first.id}/sources` })).json();
    expect(saved).toHaveLength(1); expect(saved[0].title).toBe('Saved from the companion');
    await panel.getByRole('button', { name: 'Book details and captured passage' }).click();
    await panel.getByRole('button', { name: 'Add book to project', exact: true }).click();
    await expect(panel.locator('#preview')).not.toBeVisible();
    saved = (await app.inject({ url: `/api/projects/${first.id}/sources` })).json();
    expect(saved).toHaveLength(1);

    // A URL cannot choose a project that has no reference to this book.
    await reader.goto(kindleLaunchUrl(book.url, missing.id, base));
    await expect(reader).toHaveURL(book.url);
    await panel.reload();
    await expect(panel.locator('#question')).toBeEnabled();
    await expect(panel.locator('#project')).toHaveValue(first.id);

    // Loopback aliases refer to the same server, but another port does not.
    await reader.goto(kindleLaunchUrl(book.url, target.id, base.replace('127.0.0.1', 'localhost')));
    await expect(reader).toHaveURL(book.url);
    await panel.reload();
    await expect(panel.locator('#project')).toHaveValue(target.id);
    await reader.goto(kindleLaunchUrl(book.url, other.id, 'http://127.0.0.1:1'));
    await expect(reader).toHaveURL(book.url);
    await panel.reload();
    await expect(panel.locator('#question')).toBeEnabled();
    await expect(panel.locator('#project')).toHaveValue(target.id);

    // Without a launch link, a unique saved book also selects its project.
    const regional = 'https://ler.amazon.com.br/?asin=REGIONAL01';
    await app.inject({ method: 'POST', url: `/api/projects/${other.id}/kindle-books`, payload: { ...book, url: regional } });
    await reader.goto(regional);
    await expect(panel.locator('#project')).toHaveValue(other.id);
    await expect(panel.locator('#reader')).toContainText('Regional book');
    await panel.screenshot({ path: info.outputPath('kindle-linked-companion.png'), fullPage: true });

    await web.reload();
    web.once('dialog', dialog => dialog.accept());
    await web.getByTitle('Remove source', { exact: true }).click();
    await expect(web.getByRole('link', { name: 'Open in Kindle' })).toHaveCount(0);
    expect((await app.inject({ url: `/api/projects/${first.id}/sources` })).json()).toHaveLength(1);
  } finally {
    await context?.close(); await app.close(); db.close();
    await rm(temporary, { recursive: true, force: true });
  }
});
