import { test, expect } from '@playwright/test';
import { mockAuth } from './helpers';

test.describe('Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuth(page);
  });

  test('page loads and shows pdfpal branding', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=pdfpal')).toBeVisible();
  });

  test('home page shows "My Projects" heading', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=My Projects')).toBeVisible();
  });

  test('shows user email from mocked auth', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=test@example.com')).toBeVisible();
  });

  test('unknown route redirects to home', async ({ page }) => {
    await page.goto('/nonexistent-page');
    await expect(page.locator('text=My Projects')).toBeVisible();
  });

  test('direct URL to project view works', async ({ page }) => {
    // Create a project via API first
    const res = await page.request.post('/api/projects', {
      data: { title: 'Nav Test Project', description: '' },
    });
    const project = await res.json();

    await page.goto(`/projects/${project.id}`);
    await expect(page.locator('text=Nav Test Project')).toBeVisible();
    await expect(page.getByText('Sources').first()).toBeVisible();
  });

  test('can navigate back to projects list from project view', async ({ page }) => {
    const res = await page.request.post('/api/projects', {
      data: { title: 'Back Nav Project', description: '' },
    });
    const project = await res.json();

    await page.goto(`/projects/${project.id}`);
    await expect(page.locator('text=Back Nav Project')).toBeVisible();

    await page.click('text=All projects');
    await expect(page.locator('text=My Projects')).toBeVisible();
  });
});
