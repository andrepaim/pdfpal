import { test, expect } from '@playwright/test';
import { mockAuth, createProjectViaApi, createNoteViaApi } from './helpers';

test.describe('Notes management', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuth(page);
  });

  test('desktop quit flush saves a draft before the autosave delay', async ({ page }) => {
    await page.addInitScript(() => { window.pdfpalDesktop = { setAgent: async id => id, onAgentChanged: () => () => {} }; });
    const project = await createProjectViaApi(page, 'Quit flush project');
    const id = await createNoteViaApi(page, project.id, { title: 'Before' });
    await page.goto(`/projects/${project.id}/notes/${id}`);
    const input = page.getByPlaceholder('Note title…');
    await expect(input).toHaveValue('Before');
    await input.fill('Saved before quit');
    await page.evaluate(() => window.pdfpalFlushPending!());
    const saved = await (await page.request.get(`/api/projects/${project.id}/notes/${id}`)).json();
    expect(saved.title).toBe('Saved before quit');
  });

  test('a failed earlier save cannot overwrite a newer queued draft', async ({ page }) => {
    await page.addInitScript(() => { window.pdfpalDesktop = { setAgent: async id => id, onAgentChanged: () => () => {} }; });
    const project = await createProjectViaApi(page, 'Save failure project');
    const id = await createNoteViaApi(page, project.id, { title: 'Before' });
    await page.goto(`/projects/${project.id}/notes/${id}`);
    const input = page.getByPlaceholder('Note title…');
    await expect(input).toHaveValue('Before');
    let release!: () => void;
    let started = false;
    const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route(`**/api/projects/${project.id}/notes/${id}`, async route => {
      if (route.request().method() === 'PUT' && !started) {
        started = true;
        await gate;
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ detail: 'Fixture save failure' }) });
      } else await route.continue();
    });
    await input.fill('First draft');
    const first = page.evaluate(() => window.pdfpalFlushPending!().then(() => false, () => true));
    await expect.poll(() => started).toBe(true);
    await input.fill('Latest draft');
    const second = page.evaluate(async () => {
      const saving = window.pdfpalFlushPending!();
      document.body.dataset.secondFlushStarted = 'true';
      await saving;
    });
    await expect(page.locator('body')).toHaveAttribute('data-second-flush-started', 'true');
    release();
    expect(await first).toBe(true);
    await second;
    await page.evaluate(() => window.pdfpalFlushPending!());
    const saved = await (await page.request.get(`/api/projects/${project.id}/notes/${id}`)).json();
    expect(saved.title).toBe('Latest draft');
  });

  test('notes tab shows empty state', async ({ page }) => {
    const project = await createProjectViaApi(page, 'Notes Empty Project');

    await page.goto(`/projects/${project.id}`);
    // Switch to Notes tab
    await page.getByRole('tab', { name: 'Notes' }).click();
    await expect(page.locator('text=No notes yet')).toBeVisible();
  });

  test('create a new note via button', async ({ page }) => {
    const project = await createProjectViaApi(page, 'Notes Create Project');

    await page.goto(`/projects/${project.id}`);
    // Switch to Notes tab
    await page.getByRole('tab', { name: 'Notes' }).click();

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

    // Notes open in rendered read view by default; switch to Edit to reach the textarea.
    await page.getByRole('button', { name: /Edit/ }).click();

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
    await page.getByRole('button', { name: /Edit/ }).click();

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
    await page.getByRole('tab', { name: 'Notes' }).click();

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
    await page.getByRole('tab', { name: 'Notes' }).click();

    await expect(page.locator('text=Delete Me Note')).not.toBeVisible();
    await expect(page.locator('text=No notes yet')).toBeVisible();
  });
});
