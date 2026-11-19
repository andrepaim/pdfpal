import { test, expect, type Page, type Route } from '@playwright/test';
import { mockAuth, createProjectViaApi } from './helpers';

// The reader's "Order meanings by context" control, against a mocked
// /api/dictionary/contextual that plays the server's states.
type Status = {
  enabled: boolean; locked: boolean; language: 'en'; state: string; error: string | null;
  model_source: string | null; runtime_source: string | null;
  download: { required_bytes: number | null; received_bytes: number; total_bytes: number };
};
const off = (required: number | null = 151_400_000): Status => ({ enabled: false, locked: false, language: 'en', state: required === null ? 'unavailable' : 'off', error: null, model_source: null, runtime_source: null, download: { required_bytes: required, received_bytes: 0, total_bytes: 0 } });

async function mockContextual(page: Page, initial: Status) {
  const server = { status: initial, posts: [] as Array<{ url: string; body: unknown }>, polls: 0, script: [] as Status[] };
  await page.route('**/api/dictionary/contextual**', async (route: Route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      server.polls++;
      if (server.script.length) server.status = server.script.shift()!;
      return route.fulfill({ json: server.status });
    }
    const body = request.postDataJSON();
    server.posts.push({ url: new URL(request.url()).pathname, body });
    expect(request.headers()['content-type']).toContain('application/json');
    return route.fulfill({ status: 200, json: server.status });
  });
  return server;
}
async function openReader(page: Page) {
  const project = await createProjectViaApi(page, 'Context order');
  const source = await (await page.request.post(`/api/projects/${project.id}/sources`, { data: { url: 'test/fixtures/dictionary.pdf', title: 'Dictionary paper' } })).json();
  await page.goto(`/projects/${project.id}/sources/${source.id}`);
  await expect(page.locator('[data-pdf-page="1"] .textLayer span').first()).toBeVisible();
}
const control = (page: Page) => page.getByRole('button', { name: 'Order meanings by context' });
const panel = (page: Page) => page.getByRole('dialog', { name: 'Order meanings by context' });
const downloading = (received: number, total: number): Status => ({ ...off(total), state: 'downloading', download: { required_bytes: total, received_bytes: received, total_bytes: total } });
const ready = (): Status => ({ ...off(0), enabled: true, state: 'ready', model_source: 'cache', runtime_source: 'cache' });

test.describe('order meanings by context', () => {
  test.beforeEach(async ({ page }) => { await mockAuth(page); });

  test('shows the download size before anything is downloaded, then progress, then turns on', async ({ page }) => {
    const server = await mockContextual(page, off());
    await openReader(page);
    await expect(control(page)).toHaveAttribute('aria-pressed', 'false');
    await control(page).click();
    await expect(panel(page)).toContainText('one-time download of 151 MB');
    await expect(panel(page)).toContainText('Your text stays on this computer');
    expect(server.posts).toEqual([]);

    server.status = downloading(0, 151_400_000);
    server.script = [downloading(60_000_000, 151_400_000), downloading(151_400_000, 151_400_000), { ...ready(), state: 'loading' }, ready()];
    await panel(page).getByRole('button', { name: 'Download and turn on' }).click();
    expect(server.posts).toEqual([{ url: '/api/dictionary/contextual/download', body: { accept_bytes: 151_400_000 } }]);
    await expect(panel(page).getByRole('progressbar')).toBeVisible();
    await expect(panel(page)).toContainText('On. Each entry lists the meaning that fits the passage first.');
    await expect(control(page)).toHaveAttribute('aria-pressed', 'true');
    const polls = server.polls;
    await page.waitForTimeout(1200);
    expect(server.polls).toBe(polls, 'no polling once the model is ready');
  });

  test('a download can be cancelled, a failure retried, and the setting turned off', async ({ page }) => {
    const server = await mockContextual(page, downloading(10_000_000, 151_400_000));
    await openReader(page);
    await control(page).click();
    await expect(panel(page).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '6');
    server.status = { ...off(), error: 'DOWNLOAD_CANCELLED' };
    await panel(page).getByRole('button', { name: 'Cancel' }).click();
    expect(server.posts.at(-1)!.url).toBe('/api/dictionary/contextual/download/cancel');
    await expect(panel(page).getByRole('button', { name: 'Download and turn on' })).toBeVisible();
    await expect(panel(page).getByRole('alert')).toHaveCount(0);

    server.status = { ...off(), state: 'failed', error: 'DOWNLOAD_FAILED' };
    await control(page).click(); await control(page).click();
    await expect(panel(page).getByRole('alert')).toContainText('The download failed. Check your connection');
    server.status = downloading(0, 151_400_000);
    server.script = [ready()];
    await panel(page).getByRole('button', { name: 'Retry download' }).click();
    expect(server.posts.at(-1)).toEqual({ url: '/api/dictionary/contextual/download', body: { accept_bytes: 151_400_000 } });
    await expect(control(page)).toHaveAttribute('aria-pressed', 'true');

    server.status = { ...off(0) };
    await panel(page).getByRole('button', { name: 'Turn off' }).click();
    expect(server.posts.at(-1)).toEqual({ url: '/api/dictionary/contextual', body: { enabled: false } });
    await expect(control(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(panel(page)).toContainText('The model is already on this computer.');
  });

  test('with the model already on this computer, turning on needs no download', async ({ page }) => {
    const server = await mockContextual(page, off(0));
    await openReader(page);
    await control(page).click();
    await expect(panel(page)).not.toContainText('download of');
    server.status = { ...ready(), state: 'loading' };
    server.script = [ready()];
    await panel(page).getByRole('button', { name: 'Turn on' }).click();
    expect(server.posts).toEqual([{ url: '/api/dictionary/contextual', body: { enabled: true } }]);
    await expect(control(page)).toHaveAttribute('aria-pressed', 'true');
  });

  test('a setting fixed by the environment offers no actions, and an unavailable one is hidden', async ({ page }) => {
    await mockContextual(page, { ...off(), locked: true });
    await openReader(page);
    await control(page).click();
    await expect(panel(page)).toContainText('fixed by your startup configuration');
    await expect(panel(page).getByRole('button')).toHaveCount(0);

    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await mockContextual(page, off(null));
    await page.reload();
    await expect(page.locator('[data-pdf-page="1"] .textLayer span').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Definitions', exact: true })).toBeVisible();
    await expect(control(page)).toHaveCount(0);
  });
});
