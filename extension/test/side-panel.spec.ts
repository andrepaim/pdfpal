import { test, expect, chromium, type BrowserContext } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const extensionPath = fileURLToPath(new URL('../dist', import.meta.url));

test('side panels follow Kindle tabs, navigation and extension reloads', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'pdfpal-side-panel-'));
  let context: BrowserContext | undefined;
  try {
    context = await chromium.launchPersistentContext(temporary, {
      channel: 'chromium', headless: true,
      ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}),
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`, '--enable-unsafe-extension-debugging'],
    });
    await context.route('https://**/*', route => route.fulfill({ contentType: 'text/html', body: '<title>Reader fixture</title><h1 data-testid="book-title">Test book</h1>' }));
    let worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).host;
    const reader = await context.newPage();
    await reader.goto('https://read.amazon.com/?asin=TESTBOOK01');
    const tabId = await worker.evaluate(async () => (await chrome.tabs.query({ url: 'https://read.amazon.com/*' }))[0].id!);
    const options = () => worker.evaluate(tabId => chrome.sidePanel.getOptions({ tabId }), tabId);
    await expect.poll(options).toMatchObject({ enabled: true, path: `panel.html?tabId=${tabId}` });
    expect(await worker.evaluate(() => chrome.sidePanel.getOptions({}))).toMatchObject({ enabled: false });

    // Exercise the real toolbar action, including the activeTab screenshot grant.
    const cdp = await context.browser()!.newBrowserCDPSession();
    const trigger = async (url: string) => {
      const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{ type: 'tab' }] });
      const target = targetInfos.find(target => target.url === url)!;
      await cdp.send('Extensions.triggerAction', { id: extensionId, targetId: target.targetId });
    };
    const panels = () => worker.evaluate(() => chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.SIDE_PANEL] }));
    await reader.bringToFront();
    await trigger(reader.url());
    await expect.poll(async () => (await panels()).map(panel => panel.documentUrl)).toContain(`chrome-extension://${extensionId}/panel.html?tabId=${tabId}`);
    // Side panels are not Playwright pages; inspect their renderer through CDP.
    const { targetInfos } = await cdp.send('Target.getTargets');
    const panelTarget = targetInfos.find(target => target.url === `chrome-extension://${extensionId}/panel.html?tabId=${tabId}`)!;
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: panelTarget.targetId });
    let commandId = 0;
    const visibility = async () => {
      const id = ++commandId;
      const response = new Promise<string>(resolve => {
        const receive = (event: { sessionId: string; message: string }) => {
          const message = JSON.parse(event.message);
          if (event.sessionId === sessionId && message.id === id) {
            cdp.off('Target.receivedMessageFromTarget', receive);
            resolve(message.result.result.value);
          }
        };
        cdp.on('Target.receivedMessageFromTarget', receive);
      });
      await cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: 'document.visibilityState', returnByValue: true } }) });
      return response;
    };
    await expect.poll(visibility).toBe('visible');

    const otherId = await worker.evaluate(async () => (await chrome.tabs.create({ url: 'https://example.org/', active: true })).id!);
    await expect.poll(() => worker.evaluate(tabId => chrome.sidePanel.getOptions({ tabId }), otherId)).toMatchObject({ enabled: false });
    await expect.poll(visibility).toBe('hidden');
    await worker.evaluate(tabId => chrome.tabs.update(tabId, { active: true }), tabId);
    await expect.poll(options).toMatchObject({ enabled: true });
    await expect.poll(visibility).toBe('visible');
    await cdp.send('Target.detachFromTarget', { sessionId });

    for (const origin of ['https://ler.amazon.com.br', 'https://read.amazon.co.uk']) {
      await reader.goto(`${origin}/?asin=TESTBOOK01`);
      await expect.poll(options).toMatchObject({ enabled: true, path: `panel.html?tabId=${tabId}` });
    }
    await reader.goto('https://example.org/away');
    await expect.poll(options).toMatchObject({ enabled: false });
    await expect.poll(panels).toHaveLength(0);
    await trigger(reader.url());
    expect(await panels()).toHaveLength(0);

    // A pre-existing Kindle tab must work immediately after loading an update.
    await reader.goto('https://read.amazon.com/?asin=TESTBOOK01');
    await expect.poll(options).toMatchObject({ enabled: true });
    const manager = await context.newPage();
    await manager.goto('chrome://extensions');
    const developerMode = manager.locator('#devMode');
    if (!await developerMode.evaluate((toggle: HTMLElement & { checked: boolean }) => toggle.checked)) await developerMode.click();
    const restarted = context.waitForEvent('serviceworker');
    await manager.locator('#dev-reload-button').click();
    worker = await restarted;
    await expect.poll(options).toMatchObject({ enabled: true, path: `panel.html?tabId=${tabId}` });
    expect(await worker.evaluate(() => chrome.sidePanel.getOptions({}))).toMatchObject({ enabled: false });
    await reader.bringToFront();
    await trigger(reader.url());
    await expect.poll(async () => (await panels()).map(panel => panel.documentUrl)).toContain(`chrome-extension://${extensionId}/panel.html?tabId=${tabId}`);
  } finally {
    await context?.close();
    await rm(temporary, { recursive: true, force: true });
  }
});
