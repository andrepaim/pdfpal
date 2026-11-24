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
    const element = elements.find(el => (el.textContent?.trim().split(/\s+/).length ?? 0) >= 3)!;
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    const rect = element.getBoundingClientRect();
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: rect.left + 5, clientY: rect.top + 5 }));
  });
}

test.describe('reader selection context', () => {
  test.beforeEach(async ({ page }) => { await mockAuth(page); });

  test('Explain sends one passage explanation to reader chat without typing', async ({ page }) => {
    const requests: Record<string, unknown>[] = [];
    await page.route('**/api/agents', route => route.fulfill({
      json: { default: 'codex', agents: [{ id: 'codex', label: 'Codex', available: true }] },
    }));
    await page.route('**/api/chat', async route => {
      requests.push(route.request().postDataJSON());
      await route.fulfill({ contentType: 'text/event-stream', body: 'data: {"text":"Passage explained."}\n\ndata: [DONE]\n\n' });
    });
    const { project, source } = await openReader(page);
    await page.getByRole('button', { name: '📝 Notes' }).click();
    await selectOnFirstPage(page);
    const actions = page.locator('[data-ask-bubble]');
    await expect(actions.getByRole('button').first()).toHaveText('Explain');
    const passage = await page.evaluate(() => window.getSelection()!.toString().trim());
    expect(requests).toHaveLength(0);
    await actions.getByRole('button', { name: 'Explain', exact: true }).click();
    await expect(page.getByText('Passage explained.', { exact: true })).toBeVisible();
    expect(requests).toEqual([expect.objectContaining({
      project_id: project.id, source_id: source.id, selection_page: 1, agent: 'codex',
      message: 'Explain this passage in plain language. Use the surrounding page for context and clarify any technical terms needed to understand it.\n\n> ' + passage,
    })]);
    await expect(actions).toHaveCount(0);

    const draft = 'How does this relate to the earlier result?';
    await page.getByRole('textbox').fill(draft);
    await selectOnFirstPage(page);
    await actions.getByRole('button', { name: 'Explain', exact: true }).click();
    await expect.poll(() => requests.length).toBe(2);
    await expect(page.getByRole('textbox')).toHaveValue(draft);
  });

  test('chat sends the page an attached selection came from, and plain questions do not', async ({ page }) => {
    const bodies: Array<Record<string, unknown>> = [];
    await page.route('**/api/chat', async route => {
      bodies.push(route.request().postDataJSON());
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'data: {"text":"Answer."}\n\ndata: [DONE]\n\n' });
    });
    await openReader(page);
    await selectOnFirstPage(page);
    await page.getByRole('button', { name: 'Ask…', exact: true }).click();
    await expect(page.getByText('Selection attached — ask a question or type /visual')).toBeVisible();
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

  for (const entry of ['selection button', 'chat command']) {
    test(`a visual explanation from the ${entry} sends the selection and its page`, async ({ page }) => {
      let body: Record<string, unknown> | undefined;
      await page.route('**/api/agents', route => route.fulfill({
        json: { default: 'codex', agents: [{ id: 'codex', label: 'Codex', available: true }] },
      }));
      await page.route('**/api/projects/*/visuals', async route => {
        if (route.request().method() !== 'POST') return route.fallback();
        body = route.request().postDataJSON();
        await route.fulfill({ status: 400, json: { detail: 'Stopped by the test.' } });
      });
      const { source } = await openReader(page);
      await selectOnFirstPage(page);
      if (entry === 'selection button') {
        await page.getByRole('button', { name: 'Explain visually', exact: true }).click();
      } else {
        await page.getByRole('button', { name: 'Ask…', exact: true }).click();
        await page.getByRole('textbox').fill('/visual Explain this');
        await page.keyboard.press('Enter');
      }
      await expect.poll(() => body).toMatchObject({ selection_page: 1, source_id: source.id, selection: expect.any(String) });
      expect(body!.selection).toBeTruthy();
    });
  }
});

test.describe('paper conversation models', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuth(page);
    await page.route('**/api/agents', route => route.fulfill({
      json: { default: 'codex', agents: [{ id: 'codex', label: 'Codex', available: true }, { id: 'claude', label: 'Claude', available: true }] },
    }));
  });

  test('remembers each assistant model and uses it for Ask, Explain and visuals while preserving the draft', async ({ page }) => {
    const asks: Record<string, unknown>[] = [];
    const visuals: Record<string, unknown>[] = [];
    await page.route('**/api/agent-models/codex', route => route.fulfill({
      json: { models: [{ id: 'codex-default', name: 'Codex default' }, { id: 'codex-fast', name: 'Codex fast' }], model: 'codex-default' },
    }));
    await page.route('**/api/agent-models/claude', route => route.fulfill({
      json: { models: [{ id: 'claude-default', name: 'Claude default' }, { id: 'claude-fast', name: 'Claude fast' }], model: 'claude-default' },
    }));
    await page.route('**/api/chat', route => {
      asks.push(route.request().postDataJSON());
      return route.fulfill({ contentType: 'text/event-stream', body: 'data: {"text":"Answered."}\n\ndata: [DONE]\n\n' });
    });
    await page.route('**/api/projects/*/visuals', route => {
      if (route.request().method() !== 'POST') return route.fallback();
      visuals.push(route.request().postDataJSON());
      return route.fulfill({ status: 400, json: { detail: 'Stopped by the test.' } });
    });
    const { project, source } = await openReader(page);
    const assistant = page.getByTitle('Chat agent');
    const model = page.getByRole('combobox', { name: 'Conversation model' });
    const draft = page.getByPlaceholder(/Ask (a question|about the selection)/);

    await expect(model.locator('option:checked')).toHaveText('Use default (Codex default)');
    await draft.fill('Why does the result hold?');
    await model.selectOption('codex-fast');
    await assistant.selectOption('claude');
    await expect(model.locator('option:checked')).toHaveText('Use default (Claude default)');
    await model.selectOption('claude-fast');
    await assistant.selectOption('codex');
    await expect(model).toHaveValue('codex-fast');
    await expect(draft).toHaveValue('Why does the result hold?');
    await draft.press('Enter');
    await expect(page.getByText('Answered.', { exact: true })).toBeVisible();
    expect(asks[0]).toMatchObject({ agent: 'codex', model: 'codex-fast', source_id: source.id });

    await page.reload();
    await expect(model).toHaveValue('codex-fast');
    await assistant.selectOption('claude');
    await expect(model).toHaveValue('claude-fast');
    await draft.fill('Keep this draft');
    await selectOnFirstPage(page);
    await page.getByRole('button', { name: 'Explain', exact: true }).click();
    await expect(page.getByText('Answered.', { exact: true })).toBeVisible();
    expect(asks[1]).toMatchObject({ agent: 'claude', model: 'claude-fast', selection_page: 1 });
    await expect(draft).toHaveValue('Keep this draft');

    await selectOnFirstPage(page);
    await page.getByRole('button', { name: 'Explain visually', exact: true }).click();
    await expect.poll(() => visuals[0]).toMatchObject({ agent: 'claude', model: 'claude-fast', selection_page: 1 });
    await expect(draft).toHaveValue('Keep this draft');

    const second = await page.request.post(`/api/projects/${project.id}/sources`, {
      data: { url: 'test/fixtures/sample.pdf', title: 'Second paper' },
    });
    expect(second.ok()).toBeTruthy();
    await page.goto(`/projects/${project.id}/sources/${(await second.json()).id}`);
    await expect(model.locator('option:checked')).toHaveText('Use default (Claude default)');
    await page.goto(`/projects/${project.id}/sources/${source.id}`);
    await expect(model).toHaveValue('claude-fast');
    await model.selectOption('');
    await draft.fill('Use configured model');
    await draft.press('Enter');
    await expect.poll(() => asks.length).toBe(3);
    expect(asks[2]).toMatchObject({ agent: 'claude' });
    expect(asks[2]).not.toHaveProperty('model');
    await page.reload();
    await expect(model.locator('option:checked')).toHaveText('Use default (Claude default)');
  });

  test('keeps Ask available during discovery and offers custom IDs if the other assistant list fails', async ({ page }) => {
    const asks: Record<string, unknown>[] = [];
    let finishCodexList: () => void = () => {};
    const delayedCodexList = new Promise<void>(resolve => { finishCodexList = resolve; });
    await page.route('**/api/agent-models/codex', async route => {
      await delayedCodexList;
      await route.fulfill({ json: { models: [{ id: 'codex-only', name: 'Codex only' }], model: 'codex-only' } });
    });
    await page.route('**/api/agent-models/claude', route => route.fulfill({ status: 503, json: {} }));
    await page.route('**/api/chat', route => {
      asks.push(route.request().postDataJSON());
      return route.fulfill({ contentType: 'text/event-stream', body: 'data: {"text":"Answered."}\n\ndata: [DONE]\n\n' });
    });
    await openReader(page);
    const draft = page.getByPlaceholder('Ask a question, or type /visual…');
    await draft.fill('Use the assistant default');
    await draft.press('Enter');
    await expect(page.getByText('Answered.', { exact: true })).toBeVisible();
    expect(asks[0]).toMatchObject({ agent: 'codex' });
    expect(asks[0]).not.toHaveProperty('model');

    await page.getByTitle('Chat agent').selectOption('claude');
    finishCodexList();
    const model = page.getByRole('combobox', { name: 'Conversation model' });
    await expect(model.getByRole('option', { name: 'Codex only' })).toHaveCount(0);
    await model.selectOption({ label: 'Enter a model ID…' });
    await page.getByRole('textbox', { name: 'Conversation model ID' }).fill('local-model');
    await page.getByRole('button', { name: 'Apply model' }).click();
    await expect(model).toHaveValue('local-model');
    await draft.fill('Use the custom model');
    await draft.press('Enter');
    await expect.poll(() => asks.length).toBe(2);
    expect(asks[1]).toMatchObject({ agent: 'claude', model: 'local-model' });
  });

  test('keeps ChatGPT overrides scoped to the active desktop library and account', async ({ page }) => {
    await page.addInitScript(() => {
      window.pdfpalDesktop = {
        setAgent: async id => id,
        onAgentChanged: () => () => {},
        libraryState: async () => {
          if (localStorage.getItem('test-delay-library')) {
            await new Promise(resolve => window.addEventListener('test-library-ready', resolve, { once: true }));
          }
          return { active: localStorage.getItem('test-library') || 'original', libraries: [] };
        },
        chatgpt: async () => {
          const active = localStorage.getItem('test-account') || 'first';
          return {
            connected: true, busy: false, active, accounts: [], message: '', model: `${active}-default`,
            models: [{ id: `${active}-default`, name: `${active} default` }, { id: 'fast', name: 'Fast' }],
          };
        },
      };
    });
    await page.route('**/api/agents', route => route.fulfill({
      json: { default: 'chatgpt', agents: [{ id: 'chatgpt', label: 'ChatGPT', available: true }] },
    }));
    const asks: Record<string, unknown>[] = [];
    await page.route('**/api/chat', route => {
      asks.push(route.request().postDataJSON());
      return route.fulfill({ contentType: 'text/event-stream', body: 'data: {"text":"Answered."}\n\ndata: [DONE]\n\n' });
    });
    await openReader(page);
    const model = page.getByRole('combobox', { name: 'Conversation model' });
    const draft = page.getByPlaceholder('Ask a question, or type /visual…');
    await expect(model.locator('option:checked')).toHaveText('Use default (first default)');
    await expect(model.getByRole('option', { name: 'Enter a model ID…' })).toHaveCount(0);
    await model.selectOption('fast');
    await page.evaluate(() => localStorage.setItem('test-delay-library', 'true'));
    await page.reload();
    await draft.fill('Send after the library loads');
    await expect(page.getByRole('button', { name: '↑' })).toBeDisabled();
    await draft.press('Enter');
    expect(asks).toHaveLength(0);
    await expect(draft).toHaveValue('Send after the library loads');
    await page.evaluate(() => {
      localStorage.removeItem('test-delay-library');
      window.dispatchEvent(new Event('test-library-ready'));
    });
    await expect(model).toHaveValue('fast');
    await draft.press('Enter');
    await expect(page.getByText('Answered.', { exact: true })).toBeVisible();
    expect(asks[0]).toMatchObject({ agent: 'chatgpt', model: 'fast' });

    await page.getByRole('button', { name: '📝 Notes' }).click();
    await selectOnFirstPage(page);
    await page.getByRole('button', { name: 'Explain', exact: true }).click();
    await expect(page.getByText('Answered.', { exact: true })).toBeVisible();
    expect(asks[1]).toMatchObject({ agent: 'chatgpt', model: 'fast', selection_page: 1 });

    // Simulate an account change after the picker loaded. Both accounts can run
    // the same model, so checking the active model list alone cannot detect it.
    await page.evaluate(() => localStorage.setItem('test-account', 'second'));
    await draft.fill('Use the current account');
    await draft.press('Enter');
    await expect(page.getByText(/Could not confirm the selected model/)).toBeVisible();
    expect(asks).toHaveLength(2);
    await expect(draft).toHaveValue('Use the current account');
    await expect(model.locator('option:checked')).toHaveText('Use default (second default)');
    await draft.press('Enter');
    await expect.poll(() => asks.length).toBe(3);
    expect(asks[2]).toMatchObject({ agent: 'chatgpt' });
    expect(asks[2]).not.toHaveProperty('model');

    await page.evaluate(() => {
      localStorage.setItem('test-account', 'first');
      localStorage.setItem('test-library', 'recovery');
    });
    await page.reload();
    await expect(model.locator('option:checked')).toHaveText('Use default (first default)');
    await expect(model).toBeEnabled();
    await page.evaluate(() => localStorage.removeItem('test-library'));
    await page.reload();
    await expect(model).toHaveValue('fast');
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
