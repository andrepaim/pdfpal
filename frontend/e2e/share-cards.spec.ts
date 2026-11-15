import { test, expect, type Page, type Route } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { captionText, type ShareCardRecord } from '../../src/shared/share-card';
import { mockAuth, createProjectViaApi } from './helpers';

test.describe('share card samples', () => {
  test.beforeEach(async ({ page }) => { await mockAuth(page); });

  test('every sample card fits, and each is written as a PNG for review', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/dev/share-cards');
    await expect(page.locator('main[data-samples-done="true"]')).toBeVisible({ timeout: 100_000 });
    const samples = page.locator('[data-sample]');
    // 7 samples × 3 styles × 3 looks × 2 sizes. Page cards need a PDF and are covered with the reader.
    await expect(samples).toHaveCount(126);
    const failed = await page.locator('[data-fits="false"]').evaluateAll(nodes => nodes.map(node => `${node.getAttribute('data-sample')}: ${node.textContent}`));
    expect(failed).toEqual([]);
    const images = await page.locator('[data-sample] img').evaluateAll(async nodes => Promise.all(nodes.map(async node => {
      const image = node as HTMLImageElement;
      const bytes = new Uint8Array(await (await fetch(image.src)).arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return { name: image.alt, width: image.naturalWidth, height: image.naturalHeight, png: btoa(binary) };
    })));
    const directory = path.resolve('test-results/share-card-samples');
    fs.mkdirSync(directory, { recursive: true });
    for (const image of images) {
      expect(image.width).toBe(1080);
      expect(image.height).toBe(image.name.endsWith('-story') ? 1920 : 1350);
      fs.writeFileSync(path.join(directory, `${image.name}.png`), Buffer.from(image.png, 'base64'));
    }
    expect(images).toHaveLength(126);
  });
});

// ── The reader: a highlight becomes a post ──────────────────────────────────────────────────────────────────────────
// The share-card routes are answered by fixtures; the project, PDF and highlight are real.

type Rect = { x1: number; y1: number; x2: number; y2: number };
const POST_ID = '7d4a8f2e-1c3b-4e5f-9a6b-0c1d2e3f4a5b';
const CARD = {
  quote: 'the cost grows with the square of the sequence length', quoteEdited: false, emphasis: 'the square',
  headline: 'Reach has a quadratic price', pull: 'long documents become expensive', topic: 'Attention',
  takeawaysTitle: 'What full attention costs', style: 'quote' as const, look: 'ink' as const,
  takeaways: [{ title: 'Reach is global', detail: 'Every position can use every other one.' },
    { title: 'Cost grows fast', detail: 'Doubling the input quadruples the work.' }, { title: 'Long inputs hurt', detail: 'Documents become expensive quickly.' }],
};
const CAPTION = { body: 'Full attention buys reach at a price.\n\nThe cost grows with the square of the sequence length.', hashtags: ['attention', 'research', 'ml'], edited: null };

/** Opens a PDF in the reader and returns its page's text lines as fractions of the page. */
async function openPdf(page: Page, file: string, pageNumber: number) {
  const project = await createProjectViaApi(page, 'Share cards');
  const source = await (await page.request.post(`/api/projects/${project.id}/sources`, { data: { url: file, title: 'Share card paper' } })).json();
  await page.goto(`/projects/${project.id}/sources/${source.id}`);
  const layer = page.locator(`[data-pdf-page="${pageNumber}"]`);
  await layer.scrollIntoViewIfNeeded();
  await expect(layer.locator('.textLayer span').first()).toBeVisible();
  const lines = await layer.evaluate(element => {
    const box = element.querySelector('.react-pdf__Page')!.getBoundingClientRect();
    return [...element.querySelectorAll('.textLayer span')].filter(span => span.textContent!.trim()).map(span => {
      const r = span.getBoundingClientRect();
      return { text: span.textContent!, rect: { x1: (r.left - box.left) / box.width, y1: (r.top - box.top) / box.height, x2: (r.right - box.left) / box.width, y2: (r.bottom - box.top) / box.height } };
    });
  });
  return { project, source, lines };
}

async function highlight(page: Page, projectId: string, sourceId: string, pageNumber: number, text: string, rects: Rect[]) {
  const box = { x1: Math.min(...rects.map(r => r.x1)), y1: Math.min(...rects.map(r => r.y1)), x2: Math.max(...rects.map(r => r.x2)), y2: Math.max(...rects.map(r => r.y2)) };
  const response = await page.request.post(`/api/projects/${projectId}/sources/${sourceId}/annotations`, { data: { page_number: pageNumber, ...box, rects, text, color: 'yellow' } });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).id as string;
}

function record(projectId: string, sourceId: string | null, annotationId: string | null, passage: string, pageNumber: number, rects: Rect[], extra: Partial<ShareCardRecord> = {}): ShareCardRecord {
  return {
    id: POST_ID, project_id: projectId, source_id: sourceId, annotation_id: annotationId, status: 'complete', can_undo: false, instruction: '', error: null,
    created_at: '2026-11-15T10:00:00.000Z', updated_at: '2026-11-15T10:00:01.000Z', card: CARD, caption: CAPTION,
    source: { version: 1, passage, page: pageNumber, rects, color: 'yellow', context: passage, title: 'Share card paper', credit: 'Vaswani et al., 2017', url: '' },
    ...extra,
  };
}

/** Answers the share-card routes from `state` and counts each kind of request. */
async function routePosts(page: Page, state: { current: ShareCardRecord | null; afterStart?: ShareCardRecord; gets: number }) {
  const calls = { start: 0, change: 0, restyle: 0, retry: 0 };
  await page.route('**/api/projects/*/share-cards**', async (route: Route) => {
    const request = route.request(), url = new URL(request.url()), tail = url.pathname.split('/share-cards')[1] ?? '';
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (request.method() === 'POST' && tail === '') {
      calls.start++
      state.current = { ...state.afterStart!, status: 'running', card: null, caption: null };
      return json(202, state.current);
    }
    if (request.method() === 'GET' && tail === '') {
      const post = state.current;
      return json(200, post ? [{ id: post.id, status: post.status, annotation_id: post.annotation_id, source_id: post.source_id, page: post.source.page, title: post.card?.headline || post.source.passage, updated_at: post.updated_at }] : []);
    }
    if (!state.current || tail.split('/')[1] !== state.current.id) return json(404, { detail: 'Post not found.' });
    if (request.method() === 'GET') {
      state.gets++
      if (state.current.status === 'running' && state.gets >= 2) state.current = state.afterStart!;
      return json(200, state.current);
    }
    if (request.method() === 'PATCH') {
      calls.restyle++
      const body = request.postDataJSON() as { style: 'quote'; look: 'ink' };
      state.current = { ...state.current, card: { ...state.current.card!, style: body.style, look: body.look }, updated_at: new Date().toISOString() };
      return json(200, state.current);
    }
    if (tail.endsWith('/change')) calls.change++;
    if (tail.endsWith('/retry')) calls.retry++;
    return json(409, { detail: 'Not expected in this test.' });
  });
  return calls;
}

const pngSize = (bytes: Buffer) => ({ signature: bytes.subarray(0, 8).toString('hex'), width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) });

test.describe('share posts in the reader', () => {
  test.beforeEach(async ({ page }) => { await mockAuth(page); });

  test('a highlight becomes a post; style and look change without the assistant; the card is copied and saved', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const state = { current: null as ShareCardRecord | null, afterStart: undefined as ShareCardRecord | undefined, gets: 0 };
    const calls = await routePosts(page, state);
    const { project, source, lines } = await openPdf(page, 'test/fixtures/share-cards.pdf', 2);
    const rects = [lines[1]!.rect, lines[2]!.rect];
    const text = `${lines[1]!.text}\n${lines[2]!.text}`;
    const annotation = await highlight(page, project.id, source.id, 2, text, rects);
    state.afterStart = record(project.id, source.id, annotation, 'the sequence. However, the cost grows with the square of the sequence length, so long documents become expensive. We suspect', 2, rects);
    await page.reload();
    const box = page.locator(`[data-annotation-id="${annotation}"]`).first();
    await expect(box).toBeVisible();
    await expect(page.locator(`[data-post-mark="${annotation}"]`)).toHaveCount(0);

    await box.click();
    await expect(page.getByRole('menu', { name: 'Highlight' })).toBeVisible();
    await page.getByRole('menuitem', { name: /Create post/ }).click();
    await expect(page.getByText('Writing your post…')).toBeVisible();
    await expect(page.getByText('You can keep reading. Your post will stay here.')).toBeVisible();
    const card = page.locator('img[data-share-card]');
    await expect(card).toHaveAttribute('alt', `Quote card: “${CARD.quote}”`, { timeout: 15_000 });
    await expect(card).toHaveAttribute('data-share-card', 'quote/ink');
    expect(page.url()).toContain(`post=${POST_ID}`);
    await expect(page.locator(`[data-post-mark="${annotation}"]`)).toHaveCount(1);
    await expect(page.locator('[data-share-caption]')).toHaveText(captionText(state.current!.source, CAPTION));

    // Style and look redraw locally; only the stored choice is saved.
    await page.getByRole('radio', { name: 'Big idea' }).click();
    await expect(card).toHaveAttribute('data-share-card', 'idea/ink');
    await expect(card).toHaveAttribute('alt', /^Big idea card: Reach has a quadratic price\. “long documents become expensive”$/);
    await page.getByRole('radio', { name: 'Paper look' }).click();
    await expect(card).toHaveAttribute('data-share-card', 'idea/paper');
    await page.getByRole('radio', { name: 'Takeaways' }).click();
    await page.getByRole('radio', { name: 'Marker look' }).click();
    await expect(card).toHaveAttribute('data-share-card', 'takeaways/marker');
    await page.getByRole('radio', { name: 'Big idea' }).click();
    await page.getByRole('radio', { name: 'Paper look' }).click();
    await expect(card).toHaveAttribute('data-share-card', 'idea/paper');
    await expect.poll(() => state.current!.card!.look).toBe('paper');
    expect(calls.start).toBe(1); expect(calls.change).toBe(0); expect(calls.retry).toBe(0);
    expect(calls.restyle).toBe(6);

    await page.getByRole('button', { name: 'Copy caption' }).click();
    await expect(page.getByText('Caption copied.')).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(captionText(state.current!.source, CAPTION));
    await page.getByRole('button', { name: 'Copy image' }).click();
    await expect(page.getByText('Image copied. Paste it into your post.')).toBeVisible();
    expect(await page.evaluate(async () => (await navigator.clipboard.read())[0]!.types)).toContain('image/png');

    for (const [label, name, height] of [['Save image', 'pdfpal-share-card-paper-p2-idea.png', 1350], ['Save as Story (9:16)', 'pdfpal-share-card-paper-p2-idea-story.png', 1920]] as const) {
      await page.getByRole('button', { name: 'More post actions' }).click();
      const download = page.waitForEvent('download');
      await page.getByRole('menuitem', { name: label }).click();
      const file = await download;
      expect(file.suggestedFilename()).toBe(name);
      expect(pngSize(fs.readFileSync((await file.path())!))).toEqual({ signature: '89504e470d0a1a0a', width: 1080, height });
    }
    expect(calls.start).toBe(1); expect(calls.change).toBe(0);

    // Clicking the highlight again offers its post.
    await page.getByRole('button', { name: 'All posts' }).click();
    await expect(page.getByRole('button', { name: /Reach has a quadratic price/ })).toBeVisible();
    await box.click();
    await page.getByRole('menuitem', { name: /Open post/ }).click();
    await expect(card).toBeVisible();
    expect(calls.start).toBe(1);
  });

  test('a link to a post opens it beside its page, and a failed generation offers Try again', async ({ page }) => {
    const state = { current: null as ShareCardRecord | null, afterStart: undefined as ShareCardRecord | undefined, gets: 0 };
    const calls = await routePosts(page, state);
    const { project, source, lines } = await openPdf(page, 'test/fixtures/share-cards.pdf', 2);
    const rects = [lines[0]!.rect];
    const annotation = await highlight(page, project.id, source.id, 2, lines[0]!.text, rects);
    state.current = record(project.id, source.id, annotation, lines[0]!.text, 2, rects, { status: 'failed', error: 'The post could not be checked against its source. Try again.' });
    await page.goto(`/projects/${project.id}/sources/${source.id}?post=${POST_ID}`);
    await expect(page.getByText('The post could not be checked against its source. Try again.')).toBeVisible();
    await expect(page.getByText('Your last completed version')).toBeVisible();
    await expect(page.locator('img[data-share-card]')).toHaveAttribute('data-share-card', 'quote/ink');
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect.poll(() => calls.retry).toBe(1);
  });
});

// ── The Page style: the PDF's own pixels ─────────────────────────────────────────────────────────────────────────────
test.describe('page cards', () => {
  test.beforeEach(async ({ page }) => { await mockAuth(page); });

  for (const sample of [
    { name: 'one-line', file: 'test/fixtures/sample.pdf', page: 1, lines: [0] },
    { name: 'multi-line', file: 'test/fixtures/share-cards.pdf', page: 2, lines: [1, 2, 3] },
  ]) {
    test(`a ${sample.name} highlight draws as a Page card in every look and size`, async ({ page }) => {
      test.setTimeout(60_000);
      const state = { current: null as ShareCardRecord | null, gets: 0 };
      await routePosts(page, state);
      const { project, source, lines } = await openPdf(page, sample.file, sample.page);
      const chosen = sample.lines.map(index => lines[index]!);
      const rects = chosen.map(line => line.rect);
      const text = chosen.map(line => line.text).join('\n');
      const annotation = await highlight(page, project.id, source.id, sample.page, text, rects);
      state.current = record(project.id, source.id, annotation, text.replace(/\s+/g, ' '), sample.page, rects, { card: { ...CARD, quote: chosen[0]!.text.trim(), emphasis: '', style: 'page' } });
      await page.goto(`/projects/${project.id}/sources/${source.id}?post=${POST_ID}`);
      const card = page.locator('img[data-share-card]');
      await expect(card).toHaveAttribute('data-share-card', 'page/ink', { timeout: 20_000 });
      await expect(card).toHaveAttribute('alt', `Page card: “${chosen[0]!.text.trim()}”`);
      const directory = path.resolve('test-results/share-card-samples');
      fs.mkdirSync(directory, { recursive: true });
      for (const look of ['ink', 'paper', 'marker']) {
        await page.getByRole('radio', { name: `${look[0]!.toUpperCase()}${look.slice(1)} look` }).click();
        await expect(card).toHaveAttribute('data-share-card', `page/${look}`);
        for (const [label, size] of [['Save image', 'feed'], ['Save as Story (9:16)', 'story']] as const) {
          await page.getByRole('button', { name: 'More post actions' }).click();
          const download = page.waitForEvent('download');
          await page.getByRole('menuitem', { name: label }).click();
          const file = await download;
          expect(file.suggestedFilename()).toBe(`pdfpal-share-card-paper-p${sample.page}-page${size === 'story' ? '-story' : ''}.png`);
          const bytes = fs.readFileSync((await file.path())!);
          expect(pngSize(bytes)).toEqual({ signature: '89504e470d0a1a0a', width: 1080, height: size === 'story' ? 1920 : 1350 });
          fs.writeFileSync(path.join(directory, `page-${sample.name}-${look}-${size}.png`), bytes);
        }
      }
    });
  }

  test('without its PDF a post offers no Page card, and a stored Page card is drawn as Quote', async ({ page }) => {
    const state = { current: null as ShareCardRecord | null, gets: 0 };
    await routePosts(page, state);
    const project = await createProjectViaApi(page, 'Removed PDF');
    state.current = record(project.id, null, null, 'Attention lets every position look at every other position.', 3,
      [{ x1: 0.1, y1: 0.2, x2: 0.9, y2: 0.23 }], { card: { ...CARD, style: 'page' } });
    await page.goto(`/projects/${project.id}`);
    await page.getByRole('tab', { name: /Highlights/ }).click();
    await page.getByRole('button', { name: /Reach has a quadratic price/ }).click();
    const card = page.locator('img[data-share-card]');
    await expect(card).toHaveAttribute('data-share-card', 'quote/ink');
    await expect(page.getByRole('radio', { name: 'Page' })).toBeDisabled();
    await expect(page.getByRole('radio', { name: 'Page' })).toHaveAttribute('title', 'The PDF for this post was removed.');
    await expect(page.getByText('Page isn’t available: The PDF for this post was removed.')).toBeVisible();
    await expect(page.getByText(/PDF removed/)).toBeVisible();
  });
});
