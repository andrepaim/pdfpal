// Writes test/fixtures/share-cards.pdf: three pages of Helvetica text. Page 2 holds a paragraph whose lines end
// in a word split by a hyphen ("se-" / "quence") and use the fi ligature glyph, as typeset papers do.
// Run: node test/fixtures/make-share-cards-pdf.mjs
import fs from 'node:fs'
import path from 'node:path'

const pages = [
  ['Page one introduces the model and its training data.', 'It sets up the question the next page answers.'],
  ['Attention lets every position look at every other position in',
    'the sequence. However, the cost grows with the square of the se-',
    'quence length, so long documents become expensive. We suspect',
    'that sparse patterns may reduce this cost without a large loss of',
    'quality. The \u0001rst experiments are encouraging but not conclusive.',
    '',
    'A second paragraph follows the first one on the same page.'],
  ['Page three compares the results with earlier work.', 'It ends with the open questions.'],
]
const escape = text => text.replace(/[\\()]/g, match => `\\${match}`).replace(/\u0001/g, '\\001')
const objects = []
const add = body => { objects.push(body); return objects.length }
add('<< /Type /Catalog /Pages 2 0 R >>')
add('') // pages, filled in below
const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding << /Type /Encoding /BaseEncoding /WinAnsiEncoding /Differences [1 /fi] >> >>')
const kids = []
for (const lines of pages) {
  const content = `BT /F1 12 Tf 72 760 Td 16 TL\n${lines.map(line => `(${escape(line)}) Tj T*`).join('\n')}\nET`
  const stream = add(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`)
  kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Contents ${stream} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`))
}
objects[1] = `<< /Type /Pages /Kids [${kids.map(id => `${id} 0 R`).join(' ')}] /Count ${kids.length} >>`
let pdf = '%PDF-1.4\n'
const offsets = objects.map((body, index) => { const offset = Buffer.byteLength(pdf, 'latin1'); pdf += `${index + 1} 0 obj\n${body}\nendobj\n`; return offset })
const xref = Buffer.byteLength(pdf, 'latin1')
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`
pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
fs.writeFileSync(path.join(import.meta.dirname, 'share-cards.pdf'), Buffer.from(pdf, 'latin1'))
