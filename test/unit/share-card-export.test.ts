import test from 'node:test'
import assert from 'node:assert/strict'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { carouselFileName, crc32, pdfFromJpegs, slideFileName, zipStore } from '../../frontend/src/lib/share-card/export.js'

const latin1 = (bytes: Uint8Array) => Buffer.from(bytes).toString('latin1')
/** Stand-ins for JPEG data: the PDF writer embeds the bytes as they are, so any bytes do for its structure. */
const fakeJpeg = (length: number, seed: number) => Uint8Array.from({ length }, (_, i) => (i * 31 + seed) & 0xff)

test('the PDF has one page per slide, each the image\'s size, with the JPEG embedded as it is', async () => {
  const pages = [{ jpeg: fakeJpeg(1000, 1), width: 1080, height: 1350 }, { jpeg: fakeJpeg(2345, 2), width: 1080, height: 1350 }, { jpeg: fakeJpeg(17, 3), width: 1080, height: 1350 }]
  const bytes = pdfFromJpegs(pages)
  const text = latin1(bytes)
  assert.ok(text.startsWith('%PDF-1.4\n'))
  assert.ok(text.trimEnd().endsWith('%%EOF'))
  // Catalog, page tree, then a page, an image and a content stream per slide.
  const objects = [...text.matchAll(/(?:^|\n)(\d+) 0 obj/g)].map(m => Number(m[1]))
  assert.deepEqual(objects, Array.from({ length: 2 + 3 * pages.length }, (_, i) => i + 1))
  assert.equal([...text.matchAll(/\/Type \/Page\b/g)].length, pages.length)
  assert.match(text, new RegExp(`/Count ${pages.length}\\b`))
  // Each image's declared length is the JPEG's, and its bytes sit between stream and endstream unchanged.
  const images = [...text.matchAll(/\/Subtype \/Image [^>]*\/Filter \/DCTDecode \/Length (\d+) >>\nstream\n/g)]
  assert.equal(images.length, pages.length)
  images.forEach((match, index) => {
    assert.equal(Number(match[1]), pages[index]!.jpeg.length)
    const start = match.index! + match[0].length
    assert.deepEqual(bytes.subarray(start, start + pages[index]!.jpeg.length), pages[index]!.jpeg)
    assert.equal(text.slice(start + pages[index]!.jpeg.length, start + pages[index]!.jpeg.length + 10), '\nendstream')
  })
  // The cross-reference table points at every object.
  const startxref = Number(/startxref\n(\d+)\n%%EOF/.exec(text)![1])
  assert.ok(text.slice(startxref).startsWith('xref\n0 ' + (objects.length + 1) + '\n'))
  const entries = text.slice(startxref).split('\n').slice(2, 3 + objects.length)
  assert.equal(entries[0], '0000000000 65535 f ')
  for (const [index, entry] of entries.slice(1).entries()) {
    assert.match(entry, /^\d{10} 00000 n $/)
    assert.ok(text.slice(Number(entry.slice(0, 10))).startsWith(`${index + 1} 0 obj`), `object ${index + 1}`)
  }
  assert.match(text, /trailer\n<< \/Size 12 \/Root 1 0 R >>/)
  // pdf.js opens it: three pages of 1080 × 1350 points.
  const document = await getDocument({ data: bytes.slice() }).promise
  assert.equal(document.numPages, 3)
  for (let number = 1; number <= 3; number++) {
    const viewport = (await document.getPage(number)).getViewport({ scale: 1 })
    assert.equal(viewport.width, 1080); assert.equal(viewport.height, 1350)
  }
  await document.destroy()
})

test('each PDF page is scaled to 1080 points wide and keeps its image\'s proportions', () => {
  const text = latin1(pdfFromJpegs([{ jpeg: fakeJpeg(10, 0), width: 2160, height: 2700 }, { jpeg: fakeJpeg(10, 0), width: 540, height: 1080 }]))
  assert.deepEqual([...text.matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)].map(m => [Number(m[1]), Number(m[2])]), [[1080, 1350], [1080, 2160]])
  assert.match(text, /\/Width 2160 \/Height 2700/)
  assert.match(text, /1080 0 0 1350 0 0 cm/)
  assert.throws(() => pdfFromJpegs([]), /at least one/)
})

test('CRC-32 matches the standard check value', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926)
  assert.equal(crc32(new Uint8Array()), 0)
})

test('the ZIP stores each file uncompressed with correct headers, CRCs, directory and end record', () => {
  const files = [{ name: 'slide-01.png', bytes: new TextEncoder().encode('123456789') }, { name: 'ação/slide-02.png', bytes: fakeJpeg(300, 9) }, { name: 'empty.txt', bytes: new Uint8Array() }]
  const zip = zipStore(files)
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
  // End of central directory: the last 22 bytes, with no comment.
  const end = zip.length - 22
  assert.equal(view.getUint32(end, true), 0x06054b50)
  assert.equal(view.getUint16(end + 8, true), files.length); assert.equal(view.getUint16(end + 10, true), files.length)
  const directorySize = view.getUint32(end + 12, true), directoryOffset = view.getUint32(end + 16, true)
  assert.equal(directoryOffset + directorySize, end)
  let at = directoryOffset
  for (const file of files) {
    const name = new TextEncoder().encode(file.name)
    assert.equal(view.getUint32(at, true), 0x02014b50)
    assert.equal(view.getUint16(at + 8, true) & 0x0800, 0x0800, 'UTF-8 names')
    assert.equal(view.getUint16(at + 10, true), 0, 'stored')
    const crc = view.getUint32(at + 16, true)
    assert.equal(crc, crc32(file.bytes))
    assert.equal(view.getUint32(at + 20, true), file.bytes.length); assert.equal(view.getUint32(at + 24, true), file.bytes.length)
    const nameLength = view.getUint16(at + 28, true)
    assert.deepEqual(zip.subarray(at + 46, at + 46 + nameLength), name)
    // The local header it points at agrees, and the data follows it unchanged.
    const local = view.getUint32(at + 42, true)
    assert.equal(view.getUint32(local, true), 0x04034b50)
    assert.equal(view.getUint32(local + 14, true), crc)
    assert.equal(view.getUint16(local + 12, true), view.getUint16(at + 14, true), 'same date')
    const data = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
    assert.deepEqual(zip.subarray(data, data + file.bytes.length), file.bytes)
    at += 46 + nameLength
  }
  assert.equal(view.getUint32(directoryOffset + 16, true), 0xcbf43926)
  // The same files give the same bytes: the modification time is fixed.
  assert.deepEqual(zipStore(files), zip)
  assert.throws(() => zipStore([{ name: 'a', bytes: new Uint8Array() }, { name: 'a', bytes: new Uint8Array() }]), /twice/)
})

test('slide files are named as the panel names cards, numbered so they sort in order', () => {
  assert.equal(slideFileName('Specific feedback: a field study', 3, 12), 'pdfpal-specific-feedback-a-field-study-slide-03.png')
  assert.equal(slideFileName('', 1, 2), 'pdfpal-post-slide-1.png')
  assert.equal(slideFileName('Ação & reação', 10, 10), 'pdfpal-acao-reacao-slide-10.png')
  assert.equal(carouselFileName('Ação & reação', 'pdf'), 'pdfpal-acao-reacao-carousel.pdf')
  assert.equal(carouselFileName('', 'zip'), 'pdfpal-post-carousel.zip')
})
