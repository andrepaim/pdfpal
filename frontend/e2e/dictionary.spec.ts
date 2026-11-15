import { test, expect, type Page } from '@playwright/test';
import { mockAuth, createProjectViaApi } from './helpers';

// test/fixtures/dictionary.pdf reads:
//   We trained a neural network on images.
//   The mice ran along the river bank.
//   It is a well-known result.
//   The zxqv value is unknown.
async function openReader(page: Page) {
  const project = await createProjectViaApi(page, 'Dictionary');
  const response = await page.request.post(`/api/projects/${project.id}/sources`, {
    data: { url: 'test/fixtures/dictionary.pdf', title: 'Dictionary paper' },
  });
  expect(response.ok()).toBeTruthy();
  const source = await response.json();
  await page.goto(`/projects/${project.id}/sources/${source.id}`);
  await expect(page.locator('[data-pdf-page="1"] .textLayer span').first()).toBeVisible();
  return { project, source };
}

/** Where `text` is drawn on the page, in viewport coordinates. */
async function boxOf(page: Page, text: string) {
  return page.evaluate(wanted => {
    const walker = document.createTreeWalker(document.querySelector('[data-pdf-page="1"] .textLayer')!, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = (node as Text).data.indexOf(wanted);
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at); range.setEnd(node, at + wanted.length);
      const rect = range.getBoundingClientRect();
      return { left: rect.left, right: rect.right, y: rect.top + rect.height / 2, x: rect.left + rect.width / 2 };
    }
    throw new Error(`"${wanted}" is not on the page`);
  }, text);
}

/** Select `text` the way dragging the mouse across it does. */
async function drag(page: Page, text: string) {
  const box = await boxOf(page, text);
  await page.mouse.move(box.left + 1, box.y);
  await page.mouse.down();
  await page.mouse.move(box.right - 1, box.y, { steps: 4 });
  await page.mouse.up();
}

const card = (page: Page) => page.getByRole('dialog', { name: /^Definition of/ });
const defined = (page: Page) => page.waitForResponse(response => response.url().includes('/api/dictionary/define'));

test.describe('reader dictionary', () => {
  test.beforeEach(async ({ page }) => { await mockAuth(page); });

  test('double-clicking a word shows its meanings, base form first, next to the selection bubble', async ({ page }) => {
    await openReader(page);
    const box = await boxOf(page, 'mice');
    await page.mouse.dblclick(box.x, box.y);

    await expect(card(page)).toBeVisible();
    await expect(card(page).locator('section').first()).toContainText('mouse noun');
    await expect(card(page)).toContainText('rodent');
    await expect(card(page)).toContainText('WordNet 3.1');
    await expect(page.getByRole('button', { name: '💬 Ask', exact: true })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(card(page)).toHaveCount(0);
  });

  test('a word inside a compound lists the compound first, then the word', async ({ page }) => {
    await openReader(page);
    const box = await boxOf(page, 'network');
    await page.mouse.dblclick(box.x, box.y);
    const entries = card(page).locator('section');
    await expect(entries.nth(0)).toContainText('neural network noun');
    await expect(entries.nth(1)).toContainText('network noun');
  });

  test('half of a hyphenated word is looked up as the whole word', async ({ page }) => {
    await openReader(page);
    const box = await boxOf(page, 'known');
    await page.mouse.dblclick(box.x, box.y);
    await expect(card(page).locator('section').first()).toContainText('well-known adjective');
  });

  test('a selected phrase is defined when the dictionary lists it, and a long selection is not looked up', async ({ page }) => {
    await openReader(page);
    await drag(page, 'neural network');
    await expect(card(page).locator('section').first()).toContainText('neural network noun');

    let lookups = 0;
    page.on('request', request => { if (request.url().includes('/api/dictionary/define')) lookups++; });
    await drag(page, 'We trained a neural network on images.');
    await expect(page.getByRole('button', { name: '💬 Ask', exact: true })).toBeVisible();
    await expect(card(page)).toHaveCount(0);
    expect(lookups).toBe(0);
  });

  test('a word the dictionary does not list shows no card, and the bubble still appears', async ({ page }) => {
    await openReader(page);
    const answered = defined(page);
    const box = await boxOf(page, 'zxqv');
    await page.mouse.dblclick(box.x, box.y);
    expect((await (await answered).json()).entries).toEqual([]);
    await expect(page.getByRole('button', { name: '💬 Ask', exact: true })).toBeVisible();
    await expect(card(page)).toHaveCount(0);
  });

  test('the card expands in place, keeps the selection for Highlight, and closes on a click elsewhere', async ({ page }) => {
    const { project, source } = await openReader(page);
    const box = await boxOf(page, 'bank');
    await page.mouse.dblclick(box.x, box.y);
    await expect(card(page).locator('section').first()).toContainText('bank noun');
    // Three meanings each for the noun and the verb until the card is expanded.
    await expect(card(page).locator('li')).toHaveCount(6);

    await card(page).getByRole('button', { name: 'Show all meanings' }).click();
    await expect(card(page).locator('li')).toHaveCount(18);
    await expect(card(page).getByRole('button', { name: 'Show fewer' })).toBeVisible();

    // The word is still selected, so the bubble's Highlight applies to it.
    const saved = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith(`/sources/${source.id}/annotations`));
    await page.getByRole('button', { name: /Highlight/ }).click();
    expect((await saved).ok()).toBeTruthy();
    await expect(card(page)).toHaveCount(0);
    const annotations = await (await page.request.get(`/api/projects/${project.id}/sources/${source.id}/annotations`)).json();
    expect(annotations.map((annotation: { text: string }) => annotation.text.trim())).toEqual(['bank']);

    const mice = await boxOf(page, 'mice');
    await page.mouse.dblclick(mice.x, mice.y);
    await expect(card(page)).toBeVisible();
    await page.getByTestId('page-progress').click();
    await expect(card(page)).toHaveCount(0);
  });

  test('the Definitions button turns the card off and the choice survives a reload', async ({ page }) => {
    await openReader(page);
    const toggle = page.getByRole('button', { name: 'Definitions', exact: true });
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    const box = await boxOf(page, 'mice');
    await page.mouse.dblclick(box.x, box.y);
    await expect(card(page)).toBeVisible();

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(card(page)).toHaveCount(0);

    await page.reload();
    await expect(page.locator('[data-pdf-page="1"] .textLayer span').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Definitions', exact: true })).toHaveAttribute('aria-pressed', 'false');
    let lookups = 0;
    page.on('request', request => { if (request.url().includes('/api/dictionary/define')) lookups++; });
    const again = await boxOf(page, 'mice');
    await page.mouse.dblclick(again.x, again.y);
    await expect(page.getByRole('button', { name: '💬 Ask', exact: true })).toBeVisible();
    await expect(card(page)).toHaveCount(0);
    expect(lookups).toBe(0);
  });
});
