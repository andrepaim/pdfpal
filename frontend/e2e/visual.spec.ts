import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { mockAuth, createProjectViaApi } from './helpers';
import { visualDefinitionV1, visualDefinitionV2, visualFrames, type VisualRecord } from '../../src/shared/visual';

// Visual explanations are produced by an assistant, which must never run in tests. The records are served by
// intercepting the player's own GET request, using answers recorded from real runs (test/fixtures/visual-v*/).
async function fixture(version: 1 | 2, name: string) {
  const data = JSON.parse(await readFile(new URL(`../../test/fixtures/visual-v${version}/${name}.json`, import.meta.url), 'utf8'));
  return { definition: version === 2 ? visualDefinitionV2.parse(data.definition) : visualDefinitionV1.parse(data.definition), references: data.references };
}
function record(projectId: string, patch: Partial<VisualRecord>): VisualRecord {
  return { id: 'vis-1', project_id: projectId, question: 'Why do residual connections help?', status: 'complete', definition: null, references: [], error: null, note_id: null, created_at: new Date().toISOString(), ...patch };
}
async function serve(page: Page, projectId: string, value: VisualRecord) {
  await page.route(`**/api/projects/${projectId}/visuals/${value.id}`, route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) }));
  await page.goto(`/projects/${projectId}/visuals/${value.id}`);
}

test.describe('Explain visually player', () => {
  test.beforeEach(async ({ page }) => { await mockAuth(page); });

  test('segments, buttons and arrow keys move through every step of a version 2 explanation', async ({ page }) => {
    const project = await createProjectViaApi(page, 'Visual player');
    const { definition, references } = await fixture(2, 'resnet.claude');
    const frames = visualFrames(definition);
    await serve(page, project.id, record(project.id, { definition, references }));

    const card = page.getByRole('article', { name: 'Visual explanation' });
    await expect(card.getByRole('heading', { name: definition.title })).toBeVisible();
    const segments = card.locator('.visual-progress button');
    await expect(segments).toHaveCount(frames.length);
    await expect(card.locator('.visual-progress-scene')).toHaveCount(definition.scenes.length);
    const caption = card.locator('.visual-caption');
    await expect(caption).toHaveText(frames[0]!.caption);
    await expect(card.getByText(`Step 1 of ${frames.length}`)).toBeVisible();

    // A segment jumps straight to its step.
    await segments.nth(3).click();
    await expect(caption).toHaveText(frames[3]!.caption);
    await expect(segments.nth(3)).toHaveAttribute('aria-current', 'step');
    await expect(card.locator('.visual-stage-head h4')).toHaveText(frames[3]!.sceneTitle);

    // Arrow keys move one step while the player has focus; focus follows the current segment.
    await page.keyboard.press('ArrowRight');
    await expect(caption).toHaveText(frames[4]!.caption);
    await expect(segments.nth(4)).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect(caption).toHaveText(frames[2]!.caption);
    await card.locator('.visual-story').focus();
    await page.keyboard.press('ArrowRight');
    await expect(caption).toHaveText(frames[3]!.caption);

    // Buttons stop at the ends.
    await card.getByRole('button', { name: 'Previous step' }).click();
    await expect(caption).toHaveText(frames[2]!.caption);
    for (let i = 3; i < frames.length; i++) await card.getByRole('button', { name: 'Next step' }).click();
    await expect(caption).toHaveText(frames[frames.length - 1]!.caption);
    await expect(card.getByRole('button', { name: 'Next step' })).toBeDisabled();

    // The basis and the frame's references are shown; the transcript holds every caption and the takeaways.
    const last = frames[frames.length - 1]!;
    await expect(card.locator('.visual-basis')).toHaveText(last.basis === 'source' ? 'Based on supplied text' : last.basis === 'illustration' ? 'Illustrative example' : 'Background knowledge');
    await card.getByText('Takeaways and full transcript').click();
    for (const frame of frames) await expect(card.locator('.visual-transcript')).toContainText(frame.caption);
    await expect(card.locator('.visual-transcript')).toContainText(definition.takeaways[0]!);
  });

  test('the expanded view is centred and stays on the same step', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const project = await createProjectViaApi(page, 'Visual dialog');
    const { definition, references } = await fixture(2, 'vqvae.claude');
    const frames = visualFrames(definition);
    await serve(page, project.id, record(project.id, { definition, references }));
    const card = page.getByRole('article', { name: 'Visual explanation' });
    await expect(card.locator('.visual-caption')).toHaveText(frames[0]!.caption);
    // The card is inside a scrolling page: no part of the page itself may scroll sideways.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1280);
    await card.locator('.visual-progress button').nth(2).click();
    await card.getByRole('button', { name: 'Expand' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const box = (await dialog.boundingBox())!;
    expect(Math.abs(box.x - (1280 - box.x - box.width))).toBeLessThan(4);
    expect(box.y).toBeGreaterThan(0);
    expect(box.y + box.height).toBeLessThanOrEqual(900);
    expect(box.width).toBeGreaterThan(800);
    await expect(dialog.locator('.visual-caption')).toHaveText(frames[2]!.caption);
    // A plot on a shared scale (frames 3 to 5) is laid out narrower rather than shrunk, so its text keeps the size it
    // was measured at.
    await dialog.locator('.visual-progress button').nth(3).click();
    await expect.poll(() => dialog.locator('.visual-canvas svg').evaluate(svg => svg.getBoundingClientRect().height / (svg as SVGSVGElement).viewBox.baseVal.height)).toBeGreaterThan(0.95);
    await dialog.locator('.visual-progress button').nth(2).click();
    // Caption and controls stay on screen below the figure.
    const next = dialog.getByRole('button', { name: 'Next step' });
    await expect(next).toBeInViewport();
    await next.click();
    await expect(dialog.locator('.visual-caption')).toHaveText(frames[3]!.caption);
    await page.keyboard.press('ArrowRight');
    await expect(dialog.locator('.visual-caption')).toHaveText(frames[4]!.caption);
    await dialog.getByRole('button', { name: 'Close visual explanation' }).click();
    await expect(dialog).toBeHidden();
    await expect(card.locator('.visual-story:not(.visual-story-expanded) .visual-caption')).toHaveText(frames[4]!.caption);
  });

  test('a stored version 1 explanation plays one step per figure', async ({ page }) => {
    const project = await createProjectViaApi(page, 'Visual v1');
    const { definition, references } = await fixture(1, 'arcface.claude');
    await serve(page, project.id, record(project.id, { definition, references }));
    const card = page.getByRole('article', { name: 'Visual explanation' });
    await expect(card.locator('.visual-progress button')).toHaveCount(definition.steps.length);
    await expect(card.locator('.visual-progress-scene')).toHaveCount(definition.steps.length);
    await card.locator('.visual-progress button').last().click();
    await expect(card.locator('.visual-caption')).toHaveText(definition.steps[definition.steps.length - 1]!.caption);
  });

  test('while the assistant works the card shows the elapsed time', async ({ page }) => {
    const project = await createProjectViaApi(page, 'Visual waiting');
    await serve(page, project.id, record(project.id, { status: 'running', created_at: new Date(Date.now() - 75_000).toISOString() }));
    const status = page.getByRole('status');
    await expect(status).toContainText('Creating your visual explanation');
    await expect(status).toContainText(/1:1\d/);
    await expect(status).toContainText('usually takes one to two minutes');
  });

  test('a failure shows the stored reason and a retry', async ({ page }) => {
    const project = await createProjectViaApi(page, 'Visual failure');
    await serve(page, project.id, record(project.id, { status: 'failed', error: 'The assistant took too long to respond. Retry, or check its connection in AI settings.' }));
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('The assistant took too long to respond.');
    await expect(alert.getByRole('button', { name: 'Retry visual explanation' })).toBeVisible();
  });
});
