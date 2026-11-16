import { test, expect, type Locator, type Page, type Route } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {
  DESTINATION_DEFAULTS, captionText,
  type CardContent, type Caption, type Destination, type PageRect, type ShareCardRecord, type SourceKind,
} from '../../src/shared/share-card';
import { mockAuth, createProjectViaApi } from './helpers';

// Region and first-page posts in the reader. The project and the PDF (test/fixtures/share-regions.pdf, made by
// test/fixtures/make-share-regions-pdf.mjs) are real; the share-card routes are answered by the small fake below, so
// no assistant is involved. Page 1 is a paper's first page; page 2 holds a plotted figure with axis labels.

const SHOTS = path.resolve('test-results/share-regions');
const POST_ID = '3b9c2d4e-5f60-4a71-8b92-a3b4c5d6e7f8';
const TITLE = 'Sparse Attention at a Fraction of the Cost';
const HEADLINE = 'Accuracy keeps climbing long after the curve looks flat';
const FIGURE_TEXT = '100\nAccuracy\n50\n0\n0\n50\n100\nSteps';
const BUSY = 'pdfpal is busy writing posts. Try again shortly.';

type Fake = {
  current: ShareCardRecord | null
  /** When set, the next start is refused with this status and message. */
  refuse?: { status: number; detail: string }
  starts: Record<string, any>[]
  patches: Record<string, any>[]
};
const fake = (): Fake => ({ current: null, starts: [], patches: [] });

function drafts(destination: Destination): Caption['drafts'] {
  if (destination === 'x') return { finding: 'Accuracy keeps rising for the sparse pattern until about sixty thousand steps, then flattens.', contrast: '', caveat: '' };
  const body = 'The authors train each model for one hundred thousand steps on the same data.\n\nAccuracy rises with training steps, and the curve flattens after about sixty thousand of them.\n\nLonger training does not close the remaining gap, which points at the window rather than the schedule.';
  return { finding: `Where the curve flattens says more than where it ends.\n\n${body}`, contrast: '', caveat: '' };
}

/** A region or first-page post as the server returns it once written. */
function regionRecord(projectId: string, sourceId: string | null, kind: Exclude<SourceKind, 'highlight'>, page: number, region: PageRect, text: string, destination: Destination = 'linkedin'): ShareCardRecord {
  const defaults = DESTINATION_DEFAULTS[destination];
  const card: CardContent = { quote: '', quoteEdited: false, emphasis: '', headline: HEADLINE, pull: '', topic: 'Training', takeawaysTitle: '', takeaways: [], style: defaults.style, look: 'ink', crop: region };
  return {
    id: POST_ID, project_id: projectId, source_id: sourceId, annotation_id: null, status: 'complete', can_undo: false, instruction: '', error: null,
    created_at: '2026-11-15T10:00:00.000Z', updated_at: '2026-11-15T10:00:01.000Z', destination, take: '', marks: [],
    source: { version: 1, kind, passage: text, page, rects: [], color: 'yellow', region, context: '', title: TITLE, credit: 'Lovelace and Turing, 2026', url: 'https://example.org/sparse-attention' },
    card, caption: { destination, take: '', drafts: drafts(destination), angle: 'finding', hashtags: ['attention', 'research', 'ml'], showTags: defaults.showTags, link: 'post', edited: null },
  };
}

/** Answers the share-card routes from `state`, as the server does for region posts. */
async function routePosts(page: Page, state: Fake) {
  await page.route('**/api/projects/*/share-cards**', async (route: Route) => {
    const request = route.request(), url = new URL(request.url()), tail = url.pathname.split('/share-cards')[1] ?? '';
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const body = (request.postDataJSON() ?? {}) as Record<string, any>;
    const projectId = url.pathname.split('/')[3]!;
    if (request.method() === 'POST' && tail === '') {
      state.starts.push(body);
      if (state.refuse) { const { status, detail } = state.refuse; state.refuse = undefined; return json(status, { detail }); }
      state.current = { ...regionRecord(projectId, body.source_id, body.kind, body.page, body.region, body.text, body.destination), status: 'running', card: null, caption: null };
      return json(202, state.current);
    }
    if (request.method() === 'GET' && tail === '') {
      const post = state.current;
      return json(200, post ? [{ id: post.id, status: post.status, annotation_id: null, source_id: post.source_id, page: post.source.page, kind: post.source.kind,
        title: post.card?.headline || (post.source.kind === 'paper' ? 'First page' : `Region on p. ${post.source.page}`), updated_at: post.updated_at }] : []);
    }
    const post = state.current;
    if (!post || tail.split('/')[1] !== post.id) return json(404, { detail: 'Post not found.' });
    if (request.method() === 'GET') {
      if (post.status === 'running') {
        const done = regionRecord(projectId, post.source_id, post.source.kind as 'region' | 'paper', post.source.page, post.source.region!, post.source.passage, post.destination);
        state.current = { ...done, updated_at: new Date().toISOString() };
      }
      return json(200, state.current);
    }
    if (request.method() === 'PATCH') {
      state.patches.push(body);
      if ('crop' in body) state.current = { ...post, card: { ...post.card!, crop: body.crop ?? post.source.region }, updated_at: new Date().toISOString() };
      else if ('style' in body) {
        if (!['page', 'headline'].includes(body.style)) return json(400, { detail: 'A post made from a region has no quote or takeaways, so it uses the Page or Headline style.' });
        state.current = { ...post, card: { ...post.card!, style: body.style, look: body.look }, updated_at: new Date().toISOString() };
      } else return json(409, { detail: 'Not expected in this test.' });
      return json(200, state.current);
    }
    return json(409, { detail: 'Not expected in this test.' });
  });
}

type Line = { text: string; rect: PageRect };

/** Opens the fixture in the reader with `pageNumber` in view, and returns that page's text-layer lines as page fractions. */
async function openPaper(page: Page, pageNumber: number) {
  const project = await createProjectViaApi(page, 'Region posts');
  const source = await (await page.request.post(`/api/projects/${project.id}/sources`, { data: { url: 'test/fixtures/share-regions.pdf', title: TITLE } })).json() as { id: string };
  const url = `/projects/${project.id}/sources/${source.id}`;
  await page.goto(url);
  const lines = await pageLines(page, pageNumber);
  return { project, source, url, lines };
}

async function pageLines(page: Page, pageNumber: number): Promise<Line[]> {
  const layer = page.locator(`[data-pdf-page="${pageNumber}"]`);
  await layer.scrollIntoViewIfNeeded();
  await expect(layer.locator('.textLayer span').first()).toBeVisible();
  return layer.evaluate(element => {
    const box = element.querySelector('.react-pdf__Page')!.getBoundingClientRect();
    return [...element.querySelectorAll('.textLayer span')].filter(span => span.textContent!.trim()).map(span => {
      const r = span.getBoundingClientRect();
      return { text: span.textContent!, rect: { x1: (r.left - box.left) / box.width, y1: (r.top - box.top) / box.height, x2: (r.right - box.left) / box.width, y2: (r.bottom - box.top) / box.height } };
    });
  });
}

const postTab = (page: Page) => page.getByRole('button', { name: '✦ Post', exact: true });
const card = (page: Page) => page.locator('img[data-share-card]');
const cropBox = (page: Page) => page.locator('[data-crop-box]');
const cropOf = async (page: Page) => (await cropBox(page).getAttribute('data-crop'))!.split(',').map(Number);
const fixed = (region: PageRect) => [region.x1, region.y1, region.x2, region.y2].map(value => value.toFixed(4)).join(',');
const inside = (inner: PageRect, outer: number[]) => inner.x1 >= outer[0]! && inner.y1 >= outer[1]! && inner.x2 <= outer[2]! && inner.y2 <= outer[3]!;

/** Drags a part of the crop editor by a fraction of the page. */
async function drag(page: Page, part: Locator, dx: number, dy: number) {
  const frame = (await page.locator('[data-crop-page]').boundingBox())!, from = (await part.boundingBox())!;
  const x = from.x + from.width / 2, y = from.y + from.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx * frame.width, y + dy * frame.height, { steps: 8 });
  await page.mouse.up();
}

async function noSideScroll(page: Page, selector = '[data-share-post]') {
  const overflow = await page.locator(selector).evaluate(element => element.scrollWidth - element.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe('region and first-page posts in the reader', () => {
  test.beforeEach(async ({ page }) => { await mockAuth(page); });

  test('choose a region with the pointer and create the post', async ({ page }) => {
    test.setTimeout(60_000);
    const state = fake();
    await routePosts(page, state);
    const { source } = await openPaper(page, 2);
    await postTab(page).click();
    await expect(page.getByText('A figure or passage on page 2, or the title and abstract.')).toBeVisible();
    await page.getByRole('button', { name: 'Share a region' }).click();
    const dialog = page.getByRole('dialog', { name: 'Choose a region' });
    await expect(dialog).toHaveAttribute('data-state', 'ready');
    // It starts in the middle of the page, with nothing to reset to.
    expect(await cropOf(page)).toEqual([0.12, 0.3, 0.88, 0.62]);
    await expect(dialog.getByRole('button', { name: 'Reset to automatic' })).toHaveCount(0);
    // Up by a tenth of the page, over the figure; the left edge in a little.
    await drag(page, cropBox(page), 0, -0.1);
    await drag(page, dialog.getByRole('button', { name: 'Left edge' }), 0.06, 0);
    const chosen = await cropOf(page);
    expect(chosen[0]!).toBeCloseTo(0.18, 2); expect(chosen[1]!).toBeCloseTo(0.2, 2); expect(chosen[2]!).toBeCloseTo(0.88, 4); expect(chosen[3]!).toBeCloseTo(0.52, 2);
    await dialog.getByRole('button', { name: 'Create post' }).click();
    await expect(dialog).toBeHidden();

    await expect(card(page)).toHaveAttribute('data-share-card', 'page/ink', { timeout: 20_000 });
    expect(state.starts).toHaveLength(1);
    const body = state.starts[0]!;
    expect(body).toMatchObject({ source_id: source.id, page: 2, kind: 'region', destination: 'linkedin' });
    expect(body.request_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(fixed(body.region)).toBe(chosen.map(value => value.toFixed(4)).join(','));
    // The words inside the region: the figure's labels, none of the text above or the caption below.
    expect(body.text).toBe(FIGURE_TEXT);
    // The preview shows the region; the post's alt text says what it is.
    await expect(card(page)).toHaveAttribute('data-share-crop', fixed(body.region));
    await expect(card(page)).toHaveAttribute('alt', 'Page card: a region of page 2');
    expect(page.url()).toContain(`post=${POST_ID}`);
  });

  test('choose a region with the keyboard and create the post', async ({ page }) => {
    test.setTimeout(60_000);
    const state = fake();
    await routePosts(page, state);
    await openPaper(page, 2);
    await postTab(page).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Share a region' }).focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Choose a region' });
    await expect(dialog).toHaveAttribute('data-state', 'ready');
    await expect(cropBox(page)).toBeFocused();
    await page.keyboard.press('Shift+ArrowUp');
    await page.keyboard.press('Shift+ArrowUp');
    expect(await cropOf(page)).toEqual([0.12, 0.2, 0.88, 0.52]);
    for (let presses = 0; presses < 15; presses++) {
      if (await dialog.getByRole('button', { name: 'Create post' }).evaluate(element => element === document.activeElement)) break;
      await page.keyboard.press('Tab');
    }
    await expect(dialog.getByRole('button', { name: 'Create post' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(card(page)).toHaveAttribute('data-share-card', 'page/ink', { timeout: 20_000 });
    expect(state.starts).toEqual([expect.objectContaining({ kind: 'region', page: 2, region: { x1: 0.12, y1: 0.2, x2: 0.88, y2: 0.52 }, text: FIGURE_TEXT })]);
  });

  test('Escape leaves the region modal without starting anything', async ({ page }) => {
    const state = fake();
    await routePosts(page, state);
    await openPaper(page, 2);
    await postTab(page).click();
    await page.getByRole('button', { name: 'Share a region' }).click();
    await expect(page.getByRole('dialog', { name: 'Choose a region' })).toHaveAttribute('data-state', 'ready');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Choose a region' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Share a region' })).toBeFocused();
    expect(state.starts).toHaveLength(0);
  });

  test('share the first page: the box starts over the title, authors and abstract', async ({ page }) => {
    test.setTimeout(60_000);
    const state = fake();
    await routePosts(page, state);
    const { lines } = await openPaper(page, 1);
    await postTab(page).click();
    await page.getByRole('button', { name: 'Share the first page' }).click();
    const dialog = page.getByRole('dialog', { name: 'Share the first page' });
    await expect(dialog).toHaveAttribute('data-state', 'ready');
    const start = await cropOf(page);
    const line = (text: string | RegExp) => lines.find(entry => typeof text === 'string' ? entry.text.includes(text) : text.test(entry.text))!.rect;
    for (const text of [TITLE, 'Ada Lovelace', 'Abstract', 'Full attention lets every position', 'learning-rate schedule.'])
      expect(inside(line(text), start), `${text} inside ${start}`).toBe(true);
    // The introduction's heading and the text under it are left out.
    expect(start[3]!).toBeLessThan(line('1 Introduction').y1);
    expect(start[3]!).toBeGreaterThan(line('learning-rate schedule.').y2);
    await dialog.getByRole('button', { name: 'Create post' }).click();
    await expect(card(page)).toHaveAttribute('data-share-card', 'page/ink', { timeout: 20_000 });
    const body = state.starts[0]!;
    expect(body).toMatchObject({ kind: 'paper', page: 1 });
    expect(fixed(body.region)).toBe(start.map(value => value.toFixed(4)).join(','));
    expect(body.text.split('\n')[0]).toBe(TITLE);
    expect(body.text).toContain('Abstract');
    expect(body.text).toMatch(/learning-rate schedule\.$/);
    expect(body.text).not.toContain('Introduction');
    await expect(card(page)).toHaveAttribute('alt', 'Page card: the first page of the paper');
  });

  test('a refused start shows its message and opens nothing', async ({ page }) => {
    test.setTimeout(60_000);
    const state = fake();
    await routePosts(page, state);
    await openPaper(page, 2);
    await postTab(page).click();
    for (const refusal of [{ status: 429, detail: BUSY }, { status: 422, detail: 'Posts can be made from PDFs only.' }]) {
      state.refuse = refusal;
      await page.getByRole('button', { name: 'Share a region' }).click();
      const dialog = page.getByRole('dialog', { name: 'Choose a region' });
      await expect(dialog).toHaveAttribute('data-state', 'ready');
      await dialog.getByRole('button', { name: 'Create post' }).click();
      await expect(page.getByRole('alert')).toHaveText(refusal.detail);
      await expect(page.getByRole('heading', { name: 'Posts' })).toBeVisible();
    }
    expect(state.starts).toHaveLength(2);
    // The same region asks again with the same request ID: the first never reached a post.
    expect(state.starts[1]!.request_id).toBe(state.starts[0]!.request_id);
  });

  test('a region post has no text cards or quote edit, and its crop resets to the region it started from', async ({ page }) => {
    test.setTimeout(60_000);
    const state = fake();
    await routePosts(page, state);
    const { project, source, url } = await openPaper(page, 2);
    const region = { x1: 0.12, y1: 0.2, x2: 0.88, y2: 0.52 };
    state.current = regionRecord(project.id, source.id, 'region', 2, region, FIGURE_TEXT);
    await page.goto(`${url}?post=${POST_ID}`);
    await expect(card(page)).toHaveAttribute('data-share-card', 'page/ink', { timeout: 20_000 });
    await expect(card(page)).toHaveAttribute('data-share-crop', fixed(region));
    await expect(page.getByText('Text cards')).toHaveCount(0);
    await expect(page.getByRole('radio', { name: 'Quote' })).toHaveCount(0);
    await expect(page.getByRole('radio', { name: 'Headline' })).toBeVisible();
    await page.getByRole('button', { name: 'More post actions' }).click();
    await expect(page.getByRole('menuitem', { name: 'Edit credit' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Edit quote' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByText('The region you chose')).toBeVisible();

    await page.getByRole('button', { name: 'Adjust crop' }).click();
    const dialog = page.getByRole('dialog', { name: 'Adjust crop' });
    await expect(dialog).toHaveAttribute('data-state', 'ready');
    expect(fixed({ x1: (await cropOf(page))[0]!, y1: (await cropOf(page))[1]!, x2: (await cropOf(page))[2]!, y2: (await cropOf(page))[3]! })).toBe(fixed(region));
    await expect(dialog.getByRole('button', { name: 'Reset to automatic' })).toHaveCount(0);
    await cropBox(page).focus();
    await page.keyboard.press('Shift+ArrowDown');
    await dialog.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByText('Crop saved.')).toBeVisible();
    expect(state.patches.at(-1)).toEqual({ crop: { x1: 0.12, y1: 0.25, x2: 0.88, y2: 0.57 } });
    await expect(page.getByText('Your crop')).toBeVisible();
    await expect(card(page)).toHaveAttribute('data-share-crop', '0.1200,0.2500,0.8800,0.5700');

    await page.getByRole('button', { name: 'Adjust crop' }).click();
    await expect(dialog).toHaveAttribute('data-state', 'ready');
    await dialog.getByRole('button', { name: 'Back to the original region' }).click();
    await expect(page.getByText('Back to the original region.')).toBeVisible();
    expect(state.patches.at(-1)).toEqual({ crop: null });
    await expect(card(page)).toHaveAttribute('data-share-crop', fixed(region));
    await expect(page.getByText('The region you chose')).toBeVisible();

    // Headline works as for a highlight's post.
    await page.getByRole('radio', { name: 'Headline' }).click();
    await expect(card(page)).toHaveAttribute('data-share-card', 'headline/ink');
    await expect(card(page)).toHaveAttribute('alt', `Headline card: ${HEADLINE}.`);
    await noSideScroll(page);
  });
});

test.describe('a region post whose PDF was removed', () => {
  test.beforeEach(async ({ page }) => { await mockAuth(page); });

  test('opens in the Highlights tab on a Big idea card drawn from its headline', async ({ page }) => {
    const state = fake();
    await routePosts(page, state);
    const project = await createProjectViaApi(page, 'Removed region PDF');
    state.current = regionRecord(project.id, null, 'region', 3, { x1: 0.1, y1: 0.3, x2: 0.9, y2: 0.6 }, FIGURE_TEXT, 'instagram');
    await page.goto(`/projects/${project.id}`);
    await page.getByRole('tab', { name: /Highlights/ }).click();
    const entry = page.locator(`[data-post-id="${POST_ID}"]`);
    await expect(entry).toContainText(HEADLINE);
    await expect(entry).toContainText('p. 3 · Region · PDF removed');
    await expect(entry).not.toContainText('Highlight deleted');
    await entry.click();
    await expect(card(page)).toHaveAttribute('data-share-card', 'idea/ink', { timeout: 20_000 });
    await expect(card(page)).toHaveAttribute('alt', `Big idea card: ${HEADLINE}.`);
    await expect(page.getByText('Page and Headline aren’t available: The PDF for this post was removed.')).toBeVisible();
    for (const name of ['Page', 'Headline']) await expect(page.getByRole('radio', { name, exact: true })).toBeDisabled();
    await expect(page.getByText('Text cards')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Edit headline' })).toBeVisible();
    await expect(page.locator('[data-share-caption]')).toHaveText(captionText(state.current.source, state.current.caption!));
    await noSideScroll(page);
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.locator('[data-share-post]').screenshot({ path: path.join(SHOTS, 'removed-pdf.png') });
  });
});

// ── For review: the list, the two modals and finished posts in a narrow and a wider side column ─────────────────────
test.describe('region posts, for review', () => {
  test.beforeEach(async ({ page }) => { await mockAuth(page); });

  test('the post list, the region and first-page modals, and a region post for LinkedIn and Instagram at 360 and 480 px', async ({ page }) => {
    test.setTimeout(120_000);
    fs.mkdirSync(SHOTS, { recursive: true });
    const state = fake();
    await routePosts(page, state);
    await page.setViewportSize({ width: 806, height: 1100 });
    const { project, source, url } = await openPaper(page, 2);
    for (const width of [360, 480]) {
      const shot = (what: string) => path.join(SHOTS, `${width}-${what}.png`);
      // The reader's right column is 45% of the window, less the 5 px divider.
      await page.setViewportSize({ width: Math.round((width + 5) / 0.45), height: 1100 });
      state.current = null;
      await page.goto(url);
      await pageLines(page, 2);
      await postTab(page).click();
      const list = page.getByRole('group', { name: 'Start a post' });
      await expect(list).toBeVisible();
      await page.getByText('Or click a highlight').waitFor();
      const panel = list.locator('xpath=ancestor::div[1]');
      expect(Math.abs((await panel.boundingBox())!.width - width)).toBeLessThanOrEqual(4);
      await panel.screenshot({ path: shot('list') });

      await page.getByRole('button', { name: 'Share a region' }).click();
      await expect(page.getByRole('dialog', { name: 'Choose a region' })).toHaveAttribute('data-state', 'ready');
      await page.screenshot({ path: shot('region-modal') });
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Share the first page' }).click();
      await expect(page.getByRole('dialog', { name: 'Share the first page' })).toHaveAttribute('data-state', 'ready');
      await page.screenshot({ path: shot('first-page-modal') });
      await page.keyboard.press('Escape');

      for (const destination of ['linkedin', 'instagram'] as const) {
        state.current = regionRecord(project.id, source.id, 'region', 2, { x1: 0.15, y1: 0.22, x2: 0.84, y2: 0.53 }, FIGURE_TEXT, destination);
        await page.setViewportSize({ width: Math.round((width + 5) / 0.45), height: 2200 });
        await page.goto(`${url}?post=${POST_ID}`);
        await expect(card(page)).toHaveAttribute('data-share-card', `${DESTINATION_DEFAULTS[destination].style}/ink`, { timeout: 20_000 });
        await noSideScroll(page);
        await page.locator('[data-share-post]').screenshot({ path: shot(`${destination}-post`) });
      }
      // The list with the post in it.
      await page.getByRole('button', { name: 'All posts' }).click();
      await expect(page.getByRole('button', { name: new RegExp(HEADLINE) })).toContainText('p. 2 · Region');
      await list.locator('xpath=ancestor::div[1]').screenshot({ path: shot('list-with-post') });
    }
    // The phone-width modal.
    await page.setViewportSize({ width: 390, height: 844 });
    state.current = null;
    await page.goto(url);
    await postTab(page).click();
    await page.getByRole('button', { name: 'Share the first page' }).click();
    const dialog = page.getByRole('dialog', { name: 'Share the first page' });
    await expect(dialog).toHaveAttribute('data-state', 'ready');
    const box = (await dialog.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(390);
    await expect(dialog.getByRole('button', { name: 'Create post' })).toBeInViewport();
    await page.screenshot({ path: path.join(SHOTS, 'phone-first-page-modal.png') });
  });
});
