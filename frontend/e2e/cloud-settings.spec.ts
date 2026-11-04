import { test, expect } from "@playwright/test";
test("privacy choices persist and an unconfigured app sends no Firebase telemetry", async ({
  page,
}) => {
  await page.request.post("/api/telemetry/consent", {
    data: { diagnostics: false, usage: false },
  });
  const requests: string[] = [];
  page.on("request", (req) => {
    if (
      /google-analytics|firebaseinstallations|firebaselogging|firebaseperformance|googletagmanager/.test(
        req.url(),
      )
    )
      requests.push(req.url());
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Privacy", exact: true }).click();
  const diagnostics = page.getByLabel("Diagnostic reporting"),
    usage = page.getByLabel("Usage analytics");
  await expect(diagnostics).not.toBeChecked();
  await expect(usage).not.toBeChecked();
  await diagnostics.check();
  await expect
    .poll(
      async () =>
        (await (await page.request.get("/api/telemetry/consent")).json())
          .diagnostics,
    )
    .toBe(true);
  await page.reload();
  await page.getByRole("button", { name: "Privacy", exact: true }).click();
  await expect(diagnostics).toBeChecked();
  await diagnostics.uncheck();
  await expect
    .poll(
      async () =>
        (await (await page.request.get("/api/telemetry/consent")).json())
          .diagnostics,
    )
    .toBe(false);
  expect(requests).toEqual([]);
});
test("metadata-only cloud configuration is clearly labelled", async ({
  page,
}) => {
  await page.route("**/api/cloud/status", (route) =>
    route.fulfill({
      json: {
        configured: true,
        pdfStorage: false,
        account: null,
        enabled: false,
        running: false,
        pending: 0,
        conflicts: 0,
        error: "",
        lastSync: null,
      },
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Cloud library", exact: true }).click();
  await expect(page.getByText(/Metadata sync only/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Sign in with Google" }),
  ).toBeVisible();
});

const signedIn = { uid: 'fixture-user', email: 'reader@example.test' }
const baseStatus = { configured: true, pdfStorage: false, account: null as typeof signedIn | null, enabled: false, running: false, pending: 0, conflicts: 0, error: '', lastSync: null as string | null, libraryId: undefined as string | undefined }
async function cloudFixture(page: import('@playwright/test').Page, initial: Partial<typeof baseStatus> = {}) {
  let status = { ...baseStatus, ...initial }
  const calls: Array<{ action: string; body: any }> = []
  await page.route('**/api/cloud/**', async route => {
    const action = new URL(route.request().url()).pathname.replace('/api/cloud/', '')
    const body = route.request().method() === 'POST' ? route.request().postDataJSON() : undefined
    calls.push({ action, body })
    if (action === 'libraries') return route.fulfill({ json: [{ id: 'existing-library', title: 'Research library' }] })
    if (action === 'conflicts') return route.fulfill({ json: [] })
    if (action === 'sync') status = { ...status, error: '', pending: 0, lastSync: '2026-11-04T12:00:00Z' }
    if (action === 'pause') status = { ...status, enabled: !body.paused }
    if (action === 'connect') status = { ...status, libraryId: body.libraryId || 'new-library', enabled: true }
    if (action === 'logout') status = { ...status, account: null }
    return route.fulfill({ json: status })
  })
  return { calls }
}

test('signed-in account is distinct from enabling library sync', async ({ page }) => {
  const fixture = await cloudFixture(page, { account: signedIn })
  await page.goto('/')
  await page.getByRole('button', { name: 'Cloud library', exact: true }).click()
  const modal = page.getByRole('dialog', { name: 'Your cloud library' })
  await expect(modal.getByText('reader@example.test')).toBeVisible()
  await expect(modal.getByText('Signed in', { exact: true })).toBeVisible()
  await expect(modal.getByRole('heading', { name: 'Choose a cloud library' })).toBeVisible()
  await expect(modal.getByText('Up to date', { exact: true })).toHaveCount(0)
  await modal.getByLabel('Library name').fill('My reading')
  await modal.getByRole('button', { name: 'Enable sync', exact: true }).click()
  await expect(modal.getByRole('heading', { name: 'Synchronization', exact: true })).toBeVisible()
  expect(fixture.calls.find(call => call.action === 'connect')?.body).toEqual({ title: 'My reading' })
  await expect(modal.getByText('No successful sync yet')).toBeVisible()
})

test('failed synchronization explains local safety and retries without claiming success', async ({ page }) => {
  const fixture = await cloudFixture(page, { account: signedIn, libraryId: 'library', enabled: true, pending: 3, error: 'Firebase access denied' })
  await page.goto('/')
  await page.getByRole('button', { name: 'Cloud library', exact: true }).click()
  const modal = page.getByRole('dialog', { name: 'Your cloud library' })
  await expect(modal.getByRole('status')).toHaveText('Needs attention')
  await expect(modal.getByRole('alert')).toContainText('Your changes are saved on this device.')
  await expect(modal.getByText('No successful sync yet')).toBeVisible()
  await modal.getByText('Show details', { exact: true }).click()
  await expect(modal.getByRole('alert')).toContainText('Firebase access denied')
  await modal.getByRole('button', { name: 'Retry sync', exact: true }).click()
  await expect(modal.getByRole('status')).toHaveText('Up to date')
  await expect(modal.getByRole('alert')).toHaveCount(0)
  expect(fixture.calls.filter(call => call.action === 'sync')).toHaveLength(1)
})

test('pause and resume are clear and do not sign the account out', async ({ page }) => {
  await cloudFixture(page, { account: signedIn, libraryId: 'library', enabled: true, lastSync: '2026-11-04T12:00:00Z' })
  await page.goto('/')
  await page.getByRole('button', { name: 'Cloud library', exact: true }).click()
  const modal = page.getByRole('dialog', { name: 'Your cloud library' })
  await modal.getByRole('button', { name: 'Pause sync', exact: true }).click()
  await expect(modal.getByRole('status')).toHaveText('Sync paused')
  await expect(modal.getByText('reader@example.test')).toBeVisible()
  await modal.getByRole('button', { name: 'Resume sync', exact: true }).click()
  await expect(modal.getByRole('status')).toHaveText('Up to date')
  await modal.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(modal).not.toBeVisible()
  await expect(page.getByRole('button', { name: 'Cloud library', exact: true })).toBeFocused()
})

test('cloud modal fits a narrow window and the footer stays available', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 600 })
  await cloudFixture(page, { account: signedIn, libraryId: 'library', enabled: true, pending: 3, error: 'Firebase access denied' })
  await page.goto('/')
  const launcher = page.getByRole('button', { name: 'Cloud library', exact: true })
  const privacy = page.getByRole('button', { name: 'Privacy', exact: true })
  const a = await launcher.boundingBox(), b = await privacy.boundingBox()
  expect(a!.x + a!.width).toBeLessThan(b!.x)
  await launcher.click()
  const modal = page.getByRole('dialog', { name: 'Your cloud library' })
  await expect(modal).toBeVisible()
  const box = await modal.boundingBox()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(390)
  expect(box!.y + box!.height).toBeLessThanOrEqual(600)
  await expect(modal.getByRole('button', { name: 'Done', exact: true })).toBeInViewport()
  await expect(modal.getByRole('button', { name: 'Retry sync', exact: true })).toBeInViewport()
  await page.screenshot({ path: testInfo.outputPath('cloud-settings-narrow.png') })
  await page.keyboard.press('Escape')
  await expect(modal).not.toBeVisible()
})
