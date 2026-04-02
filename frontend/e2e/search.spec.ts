import { test, expect } from '@playwright/test';
import { mockAuth, createProjectViaApi, mockExtract } from './helpers';

test.describe('Paper search', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuth(page);
  });

  test('search modal opens and shows search tab by default', async ({ page }) => {
    const project = await createProjectViaApi(page, 'Search Test Project');

    await page.goto(`/projects/${project.id}`);

    // Click "Add Source" to open the modal
    await page.getByRole('button', { name: /Add Source/ }).first().click();

    // Modal should show search tab content
    await expect(page.getByRole('heading', { name: 'Add a source' })).toBeVisible();
    await expect(page.getByText('Search papers')).toBeVisible();
    await expect(page.getByPlaceholder('e.g. Attention Is All You Need')).toBeVisible();
  });

  test('search returns mocked results', async ({ page }) => {
    const project = await createProjectViaApi(page, 'Search Results Project');

    // Mock the search API
    await page.route('**/api/search/papers*', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          results: [
            {
              s2_paper_id: 'paper-1',
              title: 'Attention Is All You Need',
              authors: 'Vaswani et al.',
              year: 2017,
              venue: 'NeurIPS',
              citation_count: 100000,
              arxiv_url: 'https://arxiv.org/abs/1706.03762',
              pdf_url: 'https://arxiv.org/pdf/1706.03762.pdf',
            },
            {
              s2_paper_id: 'paper-2',
              title: 'BERT: Pre-training of Deep Bidirectional Transformers',
              authors: 'Devlin et al.',
              year: 2019,
              venue: 'NAACL',
              citation_count: 80000,
              arxiv_url: 'https://arxiv.org/abs/1810.04805',
              pdf_url: null,
            },
          ],
          error: null,
        }),
      }),
    );

    await page.goto(`/projects/${project.id}`);
    await page.getByRole('button', { name: /Add Source/ }).first().click();

    // Type a search query
    await page.getByPlaceholder('e.g. Attention Is All You Need').fill('attention transformers');

    // Click Search button
    await page.getByRole('button', { name: 'Search', exact: true }).click();

    // Results should appear
    await expect(page.locator('text=Attention Is All You Need')).toBeVisible();
    await expect(page.locator('text=Vaswani et al.')).toBeVisible();
    await expect(page.locator('text=BERT: Pre-training of Deep Bidirectional Transformers')).toBeVisible();
  });

  test('can add a paper from search results', async ({ page }) => {
    const project = await createProjectViaApi(page, 'Search Add Project');

    // Mock search
    await page.route('**/api/search/papers*', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          results: [
            {
              s2_paper_id: 'paper-add-1',
              title: 'Searchable Paper',
              authors: 'Author A, Author B',
              year: 2023,
              venue: 'ICML',
              citation_count: 50,
              arxiv_url: 'https://arxiv.org/abs/2301.99999',
              pdf_url: 'https://arxiv.org/pdf/2301.99999.pdf',
            },
          ],
        }),
      }),
    );

    // Mock extract for when user clicks Add
    await mockExtract(page, { title: 'Searchable Paper', sourceId: 'src-search-1' });

    await page.goto(`/projects/${project.id}`);
    await page.getByRole('button', { name: /Add Source/ }).first().click();

    await page.getByPlaceholder('e.g. Attention Is All You Need').fill('searchable paper');
    await page.getByRole('button', { name: 'Search', exact: true }).click();

    await expect(page.locator('text=Searchable Paper').first()).toBeVisible();

    // Click the Add button on the result card
    await page.getByRole('button', { name: /Add$/ }).click();

    // Should show "Added" indicator
    await expect(page.locator('text=Added')).toBeVisible();
  });

  test('search with no results shows error message', async ({ page }) => {
    const project = await createProjectViaApi(page, 'Search Empty Project');

    // Mock search returning empty results
    await page.route('**/api/search/papers*', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ results: [], error: 'No results found' }),
      }),
    );

    await page.goto(`/projects/${project.id}`);
    await page.getByRole('button', { name: /Add Source/ }).first().click();

    await page.getByPlaceholder('e.g. Attention Is All You Need').fill('xyznonexistent123');
    await page.getByRole('button', { name: 'Search', exact: true }).click();

    await expect(page.locator('text=No results found')).toBeVisible();
  });

  test('close search modal', async ({ page }) => {
    const project = await createProjectViaApi(page, 'Search Close Project');

    await page.goto(`/projects/${project.id}`);
    await page.getByRole('button', { name: /Add Source/ }).first().click();
    await expect(page.getByRole('heading', { name: 'Add a source' })).toBeVisible();

    // Click Close button
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('heading', { name: 'Add a source' })).not.toBeVisible();
  });
});
