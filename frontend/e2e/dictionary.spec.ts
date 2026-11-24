import { test, expect, type Page } from '@playwright/test';
import { cardFixture } from '@andrepaim/contextual-dictionary-core/card-fixture';
import type { DictionaryDefineResponse } from '../../src/shared/dictionary';
import { mockAuth, createProjectViaApi, openReadingPreferences, readingPreferences } from './helpers';

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
const actions = (page: Page) => page.locator('[data-ask-bubble]');
const explain = (page: Page) => page.getByRole('button', { name: 'Explain', exact: true });
const defined = (page: Page) => page.waitForResponse(response => response.url().includes('/api/dictionary/define'));

test.describe('reader dictionary', () => {
  test.beforeEach(async ({ page }) => { await mockAuth(page); });

  test('double-clicking a word shows only its meanings, base form first', async ({ page }) => {
    await openReader(page);
    const box = await boxOf(page, 'mice');
    await page.mouse.dblclick(box.x, box.y);

    await expect(card(page)).toBeVisible();
    await expect(card(page).locator('section').first()).toContainText('mouse noun');
    await expect(card(page)).toContainText('rodent');
    await expect(card(page)).toContainText('plural of mouse');
    const attribution = card(page).getByRole('link', { name: 'Wiktionary · CC BY-SA 4.0' });
    await expect(attribution).toHaveAttribute('href', 'https://en.wiktionary.org/wiki/mouse');
    await expect(actions(page)).toHaveCount(0);

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
    await expect(card(page).locator('section').first()).toContainText('well-known adj');
  });

  test('two selected words use the dictionary and three or more show all normal actions', async ({ page }) => {
    await openReader(page);
    await drag(page, 'neural network');
    await expect(card(page).locator('section').first()).toContainText('neural network noun');
    await expect(actions(page)).toHaveCount(0);

    let lookups = 0;
    page.on('request', request => { if (request.url().includes('/api/dictionary/define')) lookups++; });
    for (const passage of ['a neural network', 'trained a neural network', 'We trained a neural network on images.']) {
      await drag(page, passage);
      await expect(actions(page).getByRole('button')).toHaveText(['Explain', 'Ask…', '🖊 Highlight', 'Explain visually']);
      await expect(card(page)).toHaveCount(0);
    }
    expect(lookups).toBe(0);
  });

  test('a dictionary miss offers only Explain and sends the selected text and page on click', async ({ page }) => {
    const chats: Array<Record<string, unknown>> = [];
    await page.route('**/api/agents', route => route.fulfill({
      json: { default: 'codex', agents: [{ id: 'codex', label: 'Codex', available: true }] },
    }));
    await page.route('**/api/chat', async route => {
      chats.push(route.request().postDataJSON());
      await route.fulfill({ contentType: 'text/event-stream', body: 'data: {"text":"Explanation."}\n\ndata: [DONE]\n\n' });
    });
    const { source } = await openReader(page);
    const answered = defined(page);
    const box = await boxOf(page, 'zxqv');
    await page.mouse.dblclick(box.x, box.y);
    expect((await (await answered).json()).entries).toEqual([]);
    await expect(actions(page).getByRole('button')).toHaveText(['Explain']);
    await expect(card(page)).toHaveCount(0);
    expect(chats).toHaveLength(0);

    await explain(page).click();
    await expect(page.getByText('Explanation.', { exact: true })).toBeVisible();
    expect(chats).toHaveLength(1);
    expect(chats[0]).toMatchObject({ source_id: source.id, selection_page: 1 });
    expect(chats[0]!.message).toBe('Explain this term in the context of the passage.\n\n> zxqv');
    await expect(actions(page)).toHaveCount(0);
  });

  test('a failed lookup offers Explain after the request settles and Escape dismisses it', async ({ page }) => {
    await openReader(page);
    let finishLookup!: () => void;
    const pending = new Promise<void>(resolve => { finishLookup = resolve; });
    await page.route('**/api/dictionary/define?*', async route => {
      await pending;
      await route.fulfill({ status: 503, json: { detail: 'Dictionary unavailable' } });
    });
    const requested = page.waitForRequest(request => request.url().includes('/api/dictionary/define'));
    try {
      await drag(page, 'neural network');
      await requested;
      await expect(actions(page)).toHaveCount(0);
      await expect(card(page)).toHaveCount(0);
    } finally {
      finishLookup();
    }
    await expect(actions(page).getByRole('button')).toHaveText(['Explain']);
    await page.keyboard.press('Escape');
    await expect(actions(page)).toHaveCount(0);
  });

  test('the card expands in place, keeps the selected text, and closes on a click elsewhere', async ({ page }) => {
    await openReader(page);
    const box = await boxOf(page, 'bank');
    const answered = defined(page);
    await page.mouse.dblclick(box.x, box.y);
    const { entries } = (await (await answered).json()) as DictionaryDefineResponse;
    await expect(card(page).locator('section').first()).toContainText('river bank noun');
    const shown = entries.slice(0, 3).reduce((sum, entry) => sum + Math.min(3, entry.senses.length), 0);
    const total = entries.reduce((sum, entry) => sum + entry.senses.length, 0);
    expect(total).toBeGreaterThan(shown);
    await expect(card(page).locator('li')).toHaveCount(shown);

    await card(page).getByRole('button', { name: 'Show all meanings' }).click();
    await expect(card(page).locator('li')).toHaveCount(total);
    await expect(card(page).getByRole('button', { name: 'Show fewer' })).toBeVisible();

    expect(await page.evaluate(() => window.getSelection()?.toString().trim())).toBe('bank');
    await page.getByTestId('page-progress').click();
    await expect(card(page)).toHaveCount(0);
  });

  test('additional examples alone can expand the card', async ({ page }) => {
    await openReader(page);
    await page.route('**/api/dictionary/define?*', async route => {
      const result = (await (await route.fetch()).json()) as DictionaryDefineResponse;
      const entry = result.entries[0]!;
      const sense = { ...entry.senses[0]!, examples: ['The river overflowed its bank.', 'Flowers covered the river bank.'] };
      await route.fulfill({ json: { ...result, entries: [{ ...entry, senses: [sense] }] } });
    });

    const box = await boxOf(page, 'bank');
    await page.mouse.dblclick(box.x, box.y);
    await expect(card(page)).toContainText('The river overflowed its bank.');
    await expect(card(page)).not.toContainText('Flowers covered the river bank.');
    const toggle = card(page).getByRole('button', { name: 'Show all meanings' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(card(page)).toContainText('Flowers covered the river bank.');
    const collapse = card(page).getByRole('button', { name: 'Show fewer' });
    await expect(collapse).toHaveAttribute('aria-expanded', 'true');
    await collapse.click();
    await expect(card(page)).not.toContainText('Flowers covered the river bank.');
  });

  test('the shared card fixture keeps its order and attribution while the meanings scroll', async ({ page }) => {
    await page.setViewportSize({ width: 560, height: 520 });
    await openReader(page);
    const source = `${cardFixture.source.name} · ${cardFixture.source.license}`;
    const response: DictionaryDefineResponse = {
      ...cardFixture,
      entries: cardFixture.entries.map(entry => ({ ...entry, part_of_speech: entry.partOfSpeech })),
      source,
      sourceDetails: cardFixture.source,
    };
    await page.route('**/api/dictionary/define?*', route => route.fulfill({ json: response }));

    const box = await boxOf(page, 'bank');
    await page.mouse.dblclick(box.x, box.y);
    const dialog = page.getByRole('dialog', { name: `Definition of ${cardFixture.query}` });
    const meanings = dialog.getByRole('region', { name: 'Meanings' });
    const entries = meanings.locator('section');
    const attribution = dialog.getByRole('link', { name: source });
    await expect(dialog).toHaveCSS('background-color', 'rgb(26, 26, 26)');
    const margins = await dialog.evaluate(element => {
      const card = element.getBoundingClientRect();
      const viewer = element.closest('.pdf-viewer')!.getBoundingClientRect();
      return { left: card.left - viewer.left, right: viewer.right - card.right };
    });
    expect(margins.left).toBeCloseTo(8, 1);
    expect(margins.right).toBeCloseTo(8, 1);
    await expect(attribution).toHaveAttribute('href', cardFixture.source.url);
    await expect(attribution).toBeInViewport();
    await expect(entries).toHaveCount(3);
    await expect(entries.first().locator('li')).toHaveCount(3);
    await expect(entries.first()).toContainText('also spelled glint-mark');
    await expect(meanings).not.toContainText('The jeweller buffed away the glintmark.');
    await expect(meanings).not.toContainText('A tally made with reflective ink.');
    await expect(meanings).not.toContainText('With a brief flash.');

    await dialog.getByRole('button', { name: 'Show all meanings' }).click();
    await expect(entries.locator('.dc-pos')).toHaveText(cardFixture.entries.map(entry => entry.partOfSpeech));
    const senses = cardFixture.entries.flatMap(entry => entry.senses);
    await expect(meanings.locator('.dc-definition')).toHaveText(senses.map(sense => sense.definition));
    await expect(meanings.locator('.dc-example')).toHaveText(senses.flatMap(sense => sense.examples.map(example => `“${example}”`)));
    const footerPosition = await attribution.boundingBox();
    await meanings.evaluate(element => element.scrollTo(0, element.scrollHeight));
    await expect.poll(() => meanings.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    await expect(attribution).toBeInViewport();
    expect(await attribution.boundingBox()).toEqual(footerPosition);

    await dialog.getByRole('button', { name: 'Show fewer' }).click();
    await expect(entries).toHaveCount(3);
    expect(await page.evaluate(() => window.getSelection()?.toString().trim())).toBe('bank');
  });

  test('turning off definitions closes the card and the choice survives a reload', async ({ page }) => {
    await openReader(page);
    const box = await boxOf(page, 'mice');
    await page.mouse.dblclick(box.x, box.y);
    await expect(card(page)).toBeVisible();

    await openReadingPreferences(page);
    const toggle = readingPreferences(page).getByLabel('Show definitions on selection', { exact: true });
    await expect(toggle).toBeChecked();
    await expect(card(page)).toBeVisible();
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    await expect(card(page)).toHaveCount(0);

    await page.reload();
    await expect(page.locator('[data-pdf-page="1"] .textLayer span').first()).toBeVisible();
    await openReadingPreferences(page);
    await expect(toggle).not.toBeChecked();
    await page.keyboard.press('Escape');
    let lookups = 0;
    page.on('request', request => { if (request.url().includes('/api/dictionary/define')) lookups++; });
    for (const selection of ['a', 'mice', 'neural network', 'a neural network']) {
      await drag(page, selection);
      await expect(actions(page).getByRole('button')).toHaveText(['Explain', 'Ask…', '🖊 Highlight', 'Explain visually']);
    }
    await expect(card(page)).toHaveCount(0);
    expect(lookups).toBe(0);
  });

  test('a one-word highlight can be saved with definitions off and used with definitions on', async ({ page }) => {
    const { project, source } = await openReader(page);
    await openReadingPreferences(page);
    const toggle = readingPreferences(page).getByLabel('Show definitions on selection', { exact: true });
    await toggle.click();
    await page.keyboard.press('Escape');
    await drag(page, 'bank');
    const saved = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith(`/sources/${source.id}/annotations`));
    await actions(page).getByRole('button', { name: /Highlight/ }).click();
    expect((await saved).ok()).toBeTruthy();
    const response = await page.request.get(`/api/projects/${project.id}/sources/${source.id}/annotations`);
    expect(await response.json()).toMatchObject([{ text: 'bank', page_number: 1 }]);

    await openReadingPreferences(page);
    await toggle.click();
    await page.keyboard.press('Escape');
    const highlight = page.getByRole('button', { name: 'Highlight: bank', exact: true });
    await highlight.focus();
    await page.keyboard.press('Enter');
    const menu = page.getByRole('menu', { name: 'Highlight' });
    await expect(menu.getByRole('menuitem')).toHaveText(['💬 Ask', '✦ Create post', '🗑 Delete']);
    await expect(menu.getByRole('menuitemradio', { name: 'Yellow highlight' })).toHaveAttribute('aria-checked', 'true');
    await menu.getByRole('menuitem', { name: /Ask/ }).click();
    await expect(page.getByText('Selection attached — ask a question or type /visual')).toBeVisible();
    await expect(card(page)).toHaveCount(0);
  });
  test('a contextually ordered answer renders once, in the order the server sent, with nothing added', async ({ page }) => {
    await openReader(page);
    // Reorder meanings within one entry, then answer after a model-sized delay.
    let served: DictionaryDefineResponse | undefined;
    let orderedEntry = -1;
    await page.route('**/api/dictionary/define?*', async route => {
      const result = (await (await route.fetch()).json()) as DictionaryDefineResponse;
      orderedEntry = result.entries.findIndex(entry => entry.senses.length > 1);
      result.entries[orderedEntry]!.senses.reverse();
      served = result;
      await new Promise(resolve => setTimeout(resolve, 120));
      await route.fulfill({ json: result });
    });
    // Record every card that appears and every change to its list of meanings.
    await page.evaluate(() => {
      const record = (window as unknown as { cardLog: string[] }).cardLog = [];
      new MutationObserver(mutations => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node instanceof HTMLElement && node.matches('[data-definition-card]')) record.push('card');
            else if (node instanceof HTMLElement && node.closest('[data-definition-card]')) record.push('change');
          }
        }
      }).observe(document.body, { childList: true, subtree: true });
    });

    const box = await boxOf(page, 'bank');
    await page.mouse.dblclick(box.x, box.y);
    await expect(card(page)).toBeVisible();
    const items = card(page).locator('section').nth(orderedEntry).locator('li');
    const expected = served!.entries[orderedEntry]!.senses.slice(0, 3).map(sense => sense.definition + (sense.examples[0] ? `“${sense.examples[0]}”` : ''));
    await expect(items).toHaveText(expected);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => (window as unknown as { cardLog: string[] }).cardLog)).toEqual(['card']);
    // Only the meanings and their examples: no marks, badges or scores.
    await expect(card(page).locator('li')).toHaveText(served!.entries.slice(0, 3).flatMap(entry => entry.senses.slice(0, 3)).map(sense => sense.definition + (sense.examples[0] ? `“${sense.examples[0]}”` : '')));
    await expect(card(page)).not.toContainText(/%|score|best|likely/i);
  });

  test('a lookup replaced by a newer selection is cancelled and never opens its card', async ({ page }) => {
    await openReader(page);
    const aborted: string[] = [];
    page.on('requestfailed', request => { if (request.url().includes('text=bank')) aborted.push(request.failure()?.errorText ?? ''); });
    const lookups: string[] = [];
    page.on('request', request => { if (request.url().includes('/api/dictionary/define')) lookups.push(new URL(request.url()).searchParams.get('text')!); });
    await page.route('**/api/dictionary/define?*', async route => {
      if (route.request().url().includes('text=bank')) await new Promise(resolve => setTimeout(resolve, 800));
      await route.continue().catch(() => { /* The reader already cancelled it. */ });
    });
    const bank = await boxOf(page, 'bank');
    await page.mouse.dblclick(bank.x, bank.y);
    await page.waitForTimeout(150);
    const mice = await boxOf(page, 'mice');
    await page.mouse.dblclick(mice.x, mice.y);
    await expect(card(page).locator('section').first()).toContainText('mouse noun');
    await page.waitForTimeout(1000);
    await expect(card(page)).toHaveCount(1);
    await expect(card(page).locator('section').first()).toContainText('mouse noun');
    await expect(actions(page)).toHaveCount(0);
    expect(aborted).toEqual(['net::ERR_ABORTED']);
    // One lookup per double-click, although both clicks end with the word selected.
    expect(lookups).toEqual(['bank', 'mice']);
  });
});
