import { test, expect, type Page } from '@playwright/test';
import { mockAuth, createProjectViaApi } from './helpers';

async function openReader(page: Page) {
  const project = await createProjectViaApi(page, 'Selection context');
  const response = await page.request.post(`/api/projects/${project.id}/sources`, {
    data: { url: 'test/fixtures/sample.pdf', title: 'Selection paper' },
  });
  expect(response.ok()).toBeTruthy();
  const source = await response.json();
  await page.goto(`/projects/${project.id}/sources/${source.id}`);
  await expect(page.locator('[data-pdf-page="1"] canvas')).toBeVisible();
  return { project, source };
}

async function selectOnFirstPage(page: Page) {
  const spans = page.locator('[data-pdf-page="1"] .textLayer span');
  await expect(spans.first()).toBeVisible();
  await spans.evaluateAll(elements => {
    const element = elements.find(el => (el.textContent?.trim().length ?? 0) > 5)!;
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    const rect = element.getBoundingClientRect();
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: rect.left + 5, clientY: rect.top + 5 }));
  });
  await page.getByRole('button', { name: '💬 Ask', exact: true }).click();
  await expect(page.getByText('Selection attached — ask a question or type /visual')).toBeVisible();
}

test.describe('reader selection context', () => {
  test.beforeEach(async ({ page }) => { await mockAuth(page); });

  test('chat sends the page an attached selection came from, and plain questions do not', async ({ page }) => {
    const bodies: Array<Record<string, unknown>> = [];
    await page.route('**/api/chat', async route => {
      bodies.push(route.request().postDataJSON());
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'data: {"text":"Answer."}\n\ndata: [DONE]\n\n' });
    });
    await openReader(page);
    await selectOnFirstPage(page);
    await page.getByRole('textbox').fill('Why is this needed?');
    await page.keyboard.press('Enter');
    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0]!.selection_page).toBe(1);
    expect(String(bodies[0]!.message)).toMatch(/^Why is this needed\?\n\n> /);
    await expect(page.getByText('Answer.')).toBeVisible();

    await page.getByRole('textbox').fill('A question without a selection');
    await page.keyboard.press('Enter');
    await expect.poll(() => bodies.length).toBe(2);
    expect(bodies[1]).not.toHaveProperty('selection_page');
  });

  test('a visual explanation of a selection sends its page', async ({ page }) => {
    let body: Record<string, unknown> | undefined;
    await page.route('**/api/projects/*/visuals', async route => {
      if (route.request().method() !== 'POST') return route.fallback();
      body = route.request().postDataJSON();
      await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ detail: 'Stopped by the test.' }) });
    });
    const { source } = await openReader(page);
    await selectOnFirstPage(page);
    await page.getByRole('textbox').fill('/visual Explain this');
    await page.keyboard.press('Enter');
    await expect.poll(() => body).toBeTruthy();
    expect(body!.selection_page).toBe(1);
    expect(body!.source_id).toBe(source.id);
    expect(body!.selection).toBeTruthy();
  });
});
