import { test, expect } from '@playwright/test';
import { mockAuth } from './helpers';

test.beforeEach(async ({ page }) => {
  await mockAuth(page);
  await page.addInitScript(() => {
    let open: (() => void) | undefined;
    window.pdfpalDesktop = {
      setAgent: async id => { localStorage.setItem('settings-test-agent', id); return id; },
      onAgentChanged: () => () => {},
      onOpenAISettings: callback => { open = callback; return () => { open = undefined; }; },
    };
    window.addEventListener('open-test-settings', () => open?.());
  });
  await page.route('**/api/agents', route => route.fulfill({ json: { default: 'claude', agents: [
    { id: 'claude', label: 'Claude', available: true, auth: 'account' },
    { id: 'codex', label: 'Codex', available: true, auth: 'api' },
    { id: 'opencode', label: 'OpenCode', available: false },
  ] } }));
});

test('AI settings follow the reader theme and save an available assistant', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.dispatchEvent(new Event('open-test-settings')));
  const modal = page.getByRole('dialog', { name: 'AI assistant' });
  await expect(modal).toBeVisible();
  await expect(modal).toHaveCSS('background-color', 'rgb(26, 26, 26)');
  await expect(modal.getByText('API credentials · billed separately')).toBeVisible();
  await expect(modal.getByRole('radio', { name: /OpenCode/ })).toBeDisabled();
  await modal.getByRole('radio', { name: /Codex/ }).check();
  await modal.getByRole('button', { name: 'Use assistant' }).click();
  await expect(modal).not.toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('settings-test-agent'))).toBe('codex');
});

test('AI settings keep errors in the dialog and support escape without saving', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => { window.pdfpalDesktop!.setAgent = async () => { throw new Error('fixture'); }; });
  await page.evaluate(() => window.dispatchEvent(new Event('open-test-settings')));
  const modal = page.getByRole('dialog', { name: 'AI assistant' });
  await modal.getByRole('radio', { name: /Codex/ }).check();
  await modal.getByRole('button', { name: 'Use assistant' }).click();
  await expect(modal.getByRole('alert')).toContainText('could not be saved');
  await page.keyboard.press('Escape');
  await expect(modal).not.toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('settings-test-agent'))).toBeNull();
});

test('AI settings can refresh after assistants are installed', async ({ page }) => {
  await page.route('**/api/agents', route => route.fulfill({ json: { default: 'claude', agents: [] } }));
  await page.goto('/');
  await page.evaluate(() => window.dispatchEvent(new Event('open-test-settings')));
  const modal = page.getByRole('dialog', { name: 'AI assistant' });
  await expect(modal.getByText(/You can keep reading without AI/)).toBeVisible();
  await expect(modal.getByRole('button', { name: 'Use assistant' })).toBeDisabled();
  await page.route('**/api/agents', route => route.fulfill({ json: { default: 'codex', agents: [{ id: 'codex', label: 'Codex', available: true, auth: 'account' }] } }));
  await modal.getByRole('button', { name: 'Check again' }).click();
  await expect(modal.getByRole('radio', { name: /Codex/ })).toBeChecked();
  await expect(modal.getByRole('button', { name: 'Use assistant' })).toBeEnabled();
});
