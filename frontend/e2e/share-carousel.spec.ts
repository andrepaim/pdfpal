import { test, expect, type Page, type Route } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {
  DESTINATION_DEFAULTS, captionText, cleanPassage,
  type CardContent, type Caption, type Destination, type HighlightColor, type PageMark, type PageRect, type SetItem, type ShareCardRecord,
} from '../../src/shared/share-card';
import { carouselFileName, slideFileName } from '../src/lib/share-card/export';
import { mockAuth, createProjectViaApi } from './helpers';
import { tallPdf } from './tall-pdf';
import { pdfPages, zipNames } from './export-files';
import { cropBox } from '../src/lib/share-card/crop-box';

// Carousels in the reader: several highlights of one PDF become one post. The project, the PDF
// (test/fixtures/share-cards.pdf, three pages) and the highlights are real; the share-card routes are answered by the
// small fake below, so no assistant is involved.

const SHOTS = path.resolve('test-results/share-carousel');
const POST_ID = '9c8b7a6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d';
const TITLE = 'Share card paper';
const WORDS = {
  topic: 'Attention',
  headline: 'Full attention buys reach at a quadratic price',
  study: 'A model in which every position attends to every other one, tested on long documents.',
  takeaway: 'Reach is worth its price when inputs are short; long ones need another plan.',
  limitations: 'Sparse patterns are a suspicion in the paper, not a result.',
};
const point = (index: number) => `Claim ${index + 1}: the cost of reach grows with the input`;

type Highlight = { id: string; page: number; rects: PageRect[]; color: HighlightColor; text: string };
type Version = { card: CardContent; caption: Caption };
type Fake = {
  current: ShareCardRecord | null
  previous: Version | null
  highlights: Map<string, Highlight>
  /** Whether a new carousel's text states a study and limitations. */
  study: boolean; limitations: boolean
  /** When set, the next start is refused with this status and message. */
  refuse?: { status: number; detail: string }
  starts: Record<string, any>[]
  patches: Record<string, any>[]
};
const fake = (): Fake => ({ current: null, previous: null, highlights: new Map(), study: true, limitations: true, starts: [], patches: [] });

function drafts(destination: Destination): Caption['drafts'] {
  if (destination === 'x') return { finding: 'Every position can look at every other one, and the cost grows with the square of the length.', contrast: '', caveat: '' };
  const body = 'In the model the authors describe, every position can look at every other position.\n\nThe cost grows with the square of the sequence length, so long documents become expensive.';
  return { finding: `Full attention buys reach at a price.\n\n${body}`, contrast: '', caveat: `The fix is still a suspicion.\n\n${body}` };
}

/** Every highlight on a page, as the server's set_marks lists them. */
const marksOn = (state: Fake, page: number): PageMark[] => [...state.highlights.values()].filter(h => h.page === page).map(h => ({ rects: h.rects, color: h.color }));

/** A carousel as the server returns it once written, from highlights in the reader's order. */
function setRecord(state: Fake, projectId: string, sourceId: string | null, ids: string[], destination: Destination = 'linkedin'): ShareCardRecord {
  const items: SetItem[] = ids.map(id => { const h = state.highlights.get(id)!; return { annotation_id: id, passage: cleanPassage(h.text), page: h.page, rects: h.rects, color: h.color }; });
  const card: CardContent = {
    quote: '', quoteEdited: false, emphasis: '', headline: WORDS.headline, pull: '', topic: WORDS.topic, takeawaysTitle: '', takeaways: [], style: 'headline', look: 'ink', crop: null,
    set: { study: state.study ? WORDS.study : '', points: items.map((_, index) => point(index)), takeaway: WORDS.takeaway, limitations: state.limitations ? WORDS.limitations : '', crops: items.map(() => null) },
  };
  const setMarks = items.map(item => marksOn(state, item.page));
  return {
    id: POST_ID, project_id: projectId, source_id: sourceId, annotation_id: null, status: 'complete', can_undo: false, instruction: '', error: null,
    created_at: '2026-11-15T10:00:00.000Z', updated_at: '2026-11-15T10:00:01.000Z', destination, take: '', marks: setMarks[0] ?? [], set_marks: setMarks,
    source: { version: 1, kind: 'set', passage: items.map(item => item.passage).join('\n\n'), page: items[0]!.page, rects: [], color: 'yellow', region: null, items,
      context: '', title: TITLE, credit: 'Vaswani et al., 2017', url: 'https://example.org/attention' },
    card, caption: { destination, take: '', drafts: drafts(destination), angle: 'finding', hashtags: ['attention', 'research', 'ml'], showTags: DESTINATION_DEFAULTS[destination].showTags, link: 'post', edited: null },
  };
}

/** Answers the share-card routes from `state`, as the server does for carousels. */
async function routePosts(page: Page, state: Fake) {
  await page.route('**/api/projects/*/share-cards**', async (route: Route) => {
    const request = route.request(), url = new URL(request.url()), tail = url.pathname.split('/share-cards')[1] ?? '';
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const body = (request.postDataJSON() ?? {}) as Record<string, any>;
    const projectId = url.pathname.split('/')[3]!;
    if (request.method() === 'POST' && tail === '') {
      state.starts.push(body);
      if (state.refuse) { const { status, detail } = state.refuse; state.refuse = undefined; return json(status, { detail }); }
      state.current = { ...setRecord(state, projectId, body.source_id, body.annotation_ids, body.destination), status: 'running', card: null, caption: null };
      return json(202, state.current);
    }
    if (request.method() === 'GET' && tail === '') {
      const post = state.current;
      return json(200, post ? [{ id: post.id, status: post.status, annotation_id: null, source_id: post.source_id, page: post.source.page, kind: 'set',
        title: post.card?.headline || `${post.source.items.length} highlights`, updated_at: post.updated_at }] : []);
    }
    const post = state.current;
    if (!post || tail.split('/')[1] !== post.id) return json(404, { detail: 'Post not found.' });
    if (request.method() === 'GET') {
      if (post.status === 'running') state.current = { ...setRecord(state, projectId, post.source_id, post.source.items.map(item => item.annotation_id!), post.destination), updated_at: new Date().toISOString() };
      return json(200, state.current);
    }
    if (tail.endsWith('/undo')) {
      const back = state.previous!;
      state.previous = null;
      state.current = { ...post, ...back, can_undo: false, updated_at: new Date().toISOString() };
      return json(200, state.current);
    }
    if (request.method() === 'PATCH') {
      state.patches.push(body);
      const card = post.card!, set = card.set!;
      let next: Version = { card, caption: post.caption! }, keep = false;
      if ('style' in body) {
        if (body.style !== 'headline') return json(400, { detail: "A carousel's slides use the Headline style; only the look can change." });
        next = { ...next, card: { ...card, look: body.look } };
      } else if ('crop' in body) {
        if (body.slide === undefined) return json(400, { detail: 'A carousel has a crop for each highlight slide; name the slide.' });
        next = { ...next, card: { ...card, set: { ...set, crops: set.crops.map((crop, index) => index === body.slide ? body.crop : crop) } } };
      } else if ('set_text' in body) {
        const { field, index, text } = body.set_text as { field: string; index?: number; text: string };
        next = { ...next, card: { ...card, set: field === 'point' ? { ...set, points: set.points.map((value, position) => position === index ? text : value) } : { ...set, [field]: text } } };
        keep = true;
      } else if ('headline' in body) { next = { ...next, card: { ...card, headline: body.headline } }; keep = true; }
      else return json(400, { detail: 'Not expected in this test.' });
      // As the server does: the look and the slides' crops also change the version behind Undo, so they survive it.
      if (!keep && state.previous) {
        const behind = state.previous.card;
        state.previous = { ...state.previous, card: 'style' in body ? { ...behind, look: body.look }
          : { ...behind, set: { ...behind.set!, crops: behind.set!.crops.map((crop, index) => index === body.slide ? body.crop : crop) } } };
      }
      if (keep) state.previous = { card, caption: post.caption! };
      state.current = { ...post, ...next, can_undo: !!state.previous, updated_at: new Date().toISOString() };
      return json(200, state.current);
    }
    return json(409, { detail: 'Not expected in this test.' });
  });
}

type Line = { text: string; rect: PageRect };

/** Opens test/fixtures/share-cards.pdf in the reader and returns each page's text lines as fractions of the page. */
async function openPaper(page: Page) {
  const project = await createProjectViaApi(page, 'Carousels');
  const source = (await (await page.request.post(`/api/projects/${project.id}/sources`, { data: { url: 'test/fixtures/share-cards.pdf', title: TITLE } })).json()) as { id: string };
  const readerUrl = `/projects/${project.id}/sources/${source.id}`;
  await page.goto(readerUrl);
  const lines: Record<number, Line[]> = {};
  for (const number of [1, 2, 3]) {
    const layer = page.locator(`[data-pdf-page="${number}"]`);
    await layer.scrollIntoViewIfNeeded();
    await expect(layer.locator('.textLayer span').first()).toBeVisible();
    lines[number] = await layer.evaluate(element => {
      const box = element.querySelector('.react-pdf__Page')!.getBoundingClientRect();
      return [...element.querySelectorAll('.textLayer span')].filter(span => span.textContent!.trim()).map(span => {
        const r = span.getBoundingClientRect();
        return { text: span.textContent!, rect: { x1: (r.left - box.left) / box.width, y1: (r.top - box.top) / box.height, x2: (r.right - box.left) / box.width, y2: (r.bottom - box.top) / box.height } };
      });
    });
  }
  return { project, source, lines, readerUrl };
}

async function highlight(page: Page, state: Fake, projectId: string, sourceId: string, pageNumber: number, text: string, rects: PageRect[], color: HighlightColor = 'yellow') {
  const box = { x1: Math.min(...rects.map(r => r.x1)), y1: Math.min(...rects.map(r => r.y1)), x2: Math.max(...rects.map(r => r.x2)), y2: Math.max(...rects.map(r => r.y2)) };
  const response = await page.request.post(`/api/projects/${projectId}/sources/${sourceId}/annotations`, { data: { page_number: pageNumber, ...box, rects, text, color } });
  expect(response.ok()).toBeTruthy();
  const id = (await response.json()).id as string;
  state.highlights.set(id, { id, page: pageNumber, rects, color, text });
  return id;
}

/**
 * The paper with four highlights that can make a post, made out of page order, and one too short to: p. 2 (green, the
 * line after the yellow one), p. 1 (yellow), p. 2 (yellow, two lines), p. 3 (blue), and "Too short." on p. 2.
 */
async function paper(page: Page, state: Fake) {
  await routePosts(page, state);
  const opened = await openPaper(page);
  const { project, source, lines } = opened;
  const add = (pageNumber: number, indexes: number[], color: HighlightColor) =>
    highlight(page, state, project.id, source.id, pageNumber, indexes.map(index => lines[pageNumber]![index]!.text).join('\n'), indexes.map(index => lines[pageNumber]![index]!.rect), color);
  const green = await add(2, [3], 'green');
  const first = await add(1, [0], 'yellow');
  const second = await add(2, [1, 2], 'yellow');
  const third = await add(3, [0], 'blue');
  await highlight(page, state, project.id, source.id, 2, 'Too short.', [lines[2]![5]!.rect], 'pink');
  return { ...opened, ids: { first, second, green, third } };
}

/** Opens the fake's carousel through a link, as the reader does after a reload. */
async function openCarousel(page: Page, state: Fake, readerUrl: string, ids: string[], projectId: string, sourceId: string | null) {
  state.current = setRecord(state, projectId, sourceId, ids);
  await page.goto(`${readerUrl}?post=${POST_ID}`);
  await expect(slide(page)).toHaveAttribute('data-slide', '1', { timeout: 20_000 });
}

const slide = (page: Page) => page.locator('img[data-slide]');
const position = (page: Page) => page.locator('[data-slide-position]');
const caption = (page: Page) => page.locator('[data-share-caption]');

/** Steps to slide `number` with Next, and waits for its picture. */
async function goTo(page: Page, number: number) {
  const current = Number(await slide(page).getAttribute('data-slide'));
  for (let at = current; at < number; at++) await page.getByRole('button', { name: 'Next slide' }).click();
  for (let at = current; at > number; at--) await page.getByRole('button', { name: 'Previous slide' }).click();
  await expect(slide(page)).toHaveAttribute('data-slide', String(number));
}

test.describe('carousels in the reader', () => {
  test.beforeEach(async ({ page }) => { await mockAuth(page); });

  test('choosing and ordering highlights with the pointer and the keyboard makes one start request', async ({ page }) => {
    test.setTimeout(60_000);
    const state = fake();
    const { ids, source } = await paper(page, state);
    await page.reload();
    await page.getByRole('button', { name: '✦ Post' }).click();
    await page.getByRole('button', { name: 'Share several highlights' }).click();
    const dialog = page.getByRole('dialog', { name: 'Share several highlights' });
    await expect(dialog).toBeVisible();
    // The PDF's highlights that can make a post, in page order; "Too short." is not offered.
    await expect(dialog.locator('[data-chooser-id]')).toHaveCount(4);
    expect(await dialog.locator('[data-chooser-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-chooser-id'))))
      .toEqual([ids.first, ids.second, ids.green, ids.third]);
    await expect(dialog.getByRole('checkbox', { name: /^Yellow highlight on page 1: Page one introduces/ })).toBeVisible();
    const create = dialog.getByRole('button', { name: 'Create carousel' });
    await expect(create).toBeDisabled();
    await expect(dialog.locator('[data-chooser-status]')).toHaveText('0 chosen. Choose at least 2.');

    // The pointer chooses the green one, the keyboard the first and the third.
    await dialog.locator(`[data-chooser-id="${ids.green}"]`).click();
    await expect(dialog.locator('[data-chooser-status]')).toHaveText('1 chosen. Choose at least 2.');
    await expect(create).toBeDisabled();
    await dialog.locator(`[data-chooser-id="${ids.first}"] input`).focus();
    await page.keyboard.press('Space');
    await dialog.locator(`[data-chooser-id="${ids.third}"] input`).focus();
    await page.keyboard.press('Space');
    await expect(dialog.locator('[data-chooser-status]')).toHaveText('3 chosen.');
    await expect(create).toBeEnabled();
    const order = () => dialog.locator('[data-chosen-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-chosen-id')));
    expect(await order()).toEqual([ids.green, ids.first, ids.third]);

    // Move the first highlight up with the pointer, then the third to the top with the keyboard.
    await dialog.getByRole('button', { name: /^Move up: p\. 1/ }).click();
    expect(await order()).toEqual([ids.first, ids.green, ids.third]);
    const third = dialog.getByRole('button', { name: /^Move up: p\. 3/ });
    await third.focus();
    await page.keyboard.press('Enter');
    await expect.poll(order).toEqual([ids.first, ids.third, ids.green]);
    await expect(third).toBeFocused();
    await page.keyboard.press('Enter');
    await expect.poll(order).toEqual([ids.third, ids.first, ids.green]);
    // At the top Move up does nothing, and the focus stays with that highlight.
    await expect(dialog.getByRole('button', { name: /^Move down: p\. 3/ })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Enter');
    expect(await order()).toEqual([ids.third, ids.first, ids.green]);

    await fs.promises.mkdir(SHOTS, { recursive: true });
    await create.click();
    await expect(dialog).toBeHidden();
    await expect.poll(() => state.starts.length).toBe(1);
    const body = state.starts[0]!;
    expect(body).toEqual({ request_id: expect.stringMatching(/^[0-9a-f-]{36}$/), source_id: source.id, annotation_ids: [ids.third, ids.first, ids.green], kind: 'set', destination: 'linkedin' });
    // The post opens on its cover; its first highlight slide is the third highlight's.
    await expect(slide(page)).toHaveAttribute('data-slide', '1', { timeout: 20_000 });
    await expect(position(page)).toHaveText('1 of 7 · Cover');
    expect(page.url()).toContain(`post=${POST_ID}`);
  });

  test('a carousel needs 2 to 8 highlights, and the action needs two that can make a post', async ({ page }) => {
    test.setTimeout(90_000);
    const state = fake();
    await routePosts(page, state);
    const { project, source, lines, readerUrl } = await openPaper(page);
    await highlight(page, state, project.id, source.id, 2, lines[2]![0]!.text, [lines[2]![0]!.rect]);
    await highlight(page, state, project.id, source.id, 2, 'Too short.', [lines[2]![1]!.rect]);
    await page.goto(readerUrl);
    await page.getByRole('button', { name: '✦ Post' }).click();
    await expect(page.getByRole('button', { name: 'Share a region' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Share several highlights' })).toHaveCount(0);

    // Nine highlights that can make a post: every line of the paper but one.
    for (const [number, indexes] of [[1, [0, 1]], [2, [2, 3, 4, 5]], [3, [0, 1]]] as const)
      for (const index of indexes) await highlight(page, state, project.id, source.id, number, lines[number]![index]!.text, [lines[number]![index]!.rect], 'green');
    await page.goto(readerUrl);
    await page.getByRole('button', { name: '✦ Post' }).click();
    await page.getByRole('button', { name: 'Share several highlights' }).click();
    const dialog = page.getByRole('dialog', { name: 'Share several highlights' });
    const boxes = dialog.getByRole('checkbox');
    await expect(boxes).toHaveCount(9);
    for (let index = 0; index < 9; index++) await boxes.nth(index).check();
    await expect(dialog.locator('[data-chooser-status]')).toHaveText('9 chosen. A carousel holds at most 8; remove 1.');
    await expect(dialog.getByRole('button', { name: 'Create carousel' })).toBeDisabled();
    await boxes.nth(4).uncheck();
    await expect(dialog.locator('[data-chooser-status]')).toHaveText('8 chosen.');
    await expect(dialog.getByRole('button', { name: 'Create carousel' })).toBeEnabled();
    for (let index = 0; index < 9; index++) if (index !== 2) await boxes.nth(index).uncheck();
    await expect(dialog.locator('[data-chooser-status]')).toHaveText('1 chosen. Choose at least 2.');
    await expect(dialog.getByRole('button', { name: 'Create carousel' })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    expect(state.starts).toEqual([]);
  });

  test('a refused start shows the server\'s message and keeps the choice for another try', async ({ page }) => {
    test.setTimeout(60_000);
    const state = fake();
    const { ids } = await paper(page, state);
    await page.reload();
    await page.getByRole('button', { name: '✦ Post' }).click();
    await page.getByRole('button', { name: 'Share several highlights' }).click();
    const dialog = page.getByRole('dialog', { name: 'Share several highlights' });
    await dialog.locator(`[data-chooser-id="${ids.first}"]`).click();
    await dialog.locator(`[data-chooser-id="${ids.second}"]`).click();
    state.refuse = { status: 422, detail: 'Highlight 2 is too short for a post.' };
    await dialog.getByRole('button', { name: 'Create carousel' }).click();
    await expect(page.getByRole('alert')).toHaveText('Highlight 2 is too short for a post.');
    await expect(page.locator('img[data-slide]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Share several highlights' }).click();
    await expect(dialog.locator('[data-chooser-status]')).toHaveText('2 chosen.');
    await dialog.getByRole('button', { name: 'Create carousel' }).click();
    await expect(slide(page)).toHaveAttribute('data-slide', '1', { timeout: 20_000 });
    expect(state.starts.map(start => start.annotation_ids)).toEqual([[ids.first, ids.second], [ids.first, ids.second]]);
    // A refusal is final, so its request ID is forgotten: the try again is a new request.
    expect(state.starts[1]!.request_id).not.toBe(state.starts[0]!.request_id);
    expect(await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith('pdfpal:share-card-request:')))).toEqual([]);
  });

  test('stepping through the slides with buttons and keys, with and without the study and the limits', async ({ page }) => {
    test.setTimeout(60_000);
    const state = fake();
    const { ids, project, source, readerUrl } = await paper(page, state);
    await openCarousel(page, state, readerUrl, [ids.first, ids.second, ids.third], project.id, source.id);
    // Cover, study, three highlights, takeaway, limits.
    await expect(slide(page)).toHaveAttribute('data-slide-count', '7');
    await expect(position(page)).toHaveText('1 of 7 · Cover');
    await expect(slide(page)).toHaveAttribute('alt', `Slide 1 of 7, cover: ${WORDS.headline}`);
    await expect(page.getByRole('button', { name: 'Previous slide' })).toHaveAttribute('aria-disabled', 'true');
    const cover = await slide(page).getAttribute('src');

    await page.getByRole('button', { name: 'Next slide' }).click();
    await expect(slide(page)).toHaveAttribute('alt', `Slide 2 of 7, the study: ${WORDS.study}`);
    await expect(position(page)).toHaveText('2 of 7 · The study');
    await page.getByRole('button', { name: 'Next slide' }).click();
    await expect(slide(page)).toHaveAttribute('alt', `Slide 3 of 7, highlight 1: ${point(0)}`);
    // A highlight slide: its claim above that highlight's page, with every highlight on the page inside the crop.
    await expect(slide(page)).toHaveAttribute('data-share-card', 'headline/ink');
    await expect(slide(page)).toHaveAttribute('data-share-marks', '1');

    const viewer = page.locator('[data-slide-viewer]');
    await viewer.focus();
    await page.keyboard.press('ArrowRight');
    await expect(slide(page)).toHaveAttribute('data-slide', '4');
    // The second highlight's page holds three highlights; the green and the pink are next to it.
    await expect(slide(page)).toHaveAttribute('data-share-marks', /^[23]$/);
    await page.keyboard.press('End');
    await expect(slide(page)).toHaveAttribute('alt', `Slide 7 of 7, limits: ${WORDS.limitations}`);
    await expect(page.getByRole('button', { name: 'Next slide' })).toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.press('ArrowRight');
    await expect(position(page)).toHaveText('7 of 7 · Limits');
    await page.keyboard.press('ArrowLeft');
    await expect(slide(page)).toHaveAttribute('alt', `Slide 6 of 7, the takeaway: ${WORDS.takeaway}`);
    await page.keyboard.press('Home');
    await expect(slide(page)).toHaveAttribute('data-slide', '1');
    // Kept: stepping back shows the very same picture.
    expect(await slide(page).getAttribute('src')).toBe(cover);

    // Without a study or limits, two highlights make four slides; the text is the same kind of post.
    state.study = false; state.limitations = false;
    await openCarousel(page, state, readerUrl, [ids.first, ids.third], project.id, source.id);
    await expect(slide(page)).toHaveAttribute('data-slide-count', '4');
    const kinds: string[] = [];
    for (let number = 1; number <= 4; number++) { await goTo(page, number); kinds.push((await slide(page).getAttribute('data-slide-kind'))!); }
    expect(kinds).toEqual(['cover', 'point', 'point', 'takeaway']);
    await expect(caption(page)).toHaveText(captionText(state.current!.source, state.current!.caption!));
    await expect(page.getByRole('radio', { name: 'Page' })).toHaveCount(0);
    await expect(page.getByText('Text cards')).toHaveCount(0);
    await page.getByRole('button', { name: 'More post actions' }).click();
    await expect(page.getByRole('menuitem', { name: 'Edit quote' })).toHaveCount(0);
  });

  test('editing a point and the cover, removing the study slide, and Undo', async ({ page }) => {
    test.setTimeout(60_000);
    const state = fake();
    const { ids, project, source, readerUrl } = await paper(page, state);
    await openCarousel(page, state, readerUrl, [ids.first, ids.second, ids.third], project.id, source.id);

    await goTo(page, 3);
    await page.getByRole('button', { name: 'Edit slide' }).click();
    let dialog = page.getByRole('dialog', { name: 'Edit slide 3 of 7: Highlight 1' });
    const claim = dialog.getByRole('textbox', { name: 'Claim' });
    await expect(claim).toHaveValue(point(0));
    await expect(dialog.getByText('Up to 70 characters.')).toBeVisible();
    await claim.fill('c'.repeat(90));
    await expect(claim).toHaveValue('c'.repeat(70));
    await claim.fill('Doubling the input quadruples the work');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(slide(page)).toHaveAttribute('alt', 'Slide 3 of 7, highlight 1: Doubling the input quadruples the work');
    expect(state.patches.at(-1)).toEqual({ set_text: { field: 'point', index: 0, text: 'Doubling the input quadruples the work' } });

    await goTo(page, 1);
    await page.getByRole('button', { name: 'Edit slide' }).click();
    dialog = page.getByRole('dialog', { name: 'Edit slide 1 of 7: Cover' });
    await dialog.getByRole('textbox', { name: 'Headline' }).fill('Reach costs more than it looks');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(slide(page)).toHaveAttribute('alt', 'Slide 1 of 7, cover: Reach costs more than it looks');
    expect(state.patches.at(-1)).toEqual({ headline: 'Reach costs more than it looks' });

    await goTo(page, 2);
    await page.getByRole('button', { name: 'Edit slide' }).click();
    dialog = page.getByRole('dialog', { name: 'Edit slide 2 of 7: The study' });
    await expect(dialog.getByText('Leave it empty to remove this slide; Undo brings it back.')).toBeVisible();
    await dialog.getByRole('textbox', { name: 'The study' }).fill('');
    await dialog.getByRole('button', { name: 'Remove slide' }).click();
    expect(state.patches.at(-1)).toEqual({ set_text: { field: 'study', text: '' } });
    await expect(page.getByText('The study slide was removed.')).toBeVisible();
    await expect(slide(page)).toHaveAttribute('data-slide-count', '6');
    await expect(slide(page)).toHaveAttribute('alt', `Slide 2 of 6, highlight 1: Doubling the input quadruples the work`);
    await page.locator('[aria-live="polite"]').getByRole('button', { name: 'Undo' }).click();
    await expect(slide(page)).toHaveAttribute('data-slide-count', '7');
    await expect(slide(page)).toHaveAttribute('alt', `Slide 2 of 7, the study: ${WORDS.study}`);
  });

  test('a highlight slide\'s crop is saved with its highlight\'s index and reset; the looks change every slide', async ({ page }) => {
    test.setTimeout(60_000);
    const state = fake();
    const { ids, project, source, readerUrl } = await paper(page, state);
    await openCarousel(page, state, readerUrl, [ids.first, ids.second, ids.third], project.id, source.id);
    // Slide 4 is the second highlight's (index 1), on page 2.
    await goTo(page, 4);
    await expect(slide(page)).toHaveAttribute('data-share-crop', /\d/);
    const automatic = (await slide(page).getAttribute('data-share-crop'))!;
    await expect(page.getByText('Automatic crop')).toBeVisible();
    await page.getByRole('button', { name: 'Adjust crop' }).click();
    const dialog = page.getByRole('dialog', { name: 'Adjust crop: highlight 2' });
    await expect(dialog).toHaveAttribute('data-state', 'ready');
    // The editor shows the item's page with its highlights: the yellow (two lines), the green and the pink.
    await expect(page.locator('[data-crop-mark]')).toHaveCount(4);
    await expect(page.locator('[data-crop-box]')).toBeFocused();
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Shift+ArrowDown');
    const chosen = (await page.locator('[data-crop-box]').getAttribute('data-crop'))!;
    await dialog.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByText('Crop saved.')).toBeVisible();
    const saved = state.patches.at(-1)!;
    expect(saved.slide).toBe(1);
    expect([saved.crop.x1, saved.crop.y1, saved.crop.x2, saved.crop.y2].map((value: number) => value.toFixed(4)).join(',')).toBe(chosen);
    await expect(slide(page)).toHaveAttribute('data-share-crop', chosen);
    await expect(page.getByText('Your crop')).toBeVisible();
    // The other highlight slides keep their automatic crops.
    expect(state.current!.card!.set!.crops).toEqual([null, saved.crop, null]);

    await page.getByRole('button', { name: 'Adjust crop' }).click();
    await expect(dialog).toHaveAttribute('data-state', 'ready');
    await dialog.getByRole('button', { name: 'Reset to automatic' }).click();
    await expect(page.getByText('Back to the automatic crop.')).toBeVisible();
    expect(state.patches.at(-1)).toEqual({ crop: null, slide: 1 });
    await expect(slide(page)).toHaveAttribute('data-share-crop', automatic);

    // The looks: one choice for every slide.
    await page.getByRole('radio', { name: 'Paper look' }).click();
    await expect(slide(page)).toHaveAttribute('data-share-card', 'headline/paper');
    expect(state.patches.at(-1)).toEqual({ style: 'headline', look: 'paper' });
    await goTo(page, 1);
    await expect(slide(page)).toHaveAttribute('data-share-card', 'idea/paper');
    await page.getByRole('radio', { name: 'Marker look' }).click();
    await expect(slide(page)).toHaveAttribute('data-share-card', 'idea/marker');
  });

  test('the slide in view is copied and saved; all slides are saved as a ZIP and as a PDF', async ({ page, context }) => {
    test.setTimeout(90_000);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const state = fake();
    const { ids, project, source, readerUrl } = await paper(page, state);
    await openCarousel(page, state, readerUrl, [ids.first, ids.second, ids.third], project.id, source.id);
    await expect(page.getByText('LinkedIn takes the PDF as a document post: one page per slide.')).toBeVisible();

    await goTo(page, 3);
    await page.getByRole('button', { name: 'Copy slide' }).click();
    await expect(page.getByText('Slide copied. Paste it into your post.')).toBeVisible();
    expect(await page.evaluate(async () => (await navigator.clipboard.read())[0]!.types)).toContain('image/png');
    let download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save slide' }).click();
    let file = await download;
    expect(file.suggestedFilename()).toBe(slideFileName(TITLE, 3, 7));
    const png = fs.readFileSync((await file.path())!);
    expect({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) }).toEqual({ width: 1080, height: 1350 });

    download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save all slides (ZIP)' }).click();
    file = await download;
    expect(file.suggestedFilename()).toBe(carouselFileName(TITLE, 'zip'));
    expect(file.suggestedFilename()).toBe('pdfpal-share-card-paper-carousel.zip');
    expect(zipNames(fs.readFileSync((await file.path())!))).toEqual(Array.from({ length: 7 }, (_, index) => slideFileName(TITLE, index + 1, 7)));
    await expect(page.getByText('All slides saved as a ZIP.')).toBeVisible();

    download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save as PDF' }).click();
    file = await download;
    expect(file.suggestedFilename()).toBe('pdfpal-share-card-paper-carousel.pdf');
    expect(pdfPages(fs.readFileSync((await file.path())!))).toBe(7);
    await expect(page.getByText('Carousel saved as a PDF.')).toBeVisible();
    expect(state.patches).toEqual([]);
  });

  test('the post lists say Carousel, and the Highlights tab opens one on its first highlight\'s page', async ({ page }) => {
    test.setTimeout(60_000);
    const state = fake();
    const { ids, project, source, readerUrl } = await paper(page, state);
    state.current = setRecord(state, project.id, source.id, [ids.third, ids.first]);
    await page.goto(readerUrl);
    await page.getByRole('button', { name: '✦ Post' }).click();
    const item = page.getByRole('button', { name: new RegExp(WORDS.headline) });
    await expect(item).toContainText('Carousel');
    await expect(item).not.toContainText('Highlight deleted');

    await page.goto(`/projects/${project.id}`);
    await page.getByRole('tab', { name: /Highlights/ }).click();
    const listed = page.locator(`[data-post-id="${POST_ID}"]`);
    await expect(listed).toContainText('Carousel');
    await expect(listed).toContainText('p. 3');
    await listed.click();
    await expect(page).toHaveURL(new RegExp(`/sources/${source.id}\\?post=${POST_ID}`));
    await expect(slide(page)).toHaveAttribute('data-slide', '1', { timeout: 20_000 });
    await expect(page.locator('[data-pdf-page="3"]')).toBeInViewport({ ratio: 0.3 });
  });
});

test.describe('a carousel whose PDF was removed', () => {
  test.beforeEach(async ({ page }) => { await mockAuth(page); });

  test('draws its highlight slides without the page and says why', async ({ page }) => {
    test.setTimeout(60_000);
    const state = fake();
    await routePosts(page, state);
    const project = await createProjectViaApi(page, 'Removed carousel');
    const box = (top: number): PageRect[] => [{ x1: 0.1, y1: top, x2: 0.9, y2: top + 0.02 }];
    state.highlights.set('a', { id: 'a', page: 2, rects: box(0.2), color: 'yellow', text: 'Attention lets every position look at every other position.' });
    state.highlights.set('b', { id: 'b', page: 3, rects: box(0.3), color: 'green', text: 'The cost grows with the square of the sequence length.' });
    state.current = setRecord(state, project.id, null, ['a', 'b']);
    await page.goto(`/projects/${project.id}`);
    await page.getByRole('tab', { name: /Highlights/ }).click();
    await expect(page.locator(`[data-post-id="${POST_ID}"]`)).toContainText('PDF removed');
    await page.locator(`[data-post-id="${POST_ID}"]`).click();
    await expect(slide(page)).toHaveAttribute('data-slide', '1', { timeout: 20_000 });
    await expect(page.getByText('The PDF for this post was removed. Highlight slides show their claim without the page.')).toBeVisible();
    await goTo(page, 3);
    await expect(slide(page)).toHaveAttribute('data-slide-kind', 'point');
    await expect(slide(page)).toHaveAttribute('data-share-card', 'idea/ink');
    await expect(page.getByRole('button', { name: 'Adjust crop' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Edit slide' })).toBeVisible();
    const overflow = await page.locator('[data-share-post]').evaluate(element => element.scrollWidth - element.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

// ── For review: the carousel in a narrow and a wider side column ────────────────────────────────────────────────────
test.describe('carousels: fixes from the review', () => {
  test.beforeEach(async ({ page }) => { await mockAuth(page); });

  test('a highlight slide too tall for an automatic crop can be given a crop', async ({ page }) => {
    test.setTimeout(60_000);
    const state = fake();
    await routePosts(page, state);
    const project = await createProjectViaApi(page, 'Tall carousel');
    const source = (await (await page.request.post(`/api/projects/${project.id}/sources`, { data: { url: tallPdf(), title: TITLE } })).json()) as { id: string };
    const readerUrl = `/projects/${project.id}/sources/${source.id}`;
    await page.goto(readerUrl);
    const layer = page.locator('[data-pdf-page="1"]');
    await expect(layer.locator('.textLayer span').first()).toBeVisible();
    const rects: PageRect[] = await layer.evaluate(element => {
      const box = element.querySelector('.react-pdf__Page')!.getBoundingClientRect();
      return [...element.querySelectorAll('.textLayer span')].filter(span => span.textContent!.trim()).map(span => {
        const r = span.getBoundingClientRect();
        return { x1: (r.left - box.left) / box.width, y1: (r.top - box.top) / box.height, x2: (r.right - box.left) / box.width, y2: (r.bottom - box.top) / box.height };
      });
    });
    // One highlight over the whole page, and one over its first line.
    const tall = await highlight(page, state, project.id, source.id, 1, 'Every line of a page full of text, from the top to the bottom.', rects);
    const short = await highlight(page, state, project.id, source.id, 1, 'The first line of the page, on its own.', [rects[0]!], 'green');
    await openCarousel(page, state, readerUrl, [short, tall], project.id, source.id);
    await goTo(page, 4);
    await expect(slide(page)).toHaveAttribute('data-slide-kind', 'point');
    await expect(slide(page)).toHaveAttribute('data-share-card', 'idea/ink');
    await expect(page.getByText('This highlight is too tall for an automatic crop. Adjust the crop to show part of it.')).toBeVisible();
    await page.getByRole('button', { name: 'Adjust crop' }).click();
    const dialog = page.getByRole('dialog', { name: 'Adjust crop: highlight 2' });
    await expect(dialog).toHaveAttribute('data-state', 'ready');
    const start = cropBox(rects, 0);
    const shown = (await page.locator('[data-crop-box]').getAttribute('data-crop'))!.split(',').map(Number);
    [start.x1, start.y1, start.x2, start.y2].forEach((value, index) => expect(Math.abs(value - shown[index]!)).toBeLessThan(0.002));
    await dialog.getByRole('button', { name: 'Bottom edge' }).focus();
    for (let i = 0; i < 12; i++) await page.keyboard.press('Shift+ArrowUp');
    const chosen = (await page.locator('[data-crop-box]').getAttribute('data-crop'))!;
    await dialog.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByText('Crop saved.')).toBeVisible();
    expect(state.patches.at(-1)!.slide).toBe(1);
    await expect(slide(page)).toHaveAttribute('data-share-card', 'headline/ink');
    await expect(slide(page)).toHaveAttribute('data-share-crop', chosen);
    await expect(page.getByText(/too tall for an automatic crop/)).toHaveCount(0);
  });

  test('closing a carousel while its slides are drawn leaves no picture behind', async ({ page }) => {
    test.setTimeout(60_000);
    await page.addInitScript(() => {
      const w = window as unknown as { __urls: Set<string> };
      w.__urls = new Set();
      const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
      URL.createObjectURL = (object: Blob | MediaSource) => { const url = create(object); w.__urls.add(url); return url; };
      URL.revokeObjectURL = (url: string) => { w.__urls.delete(url); revoke(url); };
    });
    const state = fake();
    const { ids, project, source, readerUrl } = await paper(page, state);
    let fonts = 0;
    await page.route('**/fonts/**', async route => { fonts++; await new Promise(resolve => setTimeout(resolve, 2500)); await route.continue(); });
    state.current = setRecord(state, project.id, source.id, [ids.first, ids.second]);
    await page.goto(`${readerUrl}?post=${POST_ID}`);
    await expect(position(page)).toHaveText('1 of 6 · Cover');
    await expect.poll(() => fonts).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'All posts' }).click();
    await expect(page.getByRole('heading', { name: 'Posts' })).toBeVisible();
    await page.waitForTimeout(5000);
    expect(await page.evaluate(() => (window as unknown as { __urls: Set<string> }).__urls.size)).toBe(0);
  });
});

test.describe('carousels, for review', () => {
  test.beforeEach(async ({ page }) => { await mockAuth(page); });

  test('the chooser, the slides, the edit dialog and the export row at 360 and 480 px, and a removed PDF', async ({ page }) => {
    test.setTimeout(180_000);
    fs.mkdirSync(SHOTS, { recursive: true });
    const state = fake();
    await page.setViewportSize({ width: 806, height: 1000 });
    const { ids, project, source, readerUrl } = await paper(page, state);
    for (const width of [360, 480]) {
      const name = (what: string) => path.join(SHOTS, `${width}-${what}.png`);
      const viewport = Math.round((width + 5) / 0.45);
      await page.setViewportSize({ width: viewport, height: 1000 });
      state.current = null;
      await page.goto(readerUrl);
      await page.getByRole('button', { name: '✦ Post' }).click();
      const panel = page.locator('[data-share-post]');
      await page.getByRole('button', { name: 'Share several highlights' }).click();
      const dialog = page.getByRole('dialog', { name: 'Share several highlights' });
      for (const id of [ids.third, ids.first, ids.second]) await dialog.locator(`[data-chooser-id="${id}"]`).click();
      await page.screenshot({ path: name('chooser') });
      await dialog.getByRole('button', { name: 'Cancel' }).click();

      await page.setViewportSize({ width: viewport, height: 2200 });
      await openCarousel(page, state, readerUrl, [ids.first, ids.second, ids.third], project.id, source.id);
      const column = (await panel.boundingBox())!.width;
      expect(Math.abs(column - width)).toBeLessThanOrEqual(4);
      const overflow = () => panel.evaluate(element => element.scrollWidth - element.clientWidth);
      expect(await overflow()).toBeLessThanOrEqual(0);
      await panel.screenshot({ path: name('cover') });
      await goTo(page, 3);
      await panel.screenshot({ path: name('highlight-slide') });
      await goTo(page, 6);
      await panel.screenshot({ path: name('text-slide') });
      await goTo(page, 2);
      await page.getByRole('button', { name: 'Edit slide' }).click();
      await page.setViewportSize({ width: viewport, height: 900 });
      await page.screenshot({ path: name('edit-dialog') });
      await page.getByRole('dialog', { name: /^Edit slide/ }).getByRole('button', { name: 'Cancel' }).click();
      await page.setViewportSize({ width: viewport, height: 2200 });
      await page.getByRole('button', { name: 'Save as PDF' }).scrollIntoViewIfNeeded();
      await page.getByRole('button', { name: 'Save as PDF' }).locator('xpath=../..').screenshot({ path: name('export-row') });
      expect(await overflow()).toBeLessThanOrEqual(0);
    }

    // A removed PDF, in the Highlights tab's side panel.
    const removed = await createProjectViaApi(page, 'Removed carousel');
    state.current = setRecord(state, removed.id, null, [ids.first, ids.second, ids.third]);
    await page.setViewportSize({ width: 1100, height: 2200 });
    await page.goto(`/projects/${removed.id}`);
    await page.getByRole('tab', { name: /Highlights/ }).click();
    await page.locator(`[data-post-id="${POST_ID}"]`).click();
    await goTo(page, 3);
    await page.locator('[data-share-post]').screenshot({ path: path.join(SHOTS, 'removed-pdf.png') });
  });
});
