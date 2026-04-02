import { test, expect } from '@playwright/test';
import { mockAuth, createProjectViaApi, mockExtract } from './helpers';

test.describe('Sources management', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuth(page);
  });

  test('sources tab shows empty state', async ({ page }) => {
    const project = await createProjectViaApi(page, 'Sources Empty Project');

    await page.goto(`/projects/${project.id}`);
    await expect(page.getByText('Sources').first()).toBeVisible();
    await expect(page.locator('text=No sources yet')).toBeVisible();
  });

  test('add source via URL with mocked extract', async ({ page }) => {
    const project = await createProjectViaApi(page, 'Sources Add Project');

    // Mock the extract endpoint
    await mockExtract(page, { title: 'Test Paper: A Study', sourceId: 'src-123' });

    await page.goto(`/projects/${project.id}`);
    await expect(page.locator('text=No sources yet')).toBeVisible();

    // Click "Add Source" button (the one in the header, not modal)
    await page.getByRole('button', { name: /Add Source/ }).first().click();

    // Modal should appear with "Add a source" heading
    await expect(page.getByRole('heading', { name: 'Add a source' })).toBeVisible();

    // Switch to URL tab
    await page.locator('text=Paste URL').click();

    // Enter a URL
    await page.getByPlaceholder('https://arxiv.org/abs/1234.56789').fill('https://arxiv.org/abs/2301.00001');

    // Click Add Source button (the one inside the URL tab modal, exact match)
    await page.getByRole('button', { name: 'Add Source', exact: true }).click();

    // Modal should close and source should appear
    await expect(page.getByRole('heading', { name: 'Add a source' })).not.toBeVisible();
    await expect(page.locator('text=Test Paper: A Study')).toBeVisible();
  });

  test('click source navigates to reader view', async ({ page }) => {
    const project = await createProjectViaApi(page, 'Source Click Project');

    // Create a source via API by mocking extract
    const sourceId = 'src-click-test';
    await mockExtract(page, { title: 'Clickable Paper', sourceId });

    await page.goto(`/projects/${project.id}`);

    // Add the source via URL tab
    await page.getByRole('button', { name: /Add Source/ }).first().click();
    await page.locator('text=Paste URL').click();
    await page.getByPlaceholder('https://arxiv.org/abs/1234.56789').fill('https://example.com/paper.pdf');
    await page.getByRole('button', { name: 'Add Source', exact: true }).click();

    // Wait for modal to close
    await expect(page.getByRole('heading', { name: 'Add a source' })).not.toBeVisible();
    await expect(page.locator('text=Clickable Paper')).toBeVisible();

    // Mock the source GET endpoint for the reader view
    await page.route(`**/api/projects/${project.id}/sources/${sourceId}`, route => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: sourceId,
            project_id: project.id,
            type: 'pdf',
            url: 'https://example.com/paper.pdf',
            title: 'Clickable Paper',
            pages: 5,
            pdf_text: 'Mock paper content.',
            created_at: new Date().toISOString(),
            accessed_at: new Date().toISOString(),
          }),
        });
      }
      return route.continue();
    });

    // Click the source
    await page.locator('text=Clickable Paper').click();

    // Should navigate to the reader route
    await page.waitForURL(`**/projects/${project.id}/sources/${sourceId}`);
  });
});
