// Writes test/fixtures/share-regions.pdf for the region and first-page post tests (frontend/e2e/share-regions.spec.ts).
// Page 1 is a paper's first page: title, authors, affiliation, an abstract, then "1 Introduction" and body text.
// Page 2 has body text, a plotted figure with axis labels, its caption, and more body text.
// Run: node test/fixtures/make-share-regions-pdf.mjs
import fs from 'node:fs'
import path from 'node:path'

const escape = text => text.replace(/[\\()]/g, match => `\\${match}`)
/** Text at (x, y) in points from the bottom left, in font F1 (Helvetica) or F2 (Helvetica-Bold). */
const text = (x, y, size, value, font = 'F1') => `BT /${font} ${size} Tf ${x} ${y} Td (${escape(value)}) Tj ET`
const lines = (x, top, size, leading, values) => values.map((value, index) => text(x, top - index * leading, size, value)).join('\n')

const first = [
  text(118, 760, 20, 'Sparse Attention at a Fraction of the Cost', 'F2'),
  text(222, 732, 12, 'Ada Lovelace and Alan Turing'),
  text(232, 716, 10, 'Analytical Engine Institute'),
  text(278, 684, 11, 'Abstract', 'F2'),
  lines(90, 664, 10, 14, [
    'Full attention lets every position look at every other position, but its cost grows',
    'with the square of the sequence length. We propose a sparse pattern that attends to',
    'a fixed window and a few global positions. On three long-document benchmarks it',
    'keeps 98% of the quality of full attention at a third of the cost, and it trains',
    'without changes to the optimiser or the learning-rate schedule.',
  ]),
  text(72, 580, 12, '1 Introduction', 'F2'),
  lines(72, 560, 10, 14, [
    'Transformers read long documents poorly because attention compares every pair of',
    'positions. Doubling the length of the input quadruples the work, so a model that',
    'reads a paper in one pass must either truncate it or pay for the whole square.',
    'Earlier work replaced attention with recurrence or with low-rank approximations;',
    'both lose quality on tasks that need exact recall of distant positions.',
  ]),
  text(295, 40, 10, '1'),
].join('\n')

const second = [
  lines(72, 760, 10, 14, [
    'We train each model for one hundred thousand steps on the same data and report the',
    'accuracy on held-out documents. Figure 1 shows how accuracy changes during training',
    'for the sparse pattern; the full-attention curve is almost identical and is omitted.',
  ]),
  // The figure: a light plot area, bars, a curve, axes and their labels.
  '0.92 g 150 430 300 210 re f',
  '0.75 g 170 430 30 50 re f 230 430 30 95 re f 290 430 30 130 re f 350 430 30 150 re f 410 430 30 160 re f',
  '0 G 1.5 w 150 445 m 200 500 l 260 560 l 330 600 l 440 625 l S',
  '0 g 0.8 w 150 430 m 150 640 l S 150 430 m 450 430 l S',
  text(155, 628, 9, 'Accuracy'),
  text(128, 426, 8, '0'), text(122, 532, 8, '50'), text(118, 634, 8, '100'),
  text(148, 418, 8, '0'), text(292, 418, 8, '50'), text(440, 418, 8, '100'),
  text(280, 405, 9, 'Steps'),
  text(150, 380, 10, 'Figure 1: Accuracy rises with training steps.'),
  lines(72, 340, 10, 14, [
    'The curve flattens after about sixty thousand steps. Longer training does not close',
    'the remaining gap, which suggests the window, not the schedule, limits the model.',
  ]),
  text(295, 40, 10, '2'),
].join('\n')

const objects = []
const add = body => { objects.push(body); return objects.length }
add('<< /Type /Catalog /Pages 2 0 R >>')
add('') // pages, filled in below
const regular = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
const bold = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')
const kids = []
for (const content of [first, second]) {
  const stream = add(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`)
  kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Contents ${stream} 0 R /Resources << /Font << /F1 ${regular} 0 R /F2 ${bold} 0 R >> >> >>`))
}
objects[1] = `<< /Type /Pages /Kids [${kids.map(id => `${id} 0 R`).join(' ')}] /Count ${kids.length} >>`
let pdf = '%PDF-1.4\n'
const offsets = objects.map((body, index) => { const offset = Buffer.byteLength(pdf, 'latin1'); pdf += `${index + 1} 0 obj\n${body}\nendobj\n`; return offset })
const xref = Buffer.byteLength(pdf, 'latin1')
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`
pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
fs.writeFileSync(path.join(import.meta.dirname, 'share-regions.pdf'), Buffer.from(pdf, 'latin1'))
