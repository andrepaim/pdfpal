import { test, expect } from '@playwright/test';
import { mockAuth, createProjectViaApi } from './helpers';

const paper = (title: string, relation: 'reference' | 'citation') => ({
  s2_paper_id: title, title, authors: 'Ada', year: 2024, arxiv_url: null, pdf_url: null, relation,
});

test.describe('Related papers', () => {
  test.beforeEach(async ({ page }) => { await mockAuth(page); });

  test('a failed refresh keeps the papers found earlier and says why', async ({ page }) => {
    const project = await createProjectViaApi(page, 'Related refresh');
    const response = await page.request.post(`/api/projects/${project.id}/sources`, {
      data: { url: 'test/fixtures/sample.pdf', title: 'Related paper' },
    });
    expect(response.ok()).toBeTruthy();
    const source = await response.json();
    // Some server errors have no full stop; the notice must not run them on.
    const error = 'Paper not found in Semantic Scholar or OpenAlex';
    await page.route('**/related*', route => {
      const refresh = new URL(route.request().url()).searchParams.get('refresh') === 'true';
      return route.fulfill({ json: {
        references: [paper('Saved Reference', 'reference')], citations: [], cached: true, provider: 'semantic_scholar',
        ...(refresh ? { error } : {}),
      } });
    });

    await page.goto(`/projects/${project.id}/sources/${source.id}`);
    await page.getByRole('button', { name: /Related/ }).click();
    await expect(page.getByText('Saved Reference')).toBeVisible();
    await expect(page.getByRole('status')).toHaveCount(0);

    await page.getByTitle('Refresh related papers').click();
    await expect(page.getByRole('status')).toHaveText(`Couldn't refresh: ${error}. Showing the papers found earlier.`);
    await expect(page.getByText('Saved Reference')).toBeVisible();
  });

  test('a slow first load explains that Semantic Scholar may be busy', async ({ page }) => {
    const project = await createProjectViaApi(page, 'Related slow');
    const response = await page.request.post(`/api/projects/${project.id}/sources`, {
      data: { url: 'test/fixtures/sample.pdf', title: 'Slow paper' },
    });
    const source = await response.json();
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/related*', async route => {
      await held;
      await route.fulfill({ json: { references: [paper('Eventually Found', 'reference')], citations: [], cached: false, provider: 'openalex' } });
    });

    await page.goto(`/projects/${project.id}/sources/${source.id}`);
    await page.getByRole('button', { name: /Related/ }).click();
    const hint = page.getByText('Semantic Scholar may be busy');
    await expect(page.getByText('Finding related papers…')).toBeVisible();
    await expect(hint).toHaveCount(0);
    await expect(hint).toBeVisible({ timeout: 6000 });
    release();
    await expect(page.getByText('Eventually Found')).toBeVisible();
    await expect(hint).toHaveCount(0);
  });
});
