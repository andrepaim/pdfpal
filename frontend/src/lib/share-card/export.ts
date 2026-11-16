// Exporting a carousel: all slides as one PDF (a LinkedIn document) or one ZIP of PNG files, built in the browser
// with no dependency. pdfFromJpegs, zipStore and the names are pure and tested in Node; the canvas wrappers at the
// end only encode images and call them.

const ascii = (text: string) => new TextEncoder().encode(text)

/** Bytes appended in order, with the offset of each part. */
class Writer {
  private readonly parts: Uint8Array[] = []
  length = 0
  push(part: string | Uint8Array) {
    const bytes = typeof part === 'string' ? ascii(part) : part
    this.parts.push(bytes); this.length += bytes.length
  }
  bytes(): Uint8Array {
    const out = new Uint8Array(this.length)
    let at = 0
    for (const part of this.parts) { out.set(part, at); at += part.length }
    return out
  }
}

/** A number as PDF writes it: at most two decimals, no trailing zeros. */
const num = (value: number) => String(Math.round(value * 100) / 100)

/** Width of every PDF page in points; the height follows the image's proportions (1350 for a 4:5 slide). */
export const PDF_PAGE_WIDTH = 1080

/**
 * A PDF with one page per image, in order. Each page is PDF_PAGE_WIDTH points wide and as tall as the image's
 * proportions give; the image fills it. The JPEG bytes are embedded unchanged (DCTDecode), as an RGB image of
 * `width` × `height` pixels. Objects: the catalog, the page tree, then a page, its image and its content per slide.
 */
export function pdfFromJpegs(pages: Array<{ jpeg: Uint8Array; width: number; height: number }>): Uint8Array {
  if (!pages.length) throw new Error('A PDF needs at least one page.')
  const out = new Writer(), offsets: number[] = []
  const object = (number: number, dictionary: string, stream?: Uint8Array) => {
    offsets[number] = out.length
    out.push(`${number} 0 obj\n${dictionary}\n`)
    if (stream) { out.push('stream\n'); out.push(stream); out.push('\nendstream\n') }
    out.push('endobj\n')
  }
  out.push('%PDF-1.4\n')
  // A comment of high bytes marks the file as binary for tools that guess.
  out.push(Uint8Array.from([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]))
  const first = (index: number) => 3 + 3 * index
  object(1, '<< /Type /Catalog /Pages 2 0 R >>')
  object(2, `<< /Type /Pages /Kids [${pages.map((_, index) => `${first(index)} 0 R`).join(' ')}] /Count ${pages.length} >>`)
  pages.forEach((page, index) => {
    if (!(page.width > 0 && page.height > 0)) throw new Error('Every page needs an image with a size.')
    const width = PDF_PAGE_WIDTH, height = PDF_PAGE_WIDTH * page.height / page.width, n = first(index)
    object(n, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(width)} ${num(height)}] /Resources << /XObject << /Im0 ${n + 1} 0 R >> >> /Contents ${n + 2} 0 R >>`)
    object(n + 1, `<< /Type /XObject /Subtype /Image /Width ${Math.round(page.width)} /Height ${Math.round(page.height)} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>`, page.jpeg)
    const content = ascii(`q ${num(width)} 0 0 ${num(height)} 0 0 cm /Im0 Do Q`)
    object(n + 2, `<< /Length ${content.length} >>`, content)
  })
  const count = 2 + 3 * pages.length, xref = out.length
  out.push(`xref\n0 ${count + 1}\n0000000000 65535 f \n`)
  for (let number = 1; number <= count; number++) out.push(`${String(offsets[number]).padStart(10, '0')} 00000 n \n`)
  out.push(`trailer\n<< /Size ${count + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
  return out.bytes()
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

/** CRC-32 (IEEE 802.3), as ZIP uses it. */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** Every entry's modification time: 1 January 1980, 00:00, the first DOS date, so the same files give the same ZIP. */
const DOS_TIME = 0, DOS_DATE = (1 << 5) | 1
/** Version 2.0 of the format; bit 11: names are UTF-8. */
const VERSION = 20, UTF8 = 0x0800

/** A ZIP that stores `files` uncompressed (method 0), in order, with UTF-8 names. Throws on a repeated name. */
export function zipStore(files: Array<{ name: string; bytes: Uint8Array }>): Uint8Array {
  const out = new Writer(), directory = new Writer(), seen = new Set<string>()
  for (const file of files) {
    if (seen.has(file.name)) throw new Error(`The ZIP would hold ${file.name} twice.`)
    seen.add(file.name)
    const name = ascii(file.name), crc = crc32(file.bytes), size = file.bytes.length, offset = out.length
    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, VERSION, true); local.setUint16(6, UTF8, true); local.setUint16(8, 0, true)
    local.setUint16(10, DOS_TIME, true); local.setUint16(12, DOS_DATE, true); local.setUint32(14, crc, true)
    local.setUint32(18, size, true); local.setUint32(22, size, true); local.setUint16(26, name.length, true); local.setUint16(28, 0, true)
    out.push(new Uint8Array(local.buffer)); out.push(name); out.push(file.bytes)
    const central = new DataView(new ArrayBuffer(46))
    central.setUint32(0, 0x02014b50, true); central.setUint16(4, VERSION, true); central.setUint16(6, VERSION, true); central.setUint16(8, UTF8, true)
    central.setUint16(10, 0, true); central.setUint16(12, DOS_TIME, true); central.setUint16(14, DOS_DATE, true); central.setUint32(16, crc, true)
    central.setUint32(20, size, true); central.setUint32(24, size, true); central.setUint16(28, name.length, true)
    // Extra field, comment, disk, internal and external attributes are all zero.
    central.setUint32(42, offset, true)
    directory.push(new Uint8Array(central.buffer)); directory.push(name)
  }
  const directoryOffset = out.length
  out.push(directory.bytes())
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true)
  end.setUint32(12, directory.length, true); end.setUint32(16, directoryOffset, true)
  out.push(new Uint8Array(end.buffer))
  return out.bytes()
}

/** As the panel names card images: lower case, accents dropped, words joined by hyphens, at most 60 characters. */
const slug = (text: string) => text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '') || 'post'

/** A slide's PNG name, its number padded to the count's digits so the files sort in order. */
export const slideFileName = (title: string, number: number, count: number) =>
  `pdfpal-${slug(title)}-slide-${String(number).padStart(String(count).length, '0')}.png`

/** The name of the whole carousel's PDF or ZIP. */
export const carouselFileName = (title: string, extension: 'pdf' | 'zip') => `pdfpal-${slug(title)}-carousel.${extension}`

// ── In the browser ────────────────────────────────────────────────────────────────────────────────────────────────

/** A canvas encoded as PNG or JPEG bytes. */
export function canvasBytes(canvas: HTMLCanvasElement, type: 'image/png' | 'image/jpeg', quality?: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => canvas.toBlob(blob => {
    if (!blob) { reject(new Error('The slide image could not be encoded.')); return }
    blob.arrayBuffer().then(buffer => resolve(new Uint8Array(buffer)), reject)
  }, type, quality))
}

/** JPEG quality for the PDF: text stays crisp and a 7-slide document stays a few megabytes. */
export const PDF_JPEG_QUALITY = 0.92

/** The slides, in order, as one PDF: one page per slide. */
export async function slidesPdf(slides: HTMLCanvasElement[]): Promise<Blob> {
  const pages = []
  for (const canvas of slides) pages.push({ jpeg: await canvasBytes(canvas, 'image/jpeg', PDF_JPEG_QUALITY), width: canvas.width, height: canvas.height })
  return new Blob([pdfFromJpegs(pages) as Uint8Array<ArrayBuffer>], { type: 'application/pdf' })
}

/** The slides, in order, as one ZIP of PNG files named by slideFileName. */
export async function slidesZip(slides: HTMLCanvasElement[], title: string): Promise<Blob> {
  const files = []
  for (const [index, canvas] of slides.entries()) files.push({ name: slideFileName(title, index + 1, slides.length), bytes: await canvasBytes(canvas, 'image/png') })
  return new Blob([zipStore(files) as Uint8Array<ArrayBuffer>], { type: 'application/zip' })
}
