import { test, expect } from '@playwright/test';
import { mockAuth, createProjectViaApi } from './helpers';

test.describe('Project management', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuth(page);
  });

  test('projects page loads with empty state', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=My Projects')).toBeVisible();
  });

  test('create a new project via modal', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=My Projects')).toBeVisible();

    // Click the "New Project" button in the header area
    await page.getByRole('button', { name: /New Project/ }).first().click();

    // Modal should appear
    await expect(page.locator('text=Create a new project')).toBeVisible();

    // Fill in project name
    await page.getByPlaceholder('e.g. LLM Scaling Laws').fill('My E2E Test Project');

    // Fill in description
    await page.getByPlaceholder('What are you researching?').fill('Testing pdfpal');

    // Click Create Project
    await page.getByRole('button', { name: 'Create Project' }).click();

    // Modal should close and project should appear in list
    await expect(page.locator('text=Create a new project')).not.toBeVisible();
    await expect(page.getByText('My E2E Test Project').first()).toBeVisible();
  });

  test('click project card to open project', async ({ page }) => {
    const project = await createProjectViaApi(page, 'Click Test Project');

    await page.goto('/');
    await expect(page.getByText('Click Test Project').first()).toBeVisible();

    // Click the project card
    await page.getByText('Click Test Project').first().click();

    // Should navigate to project view with sidebar
    await expect(page.getByText('Sources').first()).toBeVisible();
    await expect(page.getByText('Notes').first()).toBeVisible();
  });

  test('rename project via inline edit', async ({ page }) => {
    const project = await createProjectViaApi(page, 'Old Project Name');

    await page.goto(`/projects/${project.id}`);
    await expect(page.locator('[title="Click to rename"]')).toBeVisible();
    await expect(page.locator('[title="Click to rename"]')).toHaveText('Old Project Name');

    // Click the project title to start editing
    await page.locator('[title="Click to rename"]').click();

    // The title div should be replaced by an input -- wait for it to appear
    // The input is styled with border color matching --accent and has font-weight 700
    await expect(page.locator('[title="Click to rename"]')).not.toBeVisible();
    const input = page.getByRole('textbox').first();
    await expect(input).toBeVisible();

    // Fill with new name (fill clears first)
    await input.fill('Renamed Project');
    await input.press('Enter');

    // Verify the new name is displayed (title div reappears with new text)
    await expect(page.locator('[title="Click to rename"]')).toHaveText('Renamed Project');
  });

  test('delete project from projects list', async ({ page }) => {
    const project = await createProjectViaApi(page, 'Delete Me Project');

    await page.goto('/');
    await expect(page.locator('text=Delete Me Project')).toBeVisible();

    // Hover over the project card to reveal the delete button
    const card = page.locator('text=Delete Me Project').locator('..');
    await card.hover();

    // Accept the confirmation dialog
    page.on('dialog', dialog => dialog.accept());

    // Click the delete button (the X button that appears on hover)
    // The delete button has text content of the cross character
    await card.locator('button').click();

    // Project should disappear
    await expect(page.locator('text=Delete Me Project')).not.toBeVisible();
  });
});
