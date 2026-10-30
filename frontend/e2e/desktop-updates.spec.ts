import { test, expect } from '@playwright/test';
import { mockAuth } from './helpers';

test.beforeEach(async ({ page }) => {
  await mockAuth(page);
  await page.addInitScript(() => {
    let open: (() => void) | undefined;
    window.pdfpalDesktop = {
      setAgent: async id => id, onAgentChanged: () => () => {},
      onOpenUpdates: callback => { open = callback; return () => { open = undefined; }; },
      checkUpdates: async () => {
        localStorage.setItem('checks', String(Number(localStorage.getItem('checks') || '0') + 1));
        return JSON.parse(localStorage.getItem('update-state') || JSON.stringify({ state: 'unpublished', currentVersion: '2.1.0-preview.1', distribution: 'unsigned' }));
      },
      downloadUpdate: async () => { localStorage.setItem('download', 'requested'); return true; },
      releaseNotes: async () => { localStorage.setItem('notes', 'opened'); return true; },
      openLicenses: async () => { localStorage.setItem('licenses', 'opened'); return true; },
    };
    window.addEventListener('test-open-updates', () => open?.());
  });
});

test('updates are checked only on request and unpublished previews show their version honestly', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'My Projects' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('checks'))).toBeNull();
  await page.evaluate(() => window.dispatchEvent(new Event('test-open-updates')));
  const modal = page.getByRole('dialog', { name: 'Software updates' });
  await expect(modal.getByText('Version 2.1.0-preview.1 · Unsigned preview')).toBeVisible();
  await expect(modal.getByRole('status')).toContainText('No signed desktop release');
  await expect(modal.getByRole('button', { name: 'Download installer' })).toHaveCount(0);
  await modal.getByRole('button', { name: 'Open-source licenses' }).click();
  expect(await page.evaluate(() => localStorage.getItem('licenses'))).toBe('opened');
  await page.keyboard.press('Escape');
  await expect(modal).not.toBeVisible();
});

test('an available release shows plain-text notes and downloads only after an explicit action', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('update-state', JSON.stringify({ state: 'available', currentVersion: '2.1.0-preview.1', version: '2.1.0', publisher: 'Fixture Publisher', notes: '<script>window.untrusted = true</script>\nImproved reading.' })));
  await page.evaluate(() => window.dispatchEvent(new Event('test-open-updates')));
  const modal = page.getByRole('dialog', { name: 'Software updates' });
  await expect(modal.getByRole('heading', { name: 'pdfpal 2.1.0 is available' })).toBeVisible();
  await expect(modal.locator('.desktop-update-notes')).toContainText('<script>');
  expect(await modal.locator('script').count()).toBe(0);
  expect(await page.evaluate(() => localStorage.getItem('download'))).toBeNull();
  await modal.getByRole('button', { name: 'Download installer' }).click();
  expect(await page.evaluate(() => localStorage.getItem('download'))).toBe('requested');
  await modal.getByRole('button', { name: 'Release notes' }).click();
  expect(await page.evaluate(() => localStorage.getItem('notes'))).toBe('opened');
});

test('failed checks stay in the dialog and can be retried', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('update-state', JSON.stringify({ state: 'error', currentVersion: '2.1.0-preview.1', message: 'Check your internet connection and try again.' })));
  await page.evaluate(() => window.dispatchEvent(new Event('test-open-updates')));
  const modal = page.getByRole('dialog', { name: 'Software updates' });
  await expect(modal.getByRole('alert')).toContainText('internet connection');
  await page.evaluate(() => localStorage.setItem('update-state', JSON.stringify({ state: 'current', currentVersion: '2.1.0' })));
  await modal.getByRole('button', { name: 'Check again' }).click();
  await expect(modal.getByRole('status')).toHaveText('You’re up to date.');
});
