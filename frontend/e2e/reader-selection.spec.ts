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

test.describe('highlights across a page break', () => {
  test.beforeEach(async ({ page }) => { await mockAuth(page); });

  test('highlight only the selected text on each page, not the whole first page', async ({ page }) => {
    const { project, source } = await openReader(page);
    const secondPageText = page.locator('[data-pdf-page="2"] .textLayer span');
    await page.locator('[data-pdf-page="2"]').scrollIntoViewIfNeeded();
    await expect(secondPageText.first()).toBeVisible();

    // Select from the start of the last line of page 1 to the end of the first
    // line of page 2, the way dragging the mouse across the page gap does.
    const expected = await page.evaluate(() => {
      const spansOf = (n: number) => Array.from(document.querySelectorAll(`[data-pdf-page="${n}"] .textLayer span`))
        .filter(el => !el.children.length && (el.textContent?.trim().length ?? 0) > 2);
      const first = spansOf(1).at(-1)!;
      const last = spansOf(2)[0]!;
      const range = document.createRange();
      range.setStart(first.firstChild!, 0);
      range.setEnd(last.firstChild!, last.firstChild!.textContent!.length);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      const rect = last.getBoundingClientRect();
      last.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: rect.right, clientY: rect.bottom }));
      return { first: first.textContent!.trim(), last: last.textContent!.trim() };
    });

    await page.getByRole('button', { name: /Highlight/ }).click();
    await expect.poll(async () =>
      (await (await page.request.get(`/api/projects/${project.id}/sources/${source.id}/annotations`)).json()).length,
    ).toBe(2);
    const annotations = (await (await page.request.get(`/api/projects/${project.id}/sources/${source.id}/annotations`)).json())
      .sort((a: { page_number: number }, b: { page_number: number }) => a.page_number - b.page_number);

    expect(annotations.map((a: { page_number: number }) => a.page_number)).toEqual([1, 2]);
    expect(annotations[0].text).toContain(expected.first);
    expect(annotations[0].text).not.toContain(expected.last);
    expect(annotations[1].text).toContain(expected.last);
    expect(annotations[1].text).not.toContain(expected.first);
    for (const annotation of annotations) {
      // A line of text is a small fraction of a page; a whole-page box is not.
      expect(annotation.y2 - annotation.y1).toBeLessThan(0.2);
      for (const r of annotation.rects ?? [annotation]) {
        expect(r.y2).toBeGreaterThan(r.y1);
        expect(r.x2).toBeGreaterThan(r.x1);
      }
    }
    await expect(page.locator('[data-pdf-page="1"] .pdf-highlight').first()).toBeVisible();
    await expect(page.locator('[data-pdf-page="2"] .pdf-highlight').first()).toBeVisible();
  });
});
