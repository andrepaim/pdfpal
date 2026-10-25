import { test, expect, chromium, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const passage = 'Reading connects new ideas with what we already know. A useful passage can become the beginning of a thoughtful conversation.';
let context: BrowserContext, reader: Page, panel: Page, worker: Worker, tabId: number, profile: string;
const browserPath = process.env.PLAYWRIGHT_EXECUTABLE_PATH || chromium.executablePath();

test.beforeEach(async () => {
  profile = await mkdtemp(path.join(os.tmpdir(), 'pdfpal-extension-test-'));
  context = await chromium.launchPersistentContext(profile, {
    ...(existsSync(browserPath) ? { executablePath: browserPath } : {}),
    channel: 'chromium', headless: process.env.HEADED !== '1', viewport: { width: 1100, height: 820 },
    args: [`--disable-extensions-except=${root}/dist`, `--load-extension=${root}/dist`, '--enable-unsafe-extension-debugging'],
  });
  worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  reader = await context.newPage();
  await reader.route('https://read.amazon.com/**', route => route.fulfill({ contentType: 'text/html', body:
    `<!doctype html><title>Original test book - Kindle</title><h1 data-testid="book-title">Original test book</h1><p data-testid="book-author">Test Author</p><p data-testid="reader-location">Location 420</p><iframe style="width:800px;height:220px" srcdoc="<p id=passage style='font:24px/1.8 Georgia'>${passage}</p>"></iframe>`,
  }));
  await reader.goto('https://read.amazon.com/?asin=TESTBOOK01');
  tabId = await worker.evaluate(async () => (await chrome.tabs.query({ url: 'https://read.amazon.com/*' }))[0].id!);
  panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/panel.html?tabId=${tabId}`);
  await expect(panel.locator('#reader')).toContainText('Original test book');
});
test.afterEach(async () => {
  await context?.close();
  if (profile) await rm(profile, { recursive: true, force: true });
});

async function selectNative() {
  const frame = reader.frames().find(frame => frame.parentFrame())!;
  await frame.evaluate(() => {
    const range = document.createRange(); range.selectNodeContents(document.querySelector('#passage')!);
    const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(range);
  });
  // Let the content script remember the selection before the panel takes focus.
  await frame.waitForFunction(() => getSelection()?.toString().includes('Reading connects'));
}
async function imagePage(dark: boolean) {
  await reader.evaluate(({ passage, dark }) => {
    document.querySelector('iframe')!.remove();
    const canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = 180;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = dark ? '#17211c' : '#fff'; ctx.fillRect(0, 0, 1000, 180);
    ctx.fillStyle = dark ? '#eee' : '#111'; ctx.font = '26px Georgia';
    const split = passage.lastIndexOf(' ', 70);
    ctx.fillText(passage.slice(0, split), 20, 55); ctx.fillText(passage.slice(split + 1), 20, 105);
    const wrapper = document.createElement('div'); wrapper.className = 'kg-full-page-img'; wrapper.style.cssText = 'position:relative;width:1000px;';
    const img = document.createElement('img'); img.src = canvas.toDataURL(); img.style.width = '1000px';
    const selection = document.createElement('div'); selection.className = 'kg-selection';
    selection.style.cssText = 'position:absolute;left:10px;top:10px;width:980px;height:135px;pointer-events:none;';
    wrapper.append(img, selection); document.body.append(wrapper);
  }, { passage, dark });
  await reader.locator('.kg-full-page-img img').evaluate((image: HTMLImageElement) => image.decode());
}

test('captures a child-frame passage, preserves edits on reopen, and exports provenance', async ({}, testInfo) => {
  await selectNative();
  await panel.getByRole('button', { name: 'Capture selection', exact: true }).click();
  await expect(panel.locator('#text')).toHaveValue(passage);
  await expect(panel.locator('#title')).toHaveValue('Original test book');
  await expect(panel.locator('#author')).toHaveValue('Test Author');
  await expect(panel.locator('#location')).toHaveValue('Location 420');
  await panel.getByRole('button', { name: 'Review', exact: true }).click();
  await panel.locator('#text').fill(`${passage}\nReviewed.`);
  await panel.locator('#location').fill('Location 421');
  const downloadPromise = panel.waitForEvent('download');
  await panel.getByRole('button', { name: 'Export JSON' }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks = []; for await (const chunk of stream!) chunks.push(chunk);
  const record = JSON.parse(Buffer.concat(chunks).toString());
  expect(record.text).toContain('Reviewed.'); expect(record.metadata.asin).toBe('TESTBOOK01');
  expect(record.metadata.location).toBe('Location 421'); expect(record.method).toBe('text'); expect(record.image).toBeUndefined();
  await panel.reload();
  await expect(panel.locator('#text')).toHaveValue(`${passage}\nReviewed.`);
  await panel.setViewportSize({ width: 390, height: 1000 });
  await panel.screenshot({ path: testInfo.outputPath('capture-preview.png'), fullPage: true });
});

for (const dark of [false, true]) test(`recognizes an image-only selection locally in ${dark ? 'dark' : 'light'} mode`, async () => {
  const remote: string[] = [];
  context.on('request', request => { if (/^https?:/.test(request.url())) remote.push(request.url()); });
  await imagePage(dark);
  await panel.getByRole('button', { name: 'Capture selection', exact: true }).click();
  await expect(panel.locator('#text')).toHaveValue(/Reading connects new ideas/);
  await expect(panel.locator('#text')).toHaveValue(/thoughtful conversation/);
  await expect(panel.locator('#quality')).toContainText('OCR confidence');
  await expect(panel.locator('#method')).toContainText('OCR');
  expect((await panel.locator('#text').inputValue()).replace(/\s+/g, ' ')).toBe(passage);
  await test.info().attach('ocr-timing', { body: (await panel.locator('#quality').textContent())!, contentType: 'text/plain' });
  expect(remote).toEqual([]);
});

test('rejects OCR completion from a changed page', async () => {
  await imagePage(false);
  await panel.getByRole('button', { name: 'Capture selection', exact: true }).click();
  await reader.evaluate(() => { document.querySelector('[data-testid="reader-location"]')!.textContent = 'Location 900'; });
  await expect(panel.locator('#status')).toContainText('page changed');
  await expect(panel.locator('#export')).toBeDisabled();
});

test('missing selection gives a useful fallback and region capture can be cancelled', async () => {
  await panel.getByRole('button', { name: 'Capture selection', exact: true }).click();
  await expect(panel.locator('#status')).toContainText('Capture region');
  await panel.getByRole('button', { name: 'Capture region', exact: true }).click();
  await reader.bringToFront();
  await reader.keyboard.press('Escape');
  await expect(panel.locator('#status')).toContainText('cancelled');
  await expect(panel.locator('#preview')).toBeHidden();
});

test('a new book navigation clears the previous passage', async () => {
  await selectNative();
  await panel.getByRole('button', { name: 'Capture selection', exact: true }).click();
  await expect(panel.locator('#text')).toHaveValue(passage);
  await reader.goto('https://read.amazon.com/?asin=OTHERBOOK1');
  await expect(panel.locator('#preview')).toBeHidden();
  const stored = await worker.evaluate(tabId => chrome.storage.session.get(`draft:${tabId}`), tabId);
  expect(stored[`draft:${tabId}`]).toBeUndefined();
});

test('region capture uses an actual screenshot after a toolbar action grant', async () => {
  await imagePage(false);
  await reader.bringToFront();
  const cdp = await context.newCDPSession(reader);
  const { targetInfo } = await cdp.send('Target.getTargetInfo');
  const extensionId = new URL(worker.url()).host;
  const browserCdp = await context.browser()!.newBrowserCDPSession();
  const { targetInfos } = await browserCdp.send('Target.getTargets', { filter: [{ type: 'tab' }] });
  const tabTarget = targetInfos.find(target => target.url === reader.url());
  await browserCdp.send('Extensions.triggerAction', { id: extensionId, targetId: tabTarget?.targetId || targetInfo.targetId });
  await panel.evaluate(() => document.getElementById('region')!.click());
  await expect(panel.locator('#status')).toContainText('Drag around');
  const bounds = await reader.locator('.kg-full-page-img img').boundingBox();
  await reader.mouse.move(bounds!.x + 5, bounds!.y + 5);
  await reader.mouse.down();
  await reader.mouse.move(bounds!.x + 995, bounds!.y + 140, { steps: 5 });
  await reader.mouse.up();
  await expect(panel.locator('#text')).toHaveValue(/Reading connects new ideas/);
  await expect(panel.locator('#text')).toHaveValue(/thoughtful conversation/);
});

test('pairs with real pdfpal, resumes an answer beyond 30 seconds, follows up and saves project notes', async ({}, testInfo) => {
  const { loadConfig } = await import('../../dist/core/config.js');
  const { buildServer } = await import('../../dist/server/app.js');
  const { openDatabase } = await import('../../dist/core/database.js');
  const { ExtensionAuth } = await import('../../dist/core/extension-auth.js');
  const agentPath = path.join(profile, 'fixture-agent');
  await writeFile(agentPath, `#!/usr/bin/env node\nconst fs=require('node:fs');const prompt=fs.readFileSync(0,'utf8');setTimeout(()=>process.stdout.write('# Explanation\\n\\nThe passage connects reading to prior knowledge.\\n\\n$E=mc^2$'),prompt.includes('First slow question')&&!prompt.includes('Previous turns (JSON):\\n[{')?32000:20);\n`, { mode: 0o700 });
  const config = loadConfig({ dataDir: path.join(profile, 'pdfpal'), agent: 'claude', model: '', claudeBin: agentPath });
  const app = await buildServer(config);
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address() as { port: number };
  const db = openDatabase(config);
  try {
    const project = (await app.inject({ method: 'POST', url: '/api/projects', payload: { title: 'Kindle research' } })).json();
    const other = (await app.inject({ method: 'POST', url: '/api/projects', payload: { title: 'Another project' } })).json();
    const code = new ExtensionAuth(db).pairCode().code;
    await panel.getByRole('button', { name: 'Connection and settings', exact: true }).click();
    await panel.locator('#server-url').fill(`http://127.0.0.1:${address.port}`);
    await panel.locator('#pair-code').fill(code);
    await panel.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(panel.locator('#connection-status')).toContainText('Connected');
    await panel.locator('#project').selectOption(project.id);
    await selectNative();
    await panel.getByRole('button', { name: 'Capture selection', exact: true }).click();
    await expect(panel.getByRole('button', { name: 'Save passage', exact: true })).toBeEnabled();
    await panel.getByRole('button', { name: 'Save passage', exact: true }).click();
    await expect(panel.locator('#companion-status')).toContainText('Passage saved');
    await panel.locator('#question').fill('First slow question');
    const started = Date.now();
    await panel.getByRole('button', { name: 'Ask', exact: true }).click();
    await expect(panel.locator('#messages')).toContainText('Thinking');
    await panel.reload();
    await expect(panel.locator('#messages')).toContainText('prior knowledge', { timeout: 45_000 });
    expect(Date.now() - started).toBeGreaterThan(30_000);
    await expect(panel.locator('#messages .katex')).toBeVisible();
    await expect(panel.locator('#question')).toBeEnabled();
    await panel.locator('#question').fill('Give me an example.');
    await panel.getByRole('button', { name: 'Ask', exact: true }).click();
    await expect(panel.locator('#messages .chat-turn')).toHaveCount(2);
    await expect(panel.locator('#companion-status')).toContainText('Answer ready');
    await panel.getByRole('button', { name: 'Save answer', exact: true }).last().click();
    await expect(panel.locator('#companion-status')).toContainText('Answer saved');
    await expect(panel.locator('#saved-note')).toHaveAttribute('href', new RegExp(`/projects/${project.id}/notes/`));
    await panel.getByRole('button', { name: 'Save answer', exact: true }).last().click();
    await expect(panel.getByRole('button', { name: 'Save answer', exact: true }).last()).toBeEnabled();
    const notes = (await app.inject({ url: `/api/projects/${project.id}/notes` })).json();
    expect(notes).toHaveLength(2);
    const discussion = (await app.inject({ url: `/api/projects/${project.id}/notes/${notes.find((note: { title: string }) => note.title.includes('Discussion')).id}` })).json();
    expect(discussion.content).toContain('Location 420'); expect(discussion.content).toContain('prior knowledge');
    await panel.setViewportSize({ width: 420, height: 1050 });
    await panel.screenshot({ path: testInfo.outputPath('companion-chat.png'), fullPage: true });
    await panel.locator('#project').selectOption(other.id);
    await expect(panel.locator('#messages .chat-turn')).toHaveCount(0);
    await panel.locator('#project').selectOption(project.id);
    await expect(panel.locator('#messages .chat-turn')).toHaveCount(2);
  } finally { await app.close(); db.close(); }
});

test('chat layout supports book questions without a capture and removable automatic selection context', async ({}, testInfo) => {
  const { loadConfig } = await import('../../dist/core/config.js');
  const { buildServer } = await import('../../dist/server/app.js');
  const { openDatabase } = await import('../../dist/core/database.js');
  const { ExtensionAuth } = await import('../../dist/core/extension-auth.js');
  const agentPath = path.join(profile, 'codex-fixture');
  const promptPath = path.join(profile, 'last-prompt');
  await writeFile(agentPath, `#!/usr/bin/env node\nconst fs=require('node:fs');const prompt=fs.readFileSync(0,'utf8');fs.writeFileSync(${JSON.stringify(promptPath)},prompt);process.stdout.write('# A connection to prior knowledge\\n\\nThe book explores how reading helps us connect new ideas with what we already know.\\n\\n- Start with the main idea.\\n- Relate it to a familiar example.\\n- Return to the passage to check your understanding.');\n`, { mode: 0o700 });
  const config = loadConfig({ dataDir: path.join(profile, 'chat-ui'), agent: 'codex', model: '', codexBin: agentPath });
  const app = await buildServer(config);
  await app.listen({ host: '127.0.0.1', port: 0 });
  const db = openDatabase(config);
  try {
    const project = (await app.inject({ method: 'POST', url: '/api/projects', payload: { title: 'Reading & understanding' } })).json();
    const code = new ExtensionAuth(db).pairCode().code;
    await panel.getByRole('button', { name: 'Connection and settings', exact: true }).click();
    await panel.locator('#server-url').fill(`http://127.0.0.1:${(app.server.address() as { port: number }).port}`);
    await panel.locator('#pair-code').fill(code);
    await panel.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(panel.locator('#question')).toBeEnabled();
    await expect(panel.locator('#agent-label')).toHaveText('Codex');
    await expect(panel.locator('#selection-banner')).toBeHidden();
    await panel.setViewportSize({ width: 390, height: 760 });
    await panel.locator('#question').fill('What are the main ideas in this book?');
    await panel.locator('#question').press('Enter');
    await expect(panel.locator('#companion-status')).toContainText('Answer ready');
    const first = JSON.parse((db.prepare('SELECT capture_json FROM kindle_turns ORDER BY rowid LIMIT 1').get() as { capture_json: string }).capture_json);
    expect(first.scope).toBe('book'); expect(first.text).toBe('');
    expect(await readFile(promptPath, 'utf8')).toContain('Scope: book');
    await expect(panel.locator('.chat-question').first()).toHaveCSS('background-color', 'rgb(99, 102, 241)');
    await expect(panel.locator('body')).toHaveCSS('overflow', 'hidden');
    await selectNative();
    await reader.frames().find(frame => frame.parentFrame())!.evaluate(() => document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })));
    await expect(panel.locator('#selection-banner')).toBeVisible();
    await expect(panel.locator('#selection-text')).toHaveText(passage);
    await panel.locator('#question').fill('How does this relate to learning?');
    await panel.getByRole('button', { name: 'Remove selection', exact: true }).click();
    await expect(panel.locator('#question')).toHaveValue('How does this relate to learning?');
    await expect(panel.locator('#selection-banner')).toBeHidden();
    await panel.getByRole('button', { name: 'Capture selection', exact: true }).click();
    await expect(panel.locator('#selection-banner')).toBeVisible();
    await panel.locator('#question').press('Enter');
    await expect(panel.locator('#messages .chat-turn')).toHaveCount(2);
    await expect(panel.locator('#companion-status')).toContainText('Answer ready');
    const latest = JSON.parse((db.prepare('SELECT capture_json FROM kindle_turns ORDER BY rowid DESC LIMIT 1').get() as { capture_json: string }).capture_json);
    expect(latest.scope).toBe('selection'); expect(latest.text).toBe(passage);
    await expect(panel.locator('#selection-banner')).toBeHidden();
    await panel.reload();
    await expect(panel.locator('#messages .chat-turn')).toHaveCount(2);
    await expect(panel.locator('#messages .chat-answer').last()).toContainText('The book explores');
    await expect.poll(() => panel.evaluate(() => {
      const area = document.getElementById('messages')!;
      return area.scrollHeight - area.clientHeight - area.scrollTop;
    })).toBeLessThanOrEqual(1);
    await expect(panel.locator('#selection-banner')).toBeHidden();
    await expect(panel.locator('#question')).toHaveAttribute('placeholder', 'Ask about the book, or type /visual…');
    await expect(panel.locator('#question')).toBeInViewport();
    const layout = await panel.evaluate(() => ({ height: innerHeight, documentHeight: document.documentElement.scrollHeight, bottom: document.querySelector('.composer')!.getBoundingClientRect().bottom }));
    expect(layout.documentHeight).toBeLessThanOrEqual(layout.height + 1); expect(layout.bottom).toBeLessThanOrEqual(layout.height + 1);
    await panel.screenshot({ path: testInfo.outputPath('kindle-chat-dark.png') });
    await panel.setViewportSize({ width: 320, height: 600 });
    await expect(panel.locator('#question')).toBeInViewport();
    await panel.screenshot({ path: testInfo.outputPath('kindle-chat-narrow.png') });
    await panel.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(panel.locator('#messages .chat-turn')).toHaveCount(0);
    await expect(panel.locator('.empty-state')).toBeVisible();
    expect((await app.inject({ url: `/api/projects/${project.id}/notes` })).json()).toHaveLength(0);
  } finally { await app.close(); db.close(); }
});
