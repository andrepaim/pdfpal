import { test, expect, type Page, type Route } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {
  DESTINATION_DEFAULTS, DESTINATION_NAMES, STYLE_NAMES, cardDescription, FIT, captionText, firstCommentText,
  type Angle, type CardContent, type Caption, type Destination, type PageMark, type PageRect, type ShareCardRecord,
} from '../../src/shared/share-card';
import { PAGE_FRAMES, SAMPLES as TEXT_SAMPLES } from '../src/lib/share-card/samples';
import { cropBox } from '../src/lib/share-card/crop-box';
import { tallPdf } from './tall-pdf';
import { pdfPages, zipNames } from './export-files';
import { carouselFileName, slideFileName } from '../src/lib/share-card/export';
import { mockAuth, createProjectViaApi } from './helpers';

const SAMPLES = path.resolve('test-results/share-card-samples');
const SHOTS = path.resolve('test-results/share-posts');

test.describe('share card samples', () => {
  test.beforeEach(async ({ page }) => { await mockAuth(page); });

  test('every sample card and frame fits, and each is written as a PNG for review', async ({ page }) => {
    test.setTimeout(150_000);
    await page.goto('/dev/share-cards');
    await expect(page.locator('main[data-samples-done="true"]')).toBeVisible({ timeout: 130_000 });
    // Text cards: each sample × 3 styles × 3 looks × 2 sizes. Frames: each Page and Headline frame × 3 looks.
    const textCards = TEXT_SAMPLES.length * 3 * 3 * 2, frames = PAGE_FRAMES.length * 3;
    expect(textCards).toBe(126); expect(frames).toBe(42);
    await expect(page.locator('[data-sample]')).toHaveCount(textCards);
    await expect(page.locator('[data-frame]')).toHaveCount(frames);
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
    expect(images).toHaveLength(textCards + frames);
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
  takeawaysTitle: 'What full attention costs', style: 'page', look: 'ink', crop: null, set: null,
  takeaway: 'Long documents need another plan than full attention.',
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
  /** How the next starts are answered, in order: a lost answer (the connection drops) or a refusal. Then as usual. */
  startPlan: Array<'abort' | { status: number; detail: string }>
  /** How many of the next GETs of the post fail, and with what status. */
  failGets: number; failStatus: number
  /** When set, the post is a row an earlier build saved: every request but DELETE answers 422. */
  unreadable: boolean
  calls: { start: number; change: number; retry: number; cancel: number; undo: number; patch: number; get: number; delete: number }
  bodies: { start: Record<string, unknown>[]; change: Record<string, unknown>[]; patch: Record<string, unknown>[] }
};

const UNREADABLE = 'This post was saved by an earlier build of pdfpal and can no longer be opened. Delete it.';
const fake = (): Fake => ({ current: null, previous: null, hold: false, startPlan: [], failGets: 0, failStatus: 500, unreadable: false,
  calls: { start: 0, change: 0, retry: 0, cancel: 0, undo: 0, patch: 0, get: 0, delete: 0 }, bodies: { start: [], change: [], patch: [] } });

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
      const planned = state.startPlan.shift();
      if (planned === 'abort') return route.abort('connectionreset');
      if (planned) return json(planned.status, { detail: planned.detail });
      state.current = { ...state.template!, status: 'running', card: null, caption: null, destination: body.destination ?? 'linkedin', take: body.take ?? '' };
      return json(202, state.current);
    }
    if (request.method() === 'GET' && tail === '') {
      const post = state.current;
      return json(200, post ? [{ id: post.id, status: post.status, annotation_id: post.annotation_id, source_id: post.source_id, page: post.source.page, title: post.card?.headline || post.source.passage, updated_at: post.updated_at }] : []);
    }
    if (!state.current || tail.split('/')[1] !== state.current.id) return json(404, { detail: 'Post not found.' });
    const post = state.current, active = post.status === 'running' || post.status === 'pending';
    if (request.method() === 'DELETE') { state.calls.delete++; state.current = null; return route.fulfill({ status: 204 }); }
    if (state.unreadable) return json(422, { detail: UNREADABLE });
    if (request.method() === 'GET') {
      state.calls.get++;
      if (state.failGets > 0) { state.failGets--; return json(state.failStatus, { detail: 'The server is restarting.' }); }
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
      else if ('takeaway' in body) { next = { card: { ...card, takeaway: body.takeaway }, caption }; keep = true; }
      else if ('caption' in body) { next = { card, caption: { ...caption, edited: body.caption } }; keep = true; }
      // As the server does: look, style, crop, hashtags and link also change the version behind Undo, so they survive it.
      if (state.previous && !keep && !('angle' in body)) {
        const behind = state.previous;
        if ('style' in body) state.previous = { ...behind, card: { ...behind.card, style: body.style, look: body.look } };
        else if ('crop' in body) state.previous = { ...behind, card: { ...behind.card, crop: body.crop } };
        else if ('show_tags' in body) state.previous = { ...behind, caption: { ...behind.caption, showTags: body.show_tags } };
        else if ('link' in body) state.previous = { ...behind, caption: { ...behind.caption, link: body.link } };
      }
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
    source: { version: 1, kind: 'highlight', passage, page: 2, rects, color: 'yellow', region: null, items: [], context: passage, title: 'Share card paper', credit: 'Vaswani et al., 2017', url: URL_LINK },
    set_marks: [],
    ...extra,
  };
}

/** A highlight in the lower half of page 2, far below the text the post's crops are made from. */
const FAR: PageRect = { x1: 0.121, y1: 0.6, x2: 0.5, y2: 0.6142 };

/**
 * The paper on page 2 of test/fixtures/share-cards.pdf with five highlights: the post's own (lines 2–3, yellow), one
 * line above it (blue), one below it (green), the last paragraph (pink), which only a crop with three lines of context
 * reaches, and one far down the page (blue), which no automatic crop reaches.
 */
async function paper(page: Page, state: Fake) {
  await routePosts(page, state);
  const { project, source, lines } = await openPdf(page, 'test/fixtures/share-cards.pdf', 2);
  const own = [lines[1]!.rect, lines[2]!.rect];
  const annotation = await highlight(page, project.id, source.id, 2, `${lines[1]!.text}\n${lines[2]!.text}`, own);
  const others: Array<[PageRect, string, PageMark['color']]> = [
    [lines[0]!.rect, lines[0]!.text, 'blue'], [lines[3]!.rect, lines[3]!.text, 'green'], [lines[5]!.rect, lines[5]!.text, 'pink'], [FAR, 'A note far down the page.', 'blue'],
  ];
  for (const [rect, text, color] of others) await highlight(page, project.id, source.id, 2, text, [rect], color);
  const marks: PageMark[] = [{ rects: own, color: 'yellow' }, ...others.map(([rect, , color]) => ({ rects: [rect], color }))];
  const passage = 'the sequence. However, the cost grows with the square of the sequence length, so long documents become expensive. We suspect';
  state.template = record(project.id, source.id, annotation, passage, own, marks);
  return { project, source, annotation, lines, marks, url: `/projects/${project.id}/sources/${source.id}` };
}

/** Opens the fake's current post through a link, as the reader does after a reload. */
async function openPost(page: Page, state: Fake, readerUrl: string, extra: Partial<ShareCardRecord> = {}) {
  state.current = { ...state.template!, ...extra };
  await page.goto(`${readerUrl}?post=${POST_ID}`);
}

const card = (page: Page) => page.locator('img[data-share-card]:not([data-slide])');
const slide = (page: Page) => page.locator('img[data-slide]');
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
      expect(page.url()).toContain(`post=${POST_ID}`);
      await expect(page.getByRole('radio', { name: STYLE_NAMES[style], exact: true })).toHaveAttribute('aria-checked', 'true');
      if (destination === 'instagram') {
        // Instagram: three cards, the hook, the page and the takeaway; the page carries every highlight in its crop.
        expect(style).toBe('carousel');
        await expect(slide(page)).toHaveAttribute('data-slide', '1', { timeout: 20_000 });
        await expect(slide(page)).toHaveAttribute('data-slide-count', '3');
        await expect(slide(page)).toHaveAttribute('data-slide-kind', 'cover');
        await page.getByRole('button', { name: 'Next slide' }).click();
        await expect(slide(page)).toHaveAttribute('data-slide-kind', 'page');
        await expect(slide(page)).toHaveAttribute('data-share-card', 'page/ink');
        await expect(slide(page)).toHaveAttribute('data-share-marks', '4');
        await expect(card(page)).toHaveCount(0);
      } else {
        await expect(card(page)).toHaveAttribute('data-share-card', `${style}/ink`, { timeout: 20_000 });
        // Every highlight inside the automatic crop is drawn: own, blue and green always, pink with three lines of
        // context. The one far down the page is outside every automatic crop and is not drawn.
        await expect(card(page)).toHaveAttribute('data-share-marks', destination === 'x' ? '3' : '4');
        const height = await fitHeight(page);
        expect(height).toBeGreaterThanOrEqual(FIT.minHeight); expect(height).toBeLessThan(FIT.maxHeight);
      }
      await expect(caption(page)).toHaveText(shownText(state));
      await expect(page.locator('[data-x-count]')).toHaveCount(destination === 'x' ? 1 : 0);
      await expect(page.getByRole('switch', { name: 'Hashtags' })).toHaveCount(destination === 'x' ? 0 : 1);
      if (destination === 'instagram') await expect(page.getByRole('switch', { name: 'Hashtags' })).toHaveAttribute('aria-checked', 'true');
      // No Story in the Carousel style: the slides are the export.
      await expect(page.getByRole('button', { name: 'Save Story (9:16)' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Save all slides (ZIP)' })).toHaveCount(destination === 'instagram' ? 1 : 0);
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
    // Instagram takes the Carousel style: three cards.
    await expect(slide(page)).toHaveAttribute('data-slide-count', '3');
    await expect(page.getByRole('radio', { name: 'Carousel' })).toHaveAttribute('aria-checked', 'true');
    await expect(caption(page)).toHaveText(shownText(state));
    await expect(page.getByRole('button', { name: 'Save Story (9:16)' })).toHaveCount(0);

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
    const { url, lines } = await paper(page, state);
    await openPost(page, state, url);
    await expect(card(page)).toHaveAttribute('data-share-marks', '4', { timeout: 20_000 });
    const automatic = (await card(page).getAttribute('data-share-crop'))!;
    await expect(page.getByText('Automatic crop')).toBeVisible();

    await page.getByRole('button', { name: 'Adjust crop' }).click();
    const dialog = page.getByRole('dialog', { name: 'Adjust crop' });
    await expect(dialog).toHaveAttribute('data-state', 'ready');
    const box = page.locator('[data-crop-box]');
    // The editor starts from the automatic crop, with every highlight on the page.
    const start = (await box.getAttribute('data-crop'))!.split(',').map(Number);
    automatic.split(',').map(Number).forEach((value, index) => expect(Math.abs(value - start[index]!)).toBeLessThan(0.002));
    await expect(page.locator('[data-crop-mark]')).toHaveCount(6);
    // Down by a tenth of the page with the pointer, which leaves the post's own highlight and the lines around it above
    // the crop; then the bottom edge down with the keyboard until the highlight far down the page is inside it.
    const frame = (await page.locator('[data-crop-page]').boundingBox())!, from = (await box.boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 + 0.1 * frame.height, { steps: 8 });
    await page.mouse.up();
    await dialog.getByRole('button', { name: 'Bottom edge' }).focus();
    for (let i = 0; i < 7; i++) await page.keyboard.press('Shift+ArrowDown');
    const chosen = (await box.getAttribute('data-crop'))!.split(',').map(Number);
    expect(chosen[1]!).toBeGreaterThan(start[1]! + 0.08);
    expect(chosen[1]!).toBeGreaterThan(lines[3]!.rect.y2);
    expect(chosen[3]!).toBeGreaterThan(FAR.y2);
    await dialog.getByRole('button', { name: 'Apply' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('Crop saved.')).toBeVisible();
    const saved = state.bodies.patch.at(-1)!.crop as PageRect;
    expect([saved.x1, saved.y1, saved.x2, saved.y2].map(value => value.toFixed(4)).join(',')).toBe(chosen.map(value => value.toFixed(4)).join(','));
    // The preview uses the reader's crop: it draws the two highlights inside it (pink and the far one) and not the
    // three above it.
    await expect(card(page)).toHaveAttribute('data-share-crop', chosen.map(value => value.toFixed(4)).join(','));
    await expect(card(page)).toHaveAttribute('data-share-marks', '2');
    await expect(page.getByText('Your crop')).toBeVisible();

    await page.getByRole('button', { name: 'Adjust crop' }).click();
    await expect(dialog).toHaveAttribute('data-state', 'ready');
    await dialog.getByRole('button', { name: 'Reset to automatic' }).click();
    await expect(page.getByText('Back to the automatic crop.')).toBeVisible();
    expect(state.bodies.patch.at(-1)).toEqual({ crop: null });
    await expect(card(page)).toHaveAttribute('data-share-crop', automatic);
    await expect(card(page)).toHaveAttribute('data-share-marks', '4');
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

  test('Headline chosen on Instagram is one card again, with its Story export', async ({ page }) => {
    test.setTimeout(60_000);
    const state = fake();
    const { url } = await paper(page, state);
    await openPost(page, state, url, { ...written('instagram', ''), destination: 'instagram' });
    await expect(slide(page)).toHaveAttribute('data-slide-count', '3', { timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Save Story (9:16)' })).toHaveCount(0);
    await page.getByRole('radio', { name: 'Headline', exact: true }).click();
    expect(state.bodies.patch.at(-1)).toEqual({ style: 'headline', look: 'ink' });
    await expect(card(page)).toHaveAttribute('data-share-card', 'headline/ink', { timeout: 20_000 });
    await expect(slide(page)).toHaveCount(0);
    expect(state.calls.change).toBe(0);
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
      // The reader chose Headline on Instagram.
      ...version, card: { ...version.card, style: 'headline' }, caption: { ...version.caption, drafts: { ...version.caption.drafts, contrast: '', caveat: '' } }, destination: 'instagram',
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
    fs.mkdirSync(SHOTS, { recursive: true });
    for (const width of [360, 480]) {
      await page.setViewportSize({ width: Math.round(width / 0.45), height: 2000 });
      await page.locator('[data-share-post]').screenshot({ path: path.join(SHOTS, `${width}-removed-pdf.png`) });
    }
  });
});

// ── The Carousel style: three cards from one highlight ───────────────────────────────────────────────────────────────
test.describe('the Carousel style', () => {
  test.beforeEach(async ({ page }) => { await mockAuth(page); });

  const instagram = (state: Fake): Partial<ShareCardRecord> => ({ ...written('instagram', ''), destination: 'instagram' });
  async function goTo(page: Page, number: number) {
    const current = Number(await slide(page).getAttribute('data-slide'));
    for (let at = current; at < number; at++) await page.getByRole('button', { name: 'Next slide' }).click();
    for (let at = current; at > number; at--) await page.getByRole('button', { name: 'Previous slide' }).click();
    await expect(slide(page)).toHaveAttribute('data-slide', String(number));
  }

  test('a highlight is three cards: the hook, the page with every highlight on it, and the takeaway', async ({ page }) => {
    test.setTimeout(60_000);
    const state = fake();
    const { url } = await paper(page, state);
    await openPost(page, state, url, instagram(state));
    await expect(slide(page)).toHaveAttribute('data-slide', '1', { timeout: 20_000 });
    const viewer = page.locator('[data-slide-viewer]');
    await expect(viewer).toHaveAccessibleName(cardDescription(state.current!.card!, 'carousel', state.current!.source));
    await expect(viewer).toHaveAccessibleName('Carousel of 3 slides: Reach has a quadratic price.');
    await expect(slide(page)).toHaveAttribute('alt', 'Slide 1 of 3, cover: Reach has a quadratic price');
    await expect(page.locator('[data-slide-position]')).toHaveText('1 of 3 · Cover');
    await viewer.focus();
    await page.keyboard.press('ArrowRight');
    await expect(slide(page)).toHaveAttribute('alt', `Slide 2 of 3, the page: ${CARD.quote}`);
    await expect(slide(page)).toHaveAttribute('data-share-card', 'page/ink');
    await expect(slide(page)).toHaveAttribute('data-share-marks', '4');
    await expect(page.getByText('Automatic crop')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit slide' })).toHaveCount(0);
    await page.keyboard.press('End');
    await expect(slide(page)).toHaveAttribute('alt', `Slide 3 of 3, the takeaway: ${CARD.takeaway}`);
    await expect(page.getByRole('button', { name: 'Next slide' })).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByRole('button', { name: 'Add a takeaway' })).toHaveCount(0);
    // The style row: Page, Headline and Carousel; the text cards stay under their disclosure.
    await expect(page.getByRole('radiogroup', { name: 'Card style' }).getByRole('radio')).toHaveText(['Page', 'Headline', 'Carousel']);
    await expect(page.getByRole('radio', { name: 'Quote' })).toBeHidden();
    expect(state.calls.patch).toBe(0);
  });

  test('a post without a takeaway shows two cards and a quiet Add a takeaway', async ({ page }) => {
    const state = fake();
    const { url } = await paper(page, state);
    const version = written('instagram', '');
    await openPost(page, state, url, { ...version, card: { ...version.card, takeaway: '' }, destination: 'instagram' });
    await expect(slide(page)).toHaveAttribute('data-slide-count', '2', { timeout: 20_000 });
    await page.getByRole('button', { name: 'Add a takeaway' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add a takeaway' });
    const field = dialog.getByRole('textbox', { name: 'The takeaway' });
    await expect(field).toHaveValue('');
    await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled();
    await field.fill('Long inputs need a cheaper kind of attention.');
    await dialog.getByRole('button', { name: 'Save' }).click();
    expect(state.bodies.patch.at(-1)).toEqual({ takeaway: 'Long inputs need a cheaper kind of attention.' });
    await expect(page.getByText('Takeaway added.')).toBeVisible();
    await expect(slide(page)).toHaveAttribute('data-slide-count', '3');
    await expect(page.getByRole('button', { name: 'Add a takeaway' })).toHaveCount(0);
    expect(state.calls.change).toBe(0);
  });

  test('editing the takeaway and the hook, with Undo', async ({ page }) => {
    test.setTimeout(60_000);
    const state = fake();
    const { url } = await paper(page, state);
    await openPost(page, state, url, instagram(state));
    await expect(slide(page)).toHaveAttribute('data-slide', '1', { timeout: 20_000 });
    await goTo(page, 3);
    await page.getByRole('button', { name: 'Edit slide' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit slide 3 of 3: The takeaway' });
    const field = dialog.getByRole('textbox', { name: 'The takeaway' });
    await expect(field).toHaveValue(CARD.takeaway);
    await expect(dialog.getByText('Up to 140 characters.')).toBeVisible();
    await field.fill('t'.repeat(150));
    await expect(field).toHaveValue('t'.repeat(140));
    await field.fill('Short inputs are where full attention pays.');
    await dialog.getByRole('button', { name: 'Save' }).click();
    expect(state.bodies.patch.at(-1)).toEqual({ takeaway: 'Short inputs are where full attention pays.' });
    await expect(slide(page)).toHaveAttribute('alt', 'Slide 3 of 3, the takeaway: Short inputs are where full attention pays.');
    await page.getByRole('button', { name: 'Undo last change' }).click();
    await expect(slide(page)).toHaveAttribute('alt', `Slide 3 of 3, the takeaway: ${CARD.takeaway}`);

    await goTo(page, 1);
    await page.getByRole('button', { name: 'Edit slide' }).click();
    const hook = page.getByRole('dialog', { name: 'Edit slide 1 of 3: Cover' });
    await hook.getByRole('textbox', { name: 'Headline' }).fill('Reach costs more than it looks');
    await hook.getByRole('button', { name: 'Save' }).click();
    expect(state.bodies.patch.at(-1)).toEqual({ headline: 'Reach costs more than it looks' });
    await expect(slide(page)).toHaveAttribute('alt', 'Slide 1 of 3, cover: Reach costs more than it looks');
    expect(state.calls.change).toBe(0);
  });

  test('the page card\'s crop is adjusted from its slide and reset', async ({ page }) => {
    test.setTimeout(60_000);
    const state = fake();
    const { url } = await paper(page, state);
    await openPost(page, state, url, instagram(state));
    await expect(slide(page)).toHaveAttribute('data-slide', '1', { timeout: 20_000 });
    await goTo(page, 2);
    await expect(slide(page)).toHaveAttribute('data-share-crop', /\d/);
    const automatic = (await slide(page).getAttribute('data-share-crop'))!;
    await page.getByRole('button', { name: 'Adjust crop' }).click();
    const dialog = page.getByRole('dialog', { name: 'Adjust crop' });
    await expect(dialog).toHaveAttribute('data-state', 'ready');
    await expect(page.locator('[data-crop-box]')).toBeFocused();
    await page.keyboard.press('Shift+ArrowDown');
    const chosen = (await page.locator('[data-crop-box]').getAttribute('data-crop'))!;
    await dialog.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByText('Crop saved.')).toBeVisible();
    const saved = state.bodies.patch.at(-1)!.crop as PageRect;
    expect([saved.x1, saved.y1, saved.x2, saved.y2].map(value => value.toFixed(4)).join(',')).toBe(chosen);
    expect(state.bodies.patch.at(-1)).not.toHaveProperty('slide');
    await expect(slide(page)).toHaveAttribute('data-share-crop', chosen);
    await expect(page.getByText('Your crop')).toBeVisible();
    await page.getByRole('button', { name: 'Adjust crop' }).click();
    await expect(dialog).toHaveAttribute('data-state', 'ready');
    await dialog.getByRole('button', { name: 'Reset to automatic' }).click();
    expect(state.bodies.patch.at(-1)).toEqual({ crop: null });
    await expect(slide(page)).toHaveAttribute('data-share-crop', automatic);
  });

  test('a page too tall for an automatic crop says so on its slide and can be given a crop', async ({ page }) => {
    test.setTimeout(60_000);
    const state = fake();
    await routePosts(page, state);
    const { project, source, lines } = await openPdf(page, tallPdf(), 1);
    const rects = lines.map(line => line.rect);
    const annotation = await highlight(page, project.id, source.id, 1, lines.map(line => line.text).join('\n').slice(0, 5000), rects);
    const base = record(project.id, source.id, annotation, lines.map(line => line.text).join(' ').slice(0, 5000), rects, [{ rects, color: 'yellow' }]);
    state.template = { ...base, source: { ...base.source, page: 1 } };
    await openPost(page, state, `/projects/${project.id}/sources/${source.id}`, instagram(state));
    await expect(slide(page)).toHaveAttribute('data-slide', '1', { timeout: 20_000 });
    await goTo(page, 2);
    await expect(slide(page)).toHaveAttribute('data-share-card', 'quote/ink');
    await expect(page.getByText('This highlight is too tall for an automatic crop. Adjust the crop to show part of it.')).toBeVisible();
    await page.getByRole('button', { name: 'Adjust crop' }).click();
    const dialog = page.getByRole('dialog', { name: 'Adjust crop' });
    await expect(dialog).toHaveAttribute('data-state', 'ready');
    const start = cropBox(rects, 0);
    const shown = (await page.locator('[data-crop-box]').getAttribute('data-crop'))!.split(',').map(Number);
    [start.x1, start.y1, start.x2, start.y2].forEach((value, index) => expect(Math.abs(value - shown[index]!)).toBeLessThan(0.002));
    await dialog.getByRole('button', { name: 'Bottom edge' }).focus();
    for (let i = 0; i < 12; i++) await page.keyboard.press('Shift+ArrowUp');
    await dialog.getByRole('button', { name: 'Apply' }).click();
    await expect(slide(page)).toHaveAttribute('data-share-card', 'page/ink');
  });

  test('Carousel chosen on LinkedIn draws the three cards without a request, and Page brings the single card back', async ({ page }) => {
    test.setTimeout(60_000);
    const state = fake();
    const { url } = await paper(page, state);
    await openPost(page, state, url);
    await expect(card(page)).toHaveAttribute('data-share-card', 'page/ink', { timeout: 20_000 });
    await page.getByRole('radio', { name: 'Carousel' }).click();
    expect(state.bodies.patch.at(-1)).toEqual({ style: 'carousel', look: 'ink' });
    await expect(slide(page)).toHaveAttribute('data-slide-count', '3', { timeout: 20_000 });
    await expect(card(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Save all slides (ZIP)' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save image' })).toHaveCount(0);
    await page.getByRole('radio', { name: 'Paper look' }).click();
    expect(state.bodies.patch.at(-1)).toEqual({ style: 'carousel', look: 'paper' });
    await expect(slide(page)).toHaveAttribute('data-share-card', 'idea/paper');
    await page.getByRole('radio', { name: 'Page', exact: true }).click();
    await expect(card(page)).toHaveAttribute('data-share-card', 'page/paper', { timeout: 20_000 });
    await expect(slide(page)).toHaveCount(0);
    expect(state.calls.change).toBe(0); expect(state.calls.start).toBe(0);
  });

  test('the three cards are copied and saved as a ZIP of three and a PDF of three pages', async ({ page, context }) => {
    test.setTimeout(60_000);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const state = fake();
    const { url } = await paper(page, state);
    await openPost(page, state, url, instagram(state));
    await expect(slide(page)).toHaveAttribute('data-slide', '1', { timeout: 20_000 });
    await page.getByRole('button', { name: 'Copy slide' }).click();
    await expect(page.getByText('Slide copied. Paste it into your post.')).toBeVisible();
    let download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save slide' }).click();
    expect((await download).suggestedFilename()).toBe(slideFileName('Share card paper', 1, 3));
    download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save all slides (ZIP)' }).click();
    let file = await download;
    expect(file.suggestedFilename()).toBe(carouselFileName('Share card paper', 'zip'));
    expect(zipNames(fs.readFileSync((await file.path())!))).toEqual([1, 2, 3].map(number => slideFileName('Share card paper', number, 3)));
    download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save as PDF' }).click();
    file = await download;
    expect(file.suggestedFilename()).toBe(carouselFileName('Share card paper', 'pdf'));
    expect(pdfPages(fs.readFileSync((await file.path())!))).toBe(3);
  });

  test('switching to Instagram and back makes one request each way', async ({ page }) => {
    test.setTimeout(60_000);
    const state = fake();
    const { url } = await paper(page, state);
    await openPost(page, state, url);
    await expect(card(page)).toHaveAttribute('data-share-card', 'page/ink', { timeout: 20_000 });
    await page.getByRole('radio', { name: DESTINATION_NAMES.instagram }).click();
    await expect(slide(page)).toHaveAttribute('data-slide-count', '3', { timeout: 15_000 });
    expect(state.calls.change).toBe(1);
    await page.getByRole('radio', { name: DESTINATION_NAMES.linkedin }).click();
    await expect(card(page)).toHaveAttribute('data-share-card', 'page/ink', { timeout: 15_000 });
    await expect(slide(page)).toHaveCount(0);
    expect(state.bodies.change).toEqual([{ destination: 'instagram', take: '' }, { destination: 'linkedin', take: '' }]);
    expect(state.calls.patch).toBe(0);
  });
});

test.describe('a Carousel post whose PDF was removed', () => {
  test.beforeEach(async ({ page }) => { await mockAuth(page); });

  test('draws its page slide from the quote and says why', async ({ page }) => {
    const state = fake();
    await routePosts(page, state);
    const project = await createProjectViaApi(page, 'Removed PDF carousel');
    state.current = { ...record(project.id, null, null, 'Attention lets every position look at every other position.', [{ x1: 0.1, y1: 0.2, x2: 0.9, y2: 0.23 }], []),
      ...written('instagram', ''), destination: 'instagram' };
    await page.goto(`/projects/${project.id}`);
    await page.getByRole('tab', { name: /Highlights/ }).click();
    await page.getByRole('button', { name: /Reach has a quadratic price/ }).click();
    await expect(slide(page)).toHaveAttribute('data-slide-count', '3', { timeout: 20_000 });
    await expect(page.getByText('The PDF for this post was removed. The page slide shows the quote instead.')).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Carousel' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('radio', { name: 'Carousel' })).toBeEnabled();
    for (const name of ['Page', 'Headline']) await expect(page.getByRole('radio', { name, exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Next slide' }).click();
    await expect(slide(page)).toHaveAttribute('data-slide-kind', 'page');
    await expect(slide(page)).toHaveAttribute('data-share-card', 'quote/ink');
    await expect(slide(page)).toHaveAttribute('alt', `Slide 2 of 3, the page: ${CARD.quote}`);
    await expect(page.getByRole('button', { name: 'Adjust crop' })).toHaveCount(0);
    await noSideScroll(page);
  });
});

// ── For review: the panel in a narrow and a wider side column ────────────────────────────────────────────────────────
test.describe('the post panel, for review', () => {
  test.beforeEach(async ({ page }) => { await mockAuth(page); });

  test('each destination at 360 and 480 px: new, with a take, rewriting, text cards and the crop editor', async ({ page }) => {
    test.setTimeout(180_000);
    fs.mkdirSync(SHOTS, { recursive: true });
    const state = fake();
    // The reader's right column is 45% of the window, less the 5 px divider.
    await page.setViewportSize({ width: 806, height: 2400 });
    const { url } = await paper(page, state);
    for (const width of [360, 480]) {
      await page.setViewportSize({ width: Math.round((width + 5) / 0.45), height: 2400 });
      for (const destination of ['linkedin', 'x', 'instagram'] as const) {
        const name = (what: string) => path.join(SHOTS, `${width}-${destination}-${what}.png`);
        const panel = page.locator('[data-share-post]');
        state.previous = null; state.hold = false;
        await openPost(page, state, url, { ...written(destination, ''), destination });
        if (destination === 'instagram') await expect(slide(page)).toHaveAttribute('data-share-card', 'idea/ink', { timeout: 20_000 });
        else await expect(card(page)).toHaveAttribute('data-share-card', `${DESTINATION_DEFAULTS[destination].style}/ink`, { timeout: 20_000 });
        const columnWidth = (await panel.boundingBox())!.width;
        expect(Math.abs(columnWidth - width)).toBeLessThanOrEqual(4);
        await noSideScroll(page);
        await panel.screenshot({ path: name('new') });

        await openPost(page, state, url, { ...written(destination, TAKE), destination, take: TAKE, can_undo: true });
        await expect(caption(page)).toContainText(TAKE);
        await page.getByText('Text cards').click();
        await expect(page.getByRole('radio', { name: 'Takeaways' })).toBeVisible();
        await noSideScroll(page);
        await panel.screenshot({ path: name('take-and-text-cards') });

        state.hold = true;
        await page.getByRole('radio', { name: DESTINATION_NAMES[destination === 'x' ? 'linkedin' : 'x'] }).click();
        await expect(page.getByText(/Rewriting for/)).toBeVisible();
        await noSideScroll(page);
        await panel.screenshot({ path: name('rewriting') });
        await page.getByRole('button', { name: 'Cancel' }).click();
        await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();

        if (destination === 'linkedin') {
          await page.setViewportSize({ width: Math.round((width + 5) / 0.45), height: 900 });
          await page.getByRole('button', { name: 'Adjust crop' }).click();
          await expect(page.getByRole('dialog', { name: 'Adjust crop' })).toHaveAttribute('data-state', 'ready');
          await page.screenshot({ path: name('crop-editor') });
          await page.getByRole('dialog', { name: 'Adjust crop' }).getByRole('button', { name: 'Cancel' }).click();
          await page.setViewportSize({ width: Math.round((width + 5) / 0.45), height: 2400 });
        }
      }
    }
  });
});

// ── Fixes from the review ────────────────────────────────────────────────────────────────────────────────────────────
// Counts blob URLs that were made and never revoked, and canvases that a page crop draws on.
const INSTRUMENT = () => {
  const w = window as unknown as { __urls: Set<string>; __cropCanvases: number };
  w.__urls = new Set(); w.__cropCanvases = 0;
  const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = (object: Blob | MediaSource) => { const url = create(object); w.__urls.add(url); return url; };
  URL.revokeObjectURL = (url: string) => { w.__urls.delete(url); revoke(url); };
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: unknown[]) {
    // A page crop draws on a canvas off the page (the reader's pages are on it), neither 1080 wide like a card nor the
    // default 300 × 150 of the measuring canvas.
    if (args[0] === '2d' && !this.isConnected && this.width !== 1080 && this.width > 300) w.__cropCanvases++;
    return (getContext as (...a: unknown[]) => unknown).apply(this, args);
  } as typeof getContext;
};
const outstandingUrls = (page: Page) => page.evaluate(() => (window as unknown as { __urls: Set<string> }).__urls.size);
const cropCanvases = (page: Page) => page.evaluate(() => (window as unknown as { __cropCanvases: number }).__cropCanvases);

test.describe('share posts: fixes from the review', () => {
  test.beforeEach(async ({ page }) => { await mockAuth(page); });

  test('a highlight too tall for an automatic crop can still be given a crop by the reader', async ({ page }) => {
    test.setTimeout(60_000);
    const state = fake();
    await routePosts(page, state);
    // A page full of text, highlighted from top to bottom.
    const { project, source, lines } = await openPdf(page, tallPdf(), 1);
    const rects = lines.map(line => line.rect);
    expect(rects.length).toBeGreaterThanOrEqual(45);
    const annotation = await highlight(page, project.id, source.id, 1, lines.map(line => line.text).join('\n').slice(0, 5000), rects);
    state.template = record(project.id, source.id, annotation, lines.map(line => line.text).join(' ').slice(0, 5000), rects, [{ rects, color: 'yellow' }]);
    state.template = { ...state.template, source: { ...state.template.source, page: 1 } };
    await openPost(page, state, `/projects/${project.id}/sources/${source.id}`);
    // Drawn as its fallback text card, with a line that says why and how to show the page.
    await expect(card(page)).toHaveAttribute('data-share-card', 'quote/ink', { timeout: 20_000 });
    await expect(page.getByText('This highlight is too tall for an automatic crop. Adjust the crop to show part of it.')).toBeVisible();
    await page.getByRole('button', { name: 'Adjust crop' }).click();
    const dialog = page.getByRole('dialog', { name: 'Adjust crop' });
    await expect(dialog).toHaveAttribute('data-state', 'ready');
    // The editor starts from the box around the highlight's own lines.
    const start = cropBox(rects, 0);
    const shown = (await page.locator('[data-crop-box]').getAttribute('data-crop'))!.split(',').map(Number);
    [start.x1, start.y1, start.x2, start.y2].forEach((value, index) => expect(Math.abs(value - shown[index]!)).toBeLessThan(0.002));
    // Keep its top part, and apply: a reader's crop is never too tall.
    await dialog.getByRole('button', { name: 'Bottom edge' }).focus();
    for (let i = 0; i < 12; i++) await page.keyboard.press('Shift+ArrowUp');
    const chosen = (await page.locator('[data-crop-box]').getAttribute('data-crop'))!;
    await dialog.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByText('Crop saved.')).toBeVisible();
    await expect(card(page)).toHaveAttribute('data-share-card', 'page/ink');
    await expect(card(page)).toHaveAttribute('data-share-crop', chosen);
    await expect(page.getByText(/too tall for an automatic crop/)).toHaveCount(0);
  });

  test('updates that fail are retried while the post is being written, and the reader is told when they keep failing', async ({ page }) => {
    test.setTimeout(60_000);
    const state = fake();
    const { url } = await paper(page, state);
    await openPost(page, state, url);
    await expect(card(page)).toHaveAttribute('data-share-card', 'page/ink', { timeout: 20_000 });

    // Two failed checks during a rewrite: the panel says it is trying again and then shows the new version.
    state.hold = true;
    await page.getByRole('radio', { name: DESTINATION_NAMES.x }).click();
    await expect(page.getByText('Rewriting for X · Bluesky · Threads…')).toBeVisible();
    state.failGets = 2;
    await expect(page.getByText(/Couldn’t reach pdfpal to check on this post\. Trying again…/)).toBeVisible();
    state.hold = false;
    await expect(page.locator('[data-x-count]')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Couldn’t reach pdfpal/)).toHaveCount(0);

    // Checks that keep failing stop after a few tries and offer Check again; the rewrite is not shown as finished.
    state.hold = true;
    await page.getByRole('radio', { name: DESTINATION_NAMES.linkedin }).click();
    await expect(page.getByText('Rewriting for LinkedIn…')).toBeVisible();
    state.failGets = 1000;
    const stopped = page.getByText('pdfpal stopped checking on this post: The server is restarting.');
    await expect(stopped).toBeVisible({ timeout: 20_000 });
    const tries = state.calls.get;
    await page.waitForTimeout(2500);
    expect(state.calls.get).toBe(tries);
    state.failGets = 0; state.hold = false;
    await page.getByRole('button', { name: 'Check again' }).click();
    await expect(page.locator('[data-x-count]')).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByText('Your post was rewritten.')).toBeVisible();
    await expect(stopped).toHaveCount(0);
  });

  test('a post that is gone stops the checks at once', async ({ page }) => {
    const state = fake();
    const { url } = await paper(page, state);
    state.hold = true;
    await openPost(page, state, url, { status: 'running' });
    await expect(page.getByText('Rewriting your post…')).toBeVisible({ timeout: 20_000 });
    state.failGets = 1000; state.failStatus = 404;
    await expect(page.getByText('pdfpal stopped checking on this post: The server is restarting.')).toBeVisible({ timeout: 10_000 });
    const tries = state.calls.get;
    await page.waitForTimeout(2500);
    expect(state.calls.get).toBe(tries);
  });

  test('a page crop is not started again by the checks that run while the post is rewritten', async ({ page }) => {
    test.setTimeout(60_000);
    await page.addInitScript(INSTRUMENT);
    const state = fake();
    const { url } = await paper(page, state);
    // The PDF arrives after three checks; meanwhile the post is being rewritten.
    await page.route('**/sources/*/file', async route => { await new Promise(resolve => setTimeout(resolve, 3500)); await route.continue(); });
    state.hold = true;
    await openPost(page, state, url, { status: 'running' });
    await expect(page.getByText('Rewriting your post…')).toBeVisible({ timeout: 20_000 });
    // The preview appears while the rewrite still runs, from one crop.
    await expect(card(page)).toHaveAttribute('data-share-card', 'page/ink', { timeout: 20_000 });
    await expect(page.getByText('Rewriting your post…')).toBeVisible();
    expect(state.calls.get).toBeGreaterThanOrEqual(3);
    expect(await cropCanvases(page)).toBe(1);
  });

  test('closing a post while its picture is drawn leaves no picture behind', async ({ page }) => {
    test.setTimeout(60_000);
    await page.addInitScript(INSTRUMENT);
    const state = fake();
    const { url } = await paper(page, state);
    // The card's fonts arrive late, so the picture is still being drawn when the post closes.
    let fonts = 0;
    await page.route('**/fonts/**', async route => { fonts++; await new Promise(resolve => setTimeout(resolve, 2500)); await route.continue(); });
    await openPost(page, state, url, { card: { ...state.template!.card!, style: 'quote' } });
    await expect(page.getByRole('heading', { name: 'Reach has a quadratic price' })).toBeVisible();
    await expect.poll(() => fonts).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'All posts' }).click();
    await expect(page.getByRole('heading', { name: 'Posts' })).toBeVisible();
    await page.waitForTimeout(5000);
    expect(await outstandingUrls(page)).toBe(0);
  });

  test('a refused start forgets its request ID; a start whose answer was lost keeps it', async ({ page }) => {
    test.setTimeout(60_000);
    const state = fake();
    const { annotation } = await paper(page, state);
    await page.reload();
    const box = page.locator(`[data-annotation-id="${annotation}"]`).first();
    const create = async () => { await box.click(); await page.getByRole('menuitem', { name: /Create post/ }).click(); };
    state.startPlan = ['abort', { status: 409, detail: 'This request ID was already used for another post.' }];
    await create();
    await expect.poll(() => state.bodies.start.length).toBe(1);
    await expect(page.getByRole('alert')).toBeVisible();
    // The lost answer may have started the post: the same ID is sent again, and is refused.
    await create();
    await expect(page.getByText('This request ID was already used for another post.')).toBeVisible();
    expect(state.bodies.start[1]!.request_id).toBe(state.bodies.start[0]!.request_id);
    // Refused for good: the next try is a new request, and it starts the post.
    await create();
    await expect(card(page)).toHaveAttribute('data-share-card', 'page/ink', { timeout: 20_000 });
    expect(state.bodies.start).toHaveLength(3);
    expect(state.bodies.start[2]!.request_id).not.toBe(state.bodies.start[1]!.request_id);
    expect(await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith('pdfpal:share-card-request:')))).toEqual([]);
  });

  test('a post an earlier build saved says so and can still be deleted', async ({ page }) => {
    const state = fake();
    const { url } = await paper(page, state);
    state.unreadable = true;
    await openPost(page, state, url);
    await expect(page.getByRole('alert')).toHaveText(UNREADABLE);
    await page.getByRole('button', { name: 'Delete post' }).click();
    await page.getByRole('dialog', { name: 'Delete this post?' }).getByRole('button', { name: 'Delete' }).click();
    await expect.poll(() => state.calls.delete).toBe(1);
    await expect(page.getByRole('heading', { name: 'Posts' })).toBeVisible();
    expect(page.url()).not.toContain('post=');
  });

  test('a look set after an edit survives Undo, as the server keeps it', async ({ page }) => {
    const state = fake();
    const { url } = await paper(page, state);
    await openPost(page, state, url);
    await expect(card(page)).toHaveAttribute('data-share-card', 'page/ink', { timeout: 20_000 });
    await page.getByRole('switch', { name: 'Hashtags' }).click();
    await page.getByRole('button', { name: 'Edit caption' }).click();
    await page.getByRole('dialog', { name: 'Edit caption' }).getByRole('textbox', { name: 'Caption' }).fill('My own words.');
    await page.getByRole('dialog', { name: 'Edit caption' }).getByRole('button', { name: 'Save' }).click();
    await expect(caption(page)).toHaveText('My own words.');
    await page.getByRole('radio', { name: 'Marker look' }).click();
    await expect(card(page)).toHaveAttribute('data-share-card', 'page/marker');
    await page.getByRole('button', { name: 'Undo last change' }).click();
    await expect(caption(page)).toHaveText(shownText(state));
    await expect(card(page)).toHaveAttribute('data-share-card', 'page/marker');
    await expect(page.getByRole('switch', { name: 'Hashtags' })).toHaveAttribute('aria-checked', 'true');
  });
});

// ── For review: the Carousel style in a narrow and a wider side column ───────────────────────────────────────────────
test.describe('the Carousel style, for review', () => {
  test.beforeEach(async ({ page }) => { await mockAuth(page); });

  test('the three cards, the two-card case, the takeaway dialog, the style row and the export row at 360 and 480 px', async ({ page }) => {
    test.setTimeout(180_000);
    const shots = path.resolve('test-results/share-instagram');
    fs.mkdirSync(shots, { recursive: true });
    const state = fake();
    await page.setViewportSize({ width: 806, height: 2200 });
    const { url } = await paper(page, state);
    const slide = (p: Page) => p.locator('img[data-slide]');
    for (const width of [360, 480]) {
      const name = (what: string) => path.join(shots, `${width}-${what}.png`);
      const viewport = Math.round((width + 5) / 0.45);
      const panel = page.locator('[data-share-post]');
      const overflow = () => panel.evaluate(element => element.scrollWidth - element.clientWidth);
      await page.setViewportSize({ width: viewport, height: 2200 });
      state.previous = null;
      await openPost(page, state, url, { ...written('instagram', ''), destination: 'instagram' });
      await expect(slide(page)).toHaveAttribute('data-slide', '1', { timeout: 20_000 });
      expect(Math.abs((await panel.boundingBox())!.width - width)).toBeLessThanOrEqual(4);
      for (const number of [1, 2, 3]) {
        if (number > 1) await page.getByRole('button', { name: 'Next slide' }).click();
        await expect(slide(page)).toHaveAttribute('data-slide', String(number));
        expect(await overflow()).toBeLessThanOrEqual(0);
        await panel.screenshot({ path: name(`slide-${number}`) });
      }
      await page.getByRole('radiogroup', { name: 'Card style' }).locator('xpath=..').screenshot({ path: name('style-row-carousel') });
      await page.getByRole('button', { name: 'Save as PDF' }).locator('xpath=../..').screenshot({ path: name('export-row') });
      await page.getByRole('radio', { name: 'Headline', exact: true }).click();
      await expect(page.locator('img[data-share-card]:not([data-slide])')).toHaveAttribute('data-share-card', 'headline/ink', { timeout: 20_000 });
      await page.getByRole('radiogroup', { name: 'Card style' }).locator('xpath=..').screenshot({ path: name('style-row-headline') });
      await panel.screenshot({ path: name('headline-chosen') });

      const version = written('instagram', '');
      await openPost(page, state, url, { ...version, card: { ...version.card, takeaway: '' }, destination: 'instagram' });
      await expect(slide(page)).toHaveAttribute('data-slide-count', '2', { timeout: 20_000 });
      expect(await overflow()).toBeLessThanOrEqual(0);
      await panel.screenshot({ path: name('two-slides') });
      await page.setViewportSize({ width: viewport, height: 900 });
      await page.getByRole('button', { name: 'Add a takeaway' }).click();
      await page.getByRole('dialog', { name: 'Add a takeaway' }).getByRole('textbox').fill('Long inputs need a cheaper kind of attention.');
      await page.screenshot({ path: name('takeaway-dialog') });
      await page.getByRole('dialog', { name: 'Add a takeaway' }).getByRole('button', { name: 'Cancel' }).click();
    }
  });
});
