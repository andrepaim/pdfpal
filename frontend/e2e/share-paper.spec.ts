import { test, expect, type Page, type Route } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {
  DESTINATION_DEFAULTS, PAPER,
  type CardContent, type Caption, type Destination, type PageRect, type PaperContent, type ShareCardRecord,
} from '../../src/shared/share-card';
import { carouselFileName, slideFileName } from '../src/lib/share-card/export';
import { pdfPages, zipNames } from './export-files';
import { mockAuth, createProjectViaApi } from './helpers';

// "Share the paper": a post about the paper as a whole, started with one click from the first page's title, authors
// and abstract. The project and the PDF (test/fixtures/share-regions.pdf, whose page 1 is a paper's first page) are
// real; the share-card routes are answered by the small fake below, so no assistant is involved.

const SHOTS = path.resolve('test-results/share-paper');
const POST_ID = '5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b';
const TITLE = 'Sparse Attention at a Fraction of the Cost';
const HEADLINE = 'A third of the cost keeps nearly all of the quality';
const TAKEAWAY = 'Long documents no longer force a choice between cost and recall.';
const PAPER_WORDS: PaperContent = {
  question: 'Can a sparse attention pattern keep the quality of full attention on long documents at a fraction of its cost?',
  method: 'Three long-document benchmarks, comparing a fixed window with a few global positions against full attention.',
  results: ['98% of the quality of full attention at a third of the cost.', 'Training needs no change to the optimiser or the learning-rate schedule.'],
};

type Version = { card: CardContent; caption: Caption };
type Fake = {
  current: ShareCardRecord | null
  previous: Version | null
  /** How many results a paper post is written with; 0 writes it as a post stored before papers had their own slides. */
  results: number
  /** While set, a running generation stays running. */
  hold: boolean
  /** When set, the next start is refused with this status and message. */
  refuse?: { status: number; detail: string }
  starts: Record<string, any>[]
  changes: Record<string, any>[]
  patches: Record<string, any>[]
};
const fake = (): Fake => ({ current: null, previous: null, results: 2, hold: false, starts: [], changes: [], patches: [] });

function drafts(destination: Destination): Caption['drafts'] {
  if (destination === 'x') return { finding: 'Can sparse attention keep full quality on long documents? On three benchmarks it kept 98% at a third of the cost.', contrast: '', caveat: '' };
  const body = 'The authors compare a fixed window with a few global positions against full attention on three long-document benchmarks.\n\nThe sparse pattern keeps 98% of the quality at a third of the cost, and trains with the same schedule.';
  return { finding: `Can long documents be read without paying for every pair of positions?\n\n${body}`, contrast: '', caveat: `The benchmarks are long documents only.\n\n${body}` };
}

/** A paper post as the server returns it once written: `results` results, or none of the paper's own slides. */
function paperRecord(projectId: string, sourceId: string | null, region: PageRect, text: string, destination: Destination, results: number): ShareCardRecord {
  const defaults = DESTINATION_DEFAULTS[destination];
  const card: CardContent = {
    quote: '', quoteEdited: false, emphasis: '', headline: HEADLINE, pull: '', topic: 'Attention', takeawaysTitle: '', takeaways: [], style: defaults.style, look: 'ink',
    crop: region, set: null, takeaway: TAKEAWAY, paper: results ? { ...PAPER_WORDS, results: PAPER_WORDS.results.slice(0, results) } : null,
  };
  return {
    id: POST_ID, project_id: projectId, source_id: sourceId, annotation_id: null, status: 'complete', can_undo: false, instruction: '', error: null,
    created_at: '2026-11-16T10:00:00.000Z', updated_at: '2026-11-16T10:00:01.000Z', destination, take: '', marks: [], set_marks: [],
    source: { version: 1, kind: 'paper', passage: text, page: 1, rects: [], color: 'yellow', region, items: [], context: '', title: TITLE, credit: 'Lovelace and Turing, 2026', url: 'https://example.org/sparse-attention' },
    card, caption: { destination, take: '', drafts: drafts(destination), angle: 'finding', hashtags: ['attention', 'research', 'ml'], showTags: defaults.showTags, link: 'post', edited: null },
  };
}

/** Answers the share-card routes from `state`, as the server does for paper posts. */
async function routePosts(page: Page, state: Fake) {
  await page.route('**/api/projects/*/share-cards**', async (route: Route) => {
    const request = route.request(), url = new URL(request.url()), tail = url.pathname.split('/share-cards')[1] ?? '';
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const body = (request.postDataJSON() ?? {}) as Record<string, any>;
    const projectId = url.pathname.split('/')[3]!;
    if (request.method() === 'POST' && tail === '') {
      state.starts.push(body);
      // The answer comes a moment later, as a real request's does, so a second click would find the first in flight.
      await new Promise(resolve => setTimeout(resolve, 300));
      if (state.refuse) { const { status, detail } = state.refuse; state.refuse = undefined; return json(status, { detail }); }
      state.current = { ...paperRecord(projectId, body.source_id, body.region, body.text, body.destination, state.results), status: 'running', card: null, caption: null };
      return json(202, state.current);
    }
    if (request.method() === 'GET' && tail === '') {
      const post = state.current;
      return json(200, post ? [{ id: post.id, status: post.status, annotation_id: null, source_id: post.source_id, page: post.source.page, kind: 'paper',
        title: post.card?.headline || 'Paper', updated_at: post.updated_at }] : []);
    }
    const post = state.current;
    if (!post || tail.split('/')[1] !== post.id) return json(404, { detail: 'Post not found.' });
    const touched = () => new Date().toISOString();
    if (request.method() === 'GET') {
      if (post.status === 'running' && !state.hold) {
        const before = post.card && post.caption ? { card: post.card, caption: post.caption } : null;
        const next = paperRecord(projectId, post.source_id, post.source.region!, post.source.passage, post.destination, 2);
        // A rewrite keeps the look and the crop; a new destination takes its default style.
        const card = before ? { ...next.card!, look: before.card.look, crop: before.card.crop, style: before.caption.destination === post.destination ? before.card.style : next.card!.style } : next.card!;
        if (before) state.previous = before;
        state.current = { ...post, card, caption: next.caption, status: 'complete', can_undo: !!state.previous, updated_at: touched() };
      }
      return json(200, state.current);
    }
    if (tail.endsWith('/change')) {
      state.changes.push(body);
      state.current = { ...post, status: 'running', destination: body.destination ?? post.destination, take: body.take ?? post.take };
      return json(202, state.current);
    }
    if (tail.endsWith('/undo')) {
      const back = state.previous!;
      state.previous = null;
      state.current = { ...post, ...back, destination: back.caption.destination, take: back.caption.take, can_undo: false, updated_at: touched() };
      return json(200, state.current);
    }
    if (request.method() === 'PATCH') {
      state.patches.push(body);
      const card = post.card!, caption = post.caption!;
      let next: Version = { card, caption }, keep = false;
      if ('style' in body) {
        if (!['page', 'headline', 'carousel'].includes(body.style)) return json(400, { detail: 'A post about the paper has no quote or takeaways, so it uses the Page, Headline or Carousel style.' });
        next = { card: { ...card, style: body.style, look: body.look }, caption };
      } else if ('crop' in body) next = { card: { ...card, crop: body.crop ?? post.source.region }, caption };
      else if ('headline' in body) { next = { card: { ...card, headline: body.headline }, caption }; keep = true; }
      else if ('takeaway' in body) { next = { card: { ...card, takeaway: body.takeaway }, caption }; keep = true; }
      else if ('paper_text' in body) {
        const { field, index, text } = body.paper_text as { field: 'question' | 'method' | 'result'; index?: number; text: string };
        if (!card.paper) return json(400, { detail: 'This post has no question, method or results yet. Rewrite it first.' });
        if (field === 'result' && (index === undefined || index >= card.paper.results.length)) return json(400, { detail: `This post has no result ${(index ?? 0) + 1}.` });
        const paper = field === 'result' ? { ...card.paper, results: card.paper.results.map((value, at) => at === index ? text : value) } : { ...card.paper, [field]: text };
        next = { card: { ...card, paper }, caption }; keep = true;
      } else return json(400, { detail: 'Not expected in this test.' });
      if (keep) state.previous = { card, caption };
      state.current = { ...post, ...next, can_undo: !!state.previous, updated_at: touched() };
      return json(200, state.current);
    }
    if (request.method() === 'DELETE') { state.current = null; return route.fulfill({ status: 204 }); }
    return json(409, { detail: 'Not expected in this test.' });
  });
}

type Line = { text: string; rect: PageRect };

/** Opens the fixture in the reader on its first page, and returns that page's text-layer lines as page fractions. */
async function openPaper(page: Page) {
  const project = await createProjectViaApi(page, 'Paper posts');
  const source = await (await page.request.post(`/api/projects/${project.id}/sources`, { data: { url: 'test/fixtures/share-regions.pdf', title: TITLE } })).json() as { id: string };
  const url = `/projects/${project.id}/sources/${source.id}`;
  await page.goto(url);
  const layer = page.locator('[data-pdf-page="1"]');
  await layer.scrollIntoViewIfNeeded();
  await expect(layer.locator('.textLayer span').first()).toBeVisible();
  const lines: Line[] = await layer.evaluate(element => {
    const box = element.querySelector('.react-pdf__Page')!.getBoundingClientRect();
    return [...element.querySelectorAll('.textLayer span')].filter(span => span.textContent!.trim()).map(span => {
      const r = span.getBoundingClientRect();
      return { text: span.textContent!, rect: { x1: (r.left - box.left) / box.width, y1: (r.top - box.top) / box.height, x2: (r.right - box.left) / box.width, y2: (r.bottom - box.top) / box.height } };
    });
  });
  return { project, source, url, lines };
}

/** The title, authors and abstract box the reader works out for page 1 of the fixture. */
const FIRST_PAGE: PageRect = { x1: 0.08, y1: 0.06, x2: 0.92, y2: 0.3 };
const postTab = (page: Page) => page.getByRole('button', { name: '✦ Post', exact: true });
const card = (page: Page) => page.locator('img[data-share-card]:not([data-slide])');
const slide = (page: Page) => page.locator('img[data-slide]');
const position = (page: Page) => page.locator('[data-slide-position]');
const fixed = (region: PageRect) => [region.x1, region.y1, region.x2, region.y2].map(value => value.toFixed(4)).join(',');
const inside = (inner: PageRect, outer: PageRect) => inner.x1 >= outer.x1 && inner.y1 >= outer.y1 && inner.x2 <= outer.x2 && inner.y2 <= outer.y2;

/** Opens the fake's paper post through a link, as the reader does after a reload. */
async function openPost(page: Page, state: Fake, url: string, ids: { project: string; source: string | null }, destination: Destination, results = 2) {
  state.current = paperRecord(ids.project, ids.source, FIRST_PAGE, TITLE, destination, results);
  await page.goto(`${url}?post=${POST_ID}`);
}

async function goTo(page: Page, number: number) {
  const current = Number(await slide(page).getAttribute('data-slide'));
  for (let at = current; at < number; at++) await page.getByRole('button', { name: 'Next slide' }).click();
  for (let at = current; at > number; at--) await page.getByRole('button', { name: 'Previous slide' }).click();
  await expect(slide(page)).toHaveAttribute('data-slide', String(number));
}

async function noSideScroll(page: Page) {
  const overflow = await page.locator('[data-share-post]').evaluate(element => element.scrollWidth - element.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe('share the paper', () => {
  test.beforeEach(async ({ page }) => { await mockAuth(page); });

  test('one click starts a paper post from the first page\'s title, authors and abstract, with no modal', async ({ page }) => {
    test.setTimeout(60_000);
    const state = fake();
    await routePosts(page, state);
    const { source, lines } = await openPaper(page);
    await postTab(page).click();
    await expect(page.getByRole('button', { name: 'Share the first page' })).toHaveCount(0);
    await expect(page.locator('#share-region-hint')).toHaveText('A figure or passage on page 1; or the paper: its question, method and results.');
    // A double click starts one post.
    await page.getByRole('button', { name: 'Share the paper' }).dblclick();
    await expect(page.getByText('Starting your post…')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(card(page)).toHaveAttribute('data-share-card', 'page/ink', { timeout: 20_000 });
    await page.waitForTimeout(500);
    expect(state.starts).toHaveLength(1);
    const body = state.starts[0]!;
    expect(body).toMatchObject({ kind: 'paper', page: 1, source_id: source.id, destination: 'linkedin' });
    expect(Object.keys(body).sort()).toEqual(['destination', 'kind', 'page', 'region', 'request_id', 'source_id', 'text']);
    const line = (text: string) => lines.find(entry => entry.text.includes(text))!.rect;
    for (const text of [TITLE, 'Ada Lovelace', 'Abstract', 'Full attention lets every position', 'learning-rate schedule.'])
      expect(inside(line(text), body.region), `${text} inside the box`).toBe(true);
    expect(body.region.y2).toBeLessThan(line('1 Introduction').y1);
    expect(body.text.split('\n')[0]).toBe(TITLE);
    expect(body.text).toContain('Abstract');
    expect(body.text).not.toContain('Introduction');
    // On LinkedIn a paper post opens on the Page style, with Carousel one click away.
    await expect(page.getByRole('radiogroup', { name: 'Card style' }).getByRole('radio')).toHaveText(['Page', 'Headline', 'Carousel']);
    await expect(page.getByRole('radio', { name: 'Page', exact: true })).toHaveAttribute('aria-checked', 'true');
    await expect(card(page)).toHaveAttribute('data-share-crop', fixed(body.region));
    await page.getByRole('radio', { name: 'Carousel' }).click();
    expect(state.patches.at(-1)).toEqual({ style: 'carousel', look: 'ink' });
    await expect(slide(page)).toHaveAttribute('data-slide-count', '6', { timeout: 20_000 });
    // The post list calls it a paper.
    await page.getByRole('button', { name: 'All posts' }).click();
    await expect(page.getByRole('button', { name: new RegExp(HEADLINE) })).toContainText('p. 1 · Paper');
  });

  test('a refused start shows its message and opens nothing', async ({ page }) => {
    test.setTimeout(60_000);
    const state = fake();
    await routePosts(page, state);
    await openPaper(page);
    await postTab(page).click();
    state.refuse = { status: 422, detail: 'Posts can be made from PDFs only.' };
    await page.getByRole('button', { name: 'Share the paper' }).click();
    await expect(page.getByRole('alert')).toHaveText('Posts can be made from PDFs only.');
    await expect(page.getByRole('heading', { name: 'Posts' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Share the paper' })).not.toHaveAttribute('aria-disabled', 'true');
    expect(state.starts).toHaveLength(1);
  });

  test('on Instagram the paper is six slides: the paper, the question, the method, two results and the takeaway', async ({ page }) => {
    test.setTimeout(60_000);
    const state = fake();
    await routePosts(page, state);
    const { project, source, url } = await openPaper(page);
    await openPost(page, state, url, { project: project.id, source: source.id }, 'instagram');
    await expect(slide(page)).toHaveAttribute('data-slide', '1', { timeout: 20_000 });
    await expect(page.getByRole('radio', { name: 'Carousel' })).toHaveAttribute('aria-checked', 'true');
    // The lead: the headline above the first page's box.
    await expect(slide(page)).toHaveAttribute('data-share-card', 'headline/ink');
    await expect(slide(page)).toHaveAttribute('data-share-crop', fixed(FIRST_PAGE));
    await expect(slide(page)).toHaveAttribute('alt', `Slide 1 of 6, the paper: ${HEADLINE}`);
    const names = ['The paper', 'The question', 'The method', 'Result 1', 'Result 2', 'The takeaway'];
    const words = [HEADLINE, PAPER_WORDS.question, PAPER_WORDS.method, ...PAPER_WORDS.results, TAKEAWAY];
    await page.locator('[data-slide-viewer]').focus();
    for (let number = 1; number <= 6; number++) {
      if (number > 1) await page.keyboard.press('ArrowRight');
      await expect(position(page)).toHaveText(`${number} of 6 · ${names[number - 1]}`);
      await expect(slide(page)).toHaveAttribute('alt', `Slide ${number} of 6, ${names[number - 1]!.toLowerCase()}: ${words[number - 1]}`);
    }
    await page.keyboard.press('Home');
    await expect(slide(page)).toHaveAttribute('data-slide', '1');
    await expect(page.getByRole('button', { name: 'Save Story (9:16)' })).toHaveCount(0);
    await expect(page.locator('[data-older-paper]')).toHaveCount(0);
    await noSideScroll(page);
  });

  test('with one result the paper is five slides', async ({ page }) => {
    test.setTimeout(60_000);
    const state = fake();
    await routePosts(page, state);
    const { project, source, url } = await openPaper(page);
    await openPost(page, state, url, { project: project.id, source: source.id }, 'instagram', 1);
    await expect(slide(page)).toHaveAttribute('data-slide-count', '5', { timeout: 20_000 });
    await goTo(page, 4);
    await expect(position(page)).toHaveText('4 of 5 · The result');
    await expect(slide(page)).toHaveAttribute('alt', `Slide 4 of 5, the result: ${PAPER_WORDS.results[0]}`);
  });

  test('editing the question, the method and a result, with Undo; a result cannot be emptied', async ({ page }) => {
    test.setTimeout(60_000);
    const state = fake();
    await routePosts(page, state);
    const { project, source, url } = await openPaper(page);
    await openPost(page, state, url, { project: project.id, source: source.id }, 'instagram');
    await expect(slide(page)).toHaveAttribute('data-slide', '1', { timeout: 20_000 });

    await goTo(page, 2);
    await page.getByRole('button', { name: 'Edit slide' }).click();
    let dialog = page.getByRole('dialog', { name: 'Edit slide 2 of 6: The question' });
    await expect(dialog.getByText(`Up to ${PAPER.questionMax} characters.`)).toBeVisible();
    await dialog.getByRole('textbox', { name: 'The question' }).fill('Does sparse attention keep its quality on long documents?');
    await dialog.getByRole('button', { name: 'Save' }).click();
    expect(state.patches.at(-1)).toEqual({ paper_text: { field: 'question', text: 'Does sparse attention keep its quality on long documents?' } });
    await expect(slide(page)).toHaveAttribute('alt', 'Slide 2 of 6, the question: Does sparse attention keep its quality on long documents?');

    await goTo(page, 3);
    await page.getByRole('button', { name: 'Edit slide' }).click();
    dialog = page.getByRole('dialog', { name: 'Edit slide 3 of 6: The method' });
    await dialog.getByRole('textbox', { name: 'The method' }).fill('Three benchmarks, sparse against full attention.');
    await dialog.getByRole('button', { name: 'Save' }).click();
    expect(state.patches.at(-1)).toEqual({ paper_text: { field: 'method', text: 'Three benchmarks, sparse against full attention.' } });
    await expect(slide(page)).toHaveAttribute('alt', 'Slide 3 of 6, the method: Three benchmarks, sparse against full attention.');

    await goTo(page, 5);
    await page.getByRole('button', { name: 'Edit slide' }).click();
    dialog = page.getByRole('dialog', { name: 'Edit slide 5 of 6: Result 2' });
    const result = dialog.getByRole('textbox', { name: 'The result' });
    await expect(dialog.getByText(`Up to ${PAPER.resultMax} characters.`)).toBeVisible();
    await result.fill('r'.repeat(160));
    await expect(result).toHaveValue('r'.repeat(PAPER.resultMax));
    // Emptied: Save is disabled, and the dialog says why.
    await result.fill('');
    await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled();
    await expect(dialog.getByText('A result cannot be empty: a paper post keeps at least one.')).toBeVisible();
    await result.fill('It trains with the same schedule as full attention.');
    await dialog.getByRole('button', { name: 'Save' }).click();
    expect(state.patches.at(-1)).toEqual({ paper_text: { field: 'result', index: 1, text: 'It trains with the same schedule as full attention.' } });
    await expect(slide(page)).toHaveAttribute('alt', 'Slide 5 of 6, result 2: It trains with the same schedule as full attention.');
    await page.getByRole('button', { name: 'Undo last change' }).click();
    await expect(slide(page)).toHaveAttribute('alt', `Slide 5 of 6, result 2: ${PAPER_WORDS.results[1]}`);
  });

  test('the lead slide\'s headline and crop are edited from it, and the crop resets to the first page\'s box', async ({ page }) => {
    test.setTimeout(60_000);
    const state = fake();
    await routePosts(page, state);
    const { project, source, url } = await openPaper(page);
    await openPost(page, state, url, { project: project.id, source: source.id }, 'instagram');
    await expect(slide(page)).toHaveAttribute('data-slide', '1', { timeout: 20_000 });
    await expect(page.getByText('The title and abstract')).toBeVisible();
    await page.getByRole('button', { name: 'Edit slide' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit slide 1 of 6: The paper' });
    await dialog.getByRole('textbox', { name: 'Headline' }).fill('Sparse attention, nearly full quality');
    await dialog.getByRole('button', { name: 'Save' }).click();
    expect(state.patches.at(-1)).toEqual({ headline: 'Sparse attention, nearly full quality' });
    await expect(slide(page)).toHaveAttribute('alt', 'Slide 1 of 6, the paper: Sparse attention, nearly full quality');

    await page.getByRole('button', { name: 'Adjust crop' }).click();
    const editor = page.getByRole('dialog', { name: 'Adjust crop' });
    await expect(editor).toHaveAttribute('data-state', 'ready');
    await expect(page.locator('[data-crop-box]')).toHaveAttribute('data-crop', fixed(FIRST_PAGE));
    await editor.getByRole('button', { name: 'Bottom edge' }).focus();
    await page.keyboard.press('Shift+ArrowDown');
    const chosen = (await page.locator('[data-crop-box]').getAttribute('data-crop'))!;
    await editor.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByText('Crop saved.')).toBeVisible();
    await expect(slide(page)).toHaveAttribute('data-share-crop', chosen);
    await expect(page.getByText('Your crop')).toBeVisible();
    await page.getByRole('button', { name: 'Adjust crop' }).click();
    await expect(editor).toHaveAttribute('data-state', 'ready');
    await editor.getByRole('button', { name: 'Back to the original region' }).click();
    expect(state.patches.at(-1)).toEqual({ crop: null });
    await expect(slide(page)).toHaveAttribute('data-share-crop', fixed(FIRST_PAGE));
    await expect(page.getByText('The title and abstract')).toBeVisible();
  });

  test('an older paper post keeps its three cards and offers one Rewrite that adds the paper\'s slides, with Undo', async ({ page }) => {
    test.setTimeout(60_000);
    const state = fake();
    await routePosts(page, state);
    const { project, source, url } = await openPaper(page);
    await openPost(page, state, url, { project: project.id, source: source.id }, 'instagram', 0);
    await expect(slide(page)).toHaveAttribute('data-slide-count', '3', { timeout: 20_000 });
    expect(await slide(page).getAttribute('data-slide-kind')).toBe('cover');
    const notice = page.locator('[data-older-paper]');
    await expect(notice).toHaveText(/This post was made before papers got their own slides\. Rewrite it to add the question, method and results\./);
    state.hold = true;
    await notice.getByRole('button', { name: 'Rewrite' }).click();
    await expect(page.getByText('Rewriting your post…')).toBeVisible();
    expect(state.changes).toEqual([{ destination: 'instagram', take: '' }]);
    state.hold = false;
    await expect(slide(page)).toHaveAttribute('data-slide-count', '6', { timeout: 15_000 });
    await expect(notice).toHaveCount(0);
    await page.getByRole('button', { name: 'Undo last change' }).click();
    await expect(slide(page)).toHaveAttribute('data-slide-count', '3');
    await expect(notice).toBeVisible();
    expect(state.changes).toHaveLength(1);
  });

  test('the six slides are saved as a ZIP of six and a PDF of six pages', async ({ page }) => {
    test.setTimeout(90_000);
    const state = fake();
    await routePosts(page, state);
    const { project, source, url } = await openPaper(page);
    await openPost(page, state, url, { project: project.id, source: source.id }, 'instagram');
    await expect(slide(page)).toHaveAttribute('data-slide', '1', { timeout: 20_000 });
    let download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save all slides (ZIP)' }).click();
    let file = await download;
    expect(file.suggestedFilename()).toBe(carouselFileName(TITLE, 'zip'));
    expect(zipNames(fs.readFileSync((await file.path())!))).toEqual([1, 2, 3, 4, 5, 6].map(number => slideFileName(TITLE, number, 6)));
    download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save as PDF' }).click();
    file = await download;
    expect(file.suggestedFilename()).toBe(carouselFileName(TITLE, 'pdf'));
    expect(pdfPages(fs.readFileSync((await file.path())!))).toBe(6);
  });

  test('without its PDF the lead draws as a cover, and the post says why', async ({ page }) => {
    const state = fake();
    await routePosts(page, state);
    const project = await createProjectViaApi(page, 'Removed paper');
    state.current = paperRecord(project.id, null, FIRST_PAGE, TITLE, 'instagram', 2);
    await page.goto(`/projects/${project.id}`);
    await page.getByRole('tab', { name: /Highlights/ }).click();
    const entry = page.locator(`[data-post-id="${POST_ID}"]`);
    await expect(entry).toContainText('p. 1 · Paper · PDF removed');
    await entry.click();
    await expect(slide(page)).toHaveAttribute('data-slide', '1', { timeout: 20_000 });
    await expect(slide(page)).toHaveAttribute('data-share-card', 'idea/ink');
    await expect(page.getByText('The PDF for this post was removed. The first slide shows the headline without the page.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Adjust crop' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Edit slide' })).toBeVisible();
    await page.getByRole('button', { name: 'More post actions' }).click();
    await page.getByRole('menuitem', { name: 'Delete post' }).click();
    await expect(page.getByRole('dialog', { name: 'Delete this post?' })).toContainText('The PDF and your highlights will remain.');
    await noSideScroll(page);
  });
});

// ── For review ──────────────────────────────────────────────────────────────────────────────────────────────────────
test.describe('share the paper, for review', () => {
  test.beforeEach(async ({ page }) => { await mockAuth(page); });

  test('the list, the six slides, a result\'s edit dialog, the older-post notice and LinkedIn\'s Page style at 360 and 480 px', async ({ page }) => {
    test.setTimeout(180_000);
    fs.mkdirSync(SHOTS, { recursive: true });
    const state = fake();
    await routePosts(page, state);
    await page.setViewportSize({ width: 806, height: 1100 });
    const { project, source, url, lines } = await openPaper(page);
    const ids = { project: project.id, source: source.id };
    // Two highlights, so the list offers all three ways to start a post.
    for (const index of [5, 6]) {
      const rect = lines[index]!.rect;
      await page.request.post(`/api/projects/${project.id}/sources/${source.id}/annotations`, { data: { page_number: 1, ...rect, rects: [rect], text: lines[index]!.text, color: 'yellow' } });
    }
    for (const width of [360, 480]) {
      const shot = (what: string) => path.join(SHOTS, `${width}-${what}.png`);
      const viewport = Math.round((width + 5) / 0.45);
      const panel = page.locator('[data-share-post]');
      await page.setViewportSize({ width: viewport, height: 1100 });
      state.current = null;
      await page.goto(url);
      await postTab(page).click();
      const group = page.getByRole('group', { name: 'Start a post' });
      await expect(group).toBeVisible();
      await page.getByText('Or click a highlight').waitFor();
      await expect(page.locator('#share-region-hint')).toHaveText('A figure or passage on page 1; the paper: its question, method and results; or a carousel of your highlights.');
      await group.locator('xpath=ancestor::div[1]').screenshot({ path: shot('list') });

      await page.setViewportSize({ width: viewport, height: 2200 });
      await openPost(page, state, url, ids, 'instagram');
      await expect(slide(page)).toHaveAttribute('data-slide', '1', { timeout: 20_000 });
      for (let number = 1; number <= 6; number++) {
        await goTo(page, number);
        await noSideScroll(page);
        await panel.screenshot({ path: shot(`slide-${number}`) });
      }
      await goTo(page, 4);
      await page.getByRole('button', { name: 'Edit slide' }).click();
      await page.setViewportSize({ width: viewport, height: 900 });
      await page.screenshot({ path: shot('result-dialog') });
      await page.getByRole('dialog', { name: /^Edit slide/ }).getByRole('button', { name: 'Cancel' }).click();

      await page.setViewportSize({ width: viewport, height: 2200 });
      await openPost(page, state, url, ids, 'instagram', 0);
      await expect(page.locator('[data-older-paper]')).toBeVisible({ timeout: 20_000 });
      await noSideScroll(page);
      await panel.screenshot({ path: shot('older-post') });

      await openPost(page, state, url, ids, 'linkedin');
      await expect(card(page)).toHaveAttribute('data-share-card', 'page/ink', { timeout: 20_000 });
      await noSideScroll(page);
      await panel.screenshot({ path: shot('linkedin-page') });
    }
  });
});
