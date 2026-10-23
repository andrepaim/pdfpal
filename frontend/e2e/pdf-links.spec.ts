import { test, expect, type Page } from '@playwright/test';
import { mockAuth, createProjectViaApi } from './helpers';

// A small original fixture matching the reported paper's link structure:
// page 3 links to a named XYZ destination partway down lazy page 14.
function referencePdf() {
  const objects: string[] = [];
  const add = (body: string) => { objects.push(body); return objects.length; };
  const catalog = add('');
  const pages = add('');
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pageIds: number[] = [];
  for (let page = 1; page <= 15; page++) {
    const text = page === 3 ? 'Adorno et al. (1950)' : page === 14 ? 'Adorno TW et al. (1950) The Authoritarian Personality' : `Page ${page}`;
    const y = page === 14 ? 567 : 700;
    const content = `BT /F1 12 Tf 50 ${y} Td (${text.replace(/[()]/g, '\\$&')}) Tj ET`;
    const stream = add(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
    pageIds.push(add(`<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${stream} 0 R >>`));
  }
  const namedLink = add('<< /Type /Annot /Subtype /Link /Rect [50 695 180 715] /Border [0 0 0] /A << /S /GoTo /D (Adorno1950) >> >>');
  const directLink = add(`<< /Type /Annot /Subtype /Link /Rect [50 650 180 670] /Border [0 0 0] /Dest [${pageIds[13]} 0 R /Fit] >>`);
  objects[pageIds[2] - 1] = objects[pageIds[2] - 1].replace(' /Contents', ` /Annots [${namedLink} 0 R ${directLink} 0 R] /Contents`);
  const nextReference = add(`<< /Type /Annot /Subtype /Link /Rect [50 560 350 580] /Border [0 0 0] /Dest [${pageIds[14]} 0 R /Fit] >>`);
  objects[pageIds[13] - 1] = objects[pageIds[13] - 1].replace(' /Contents', ` /Annots [${nextReference} 0 R] /Contents`);
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pages} 0 R /Names << /Dests << /Names [(Adorno1950) [${pageIds[13]} 0 R /XYZ 50 577 null]] >> >> >>`;
  objects[pages - 1] = `<< /Type /Pages /Count 15 /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] >>`;
  let pdf = '%PDF-1.7\n';
  const offsets = [0];
  for (const [index, body] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

async function openReferences(page: Page) {
  await mockAuth(page);
  const project = await createProjectViaApi(page, 'Internal PDF links');
  const response = await page.request.post(`/api/projects/${project.id}/sources/upload`, {
    multipart: { file: { name: 'references.pdf', mimeType: 'application/pdf', buffer: referencePdf() } },
  });
  expect(response.ok()).toBeTruthy();
  const source = await response.json();
  await page.request.patch(`/api/projects/${project.id}/sources/${source.id}`, { data: { last_page_read: 3 } });
  await page.goto(`/projects/${project.id}/sources/${source.id}`);
  await expect(page.getByTestId('page-progress')).toHaveText('Page 3 of 15');
  await expect(page.locator('[data-pdf-page="3"] .linkAnnotation a')).toHaveCount(2);
  await expect(page.locator('[data-pdf-page="14"] canvas')).toHaveCount(0);
  return { project, source };
}

for (const mode of ['fit', '1.5']) {
  test(`a named reference opens an unrendered page at its destination at ${mode} zoom`, async ({ page }) => {
    const { project, source } = await openReferences(page);
    if (mode !== 'fit') {
      const zoom = page.getByRole('combobox').filter({ has: page.getByRole('option', { name: 'Fit width', exact: true }) });
      await zoom.selectOption(mode);
    }
    const saved = page.waitForResponse(response => response.request().method() === 'PATCH'
      && response.url().endsWith(`/sources/${source.id}`)
      && response.request().postDataJSON()?.last_page_read === 14);
    await page.locator('[data-pdf-page="3"] .linkAnnotation a').first().click();
    await expect(page.getByTestId('page-progress')).toHaveText('Page 14 of 15');
    await expect(page.locator('[data-pdf-page="14"] canvas')).toBeVisible();
    await expect.poll(() => page.locator('[data-pdf-page="14"]').evaluate(element => {
      const pdfPage = element.querySelector('[data-page-number="14"]')!;
      const scroll = element.closest('[data-testid="pdf-scroll-area"]')!;
      const scale = pdfPage.getBoundingClientRect().height / 800;
      return Math.abs(pdfPage.getBoundingClientRect().top + (800 - 577) * scale - scroll.getBoundingClientRect().top - 16);
    })).toBeLessThan(3);
    expect((await saved).ok()).toBeTruthy();
    const persisted = await (await page.request.get(`/api/projects/${project.id}/sources/${source.id}`)).json();
    expect(persisted.last_page_read).toBe(14);
  });
}

test('a direct page destination works in dark mode without changing zoom', async ({ page }) => {
  await openReferences(page);
  await page.getByRole('button', { name: 'Dark pages', exact: true }).click();
  await page.locator('[data-pdf-page="3"] .linkAnnotation a').nth(1).click();
  await expect(page.getByTestId('page-progress')).toHaveText('Page 14 of 15');
  await expect(page.locator('[data-pdf-page="14"] canvas')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Dark pages', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const zoom = page.getByRole('combobox').filter({ has: page.getByRole('option', { name: 'Fit width', exact: true }) });
  await expect(zoom).toHaveValue('fit');
});

test('Back to citation restores the original scroll position and zoom and saves progress', async ({ page }) => {
  const { source } = await openReferences(page);
  const back = page.getByRole('button', { name: 'Back to citation', exact: true });
  await expect(back).not.toBeVisible();
  const zoom = page.getByRole('combobox').filter({ has: page.getByRole('option', { name: 'Fit width', exact: true }) });
  await zoom.selectOption('1.5');
  const citation = page.locator('[data-pdf-page="3"] .linkAnnotation a').first();
  await citation.scrollIntoViewIfNeeded();
  const scroll = page.getByTestId('pdf-scroll-area');
  const origin = await scroll.evaluate(element => ({ top: element.scrollTop, left: element.scrollLeft }));
  const savedReference = page.waitForResponse(response => response.request().method() === 'PATCH'
    && response.url().endsWith(`/sources/${source.id}`)
    && response.request().postDataJSON()?.last_page_read === 14);
  await citation.click();
  await expect(back).toBeVisible();
  expect((await savedReference).ok()).toBeTruthy();
  await zoom.selectOption('0.75');
  const savedCitation = page.waitForResponse(response => response.request().method() === 'PATCH'
    && response.url().endsWith(`/sources/${source.id}`)
    && response.request().postDataJSON()?.last_page_read === 3);
  await back.focus();
  await page.keyboard.press('Enter');
  await expect(zoom).toHaveValue('1.5');
  await expect(page.getByTestId('page-progress')).toHaveText('Page 3 of 15');
  await expect.poll(() => scroll.evaluate((element, expected) => Math.abs(element.scrollTop - expected), origin.top)).toBeLessThan(2);
  await expect.poll(() => scroll.evaluate((element, expected) => Math.abs(element.scrollLeft - expected), origin.left)).toBeLessThan(2);
  expect((await savedCitation).ok()).toBeTruthy();
  await expect(back).not.toBeVisible();
});

test('Back to citation retraces multiple reference jumps in order', async ({ page }) => {
  await openReferences(page);
  await page.locator('[data-pdf-page="3"] .linkAnnotation a').first().click();
  await expect(page.getByTestId('page-progress')).toHaveText('Page 14 of 15');
  await page.locator('[data-pdf-page="14"] .linkAnnotation a').click();
  await expect(page.getByTestId('page-progress')).toHaveText('Page 15 of 15');
  const back = page.getByRole('button', { name: 'Back to citation', exact: true });
  await back.click();
  await expect(page.getByTestId('page-progress')).toHaveText('Page 14 of 15');
  await back.click();
  await expect(page.getByTestId('page-progress')).toHaveText('Page 3 of 15');
  await expect(back).not.toBeVisible();
});
