import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { mockAuth } from './helpers';

test.describe('share card samples', () => {
  test.beforeEach(async ({ page }) => { await mockAuth(page); });

  test('every sample card fits, and each is written as a PNG for review', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/dev/share-cards');
    await expect(page.locator('main[data-samples-done="true"]')).toBeVisible({ timeout: 100_000 });
    const samples = page.locator('[data-sample]');
    // 7 samples × 3 styles × 3 looks × 2 sizes. Page cards need a PDF and are covered with the reader.
    await expect(samples).toHaveCount(126);
    const failed = await page.locator('[data-fits="false"]').evaluateAll(nodes => nodes.map(node => `${node.getAttribute('data-sample')}: ${node.textContent}`));
    expect(failed).toEqual([]);
    const images = await page.locator('[data-sample] img').evaluateAll(async nodes => Promise.all(nodes.map(async node => {
      const image = node as HTMLImageElement;
      const bytes = new Uint8Array(await (await fetch(image.src)).arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return { name: image.alt, width: image.naturalWidth, height: image.naturalHeight, png: btoa(binary) };
    })));
    const directory = path.resolve('test-results/share-card-samples');
    fs.mkdirSync(directory, { recursive: true });
    for (const image of images) {
      expect(image.width).toBe(1080);
      expect(image.height).toBe(image.name.endsWith('-story') ? 1920 : 1350);
      fs.writeFileSync(path.join(directory, `${image.name}.png`), Buffer.from(image.png, 'base64'));
    }
    expect(images).toHaveLength(126);
  });
});
