import { test, expect, type Page, type Locator } from '@playwright/test';
import { mockAuth, createProjectViaApi } from './helpers';

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

  test('defaults to light pages and toggles the rendered page colors with the keyboard', async ({ page }, testInfo) => {
    await createReader(page);
    const toggle = page.getByRole('button', { name: 'Dark pages', exact: true });
    const canvas = page.locator('[data-pdf-page="1"] canvas');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(Math.min(...await backgroundPixel(page, canvas))).toBeGreaterThan(240);

    await toggle.focus();
    await page.keyboard.press('Space');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(Math.max(...await backgroundPixel(page, canvas))).toBeLessThan(65);
    await expect(toggle).toHaveCSS('filter', 'none');
    await page.screenshot({ path: testInfo.outputPath('dark-pages.png') });

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(Math.min(...await backgroundPixel(page, canvas))).toBeGreaterThan(240);
  });

  test('remembers the preference after reload and when opening another document', async ({ page }) => {
    const { project } = await createReader(page);
    const toggle = page.getByRole('button', { name: 'Dark pages', exact: true });
    await toggle.click();
    await page.reload();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    const response = await page.request.post(`/api/projects/${project.id}/sources`, {
      data: { url: 'test/fixtures/sample.pdf', title: 'Another paper' },
    });
    const another = await response.json();
    await page.goto(`/projects/${project.id}/sources/${another.id}`);
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await toggle.click();
    await page.reload();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  });

  test('keeps the zoom and reading position when changing page appearance', async ({ page }) => {
    await createReader(page);
    const zoom = page.getByRole('combobox').filter({ has: page.getByRole('option', { name: 'Fit width', exact: true }) });
    await zoom.selectOption('0.75');
    const secondPage = page.locator('[data-pdf-page="2"]');
    await secondPage.evaluate(element => element.scrollIntoView({ block: 'center' }));
    await expect(page.getByTestId('page-progress')).toHaveText('Page 2 of 2');
    const scrollTop = await page.getByTestId('pdf-scroll-area').evaluate(element => element.scrollTop);
    await page.getByRole('button', { name: 'Dark pages', exact: true }).click();
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
    await page.getByRole('button', { name: 'Dark pages', exact: true }).click();
    await expect(placeholder).toHaveCSS('background-color', 'rgb(26, 26, 26)');
  });

  test('allows text selection and readable, clickable highlights in dark mode', async ({ page }) => {
    const { project, source } = await createReader(page);
    await page.getByRole('button', { name: 'Dark pages', exact: true }).click();
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
    await highlight.click();
    await expect(page.getByRole('textbox')).toHaveValue(`> "${selected}"\n\n`);
    await page.getByRole('button', { name: 'Dark pages', exact: true }).click();
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
    const toggle = page.getByRole('button', { name: 'Dark pages', exact: true });
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(Math.max(...await backgroundPixel(page, page.locator('[data-pdf-page="1"] canvas')))).toBeLessThan(65);
  });
});
