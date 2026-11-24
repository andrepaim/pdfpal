import { test, expect, type Page } from '@playwright/test';
import type { ContextualStatus } from '../src/lib/api';
import { mockAuth, createProjectViaApi, openReadingPreferences, readingPreferences } from './helpers';

const requiredBytes = 151_400_000;
const preferencePath = '/api/dictionary/contextual';
const downloadPath = `${preferencePath}/download`;
const cancelPath = `${downloadPath}/cancel`;

const off = (required: number | null = requiredBytes): ContextualStatus => ({
  enabled: false, locked: false, language: 'en', state: required === null ? 'unavailable' : 'off',
  error: null, model_source: null, runtime_source: null,
  download: { required_bytes: required, received_bytes: 0, total_bytes: 0 },
});
const downloading = (received: number): ContextualStatus => ({
  ...off(), state: 'downloading',
  download: { required_bytes: requiredBytes, received_bytes: received, total_bytes: requiredBytes },
});
const ready = (): ContextualStatus => ({
  ...off(0), enabled: true, state: 'ready', model_source: 'cache', runtime_source: 'cache',
});

async function mockContextual(page: Page, initial: ContextualStatus) {
  const server = {
    status: initial,
    posts: [] as Array<{ url: string; body: unknown }>,
    changes: [] as Array<{ url: string; status: ContextualStatus }>,
    polls: 0,
    pollScript: [] as ContextualStatus[],
  };
  await page.route('**/api/dictionary/contextual**', async route => {
    const request = route.request();
    if (request.method() === 'GET') {
      server.polls++;
      if (server.pollScript.length) server.status = server.pollScript.shift()!;
      return route.fulfill({ json: server.status });
    }
    const url = new URL(request.url()).pathname;
    server.posts.push({ url, body: request.postDataJSON() });
    const change = server.changes[0];
    if (request.method() !== 'POST' || !request.headers()['content-type']?.includes('application/json') || change?.url !== url) {
      return route.fulfill({ status: 409, json: { error: 'UNEXPECTED_CHANGE' } });
    }
    server.changes.shift();
    server.status = change.status;
    return route.fulfill({ json: server.status });
  });
  return server;
}

async function openReader(page: Page) {
  const project = await createProjectViaApi(page, 'Context order');
  const response = await page.request.post(`/api/projects/${project.id}/sources`, {
    data: { url: 'test/fixtures/dictionary.pdf', title: 'Dictionary paper' },
  });
  expect(response.ok()).toBeTruthy();
  const source = await response.json();
  await page.goto(`/projects/${project.id}/sources/${source.id}`);
  await expect(page.locator('[data-pdf-page="1"] .textLayer span').first()).toBeVisible();
  await openReadingPreferences(page);
}

function contextOrder(page: Page) {
  return readingPreferences(page).getByRole('switch', { name: 'Show the best-fitting meaning first', exact: true });
}

test.describe('contextual definition order in Reading preferences', () => {
  test.beforeEach(async ({ page }) => { await mockAuth(page); });

  test('requires download confirmation, shows progress, and turns on once ready', async ({ page }) => {
    const server = await mockContextual(page, off());
    await openReader(page);
    const preferences = readingPreferences(page);
    const toggle = contextOrder(page);
    const confirm = preferences.getByRole('button', { name: 'Download and turn on' });
    await expect(toggle).toBeEnabled();
    await expect(toggle).not.toBeChecked();
    await expect(confirm).toHaveCount(0);

    await toggle.click();
    await expect(preferences).toContainText(/one-time download[^.]*151\.4 MB/i);
    await expect(confirm).toBeFocused();
    expect(server.posts).toEqual([]);
    await preferences.getByRole('button', { name: 'Not now' }).click();
    await expect(confirm).toHaveCount(0);
    await expect(toggle).not.toBeChecked();
    await expect(toggle).toBeFocused();
    expect(server.posts).toEqual([]);

    await toggle.click();
    server.changes.push({ url: downloadPath, status: downloading(0) });
    await confirm.click();
    const progress = preferences.getByRole('progressbar');
    await expect(progress).toBeVisible();
    expect(server.posts).toEqual([{ url: downloadPath, body: { accept_bytes: requiredBytes } }]);
    server.pollScript.push(downloading(60_000_000));
    await expect(progress).toHaveAttribute('aria-valuenow', '39');
    server.pollScript.push(downloading(requiredBytes), { ...ready(), state: 'loading' }, ready());
    await expect(toggle).toBeChecked();
    await expect(preferences.getByRole('progressbar')).toHaveCount(0);
    await expect.poll(() => server.pollScript.length).toBe(0);

    const polls = server.polls;
    await page.waitForTimeout(1200);
    expect(server.polls).toBe(polls, 'no polling once the model is ready');
  });

  test('an active download can be cancelled and a failed download can be retried', async ({ page }) => {
    const server = await mockContextual(page, downloading(10_000_000));
    await openReader(page);
    const preferences = readingPreferences(page);
    await expect(preferences.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '6');

    server.changes.push({ url: cancelPath, status: { ...off(), error: 'DOWNLOAD_CANCELLED' } });
    await preferences.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(preferences.getByRole('progressbar')).toHaveCount(0);
    await expect(preferences.getByRole('alert')).toHaveCount(0);
    await expect(contextOrder(page)).not.toBeChecked();

    const confirm = preferences.getByRole('button', { name: 'Download and turn on' });
    await expect(confirm).toHaveCount(0);
    await contextOrder(page).click();
    server.changes.push({ url: downloadPath, status: { ...off(), state: 'failed', error: 'DOWNLOAD_FAILED' } });
    await confirm.click();
    await expect(preferences.getByRole('alert')).toContainText('The download failed. Check your connection');

    server.changes.push({ url: downloadPath, status: downloading(0) });
    await preferences.getByRole('button', { name: 'Retry download' }).click();
    await expect(preferences.getByRole('progressbar')).toBeVisible();
    server.pollScript.push(ready());
    await expect(contextOrder(page)).toBeChecked();
    expect(server.posts).toEqual([
      { url: cancelPath, body: {} },
      { url: downloadPath, body: { accept_bytes: requiredBytes } },
      { url: downloadPath, body: { accept_bytes: requiredBytes } },
    ]);
  });

  test('a cached model can be toggled directly and its enabled preference survives hiding definitions and reloading', async ({ page }) => {
    const server = await mockContextual(page, off(0));
    await openReader(page);
    const preferences = readingPreferences(page);
    const toggle = contextOrder(page);
    const definitions = preferences.getByRole('switch', { name: 'Show definitions on selection', exact: true });
    const enable = { url: preferencePath, body: { enabled: true } };
    await expect(toggle).toBeEnabled();
    await expect(toggle).not.toBeChecked();
    server.changes.push({ url: preferencePath, status: { ...ready(), state: 'loading' } });
    await toggle.click();
    await expect(toggle).toBeChecked();
    expect(server.posts).toEqual([enable]);
    server.pollScript.push(ready());

    await definitions.click();
    await expect(definitions).not.toBeChecked();
    await expect(toggle).toBeDisabled();
    await expect(toggle).toBeChecked();
    await expect(preferences.getByRole('switch', { name: 'Dark pages', exact: true })).toBeEnabled();

    await page.reload();
    await openReadingPreferences(page);
    await expect(definitions).not.toBeChecked();
    await expect(toggle).toBeDisabled();
    await expect(toggle).toBeChecked();
    await definitions.click();
    await expect(toggle).toBeEnabled();
    await expect(toggle).toBeChecked();
    expect(server.posts).toEqual([enable]);

    server.changes.push({ url: preferencePath, status: off(0) });
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    expect(server.posts).toEqual([enable, { url: preferencePath, body: { enabled: false } }]);
  });

  test('locked and unavailable ordering leave the other reading preferences usable', async ({ page }) => {
    const server = await mockContextual(page, { ...off(), locked: true });
    await openReader(page);
    const preferences = readingPreferences(page);
    await expect(preferences).toContainText(/fixed by your startup configuration/i);
    await expect(contextOrder(page)).toBeDisabled();
    await expect(preferences.getByRole('button')).toHaveCount(0);

    server.status = off(null);
    await page.reload();
    await openReadingPreferences(page);
    await expect(preferences).toContainText(/unavailable on this computer/i);
    await expect(contextOrder(page)).toBeDisabled();
    await expect(preferences.getByRole('switch', { name: 'Show definitions on selection', exact: true })).toBeEnabled();
    await expect(preferences.getByRole('switch', { name: 'Dark pages', exact: true })).toBeEnabled();
    await expect(preferences.getByRole('button')).toHaveCount(0);
    expect(server.posts).toEqual([]);
  });
});
