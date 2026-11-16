import fs from 'node:fs';
import path from 'node:path';

/**
 * Writes a one-page PDF whose page is full of text, top to bottom, and returns its absolute path. A highlight over all
 * of it is too tall for any automatic crop on a card. Built as test/fixtures/make-share-cards-pdf.mjs builds its PDF.
 */
export function tallPdf(): string {
  const words = 'Attention compares every pair of positions, so the cost of reading grows with the square of the length';
  const lines = Array.from({ length: 50 }, (_, index) => `${index + 1}. ${words}.`.slice(0, 82));
  const content = `BT /F1 10 Tf 60 800 Td 15 TL\n${lines.map(line => `(${line}) Tj T*`).join('\n')}\nET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [5 0 R] /Count 1 >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Contents 4 0 R /Resources << /Font << /F1 3 0 R >> >> >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((body, index) => { const offset = Buffer.byteLength(pdf, 'latin1'); pdf += `${index + 1} 0 obj\n${body}\nendobj\n`; return offset; });
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const file = path.resolve('test-results/fixtures/tall-page.pdf');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(pdf, 'latin1'));
  return file;
}
