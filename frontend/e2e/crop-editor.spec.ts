import { test, expect, type Locator, type Page } from '@playwright/test';
import path from 'node:path';
import { mockAuth, createProjectViaApi } from './helpers';

// The crop editor on /dev/crop-editor (frontend/src/pages/CropEditorSample.tsx), on page 2 of
// test/fixtures/share-cards.pdf added to the temporary library. No assistant is involved.

type Crop = [number, number, number, number];
const SHOTS = path.resolve('test-results/crop-editor');

async function openEditor(page: Page, crop: string | null = '0.2,0.2,0.6,0.5', source?: string) {
  const project = await createProjectViaApi(page, 'Crop editor');
  const id = source ?? (await (await page.request.post(`/api/projects/${project.id}/sources`, { data: { url: 'test/fixtures/share-cards.pdf', title: 'Crop paper' } })).json()).id;
  await page.goto(`/dev/crop-editor?project=${project.id}&source=${id}&page=2${crop ? `&crop=${crop}` : ''}`);
  const dialog = page.getByRole('dialog', { name: 'Adjust crop' });
  await expect(dialog).toBeVisible();
  return dialog;
}

const box = (page: Page) => page.locator('[data-crop-box]');
const handle = (page: Page, name: string) => page.locator(`[data-crop-handle="${name}"]`);
const readCrop = async (page: Page): Promise<Crop> => (await box(page).getAttribute('data-crop'))!.split(',').map(Number) as Crop;

async function expectCrop(page: Page, expected: Crop, tolerance = 0.004) {
  await expect.poll(async () => {
    const crop = await readCrop(page);
    return crop.every((value, index) => Math.abs(value - expected[index]!) <= tolerance) ? 'ok' : crop.join(',');
  }, { message: `crop should be ${expected.join(',')}` }).toBe('ok');
}

/** Drags `target` from its centre by a fraction of the page, or to an absolute point in the viewport. */
async function drag(page: Page, target: Locator, by: { dx: number; dy: number } | { x: number; y: number }) {
  const frame = (await page.locator('[data-crop-page]').boundingBox())!;
  const from = (await target.boundingBox())!;
  const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  const end = 'dx' in by ? { x: start.x + by.dx * frame.width, y: start.y + by.dy * frame.height } : by;
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
}

test.describe('crop editor', () => {
  test.beforeEach(async ({ page }) => { await mockAuth(page); });

  test('drag, resize by a corner and an edge, clamp to the page and the minimum, then apply and reset', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const dialog = await openEditor(page);
    await expect(dialog).toHaveAttribute('data-state', 'ready');
    await expect(page.locator('[data-crop-mark]')).toHaveCount(4);
    await expect(page.locator('[data-crop-handle]')).toHaveCount(8);
    await expectCrop(page, [0.2, 0.2, 0.6, 0.5], 0);
    await expect(box(page)).toBeFocused();
    await page.screenshot({ path: path.join(SHOTS, 'desktop-1280.png') });

    await drag(page, box(page), { dx: 0.1, dy: 0.1 });
    await expectCrop(page, [0.3, 0.3, 0.7, 0.6]);
    await drag(page, handle(page, 'se'), { dx: 0.1, dy: 0.05 });
    await expectCrop(page, [0.3, 0.3, 0.8, 0.65]);
    // An edge ignores movement across it.
    await drag(page, handle(page, 'w'), { dx: -0.15, dy: 0.2 });
    await expectCrop(page, [0.15, 0.3, 0.8, 0.65]);
    await drag(page, handle(page, 'n'), { dx: 0.3, dy: -0.1 });
    await expectCrop(page, [0.15, 0.2, 0.8, 0.65]);

    // Moved past the top left: stops at the page edge with its size kept.
    await drag(page, box(page), { dx: -1, dy: -1 });
    await expectCrop(page, [0, 0, 0.65, 0.45]);

    // A corner pulled out of the dialog to the window's corner and released there: stops at the page edge, and the
    // drag ends cleanly, so moving the mouse afterwards changes nothing.
    await drag(page, handle(page, 'se'), { x: 1279, y: 799 });
    await expectCrop(page, [0, 0, 1, 1]);
    const frame = (await page.locator('[data-crop-page]').boundingBox())!;
    await page.mouse.move(frame.x + frame.width / 2, frame.y + frame.height / 2, { steps: 4 });
    await expectCrop(page, [0, 0, 1, 1], 0);

    // The top edge pulled far below the bottom: the crop keeps 10% of the page.
    await drag(page, handle(page, 'n'), { x: frame.x + frame.width / 2, y: 799 });
    await expectCrop(page, [0, 0.9, 1, 1], 0);
    await drag(page, handle(page, 'e'), { x: 1, y: frame.y + frame.height - 20 });
    await expectCrop(page, [0, 0.9, 0.1, 1], 0);
    // And the small box still moves.
    await drag(page, box(page), { dx: 0.4, dy: -0.4 });
    await expectCrop(page, [0.4, 0.5, 0.5, 0.6]);

    const applied = (await box(page).getAttribute('data-crop'))!;
    await dialog.getByRole('button', { name: 'Apply' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('[data-crop-result]')).toHaveText(`applied ${applied}`);

    // Reopening starts from the applied crop; Reset to automatic reports null.
    await page.getByRole('button', { name: 'Open crop editor' }).click();
    await expect(dialog).toHaveAttribute('data-state', 'ready');
    await expect(box(page)).toHaveAttribute('data-crop', applied);
    await dialog.getByRole('button', { name: 'Reset to automatic' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('[data-crop-result]')).toHaveText('automatic');
    await expect(page.locator('[data-crop-value]')).toHaveText('0.0800,0.0600,0.9200,0.2400');
  });

  test('the keyboard moves the box and each handle, Shift takes larger steps, Escape cancels', async ({ page }) => {
    const dialog = await openEditor(page);
    await expect(dialog).toHaveAttribute('data-state', 'ready');
    const crop = box(page);
    await expect(crop).toBeFocused();
    await expect(crop).toHaveAccessibleName('Crop: left 20%, top 20%, right 60%, bottom 50% of the page');

    await page.keyboard.press('ArrowRight');
    await expectCrop(page, [0.21, 0.2, 0.61, 0.5], 0);
    await page.keyboard.press('Shift+ArrowDown');
    await expectCrop(page, [0.21, 0.25, 0.61, 0.55], 0);
    await expect(crop).toHaveAccessibleName('Crop: left 21%, top 25%, right 61%, bottom 55% of the page');

    // Tab goes from the box to the handles, each named for its place.
    await page.keyboard.press('Tab');
    const top = dialog.getByRole('button', { name: 'Top edge' });
    await expect(top).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowLeft'); // across the edge: nothing
    await expectCrop(page, [0.21, 0.23, 0.61, 0.55], 0);

    const corner = dialog.getByRole('button', { name: 'Bottom right corner' });
    await corner.focus();
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('ArrowDown');
    await expectCrop(page, [0.21, 0.23, 0.66, 0.56], 0);

    // The page edge and the minimum size hold for keys too.
    await dialog.getByRole('button', { name: 'Left edge' }).focus();
    for (let i = 0; i < 6; i++) await page.keyboard.press('Shift+ArrowLeft');
    await expectCrop(page, [0, 0.23, 0.66, 0.56], 0);
    await dialog.getByRole('button', { name: 'Right edge' }).focus();
    for (let i = 0; i < 20; i++) await page.keyboard.press('Shift+ArrowLeft');
    await expectCrop(page, [0, 0.23, 0.1, 0.56], 0);
    for (const name of ['Top left corner', 'Top right corner', 'Bottom left corner', 'Bottom edge']) await expect(dialog.getByRole('button', { name })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.locator('[data-crop-result]')).toHaveText('cancelled');
    // A cancelled edit changes nothing, and focus goes back to what opened the editor.
    await expect(page.locator('[data-crop-value]')).toHaveText('0.2000,0.2000,0.6000,0.5000');
    const opener = page.getByRole('button', { name: 'Open crop editor' });
    await opener.click();
    await expect(dialog).toHaveAttribute('data-state', 'ready');
    await expectCrop(page, [0.2, 0.2, 0.6, 0.5], 0);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test('the automatic crop around the highlights, at a wide and a short window, for review', async ({ page }) => {
    for (const [name, width, height] of [['desktop-1280-automatic', 1280, 800], ['short-1024x560', 1024, 560]] as const) {
      await page.setViewportSize({ width, height });
      const dialog = await openEditor(page, null);
      await expect(dialog).toHaveAttribute('data-state', 'ready');
      await expectCrop(page, [0.08, 0.06, 0.92, 0.24], 0);
      const frame = (await page.locator('[data-crop-page]').boundingBox())!;
      const shell = (await dialog.boundingBox())!;
      expect(shell.y).toBeGreaterThanOrEqual(0);
      expect(shell.y + shell.height).toBeLessThanOrEqual(height);
      expect(frame.y + frame.height).toBeLessThan(shell.y + shell.height);
      await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
    }
  });

  test('a page that cannot be loaded shows a plain message and only Cancel', async ({ page }) => {
    const dialog = await openEditor(page, null, 'no-such-source');
    await expect(dialog).toHaveAttribute('data-state', 'error');
    await expect(dialog.getByRole('alert')).toHaveText('The PDF page could not be loaded.');
    await expect(dialog.getByRole('button')).toHaveText(['Cancel']);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('[data-crop-result]')).toHaveText('cancelled');
  });
});

test.describe('crop editor on a phone-width touch screen', () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
  test.beforeEach(async ({ page }) => { await mockAuth(page); });

  test('fits the window, renders sharp, and follows a finger', async ({ page }) => {
    const dialog = await openEditor(page);
    await expect(dialog).toHaveAttribute('data-state', 'ready');
    // Nothing spills sideways and the page is drawn at the screen's density.
    const sizes = await page.evaluate(() => {
      const dialog = document.querySelector('[data-crop-editor]')!.getBoundingClientRect();
      const frame = document.querySelector('[data-crop-page]')!.getBoundingClientRect();
      const canvas = document.querySelector('[data-crop-page] canvas') as HTMLCanvasElement;
      return { dialogLeft: dialog.left, dialogRight: dialog.right, frameLeft: frame.left, frameRight: frame.right, frameWidth: frame.width, canvasWidth: canvas.width, scroll: document.documentElement.scrollWidth };
    });
    expect(sizes.dialogLeft).toBeGreaterThanOrEqual(0);
    expect(sizes.dialogRight).toBeLessThanOrEqual(390);
    expect(sizes.frameLeft).toBeGreaterThan(sizes.dialogLeft);
    expect(sizes.frameRight).toBeLessThan(sizes.dialogRight);
    expect(sizes.scroll).toBeLessThanOrEqual(390);
    expect(Math.abs(sizes.canvasWidth - 2 * sizes.frameWidth)).toBeLessThanOrEqual(2);
    for (const name of ['Reset to automatic', 'Cancel', 'Apply']) await expect(dialog.getByRole('button', { name })).toBeInViewport();
    await page.screenshot({ path: path.join(SHOTS, 'phone-390.png') });

    // A finger drags the bottom right corner, through Chrome's own touch input.
    const frame = (await page.locator('[data-crop-page]').boundingBox())!;
    const grip = (await handle(page, 'se').boundingBox())!;
    const cdp = await page.context().newCDPSession(page);
    const at = (x: number, y: number) => [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }];
    let x = grip.x + grip.width / 2, y = grip.y + grip.height / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(x, y) });
    for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(x + i * 0.1 * frame.width / 8, y + i * 0.1 * frame.height / 8) });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expectCrop(page, [0.2, 0.2, 0.7, 0.6], 0.006);

    // And moves the box.
    const inside = (await box(page).boundingBox())!;
    x = inside.x + inside.width / 2; y = inside.y + inside.height / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(x, y) });
    for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(x - i * 0.1 * frame.width / 8, y + i * 0.1 * frame.height / 8) });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expectCrop(page, [0.1, 0.3, 0.6, 0.7], 0.006);
    await page.screenshot({ path: path.join(SHOTS, 'phone-390-after-touch.png') });

    await dialog.getByRole('button', { name: 'Apply' }).tap();
    await expect(page.locator('[data-crop-result]')).toHaveText(/^applied 0\.1\d+,0\.\d+,0\.\d+,0\.\d+$/);
  });
});
