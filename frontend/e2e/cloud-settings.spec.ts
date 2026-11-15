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
const baseStatus = { configured: true, pdfStorage: false, conversations: false, account: null as typeof signedIn | null, enabled: false, running: false, pending: 0, conflicts: 0, error: '', lastSync: null as string | null, libraryId: undefined as string | undefined }
async function cloudFixture(page: import('@playwright/test').Page, initial: Partial<typeof baseStatus> = {}, cloud: { libraries?: Array<{ id: string; title: string }>; canonicalId?: string | null; failLibraryLoad?: boolean; restoreError?: boolean; missingFiles?: number } = {}) {
  let status = { ...baseStatus, ...initial }
  const libraries = cloud.libraries ?? [{ id: initial.libraryId || 'existing-library', title: 'Research library' }]
  let canonicalId = cloud.canonicalId === undefined ? initial.libraryId || null : cloud.canonicalId
  const calls: Array<{ action: string; body: any }> = []
  await page.route('**/api/cloud/**', async route => {
    const action = new URL(route.request().url()).pathname.replace('/api/cloud/', '')
    const body = route.request().method() === 'POST' ? route.request().postDataJSON() : undefined
    calls.push({ action, body })
    if (action === 'files') return route.fulfill({ json: {configured:false,enabled:false,error:'',files:[]} })
    if (action === 'libraries') return route.fulfill(cloud.failLibraryLoad ? { status: 503, json: { detail: 'Temporarily unavailable' } } : { json: libraries })
    if (action === 'canonical') {
      if (body) canonicalId = body.libraryId
      return route.fulfill({ json: { libraryId: canonicalId } })
    }
    if (action === 'restore-account') return route.fulfill(cloud.restoreError ? { status: 503, json: { detail: 'The download could not finish. Your current library is preserved.' } } : { json: { id: 'recovered-account-library', missingFiles: cloud.missingFiles ?? 0 } })
    if (action === 'conflicts') return route.fulfill({ json: [] })
    if (action === 'sync') status = { ...status, error: '', pending: 0, lastSync: '2026-11-04T12:00:00Z' }
    if (action === 'pause') status = { ...status, enabled: !body.paused }
    if (action === 'connect') status = { ...status, libraryId: body.libraryId || 'new-library', enabled: true }
    if (action === 'conversations') status = { ...status, conversations: true }
    if (action === 'logout') status = { ...status, account: null }
    return route.fulfill({ json: status })
  })
  return { calls }
}

test('existing cloud libraries upload conversations only after explicit inclusion', async ({ page }) => {
  const fixture = await cloudFixture(page, { account: signedIn, libraryId: 'library', enabled: true })
  await page.goto('/')
  await page.getByRole('button', { name: 'Cloud library', exact: true }).click()
  const modal = page.getByRole('dialog', { name: 'Your cloud library' })
  await expect(modal.getByText(/Saved questions and answers stay local until/)).toBeVisible()
  expect(fixture.calls.filter(call => call.action === 'conversations')).toHaveLength(0)
  await expect(modal.getByText(/This uploads existing and future PDF and project questions/)).toBeVisible()
  await modal.getByRole('button', { name: 'Include saved conversations' }).click()
  await expect(modal.getByText('Saved PDF and project conversations', { exact: true })).toBeVisible()
  await expect(modal.getByText(/Kindle extension history and interactive visuals stay local/)).toBeVisible()
  await expect(modal.getByRole('button', { name: 'Include saved conversations' })).toHaveCount(0)
  expect(fixture.calls.filter(call => call.action === 'conversations')).toEqual([{ action: 'conversations', body: { enabled: true } }])
})

test('signed-in account is distinct from enabling library sync', async ({ page }) => {
  const fixture = await cloudFixture(page, { account: signedIn })
  await page.goto('/')
  await page.getByRole('button', { name: 'Cloud library', exact: true }).click()
  const modal = page.getByRole('dialog', { name: 'Your cloud library' })
  await expect(modal.getByText('reader@example.test')).toBeVisible()
  await expect(modal.getByText('Signed in', { exact: true })).toBeVisible()
  await expect(modal.getByRole('heading', { name: 'Your account library' })).toBeVisible()
  await expect(modal.getByText('Up to date', { exact: true })).toHaveCount(0)
  await expect(modal.getByText('Cloud library ID: existing-library')).toBeVisible()
  await expect(modal.getByLabel('Library name')).toHaveCount(0)
  await expect(modal.getByRole('option', { name: 'Create a new cloud library' })).toHaveCount(0)
  await modal.getByRole('button', { name: 'Connect account library', exact: true }).click()
  await expect(modal.getByRole('heading', { name: 'Synchronization', exact: true })).toBeVisible()
  expect(fixture.calls.find(call => call.action === 'connect')?.body).toEqual({ title: 'My pdfpal library', libraryId: 'existing-library' })
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


test('an account with no cloud library can enable its first library', async ({ page }) => {
  const fixture = await cloudFixture(page, { account: signedIn }, { libraries: [], canonicalId: null })
  await page.goto('/')
  await page.getByRole('button', { name: 'Cloud library', exact: true }).click()
  const modal = page.getByRole('dialog', { name: 'Your cloud library' })
  await modal.getByLabel('Library name').fill('My reading')
  await modal.getByRole('button', { name: 'Enable sync', exact: true }).click()
  expect(fixture.calls.find(call => call.action === 'connect')?.body).toEqual({ title: 'My reading' })
})

test('legacy duplicate libraries require an explicit main library before connecting', async ({ page }) => {
  const fixture = await cloudFixture(page, { account: signedIn }, { libraries: [{ id: 'linux-library', title: 'Research library' }, { id: 'windows-library', title: 'Research library' }], canonicalId: null })
  await page.goto('/')
  await page.getByRole('button', { name: 'Cloud library', exact: true }).click()
  const modal = page.getByRole('dialog', { name: 'Your cloud library' })
  await expect(modal.getByText(/Older versions created multiple cloud libraries/)).toBeVisible()
  await expect(modal.getByRole('button', { name: 'Choose account library', exact: true })).toBeDisabled()
  await expect(modal.getByRole('button', { name: 'Use as account library', exact: true })).toBeDisabled()
  await modal.getByLabel('Main cloud library').selectOption('windows-library')
  await modal.getByRole('button', { name: 'Use as account library', exact: true }).click()
  await expect(modal.getByText('Cloud library ID: windows-library')).toBeVisible()
  expect(fixture.calls.filter(call => call.action === 'connect')).toHaveLength(0)
  expect(fixture.calls.filter(call => call.action === 'canonical' && call.body)).toEqual([{ action: 'canonical', body: { libraryId: 'windows-library' } }])
  await modal.getByRole('button', { name: 'Connect account library', exact: true }).click()
  expect(fixture.calls.find(call => call.action === 'connect')?.body.libraryId).toBe('windows-library')
})

test('a bound legacy device preserves its library and cannot sync to a different account library', async ({ page }) => {
  const fixture = await cloudFixture(page, { account: signedIn, libraryId: 'linux-library', enabled: true }, { libraries: [{ id: 'linux-library', title: 'Linux library' }, { id: 'windows-library', title: 'Windows library' }], canonicalId: 'windows-library' })
  await page.goto('/')
  await page.getByRole('button', { name: 'Cloud library', exact: true }).click()
  const modal = page.getByRole('dialog', { name: 'Your cloud library' })
  await expect(modal.getByRole('alert')).toContainText('This device uses a different cloud library')
  await expect(modal.getByRole('alert')).toContainText('Open an empty local library')
  await expect(modal.getByRole('button', { name: 'Account library differs', exact: true })).toBeDisabled()
  expect(fixture.calls.filter(call => call.action === 'connect' || call.action === 'sync')).toHaveLength(0)
})

test('library discovery failure never falls back to creating a cloud library', async ({ page }) => {
  const fixture = await cloudFixture(page, { account: signedIn }, { failLibraryLoad: true })
  await page.goto('/')
  await page.getByRole('button', { name: 'Cloud library', exact: true }).click()
  const modal = page.getByRole('dialog', { name: 'Your cloud library' })
  await modal.getByText('Show details', { exact: true }).click()
  await expect(modal.getByRole('alert')).toContainText('Could not load your account library')
  await expect(modal.getByRole('button', { name: 'Enable sync', exact: true })).toBeDisabled()
  expect(fixture.calls.filter(call => call.action === 'connect')).toHaveLength(0)
})


test('a bound legacy device can nominate the complete account library without rebinding local data', async ({ page }) => {
  const fixture = await cloudFixture(page, { account: signedIn, libraryId: 'linux-library', enabled: true }, { libraries: [{ id: 'linux-library', title: 'Linux library' }, { id: 'windows-library', title: 'Windows library' }], canonicalId: null })
  await page.goto('/')
  await page.getByRole('button', { name: 'Cloud library', exact: true }).click()
  const modal = page.getByRole('dialog', { name: 'Your cloud library' })
  await modal.getByLabel('Main cloud library').selectOption('windows-library')
  await modal.getByRole('button', { name: 'Use as account library', exact: true }).click()
  await expect(modal.getByRole('alert')).toContainText('This device uses a different cloud library')
  await expect(modal.getByText('Cloud library ID: linux-library')).toBeVisible()
  await expect(modal.getByRole('button', { name: 'Account library differs', exact: true })).toBeDisabled()
  expect(fixture.calls.filter(call => call.action === 'connect' || call.action === 'sync')).toHaveLength(0)
})


test('separate account restore opens the prepared recovery library on desktop', async ({ page }) => {
  await page.addInitScript(() => {
    window.pdfpalDesktop = { setAgent: async id => id, onAgentChanged: () => () => {}, openRecoveredLibrary: async id => { localStorage.setItem('opened-recovery-library', id); return true } }
  })
  const fixture = await cloudFixture(page, { account: signedIn, libraryId: 'linux-library', enabled: true }, { canonicalId: 'windows-library' })
  await page.goto('/')
  await page.getByRole('button', { name: 'Cloud library', exact: true }).click()
  const modal = page.getByRole('dialog', { name: 'Your cloud library' })
  await modal.getByRole('button', { name: 'Restore account library separately', exact: true }).click()
  await expect.poll(() => page.evaluate(() => localStorage.getItem('opened-recovery-library'))).toBe('recovered-account-library')
  expect(fixture.calls.filter(call => call.action === 'restore-account')).toEqual([{ action: 'restore-account', body: {} }])
  expect(fixture.calls.filter(call => call.action === 'connect' || call.action === 'sync')).toHaveLength(0)
})

test('failed account restore keeps the current library open and preserves the retry action', async ({ page }) => {
  await page.addInitScript(() => {
    window.pdfpalDesktop = { setAgent: async id => id, onAgentChanged: () => () => {}, openRecoveredLibrary: async id => { localStorage.setItem('opened-recovery-library', id); return true } }
  })
  await cloudFixture(page, { account: signedIn, libraryId: 'linux-library', enabled: true }, { canonicalId: 'windows-library', restoreError: true })
  await page.goto('/')
  await page.getByRole('button', { name: 'Cloud library', exact: true }).click()
  const modal = page.getByRole('dialog', { name: 'Your cloud library' })
  await modal.getByRole('button', { name: 'Restore account library separately', exact: true }).click()
  await modal.getByText('Show details', { exact: true }).click()
  await expect(modal.getByText('The download could not finish. Your current library is preserved.')).toBeVisible()
  await expect(modal.getByText('Cloud library ID: linux-library')).toBeVisible()
  await expect(modal.getByRole('button', { name: 'Restore account library separately', exact: true })).toBeEnabled()
  expect(await page.evaluate(() => localStorage.getItem('opened-recovery-library'))).toBeNull()
})

test('browser account restore directs the reader to the separate recovery copy in Backups', async ({ page }) => {
  await cloudFixture(page, { account: signedIn, libraryId: 'linux-library', enabled: true }, { canonicalId: 'windows-library', missingFiles: 3 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Cloud library', exact: true }).click()
  const modal = page.getByRole('dialog', { name: 'Your cloud library' })
  await modal.getByRole('button', { name: 'Restore account library separately', exact: true }).click()
  await expect(modal.getByText(/Your account library is ready as a separate recovery copy/)).toContainText('Open Backups')
  await expect(modal.getByText(/Your account library is ready as a separate recovery copy/)).toContainText('3 PDF files are not downloaded.')
  await expect(modal.getByText(/Your account library is ready as a separate recovery copy/)).toContainText('PDF transfers stay off until you enable them')
  await expect(modal.getByText('Cloud library ID: linux-library')).toBeVisible()
})
