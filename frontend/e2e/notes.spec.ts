import { test, expect } from '@playwright/test';
import { mockAuth, createProjectViaApi, createNoteViaApi } from './helpers';

test.describe('Notes management', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuth(page);
  });

  test('notes tab shows empty state', async ({ page }) => {
    const project = await createProjectViaApi(page, 'Notes Empty Project');

    await page.goto(`/projects/${project.id}`);
    // Switch to Notes tab
    await page.locator('text=Notes').click();
    await expect(page.locator('text=No notes yet')).toBeVisible();
  });

  test('create a new note via button', async ({ page }) => {
    const project = await createProjectViaApi(page, 'Notes Create Project');

    await page.goto(`/projects/${project.id}`);
    // Switch to Notes tab
    await page.locator('text=Notes').click();

    // Click "New Note" button
    await page.getByRole('button', { name: /New Note/ }).click();

    // Should navigate to note editor
    await page.waitForURL(`**/projects/${project.id}/notes/**`);

    // Should see the note editor with title input
    await expect(page.getByPlaceholder('Note title\u2026')).toBeVisible();
  });

  test('edit note title and content', async ({ page }) => {
    const project = await createProjectViaApi(page, 'Notes Edit Project');
    const noteId = await createNoteViaApi(page, project.id, {
      title: 'Initial Title',
      content: 'Initial content',
    });

    await page.goto(`/projects/${project.id}/notes/${noteId}`);

    // Wait for note to load
    const titleInput = page.getByPlaceholder('Note title\u2026');
    await expect(titleInput).toHaveValue('Initial Title');

    // Change the title
    await titleInput.fill('Updated Title');

    // Change the content
    const textarea = page.getByPlaceholder(/Write your notes here/);
    await expect(textarea).toHaveValue('Initial content');
    await textarea.fill('Updated content here');

    // Wait for the autosave PUT request to complete
    await page.waitForResponse(
      resp => resp.url().includes(`/notes/${noteId}`) && resp.request().method() === 'PUT' && resp.ok(),
      { timeout: 5000 },
    );

    // Re-mock auth before navigating again (reload clears route mocks)
    await mockAuth(page);
    await page.goto(`/projects/${project.id}/notes/${noteId}`);

    await expect(page.getByPlaceholder('Note title\u2026')).toHaveValue('Updated Title', { timeout: 5000 });
    await expect(page.getByPlaceholder(/Write your notes here/)).toHaveValue('Updated content here');
  });

  test('navigate back to project from note editor', async ({ page }) => {
    const project = await createProjectViaApi(page, 'Notes Nav Project');
    const noteId = await createNoteViaApi(page, project.id, { title: 'Nav Note' });

    await page.goto(`/projects/${project.id}/notes/${noteId}`);

    // Click the back button
    await page.getByRole('button', { name: /Project/ }).click();

    // Should navigate back to project view
    await page.waitForURL(`**/projects/${project.id}`);
  });

  test('note appears in notes list', async ({ page }) => {
    const project = await createProjectViaApi(page, 'Notes List Project');
    await createNoteViaApi(page, project.id, { title: 'Listed Note', content: 'Some content' });

    await page.goto(`/projects/${project.id}`);
    await page.locator('text=Notes').click();

    // Note should appear in the list
    await expect(page.locator('text=Listed Note')).toBeVisible();
  });

  test('delete note via API and verify gone', async ({ page }) => {
    const project = await createProjectViaApi(page, 'Notes Delete Project');
    const noteId = await createNoteViaApi(page, project.id, { title: 'Delete Me Note' });

    // Delete via API
    await page.request.delete(`/api/projects/${project.id}/notes/${noteId}`);

    // Navigate to project and check notes tab
    await page.goto(`/projects/${project.id}`);
    await page.locator('text=Notes').click();

    await expect(page.locator('text=Delete Me Note')).not.toBeVisible();
    await expect(page.locator('text=No notes yet')).toBeVisible();
  });
});
