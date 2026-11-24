import { test, expect, type Page, type Locator } from '@playwright/test';
import { mockAuth, createProjectViaApi, openReadingPreferences, readingPreferences, readingPreferencesTrigger } from './helpers';

async function createReader(page: Page) {
  const project = await createProjectViaApi(page, 'PDF appearance');
  const response = await page.request.post(`/api/projects/${project.id}/sources`, {
    data: { url: 'test/fixtures/sample.pdf', title: 'Theme test paper' },
  });
  expect(response.ok()).toBeTruthy();
  const source = await response.json();
  const url = `/projects/${project.id}/sources/${source.id}`;
  await page.goto(url);
  await expect(page.locator('[data-pdf-page="1"] canvas')).toBeVisible();
  return { project, source, url };
}

function darkPages(page: Page) {
  return readingPreferences(page).getByLabel('Dark pages', { exact: true });
}

async function toggleDarkPages(page: Page) {
  await openReadingPreferences(page);
  await darkPages(page).click();
  await page.keyboard.press('Escape');
}

// Read a screenshot pixel to check the colors the reader actually sees.
// Reading the PDF canvas directly would miss CSS filters applied by the browser.
async function backgroundPixel(page: Page, canvas: Locator) {
  const screenshot = await canvas.screenshot();
  return page.evaluate(async base64 => {
    const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
    const context = new OffscreenCanvas(1, 1).getContext('2d')!;
    context.drawImage(image, 0, 0);
    image.close();
    return Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3);
  }, screenshot.toString('base64'));
}

test.describe('PDF page appearance', () => {
  test.beforeEach(async ({ page }) => { await mockAuth(page); });

  test('the reading preferences open with the keyboard and dismiss with Escape or an outside click', async ({ page }) => {
    await createReader(page);
    const trigger = readingPreferencesTrigger(page);
    const preferences = readingPreferences(page);
    const definitions = preferences.getByLabel('Show definitions on selection', { exact: true });

    await expect(trigger).toHaveAttribute('title', 'Reading preferences');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(preferences).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^(Definitions|Order meanings by context|Dark pages)$/ })).toHaveCount(0);

    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(preferences.getByText('Reading preferences', { exact: true })).toBeVisible();
    await expect(preferences.getByText('Appearance', { exact: true })).toBeVisible();
    await expect(definitions).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(preferences).toHaveCount(0);
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(trigger).toBeFocused();

    await openReadingPreferences(page);
    await page.getByTestId('page-progress').click();
    await expect(preferences).toHaveCount(0);
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  test('defaults to light pages and toggles the rendered page colors with the keyboard', async ({ page }, testInfo) => {
    await createReader(page);
    const canvas = page.locator('[data-pdf-page="1"] canvas');
    expect(Math.min(...await backgroundPixel(page, canvas))).toBeGreaterThan(240);

    await openReadingPreferences(page);
    const toggle = darkPages(page);
    await expect(toggle).not.toBeChecked();
    await toggle.focus();
    await page.keyboard.press('Space');
    await expect(toggle).toBeChecked();
    await expect(toggle).toHaveCSS('filter', 'none');
    await page.keyboard.press('Escape');
    expect(Math.max(...await backgroundPixel(page, canvas))).toBeLessThan(65);
    await page.screenshot({ path: testInfo.outputPath('dark-pages.png') });

    await openReadingPreferences(page);
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    await page.keyboard.press('Escape');
    expect(Math.min(...await backgroundPixel(page, canvas))).toBeGreaterThan(240);
  });

  test('remembers the preference after reload and when opening another document', async ({ page }) => {
    const { project } = await createReader(page);
    const toggle = darkPages(page);
    await openReadingPreferences(page);
    await toggle.click();
    await page.reload();
    await openReadingPreferences(page);
    await expect(toggle).toBeChecked();
    const response = await page.request.post(`/api/projects/${project.id}/sources`, {
      data: { url: 'test/fixtures/sample.pdf', title: 'Another paper' },
    });
    const another = await response.json();
    await page.goto(`/projects/${project.id}/sources/${another.id}`);
    await openReadingPreferences(page);
    await expect(toggle).toBeChecked();
    await toggle.click();
    await page.reload();
    await openReadingPreferences(page);
    await expect(toggle).not.toBeChecked();
  });

  test('reads existing browser preferences saved by the old toolbar controls', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('pdfpal.pdf.darkPages', 'true');
      localStorage.setItem('pdfpal.pdf.definitions', 'false');
    });
    await createReader(page);
    await expect(page.locator('.pdf-viewer')).toHaveAttribute('data-page-theme', 'dark');
    const preferences = await openReadingPreferences(page);
    await expect(darkPages(page)).toBeChecked();
    await expect(preferences.getByRole('switch', { name: 'Show definitions on selection', exact: true })).not.toBeChecked();
  });

  test('keeps the zoom and reading position when changing page appearance', async ({ page }) => {
    await createReader(page);
    const zoom = page.getByRole('combobox').filter({ has: page.getByRole('option', { name: 'Fit width', exact: true }) });
    await zoom.selectOption('0.75');
    const secondPage = page.locator('[data-pdf-page="2"]');
    await secondPage.evaluate(element => element.scrollIntoView({ block: 'center' }));
    await expect(page.getByTestId('page-progress')).toHaveText('Page 2 of 2');
    const scrollTop = await page.getByTestId('pdf-scroll-area').evaluate(element => element.scrollTop);
    await toggleDarkPages(page);
    await expect(zoom).toHaveValue('0.75');
    await expect(page.getByTestId('page-progress')).toHaveText('Page 2 of 2');
    await expect.poll(() => page.getByTestId('pdf-scroll-area').evaluate(element => element.scrollTop)).toBe(scrollTop);
  });

  test('uses a dark background for unrendered page placeholders', async ({ page }) => {
    // Keep page two lazy so its placeholder can be checked before a canvas
    // replaces it. Other browser observers continue to behave normally.
    await page.addInitScript(() => {
      const NativeObserver = window.IntersectionObserver;
      window.IntersectionObserver = class extends NativeObserver {
        observe(element: Element) {
          if (!element.hasAttribute('data-pdf-page')) super.observe(element);
        }
      };
    });
    await createReader(page);
    const secondPage = page.locator('[data-pdf-page="2"]');
    await expect(secondPage.locator('canvas')).toHaveCount(0);
    const placeholder = secondPage.getByLabel('Page 2', { exact: true });
    await expect(placeholder).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await toggleDarkPages(page);
    await expect(placeholder).toHaveCSS('background-color', 'rgb(26, 26, 26)');
  });

  test('allows text selection and readable, clickable highlights in dark mode', async ({ page }) => {
    const { project, source } = await createReader(page);
    await toggleDarkPages(page);
    const spans = page.locator('[data-pdf-page="1"] .textLayer span');
    await expect(spans.first()).toBeVisible();
    const selected = await spans.evaluateAll(elements => {
      const element = elements.find(el => (el.textContent?.trim().length ?? 0) > 5)!;
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      const rect = element.getBoundingClientRect();
      element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: rect.left + 5, clientY: rect.top + 5 }));
      return selection.toString();
    });
    const saved = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith(`/sources/${source.id}/annotations`));
    await page.getByRole('button', { name: /Highlight/ }).click();
    expect((await saved).ok()).toBeTruthy();
    const highlight = page.locator('[data-pdf-page="1"]').getByTitle(selected, { exact: true });
    await expect(highlight).toBeVisible();
    await expect(highlight).toHaveCSS('mix-blend-mode', 'screen');
    await page.getByRole('textbox').fill('My question about this passage');
    await highlight.click();
    // A click on a highlight opens its menu; Ask attaches the passage to chat as before.
    await page.getByRole('menuitem', { name: /Ask/ }).click();
    await expect(page.getByRole('textbox')).toHaveValue('My question about this passage');
    await expect(page.getByText('Selection attached — ask a question or type /visual')).toBeVisible();
    await expect(page.getByTitle(selected, { exact: true }).filter({ hasText: selected })).toBeVisible();
    await page.getByRole('button', { name: 'Remove selection', exact: true }).click();
    await expect(page.getByRole('textbox')).toHaveValue('My question about this passage');
    await toggleDarkPages(page);
    await expect(highlight).toHaveCSS('mix-blend-mode', 'multiply');
    const annotations = await (await page.request.get(`/api/projects/${project.id}/sources/${source.id}/annotations`)).json();
    expect(annotations).toHaveLength(1);
    expect(annotations[0].text).toBe(selected);
  });

  test('still toggles pages when browser preference storage is unavailable', async ({ page }) => {
    await page.addInitScript(() => {
      Storage.prototype.getItem = () => { throw new DOMException('Storage blocked', 'SecurityError'); };
      Storage.prototype.setItem = () => { throw new DOMException('Storage blocked', 'SecurityError'); };
    });
    await createReader(page);
    await openReadingPreferences(page);
    const toggle = darkPages(page);
    await expect(toggle).not.toBeChecked();
    await toggle.click();
    await expect(toggle).toBeChecked();
    await page.keyboard.press('Escape');
    expect(Math.max(...await backgroundPixel(page, page.locator('[data-pdf-page="1"] canvas')))).toBeLessThan(65);
  });
});
