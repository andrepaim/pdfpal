import { test, expect } from '@playwright/test';
import { mockAuth } from './helpers';

declare global {
  interface Window {
    saveSettingsTestSelection?: (agent: string, model?: string, efforts?: Record<string, string>) => Promise<void>;
  }
}

test.beforeEach(async ({ page }) => {
  await mockAuth(page);
  await page.addInitScript(() => {
    let open: (() => void) | undefined;
    window.pdfpalDesktop = {
      setAgent: async (...args: [id: string, model?: string, efforts?: Record<string, string>]) => {
        await window.saveSettingsTestSelection?.(...args);
        localStorage.setItem('settings-test-agent', args[0]);
        return args[0];
      },
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
  await modal.getByRole('checkbox').check();
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
  await modal.getByRole('checkbox').check();
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

test('AI settings stage and save a default model for the selected assistant', async ({ page }) => {
  const models = {
    claude: { model: 'retained-claude-model', models: [{ id: 'new-claude-model', name: 'New Claude model' }] },
    codex: { model: '', models: [{ id: 'new-codex-model', name: 'New Codex model' }] },
  };
  const writes: { agent: string; model: string }[] = [];
  await page.exposeFunction('saveSettingsTestSelection', (agent: keyof typeof models, model: string) => {
    writes.push({ agent, model });
    models[agent].model = model;
  });
  await page.route('**/api/agent-models/*', route => {
    const agent = new URL(route.request().url()).pathname.split('/').at(-1) as keyof typeof models;
    return route.fulfill({ json: models[agent] });
  });
  await page.goto('/');
  const openSettings = async () => page.evaluate(() => window.dispatchEvent(new Event('open-test-settings')));
  await openSettings();
  const modal = page.getByRole('dialog', { name: 'AI assistant' });
  const claudeModel = modal.getByRole('combobox', { name: 'Claude Code default model' });
  const codexModel = modal.getByRole('combobox', { name: 'Codex default model' });
  await expect(claudeModel).toHaveValue('retained-claude-model');
  await claudeModel.selectOption('new-claude-model');
  await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(modal).not.toBeVisible();
  expect(writes).toEqual([]);

  await openSettings();
  await expect(claudeModel).toHaveValue('retained-claude-model');
  await modal.getByRole('radio', { name: /Codex/ }).check();
  await expect(codexModel).toHaveValue('');
  await expect(codexModel.getByRole('option', { name: 'Automatic' })).toHaveCount(1);
  await codexModel.selectOption('new-codex-model');
  await modal.getByRole('checkbox').check();
  await modal.getByRole('button', { name: 'Use assistant' }).click();
  await expect(modal).not.toBeVisible();
  expect(writes).toEqual([{ agent: 'codex', model: 'new-codex-model' }]);
});

test('AI settings leave saved models alone when the model catalogue is unavailable', async ({ page }) => {
  const writes: string[][] = [];
  await page.exposeFunction('saveSettingsTestSelection', (...args: string[]) => { writes.push(args); });
  await page.route('**/api/agent-models/*', route => {
    return route.fulfill({ status: 503 });
  });
  await page.goto('/');
  await page.evaluate(() => window.dispatchEvent(new Event('open-test-settings')));
  const modal = page.getByRole('dialog', { name: 'AI assistant' });
  await expect(modal.getByText('Could not load available models.')).toBeVisible();
  await modal.getByRole('button', { name: 'Use assistant' }).click();
  await expect(modal).not.toBeVisible();
  expect(writes).toEqual([['claude']]);
});

test('AI settings test a custom model without saving and allow retrying a failed save', async ({ page }) => {
  let saved = 'original-model';
  let rejectWrite = true;
  await page.exposeFunction('saveSettingsTestSelection', (_agent: string, model: string) => {
    if (rejectWrite) throw new Error('Simulated save failure');
    saved = model;
  });
  await page.route('**/api/agent-models/claude', route => route.fulfill({ json: { model: saved, models: [] } }));
  await page.goto('/');
  await page.evaluate(() => {
    window.pdfpalDesktop!.testConnection = async (...args: unknown[]) => {
      localStorage.setItem('settings-test-connection', JSON.stringify(args));
      return { at: new Date().toISOString() };
    };
    window.dispatchEvent(new Event('open-test-settings'));
  });
  const modal = page.getByRole('dialog', { name: 'AI assistant' });
  const model = modal.getByRole('combobox', { name: 'Claude Code default model' });
  await expect(model).toHaveValue('original-model');
  await model.selectOption({ label: 'Enter a model ID…' });
  const customModel = modal.getByRole('textbox', { name: 'Model ID' });
  await customModel.fill('  provider/custom-model[1m]  ');
  await modal.getByRole('button', { name: 'Apply model' }).click();
  await expect(model).toHaveValue('provider/custom-model[1m]');
  await modal.getByRole('button', { name: 'Test connection' }).click();
  await expect(modal.getByText(/Connection verified/)).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('settings-test-connection')!)))
    .toEqual(['claude', 'provider/custom-model[1m]']);
  expect(saved).toBe('original-model');

  await modal.getByRole('button', { name: 'Use assistant' }).click();
  await expect(modal.getByRole('alert')).toContainText('default model could not be saved');
  expect(await page.evaluate(() => localStorage.getItem('settings-test-agent'))).toBeNull();
  await expect(model).toHaveValue('provider/custom-model[1m]');
  rejectWrite = false;
  await modal.getByRole('button', { name: 'Use assistant' }).click();
  await expect(modal).not.toBeVisible();
  expect(saved).toBe('provider/custom-model[1m]');

  await page.evaluate(() => window.dispatchEvent(new Event('open-test-settings')));
  await expect(model).toHaveValue('provider/custom-model[1m]');
  await model.selectOption('');
  await modal.getByRole('button', { name: 'Use assistant' }).click();
  await expect(modal).not.toBeVisible();
  expect(saved).toBe('');
});

test('AI settings stage reasoning effort independently for each available model', async ({ page }) => {
  const catalogue = {
    model: 'quick',
    models: [
      { id: 'quick', name: 'Quick', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium' },
      { id: 'deep', name: 'Deep', efforts: ['high', 'max'], defaultEffort: 'high' },
      { id: 'fixed', name: 'Fixed', efforts: ['medium'], defaultEffort: 'medium' },
      { id: 'unverified', name: 'Unverified' },
    ],
    effortDefaults: { quick: 'low', deep: 'high' } as Record<string, string>,
  };
  const writes: { agent: string; model?: string; efforts?: Record<string, string> }[] = [];
  await page.exposeFunction('saveSettingsTestSelection', (agent: string, model?: string, efforts?: Record<string, string>) => {
    writes.push({ agent, model, efforts });
    if (model !== undefined) catalogue.model = model;
    for (const [id, effort] of Object.entries(efforts ?? {})) {
      if (effort) catalogue.effortDefaults[id] = effort;
      else delete catalogue.effortDefaults[id];
    }
  });
  await page.route('**/api/agent-models/claude', route => route.fulfill({ json: catalogue }));
  await page.goto('/');
  await page.evaluate(() => {
    window.pdfpalDesktop!.testConnection = async (...args: unknown[]) => {
      localStorage.setItem('settings-test-connection', JSON.stringify(args));
      return { at: new Date().toISOString() };
    };
  });
  const openSettings = async () => page.evaluate(() => window.dispatchEvent(new Event('open-test-settings')));
  const modal = page.getByRole('dialog', { name: 'AI assistant' });
  const model = modal.getByRole('combobox', { name: 'Claude Code default model' });
  const effort = modal.getByRole('combobox', { name: 'Default reasoning effort' });
  await openSettings();
  await expect(effort).toHaveValue('low');
  await effort.selectOption('high');
  await model.selectOption('deep');
  await expect(effort).toHaveValue('high');
  await effort.selectOption('max');
  await model.selectOption('quick');
  await expect(effort).toHaveValue('high');
  await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(writes).toEqual([]);

  await openSettings();
  await expect(effort).toHaveValue('low');
  await effort.selectOption('');
  await modal.getByRole('button', { name: 'Test connection' }).click();
  await expect(modal.getByText(/Connection verified/)).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('settings-test-connection')!)))
    .toEqual(['claude', 'quick', '']);
  expect(writes).toEqual([]);
  await model.selectOption('fixed');
  await expect(effort).toHaveCount(0);
  await model.selectOption('unverified');
  await expect(effort).toHaveCount(0);
  await model.selectOption('');
  await expect(effort).toHaveCount(0);
  await model.selectOption('deep');
  await expect(effort.getByRole('option')).toHaveText(['Automatic (High)', 'High', 'Max']);
  await effort.selectOption('max');
  await modal.getByRole('button', { name: 'Use assistant' }).click();
  await expect(modal).not.toBeVisible();
  expect(writes).toEqual([{ agent: 'claude', model: 'deep', efforts: { quick: '', deep: 'max' } }]);

  await openSettings();
  await expect(model).toHaveValue('deep');
  await expect(effort).toHaveValue('max');
  await model.selectOption('quick');
  await expect(effort).toHaveValue('');
});
