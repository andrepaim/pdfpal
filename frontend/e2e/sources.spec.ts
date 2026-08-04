import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
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

    // Should navigate to the reader route using the real source id — not
    // "undefined", which is what a mismatched field name in the optimistic
    // insert (SearchPaperModal's onAdded) used to produce.
    await page.waitForURL(`**/projects/${project.id}/sources/${sourceId}`);
    expect(page.url()).not.toContain('/sources/undefined');
  });

  test('reader restores the last page read after reload', async ({ page }) => {
    const project = await createProjectViaApi(page, 'Reading Progress Project');
    const created = await page.request.post(`/api/projects/${project.id}/sources`, {
      data: { url: 'test/fixtures/sample.pdf', title: 'Progress Book' },
    });
    expect(created.ok()).toBeTruthy();
    const source = await created.json();

    await page.goto(`/projects/${project.id}/sources/${source.id}`);
    await expect(page.getByTestId('page-progress')).toHaveText('Page 1 of 2');

    const saved = page.waitForResponse(response => {
      if (response.request().method() !== 'PATCH') return false;
      if (!response.url().endsWith(`/api/projects/${project.id}/sources/${source.id}`)) return false;
      return response.request().postDataJSON()?.last_page_read === 2;
    });
    await page.locator('[data-pdf-page="2"]').evaluate(element => element.scrollIntoView({ block: 'center' }));
    await expect(page.getByTestId('page-progress')).toHaveText('Page 2 of 2');
    await saved;

    await page.reload();
    await expect(page.getByTestId('page-progress')).toHaveText('Page 2 of 2');
    await expect.poll(async () => page.locator('[data-pdf-page="2"]').evaluate(element => {
      const scroll = element.closest('[data-testid="pdf-scroll-area"]');
      if (!scroll) return false;
      const pageRect = element.getBoundingClientRect();
      const scrollRect = scroll.getBoundingClientRect();
      return Math.abs(pageRect.top - scrollRect.top - 16) < 8;
    })).toBe(true);
  });

  test('reader uses a book page\'s real height without a dark placeholder gap', async ({ page }) => {
    const project = await createProjectViaApi(page, 'Book Geometry Project');
    const created = await page.request.post(`/api/projects/${project.id}/sources`, {
      data: { url: 'test/fixtures/sample.pdf', title: 'Wide Book' },
    });
    expect(created.ok()).toBeTruthy();
    const source = await created.json();

    // The fixture uses one inherited A4 MediaBox. Replace it in memory with
    // the wider trim size from the reported book; equal-length values preserve
    // the PDF's xref byte offsets.
    const bookPdf = await readFile(new URL('../../test/fixtures/sample.pdf', import.meta.url));
    const originalMediaBox = Buffer.from('595.28 841.89');
    const bookMediaBox = Buffer.from('531.00 666.00');
    const mediaBoxOffset = bookPdf.indexOf(originalMediaBox);
    expect(mediaBoxOffset).toBeGreaterThan(-1);
    bookMediaBox.copy(bookPdf, mediaBoxOffset);
    await page.route(`**/api/projects/${project.id}/sources/${source.id}/file`, route => route.fulfill({
      status: 200,
      contentType: 'application/pdf',
      body: bookPdf,
    }));

    await page.goto(`/projects/${project.id}/sources/${source.id}`);
    const renderedPage = page.locator('[data-pdf-page="1"] [data-page-number="1"]');
    await expect(renderedPage).toBeVisible();

    const geometry = await page.locator('[data-pdf-page="1"]').evaluate(wrapper => {
      const pdfPage = wrapper.querySelector<HTMLElement>('[data-page-number="1"]');
      if (!pdfPage) throw new Error('Rendered PDF page was not found');
      return {
        wrapperHeight: wrapper.getBoundingClientRect().height,
        pageHeight: pdfPage.getBoundingClientRect().height,
        pageRatio: pdfPage.getBoundingClientRect().height / pdfPage.getBoundingClientRect().width,
      };
    });
    expect(geometry.pageRatio).toBeCloseTo(666 / 531, 2);
    expect(Math.abs(geometry.wrapperHeight - geometry.pageHeight)).toBeLessThan(3);
  });
});
