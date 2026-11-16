import { test, expect, type Page, type Route } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {
  DESTINATION_DEFAULTS, DESTINATION_NAMES, FIT, captionText, firstCommentText,
  type Angle, type CardContent, type Caption, type Destination, type PageMark, type PageRect, type ShareCardRecord,
} from '../../src/shared/share-card';
import { mockAuth, createProjectViaApi } from './helpers';

const SAMPLES = path.resolve('test-results/share-card-samples');
const SHOTS = path.resolve('test-results/share-posts');

test.describe('share card samples', () => {
  test.beforeEach(async ({ page }) => { await mockAuth(page); });

  test('every sample card and frame fits, and each is written as a PNG for review', async ({ page }) => {
    test.setTimeout(150_000);
    await page.goto('/dev/share-cards');
    await expect(page.locator('main[data-samples-done="true"]')).toBeVisible({ timeout: 130_000 });
    // Text cards: 7 samples × 3 styles × 3 looks × 2 sizes. Frames: 12 Page and Headline frames × 3 looks.
    await expect(page.locator('[data-sample]')).toHaveCount(126);
    await expect(page.locator('[data-frame]')).toHaveCount(36);
    const failed = await page.locator('[data-fits="false"]').evaluateAll(nodes => nodes.map(node => `${node.getAttribute('data-sample') ?? node.getAttribute('data-frame')}: ${node.textContent}`));
    expect(failed).toEqual([]);
    const images = await page.locator('[data-sample] img, [data-frame] img').evaluateAll(async nodes => Promise.all(nodes.map(async node => {
      const image = node as HTMLImageElement;
      const bytes = new Uint8Array(await (await fetch(image.src)).arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return { name: image.alt, width: image.naturalWidth, height: image.naturalHeight, png: btoa(binary) };
    })));
    fs.mkdirSync(SAMPLES, { recursive: true });
    for (const image of images) {
      expect(image.width, image.name).toBe(1080);
      if (image.name.includes('-fit-')) {
        expect(image.height, image.name).toBeGreaterThanOrEqual(FIT.minHeight);
        expect(image.height, image.name).toBeLessThanOrEqual(FIT.maxHeight);
      } else expect(image.height, image.name).toBe(image.name.includes('-story') ? 1920 : 1350);
      fs.writeFileSync(path.join(SAMPLES, `${image.name}.png`), Buffer.from(image.png, 'base64'));
    }
    expect(images).toHaveLength(162);
    // Fit frames really vary in height: the X frame (one line of context) is shorter than the whole page.
    const heights = Object.fromEntries(images.map(image => [image.name, image.height]));
    expect(heights['page-fit-x-ink']!).toBeLessThan(heights['page-fit-whole-ink']!);
  });
});

// ── The reader: a highlight becomes a post ──────────────────────────────────────────────────────────────────────────
// The share-card routes are answered by a small fake of the server below; the project, the PDF and the highlights are
// real. No assistant is involved.

const POST_ID = '7d4a8f2e-1c3b-4e5f-9a6b-0c1d2e3f4a5b';
const URL_LINK = 'https://example.org/papers/attention-costs-and-sparse-patterns-2026';
const HASHTAGS = ['attention', 'research', 'ml'];
const TAKE = 'Long context is a budget question before it is a modelling one.';
const CARD: CardContent = {
  quote: 'the cost grows with the square of the sequence length', quoteEdited: false, emphasis: 'the square',
  headline: 'Reach has a quadratic price', pull: 'long documents become expensive', topic: 'Attention',
  takeawaysTitle: 'What full attention costs', style: 'page', look: 'ink', crop: null,
  takeaways: [{ title: 'Reach is global', detail: 'Every position can use every other one.' },
    { title: 'Cost grows fast', detail: 'Doubling the input quadruples the work.' }, { title: 'Long inputs hurt', detail: 'Documents become expensive quickly.' }],
};

/** The drafts a destination gets: LinkedIn has no contrast, X no caveat, Instagram all three. A take is its own paragraph. */
function drafts(destination: Destination, take: string): Caption['drafts'] {
  const withTake = (text: string) => take ? `${text}\n\n${take}` : text;
  const long = (lead: string) => withTake(`${lead}\n\nIn the model the authors describe, every position can look at every other position.\n\nThe cost grows with the square of the sequence length, so long documents become expensive.`);
  if (destination === 'x') return { finding: withTake('Every position can look at every other one, but the cost grows with the square of the sequence length.'), contrast: withTake('You might think reach is free. The paper says the cost grows with the square of the length.'), caveat: '' };
  if (destination === 'instagram') return { finding: long('Reach has a price.'), contrast: long('Attention looks free. It is not.'), caveat: long('The fix is still a suspicion.') };
  return { finding: long('Full attention buys reach at a price that grows fast.'), contrast: '', caveat: long('The fix for the cost of attention is still a suspicion, not a result.') };
}

/** A completed version for a destination and take, after `previous` as the server composes it. */
function written(destination: Destination, take: string, previous?: { card: CardContent; caption: Caption }): { card: CardContent; caption: Caption } {
  const moved = !previous || previous.caption.destination !== destination, defaults = DESTINATION_DEFAULTS[destination];
  const card = previous ? { ...CARD, style: moved ? defaults.style : previous.card.style, look: previous.card.look, crop: previous.card.crop } : { ...CARD, style: defaults.style };
  const text = drafts(destination, take);
  const angle: Angle = previous && text[previous.caption.angle] ? previous.caption.angle : 'finding';
  return { card, caption: { destination, take, drafts: text, angle, hashtags: HASHTAGS, showTags: moved ? defaults.showTags : previous!.caption.showTags, link: previous?.caption.link ?? 'post', edited: null } };
}

type Fake = {
  current: ShareCardRecord | null
  /** The record a start creates, before its first version. */
  template?: ShareCardRecord
  previous: { card: CardContent; caption: Caption } | null
  /** While set, a running generation stays running. */
  hold: boolean
  /** When set, the next generation fails with this message. */
  failNext?: string
  calls: { start: number; change: number; retry: number; cancel: number; undo: number; patch: number }
  bodies: { start: Record<string, unknown>[]; change: Record<string, unknown>[]; patch: Record<string, unknown>[] }
};

const fake = (): Fake => ({ current: null, previous: null, hold: false, calls: { start: 0, change: 0, retry: 0, cancel: 0, undo: 0, patch: 0 }, bodies: { start: [], change: [], patch: [] } });

/** Answers the share-card routes as the server does, from `state`. */
async function routePosts(page: Page, state: Fake) {
  const finish = () => {
    const post = state.current!;
    if (state.failNext) { state.current = { ...post, status: 'failed', error: state.failNext }; state.failNext = undefined; return; }
    const before = post.card && post.caption ? { card: post.card, caption: post.caption } : undefined;
    const next = written(post.destination, post.take, before);
    if (before) state.previous = before;
    state.current = { ...post, status: 'complete', error: null, ...next, can_undo: !!state.previous, updated_at: new Date().toISOString() };
  };
  await page.route('**/api/projects/*/share-cards**', async (route: Route) => {
    const request = route.request(), url = new URL(request.url()), tail = url.pathname.split('/share-cards')[1] ?? '';
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const body = (request.postDataJSON() ?? {}) as Record<string, any>;
    if (request.method() === 'POST' && tail === '') {
      state.calls.start++; state.bodies.start.push(body);
      state.current = { ...state.template!, status: 'running', card: null, caption: null, destination: body.destination ?? 'linkedin', take: body.take ?? '' };
      return json(202, state.current);
    }
    if (request.method() === 'GET' && tail === '') {
      const post = state.current;
      return json(200, post ? [{ id: post.id, status: post.status, annotation_id: post.annotation_id, source_id: post.source_id, page: post.source.page, title: post.card?.headline || post.source.passage, updated_at: post.updated_at }] : []);
    }
    if (!state.current || tail.split('/')[1] !== state.current.id) return json(404, { detail: 'Post not found.' });
    const post = state.current, active = post.status === 'running' || post.status === 'pending';
    if (request.method() === 'GET') {
      if (active && !state.hold) finish();
      return json(200, state.current);
    }
    if (tail.endsWith('/change')) {
      state.calls.change++; state.bodies.change.push(body);
      state.current = { ...post, status: 'running', destination: body.destination ?? post.destination, take: body.take ?? post.take, instruction: body.instruction ?? '' };
      return json(202, state.current);
    }
    if (tail.endsWith('/retry')) { state.calls.retry++; state.current = { ...post, status: 'running', error: null }; return json(202, state.current); }
    if (tail.endsWith('/cancel')) { state.calls.cancel++; state.current = { ...post, status: 'cancelled' }; return json(200, state.current); }
    if (tail.endsWith('/undo')) {
      state.calls.undo++;
      const back = state.previous!;
      state.previous = null;
      state.current = { ...post, ...back, destination: back.caption.destination, take: back.caption.take, status: 'complete', can_undo: false, updated_at: new Date().toISOString() };
      return json(200, state.current);
    }
    if (request.method() === 'PATCH') {
      state.calls.patch++; state.bodies.patch.push(body);
      if (active) return json(409, { detail: 'Wait for the current version or cancel it first.' });
      const card = post.card!, caption = post.caption!;
      let next = { card, caption }, keep = false;
      if ('style' in body) next = { card: { ...card, style: body.style, look: body.look }, caption };
      else if ('crop' in body) next = { card: { ...card, crop: body.crop }, caption };
      else if ('angle' in body) { next = { card, caption: { ...caption, angle: body.angle, edited: null } }; keep = caption.edited !== null; }
      else if ('show_tags' in body) next = { card, caption: { ...caption, showTags: body.show_tags } };
      else if ('link' in body) next = { card, caption: { ...caption, link: body.link } };
      else if ('headline' in body) { next = { card: { ...card, headline: body.headline }, caption }; keep = true; }
      else if ('caption' in body) { next = { card, caption: { ...caption, edited: body.caption } }; keep = true; }
      if (keep) state.previous = { card, caption };
      state.current = { ...post, ...next, can_undo: !!state.previous, updated_at: new Date().toISOString() };
      return json(200, state.current);
    }
    return json(409, { detail: 'Not expected in this test.' });
  });
}

type Line = { text: string; rect: PageRect };

/** Opens a PDF in the reader and returns its page's text lines as fractions of the page. */
async function openPdf(page: Page, file: string, pageNumber: number) {
  const project = await createProjectViaApi(page, 'Share posts');
  const source = await (await page.request.post(`/api/projects/${project.id}/sources`, { data: { url: file, title: 'Share card paper' } })).json();
  await page.goto(`/projects/${project.id}/sources/${source.id}`);
  const layer = page.locator(`[data-pdf-page="${pageNumber}"]`);
  await layer.scrollIntoViewIfNeeded();
  await expect(layer.locator('.textLayer span').first()).toBeVisible();
  const lines: Line[] = await layer.evaluate(element => {
    const box = element.querySelector('.react-pdf__Page')!.getBoundingClientRect();
    return [...element.querySelectorAll('.textLayer span')].filter(span => span.textContent!.trim()).map(span => {
      const r = span.getBoundingClientRect();
      return { text: span.textContent!, rect: { x1: (r.left - box.left) / box.width, y1: (r.top - box.top) / box.height, x2: (r.right - box.left) / box.width, y2: (r.bottom - box.top) / box.height } };
    });
  });
  return { project, source: source as { id: string }, lines };
}

async function highlight(page: Page, projectId: string, sourceId: string, pageNumber: number, text: string, rects: PageRect[], color = 'yellow') {
  const box = { x1: Math.min(...rects.map(r => r.x1)), y1: Math.min(...rects.map(r => r.y1)), x2: Math.max(...rects.map(r => r.x2)), y2: Math.max(...rects.map(r => r.y2)) };
  const response = await page.request.post(`/api/projects/${projectId}/sources/${sourceId}/annotations`, { data: { page_number: pageNumber, ...box, rects, text, color } });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).id as string;
}

function record(projectId: string, sourceId: string | null, annotationId: string | null, passage: string, rects: PageRect[], marks: PageMark[], extra: Partial<ShareCardRecord> = {}): ShareCardRecord {
  return {
    id: POST_ID, project_id: projectId, source_id: sourceId, annotation_id: annotationId, status: 'complete', can_undo: false, instruction: '', error: null,
    created_at: '2026-11-15T10:00:00.000Z', updated_at: '2026-11-15T10:00:01.000Z', ...written('linkedin', ''), destination: 'linkedin', take: '', marks,
    source: { version: 1, passage, page: 2, rects, color: 'yellow', context: passage, title: 'Share card paper', credit: 'Vaswani et al., 2017', url: URL_LINK },
    ...extra,
  };
}

/**
 * The paper on page 2 of test/fixtures/share-cards.pdf with four highlights: the post's own (lines 2–3, yellow), one
 * line above it (blue), one below it (green), and the last paragraph (pink), which no automatic crop reaches.
 */
async function paper(page: Page, state: Fake) {
  await routePosts(page, state);
  const { project, source, lines } = await openPdf(page, 'test/fixtures/share-cards.pdf', 2);
  const own = [lines[1]!.rect, lines[2]!.rect];
  const annotation = await highlight(page, project.id, source.id, 2, `${lines[1]!.text}\n${lines[2]!.text}`, own);
  const others: Array<[number, PageMark['color']]> = [[0, 'blue'], [3, 'green'], [5, 'pink']];
  for (const [index, color] of others) await highlight(page, project.id, source.id, 2, lines[index]!.text, [lines[index]!.rect], color);
  const marks: PageMark[] = [{ rects: own, color: 'yellow' }, ...others.map(([index, color]) => ({ rects: [lines[index]!.rect], color }))];
  const passage = 'the sequence. However, the cost grows with the square of the sequence length, so long documents become expensive. We suspect';
  state.template = record(project.id, source.id, annotation, passage, own, marks);
  return { project, source, annotation, lines, marks, url: `/projects/${project.id}/sources/${source.id}` };
}

/** Opens the fake's current post through a link, as the reader does after a reload. */
async function openPost(page: Page, state: Fake, readerUrl: string, extra: Partial<ShareCardRecord> = {}) {
  state.current = { ...state.template!, ...extra };
  await page.goto(`${readerUrl}?post=${POST_ID}`);
}

const card = (page: Page) => page.locator('img[data-share-card]');
const caption = (page: Page) => page.locator('[data-share-caption]');
const shownText = (state: Fake) => captionText(state.current!.source, state.current!.caption!);
const pngSize = (bytes: Buffer) => ({ signature: bytes.subarray(0, 8).toString('hex'), width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) });
const fitHeight = async (page: Page) => Number((await card(page).getAttribute('data-share-size'))!.split('x')[1]);

async function noSideScroll(page: Page) {
  const overflow = await page.locator('[data-share-post]').evaluate(element => element.scrollWidth - element.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe('share posts in the reader', () => {
  test.beforeEach(async ({ page }) => { await mockAuth(page); });

  for (const destination of ['linkedin', 'x', 'instagram'] as const) {
    test(`a new post for ${destination} opens on its frame with every highlight in the crop`, async ({ page }) => {
      test.setTimeout(60_000);
      if (destination !== 'linkedin') await page.addInitScript(value => { try { localStorage.setItem('pdfpal:share-destination', value) } catch { /* none */ } }, destination);
      const state = fake();
      const { annotation } = await paper(page, state);
      await page.reload();
      const box = page.locator(`[data-annotation-id="${annotation}"]`).first();
      await expect(box).toBeVisible();
      state.hold = true;
      await box.click();
      await page.getByRole('menuitem', { name: /Create post/ }).click();
      await expect(page.getByText('Writing your post…')).toBeVisible();
      await expect(page.getByText('You can keep reading. Your post will stay here.')).toBeVisible();
      // The remembered destination starts the post; the picker shows it while the post is written.
      expect(state.bodies.start).toEqual([expect.objectContaining({ destination })]);
      await expect(page.getByRole('radio', { name: DESTINATION_NAMES[destination] })).toHaveAttribute('aria-checked', 'true');
      state.hold = false;
      await expect(page.getByText('Your post is ready.')).toBeVisible({ timeout: 10_000 });
      await expect(page.getByRole('radio', { name: 'Quote' })).toBeHidden();

      const style = DESTINATION_DEFAULTS[destination].style;
      await expect(card(page)).toHaveAttribute('data-share-card', `${style}/ink`, { timeout: 20_000 });
      expect(page.url()).toContain(`post=${POST_ID}`);
      await expect(page.getByRole('radio', { name: style === 'page' ? 'Page' : 'Headline' })).toHaveAttribute('aria-checked', 'true');
      // Own, blue and green are inside the automatic crop; pink, two paragraphs away, is not.
      await expect(card(page)).toHaveAttribute('data-share-marks', '3');
      const height = await fitHeight(page);
      if (destination === 'instagram') expect(height).toBe(1350);
      else { expect(height).toBeGreaterThanOrEqual(FIT.minHeight); expect(height).toBeLessThan(FIT.maxHeight); }
      await expect(caption(page)).toHaveText(shownText(state));
      await expect(page.locator('[data-x-count]')).toHaveCount(destination === 'x' ? 1 : 0);
      await expect(page.getByRole('switch', { name: 'Hashtags' })).toHaveCount(destination === 'x' ? 0 : 1);
      if (destination === 'instagram') await expect(page.getByRole('switch', { name: 'Hashtags' })).toHaveAttribute('aria-checked', 'true');
      await expect(page.getByRole('button', { name: 'Save Story (9:16)' })).toHaveCount(destination === 'instagram' ? 1 : 0);
      expect(state.calls.start).toBe(1); expect(state.calls.change).toBe(0); expect(state.calls.patch).toBe(0);
      await noSideScroll(page);
    });
  }

  test('switching destination makes one request, keeps the last version on screen, and can be undone', async ({ page }) => {
    test.setTimeout(60_000);
    const state = fake();
    const { url } = await paper(page, state);
    await openPost(page, state, url);
    await expect(card(page)).toHaveAttribute('data-share-card', 'page/ink', { timeout: 20_000 });
    const linkedIn = shownText(state);
    const linkedInHeight = await fitHeight(page);

    state.hold = true;
    await page.getByRole('radio', { name: DESTINATION_NAMES.instagram }).click();
    await expect(page.getByText('Rewriting for Instagram…')).toBeVisible();
    await expect(page.getByText('Your last completed version')).toBeVisible();
    await expect(caption(page)).toHaveText(linkedIn);
    await expect(page.getByRole('radio', { name: DESTINATION_NAMES.instagram })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('radio', { name: DESTINATION_NAMES.x })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Undo last change' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
    expect(state.bodies.change).toEqual([{ destination: 'instagram', take: '' }]);
    expect(await page.evaluate(() => localStorage.getItem('pdfpal:share-destination'))).toBe('instagram');

    state.hold = false;
    await expect(page.getByText('Your post was rewritten.')).toBeVisible({ timeout: 10_000 });
    await expect(card(page)).toHaveAttribute('data-share-card', 'headline/ink');
    await expect(card(page)).toHaveAttribute('data-share-size', '1080x1350');
    await expect(caption(page)).toHaveText(shownText(state));
    await expect(page.getByRole('button', { name: 'Save Story (9:16)' })).toBeVisible();

    await page.getByRole('button', { name: 'Undo last change' }).click();
    await expect(page.getByText('Back to the earlier version.')).toBeVisible();
    await expect(caption(page)).toHaveText(linkedIn);
    await expect(page.getByRole('radio', { name: DESTINATION_NAMES.linkedin })).toHaveAttribute('aria-checked', 'true');
    await expect(card(page)).toHaveAttribute('data-share-card', 'page/ink');
    expect(await fitHeight(page)).toBe(linkedInHeight);
    expect(state.calls.change).toBe(1); expect(state.calls.undo).toBe(1); expect(state.calls.start).toBe(0);

    // Arrow keys move through the destinations without asking for anything; Enter chooses.
    await page.getByRole('radio', { name: DESTINATION_NAMES.linkedin }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('radio', { name: DESTINATION_NAMES.x })).toBeFocused();
    expect(state.calls.change).toBe(1);
    await page.keyboard.press('Enter');
    await expect.poll(() => state.calls.change).toBe(2);
    expect(state.bodies.change[1]).toEqual({ destination: 'x', take: '' });
    await expect(page.locator('[data-x-count]')).toBeVisible();
  });

  test('the take: rewriting around it, then without it', async ({ page }) => {
    const state = fake();
    const { url } = await paper(page, state);
    await openPost(page, state, url);
    await expect(caption(page)).toHaveText(shownText(state));
    const field = page.getByRole('textbox', { name: 'Your take' });
    await expect(field).toHaveAccessibleDescription('The drafts are built around your take, and it is quoted word for word.');
    const rewrite = page.getByRole('button', { name: 'Rewrite around my take' });
    await expect(rewrite).toBeDisabled();
    await field.fill('x'.repeat(450));
    await expect(field).toHaveValue('x'.repeat(400));
    await field.fill(`  ${TAKE}  `);
    await expect(rewrite).toBeEnabled();

    state.hold = true;
    await rewrite.click();
    await expect(page.getByText('Rewriting around your take…')).toBeVisible();
    expect(state.bodies.change).toEqual([{ destination: 'linkedin', take: TAKE }]);
    state.hold = false;
    await expect(caption(page)).toContainText(TAKE);
    await expect(caption(page)).toHaveText(shownText(state));
    await expect(field).toHaveValue(TAKE);
    await expect(rewrite).toBeDisabled();

    await field.fill('');
    const without = page.getByRole('button', { name: 'Rewrite without a take' });
    await expect(without).toBeEnabled();
    await without.click();
    await expect.poll(() => state.calls.change).toBe(2);
    expect(state.bodies.change[1]).toEqual({ destination: 'linkedin', take: '' });
    await expect(caption(page)).not.toContainText(TAKE);
    await expect(rewrite).toBeDisabled();
    expect(state.calls.patch).toBe(0);
  });

  test('angle tabs show only the drafts there are and switch the copied text without a request; edited text comes back with Undo', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const state = fake();
    const { url } = await paper(page, state);
    await openPost(page, state, url);
    const angles = page.getByRole('radiogroup', { name: 'Draft angle' });
    await expect(angles.getByRole('radio')).toHaveText(['The finding', 'The caveat']);
    await expect(angles.getByRole('radio', { name: 'The finding' })).toHaveAttribute('aria-checked', 'true');

    await angles.getByRole('radio', { name: 'The caveat' }).click();
    await expect(caption(page)).toContainText('The fix for the cost of attention is still a suspicion');
    expect(state.bodies.patch).toEqual([{ angle: 'caveat' }]);
    await expect(caption(page)).toHaveText(shownText(state));
    await page.getByRole('button', { name: 'Copy caption' }).click();
    await expect(page.getByText('Caption copied.')).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(shownText(state));

    // The reader's own words, then an angle: a one-line warning first, Undo afterwards.
    await page.getByRole('button', { name: 'Edit caption' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit caption' });
    await dialog.getByRole('textbox', { name: 'Caption' }).fill('My own words about this paper.');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(caption(page)).toHaveText('My own words about this paper.');
    await expect(page.getByText('Edited by you')).toBeVisible();
    await expect(page.getByText('Picking an angle replaces your edited text.')).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Hashtags' })).toBeDisabled();
    await angles.getByRole('radio', { name: 'The finding' }).click();
    await expect(page.getByText('Your edited text was replaced by the draft.')).toBeVisible();
    await expect(caption(page)).toContainText('Full attention buys reach');
    await page.locator('[aria-live="polite"]').getByRole('button', { name: 'Undo' }).click();
    await expect(caption(page)).toHaveText('My own words about this paper.');
    expect(state.calls.change).toBe(0); expect(state.calls.start).toBe(0); expect(state.calls.undo).toBe(1);
  });

  test('hashtags and the two link placements on LinkedIn', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const state = fake();
    const { url } = await paper(page, state);
    await openPost(page, state, url);
    await expect(caption(page)).toContainText(URL_LINK);
    await expect(caption(page)).not.toContainText('#attention');
    const tags = page.getByRole('switch', { name: 'Hashtags' });
    await expect(tags).toHaveAttribute('aria-checked', 'false');
    await tags.click();
    await expect(tags).toHaveAttribute('aria-checked', 'true');
    await expect(caption(page)).toHaveText(shownText(state));
    expect(shownText(state).endsWith('#attention #research #ml')).toBe(true);

    const links = page.getByRole('radiogroup', { name: 'Where the link goes' });
    await expect(links.getByRole('radio', { name: 'Link in the post' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('[data-share-first-comment]')).toHaveCount(0);
    await links.getByRole('radio', { name: 'Link in the first comment' }).click();
    await expect(caption(page)).not.toContainText(URL_LINK);
    await expect(caption(page)).toHaveText(shownText(state));
    await expect(page.locator('[data-share-first-comment]')).toHaveText(firstCommentText(state.current!.source));
    await page.getByRole('button', { name: 'Copy first comment' }).click();
    await expect(page.getByText('First comment copied.', { exact: false })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(firstCommentText(state.current!.source));
    await links.getByRole('radio', { name: 'Link in the post' }).click();
    await expect(caption(page)).toContainText(URL_LINK);
    expect(state.bodies.patch).toEqual([{ show_tags: true }, { link: 'comment' }, { link: 'post' }]);
    expect(state.calls.change).toBe(0);
  });

  test('on X the character count counts the link as 23 characters', async ({ page }) => {
    const state = fake();
    const { url } = await paper(page, state);
    await openPost(page, state, url, written('x', ''));
    const draft = drafts('x', '').finding;
    await expect(caption(page)).toHaveText(`${draft}\n\n${URL_LINK}`);
    expect(URL_LINK.length).toBeGreaterThan(23);
    const count = page.locator('[data-x-count]');
    await expect(count).toHaveAttribute('data-x-count', String(draft.length + 2 + 23));
    await expect(count).toHaveText(`${draft.length + 25}/280`);
    await expect(page.getByRole('radiogroup', { name: 'Draft angle' }).getByRole('radio')).toHaveText(['The finding', 'Belief vs. paper']);
    await expect(page.getByRole('radiogroup', { name: 'Where the link goes' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Edit caption' }).click();
    const long = `${'word '.repeat(60).trim()} ${URL_LINK}`;
    await page.getByRole('dialog', { name: 'Edit caption' }).getByRole('textbox', { name: 'Caption' }).fill(long);
    await page.getByRole('dialog', { name: 'Edit caption' }).getByRole('button', { name: 'Save' }).click();
    await expect(count).toHaveAttribute('data-x-count', String(299 + 1 + 23));
    await expect(count).toContainText('longer than X allows');
  });

  test('adjust crop with the pointer and the keyboard, then reset it to automatic', async ({ page }) => {
    test.setTimeout(60_000);
    const state = fake();
    const { url } = await paper(page, state);
    await openPost(page, state, url);
    await expect(card(page)).toHaveAttribute('data-share-marks', '3', { timeout: 20_000 });
    const automatic = (await card(page).getAttribute('data-share-crop'))!;
    await expect(page.getByText('Automatic crop')).toBeVisible();

    await page.getByRole('button', { name: 'Adjust crop' }).click();
    const dialog = page.getByRole('dialog', { name: 'Adjust crop' });
    await expect(dialog).toHaveAttribute('data-state', 'ready');
    const box = page.locator('[data-crop-box]');
    // The editor starts from the automatic crop, with every highlight on the page.
    const start = (await box.getAttribute('data-crop'))!.split(',').map(Number);
    automatic.split(',').map(Number).forEach((value, index) => expect(Math.abs(value - start[index]!)).toBeLessThan(0.002));
    await expect(page.locator('[data-crop-mark]')).toHaveCount(5);
    // Down by a tenth of the page with the pointer; the bottom edge a step lower with the keyboard.
    const frame = (await page.locator('[data-crop-page]').boundingBox())!, from = (await box.boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 + 0.1 * frame.height, { steps: 8 });
    await page.mouse.up();
    await dialog.getByRole('button', { name: 'Bottom edge' }).focus();
    await page.keyboard.press('Shift+ArrowDown');
    const chosen = (await box.getAttribute('data-crop'))!.split(',').map(Number);
    expect(chosen[1]!).toBeGreaterThan(start[1]! + 0.08);
    expect(chosen[3]! - chosen[1]!).toBeGreaterThan(start[3]! - start[1]! + 0.04);
    await dialog.getByRole('button', { name: 'Apply' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('Crop saved.')).toBeVisible();
    const saved = state.bodies.patch.at(-1)!.crop as PageRect;
    expect([saved.x1, saved.y1, saved.x2, saved.y2].map(value => value.toFixed(4)).join(',')).toBe(chosen.map(value => value.toFixed(4)).join(','));
    // The preview uses the reader's crop.
    await expect(card(page)).toHaveAttribute('data-share-crop', chosen.map(value => value.toFixed(4)).join(','));
    await expect(page.getByText('Your crop')).toBeVisible();

    await page.getByRole('button', { name: 'Adjust crop' }).click();
    await expect(dialog).toHaveAttribute('data-state', 'ready');
    await dialog.getByRole('button', { name: 'Reset to automatic' }).click();
    await expect(page.getByText('Back to the automatic crop.')).toBeVisible();
    expect(state.bodies.patch.at(-1)).toEqual({ crop: null });
    await expect(card(page)).toHaveAttribute('data-share-crop', automatic);
    expect(state.calls.change).toBe(0);
  });

  test('text cards sit under their disclosure; the headline is the reader\'s to edit; images are copied and saved at the frame\'s size', async ({ page, context }) => {
    test.setTimeout(60_000);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const state = fake();
    const { url } = await paper(page, state);
    await openPost(page, state, url);
    await expect(card(page)).toHaveAttribute('data-share-card', 'page/ink', { timeout: 20_000 });
    const height = await fitHeight(page);
    await expect(page.getByRole('radio', { name: 'Quote' })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Edit headline' })).toHaveCount(0);

    // Copy image and Save image at the Fit height; LinkedIn offers no Story.
    await page.getByRole('button', { name: 'Copy image' }).click();
    await expect(page.getByText('Image copied. Paste it into your post.')).toBeVisible();
    expect(await page.evaluate(async () => (await navigator.clipboard.read())[0]!.types)).toContain('image/png');
    let download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save image' }).click();
    let file = await download;
    expect(file.suggestedFilename()).toBe('pdfpal-share-card-paper-p2-page.png');
    expect(pngSize(fs.readFileSync((await file.path())!))).toEqual({ signature: '89504e470d0a1a0a', width: 1080, height });

    await page.getByText('Text cards').click();
    await page.getByRole('radio', { name: 'Big idea' }).click();
    await expect(card(page)).toHaveAttribute('data-share-card', 'idea/ink');
    await expect(card(page)).toHaveAttribute('data-share-size', '1080x1350');
    await expect(page.getByRole('button', { name: 'Adjust crop' })).toHaveCount(0);
    await page.getByRole('radio', { name: 'Paper look' }).click();
    await expect(card(page)).toHaveAttribute('data-share-card', 'idea/paper');
    await page.getByRole('button', { name: 'Edit headline' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit headline' });
    const input = dialog.getByRole('textbox', { name: 'Headline' });
    await input.fill('h'.repeat(90));
    await expect(input).toHaveValue('h'.repeat(80));
    await input.fill('Long inputs cost more than they look');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(card(page)).toHaveAttribute('alt', 'Big idea card: Long inputs cost more than they look. “long documents become expensive”');
    expect(state.bodies.patch).toContainEqual({ headline: 'Long inputs cost more than they look' });

    download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save image' }).click();
    file = await download;
    expect(file.suggestedFilename()).toBe('pdfpal-share-card-paper-p2-idea.png');
    expect(pngSize(fs.readFileSync((await file.path())!))).toMatchObject({ width: 1080, height: 1350 });

    await page.getByRole('radio', { name: 'Headline' }).click();
    await expect(card(page)).toHaveAttribute('data-share-card', 'headline/paper');
    await expect(page.getByRole('button', { name: 'Adjust crop' })).toBeVisible();
    expect(state.calls.change).toBe(0); expect(state.calls.start).toBe(0);
  });

  test('Instagram saves a Story at 1080 × 1920', async ({ page }) => {
    test.setTimeout(60_000);
    const state = fake();
    const { url } = await paper(page, state);
    await openPost(page, state, url, { ...written('instagram', ''), destination: 'instagram' });
    await expect(card(page)).toHaveAttribute('data-share-card', 'headline/ink', { timeout: 20_000 });
    for (const [label, name, height] of [['Save image', 'pdfpal-share-card-paper-p2-headline.png', 1350], ['Save Story (9:16)', 'pdfpal-share-card-paper-p2-headline-story.png', 1920]] as const) {
      const download = page.waitForEvent('download');
      await page.getByRole('button', { name: label }).click();
      const file = await download;
      expect(file.suggestedFilename()).toBe(name);
      expect(pngSize(fs.readFileSync((await file.path())!))).toEqual({ signature: '89504e470d0a1a0a', width: 1080, height });
    }
  });

  test('a failed rewrite keeps the last version and offers Try again', async ({ page }) => {
    const state = fake();
    const { url } = await paper(page, state);
    await openPost(page, state, url);
    await expect(card(page)).toHaveAttribute('data-share-card', 'page/ink', { timeout: 20_000 });
    const before = shownText(state);
    state.failNext = 'The post could not be checked against its source. Try again.';
    await page.getByRole('radio', { name: DESTINATION_NAMES.x }).click();
    await expect(page.getByText('The post could not be checked against its source. Try again.')).toBeVisible();
    await expect(page.getByText('Your last completed version')).toBeVisible();
    await expect(caption(page)).toHaveText(before);
    // The picker shows the version on screen, not the request that failed.
    await expect(page.getByRole('radio', { name: DESTINATION_NAMES.linkedin })).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect.poll(() => state.calls.retry).toBe(1);
    await expect(page.locator('[data-x-count]')).toBeVisible();
    await expect(caption(page)).toHaveText(shownText(state));
    await expect(page.getByText('Your last completed version')).toHaveCount(0);

    // Cancel while a rewrite runs: the earlier version stays, Try again picks it up.
    state.hold = true;
    await page.getByRole('radio', { name: DESTINATION_NAMES.instagram }).click();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('Creation paused. Your previous version is safe.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    expect(state.calls.cancel).toBe(1);
  });
});

// ── Without the PDF ───────────────────────────────────────────────────────────────────────────────────────────────────
test.describe('a post whose PDF was removed', () => {
  test.beforeEach(async ({ page }) => { await mockAuth(page); });

  test('opens in the Highlights tab on its fallback card, with Page and Headline unavailable', async ({ page }) => {
    const state = fake();
    await routePosts(page, state);
    const project = await createProjectViaApi(page, 'Removed PDF');
    const version = written('instagram', '');
    state.current = {
      ...record(project.id, null, null, 'Attention lets every position look at every other position.', [{ x1: 0.1, y1: 0.2, x2: 0.9, y2: 0.23 }], []),
      ...version, caption: { ...version.caption, drafts: { ...version.caption.drafts, contrast: '', caveat: '' } }, destination: 'instagram',
    };
    await page.goto(`/projects/${project.id}`);
    await page.getByRole('tab', { name: /Highlights/ }).click();
    await expect(page.getByText(/PDF removed/)).toBeVisible();
    await page.getByRole('button', { name: /Reach has a quadratic price/ }).click();
    await expect(card(page)).toHaveAttribute('data-share-card', 'idea/ink');
    for (const name of ['Page', 'Headline']) {
      await expect(page.getByRole('radio', { name, exact: true })).toBeDisabled();
      await expect(page.getByRole('radio', { name, exact: true })).toHaveAttribute('title', 'The PDF for this post was removed.');
    }
    await expect(page.getByText('Page and Headline aren’t available: The PDF for this post was removed.')).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Big idea' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('button', { name: 'Adjust crop' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Edit headline' })).toBeVisible();
    // Only the finding was written, so there are no angles to pick.
    await expect(page.getByRole('radiogroup', { name: 'Draft angle' })).toHaveCount(0);
    await noSideScroll(page);
  });
});
