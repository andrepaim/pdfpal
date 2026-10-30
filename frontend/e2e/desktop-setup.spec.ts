import { test, expect } from '@playwright/test';
import { mockAuth } from './helpers';

test.beforeEach(async ({ page }) => {
  await mockAuth(page);
  await page.addInitScript(() => {
    const agents = [{ id: 'claude', label: 'Claude', available: false, state: 'missing', auth: 'unknown' },
      { id: 'codex', label: 'Codex', available: true, state: 'installed', auth: 'account', version: '0.164.0' }];
    let cancel: (() => void) | undefined;
    const record = (name: string, value: unknown) => localStorage.setItem(name, JSON.stringify(value));
    window.pdfpalDesktop = {
      setAgent: async id => { record('chosen', id); return id; }, onAgentChanged: () => () => {},
      setupStatus: async () => ({ complete: localStorage.getItem('complete') === 'true' }),
      setupState: async () => ({ default: 'claude', complete: localStorage.getItem('complete') === 'true', agents: JSON.parse(localStorage.getItem('agents') || JSON.stringify(agents)), explicit: localStorage.getItem('explicit') === 'true' }),
      completeSetup: async () => { localStorage.setItem('complete', 'true'); return true; },
      setupAction: async (agent, action) => { record('action', { agent, action }); },
      testConnection: async agent => {
        record('tested', agent);
        if (localStorage.getItem('test-mode') === 'slow') return new Promise((_resolve, reject) => { cancel = () => reject(new Error('Connection test cancelled.')); });
        if (localStorage.getItem('test-mode') === 'offline') throw new Error('Could not reach your assistant. Check your internet connection, then retry.');
        return { at: '2026-10-29T14:00:00.000Z' };
      },
      cancelTest: async () => { cancel?.(); record('cancelled', true); return true; },
      serviceState: async () => ({ state: 'ready' }),
      onServiceState: callback => { const listener = (event: Event) => callback((event as CustomEvent).detail); window.addEventListener('test-service', listener); return () => window.removeEventListener('test-service', listener); },
      retryService: async () => { record('retried', true); return true; },
      diagnostics: async () => ({ appVersion: '2.1.0', agents: [], events: [{ code: 'READY' }] }),
      exportDiagnostics: async () => { record('exported', true); return true; },
      onOpenDiagnostics: callback => { window.addEventListener('test-diagnostics', callback); return () => window.removeEventListener('test-diagnostics', callback); },
    };
  });
});

test('first launch detects one signed-in assistant without generating, saves choice and stays complete', async ({ page }) => {
  await page.goto('/');
  const modal = page.getByRole('dialog', { name: 'Connect your reading assistant' });
  await expect(modal).toBeVisible();
  await expect(modal.getByRole('radio', { name: /Codex/ })).toBeChecked();
  expect(await page.evaluate(() => localStorage.getItem('tested'))).toBeNull();
  await modal.getByRole('button', { name: 'Start reading' }).click();
  await expect(modal).not.toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('chosen'))).toBe('"codex"');
  await page.reload();
  await expect(page.getByRole('dialog')).not.toBeVisible();
});

test('missing assistants get explicit installation help and reading without AI remains available', async ({ page }) => {
  await page.goto('/');
  const modal = page.getByRole('dialog');
  await modal.getByRole('button', { name: 'Install Claude Code' }).click();
  await expect(modal.getByRole('region', { name: 'Confirm assistant setup' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('action'))).toBeNull();
  await modal.getByRole('button', { name: 'Open official installer' }).click();
  await expect(modal.getByRole('status')).toContainText('official setup window');
  expect(JSON.parse(await page.evaluate(() => localStorage.getItem('action')) || '{}')).toEqual({ agent: 'claude', action: 'install' });
  await modal.getByRole('button', { name: 'Continue without AI' }).click();
  await expect(modal).not.toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('chosen'))).toBeNull();
});

test('optional connection tests report success and offline failures inline', async ({ page }) => {
  await page.goto('/');
  const modal = page.getByRole('dialog');
  const connection = modal.getByRole('group', { name: 'Codex connection', exact: true });
  await connection.getByRole('button', { name: 'Test connection' }).click();
  await expect(connection.getByText(/Last verified:/)).toBeVisible();
  await page.evaluate(() => localStorage.setItem('test-mode', 'offline'));
  await modal.getByRole('button', { name: 'Test connection' }).click();
  await expect(modal.getByRole('alert')).toContainText('internet connection');
  await expect(modal).toBeVisible();
});

test('closing during a test cancels it and unfinished setup resumes on next launch', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('test-mode', 'slow'));
  const modal = page.getByRole('dialog');
  await modal.getByRole('button', { name: 'Test connection' }).click();
  await modal.getByRole('button', { name: 'Cancel test' }).click();
  await expect(modal.getByRole('button', { name: 'Test connection' })).toBeEnabled();
  await modal.getByRole('button', { name: 'Test connection' }).click();
  await expect(modal.getByRole('button', { name: 'Cancel test' })).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(modal).not.toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('cancelled'))).toBe('true');
  await page.reload();
  await expect(page.getByRole('dialog', { name: 'Connect your reading assistant' })).toBeVisible();
});

test('explicit choice survives detection, signed-out login and separate billing are clear', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('explicit', 'true');
    localStorage.setItem('agents', JSON.stringify([
      { id: 'claude', label: 'Claude', available: true, state: 'installed', auth: 'signed_out' },
      { id: 'codex', label: 'Codex', available: true, state: 'installed', auth: 'api' },
    ]));
  });
  await page.goto('/');
  const modal = page.getByRole('dialog');
  await expect(modal.getByRole('radio', { name: /Claude/ })).toBeChecked();
  await expect(modal.getByText('Sign-in needed', { exact: true })).toBeVisible();
  await modal.getByRole('button', { name: 'Sign in', exact: true }).first().click();
  await modal.getByRole('button', { name: 'Open sign-in' }).click();
  expect(JSON.parse(await page.evaluate(() => localStorage.getItem('action')) || '{}')).toEqual({ agent: 'claude', action: 'login' });
  await modal.getByRole('radio', { name: /Codex/ }).check();
  await expect(modal.getByRole('button', { name: 'Test connection' })).toBeDisabled();
  await expect(modal.getByRole('button', { name: 'Start reading' })).toBeDisabled();
  await modal.getByRole('checkbox').check();
  await expect(modal.getByRole('button', { name: 'Start reading' })).toBeEnabled();
});

test('service recovery offers retry and diagnostics are previewed before export', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Continue without AI' }).click();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('test-service', { detail: { state: 'failed' } })));
  await page.getByRole('button', { name: 'Retry service' }).click();
  expect(await page.evaluate(() => localStorage.getItem('retried'))).toBe('true');
  expect(await page.evaluate(() => localStorage.getItem('tested'))).toBeNull();
  await page.evaluate(() => window.dispatchEvent(new Event('test-diagnostics')));
  const modal = page.getByRole('dialog', { name: 'Diagnostic preview' });
  await expect(modal.locator('pre')).toContainText('READY');
  expect(await page.evaluate(() => localStorage.getItem('exported'))).toBeNull();
  await modal.getByRole('button', { name: 'Export report' }).click();
  expect(await page.evaluate(() => localStorage.getItem('exported'))).toBe('true');
});

test('setup actions stay visible on a small display while the content scrolls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 600 });
  await page.goto('/');
  const modal = page.getByRole('dialog');
  await expect(modal.getByRole('radio', { name: /Codex/ })).toBeChecked();
  await expect(modal.getByRole('button', { name: 'Continue without AI' })).toBeInViewport();
  await expect(modal.getByRole('button', { name: 'Start reading' })).toBeInViewport();
  await expect(modal.getByRole('button', { name: 'Close AI settings' })).toBeInViewport();
  expect(await modal.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
});
