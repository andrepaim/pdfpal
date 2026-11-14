// Render the shared book-and-conversation artwork at each target size, then encode native ICOs and the macOS ICNS.
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// macOS app icons sit on Apple's 1024 px grid: an 824 px rounded square centred with a 100 px margin.
export const macGrid = Object.freeze({ canvas: 1024, body: 824 })
// PNG-backed ICNS element types, in the order iconutil writes them. Each is rendered at its exact pixel size.
export const icnsTypes = Object.freeze([['icp4', 16], ['icp5', 32], ['ic11', 32], ['ic12', 64], ['ic07', 128], ['ic13', 256], ['ic08', 256], ['ic14', 512], ['ic09', 512], ['ic10', 1024]])

/** Re-frame the square SVG so its rounded-square body fills Apple's icon grid instead of the whole canvas. */
export function macArtwork(svg, size) {
  const open = /<svg\b[^>]*>/.exec(svg)
  const body = /<rect\b[^>]*\bx="([\d.]+)"[^>]*\by="([\d.]+)"[^>]*\bwidth="([\d.]+)"[^>]*\bheight="([\d.]+)"/.exec(svg)
  if (!open || !body) throw new Error('favicon.svg must start with a rounded-square <rect> body for the macOS icon')
  const [x, y, width, height] = body.slice(1).map(Number)
  if (width !== height) throw new Error('favicon.svg body must be square for the macOS icon')
  const extent = width * macGrid.canvas / macGrid.body
  const round = value => Number(value.toFixed(4))
  const viewBox = [round(x + width / 2 - extent / 2), round(y + height / 2 - extent / 2), round(extent), round(extent)].join(' ')
  return svg.replace(open[0], `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${viewBox}">`)
}

/** Encode an Apple Icon Image container from [type, PNG bytes] entries. */
export function icns(entries) {
  const chunks = entries.map(([type, png]) => {
    if (!/^[a-z0-9]{4}$/i.test(type)) throw new Error(`Invalid ICNS element type: ${type}`)
    if (!png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) throw new Error(`ICNS element ${type} is not PNG data`)
    const header = Buffer.alloc(8)
    header.write(type, 0, 'latin1'); header.writeUInt32BE(png.length + 8, 4)
    return Buffer.concat([header, png])
  })
  const header = Buffer.alloc(8)
  header.write('icns', 0, 'latin1'); header.writeUInt32BE(8 + chunks.reduce((total, chunk) => total + chunk.length, 0), 4)
  return Buffer.concat([header, ...chunks])
}

/** Read an ICNS container back into its elements (used by the tests and as a self-check). */
export function readIcns(bytes) {
  if (bytes.toString('latin1', 0, 4) !== 'icns' || bytes.readUInt32BE(4) !== bytes.length) throw new Error('Not an ICNS container')
  const elements = []
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset + 4)
    if (length < 8 || offset + length > bytes.length) throw new Error('Corrupt ICNS element')
    const data = bytes.subarray(offset + 8, offset + length)
    elements.push({ type: bytes.toString('latin1', offset, offset + 4), data, width: data.readUInt32BE(16), height: data.readUInt32BE(20) })
    offset += length
  }
  return elements
}

async function main() {
  const { createCanvas, loadImage } = await import('@napi-rs/canvas')
  const publicDirectory = new URL('../../frontend/public/', import.meta.url)
  const source = await fs.readFile(new URL('favicon.svg', publicDirectory), 'utf8')
  async function render(size) {
    const image = await loadImage(Buffer.from(source.replace('width="512" height="512"', `width="${size}" height="${size}"`)))
    const canvas = createCanvas(size, size)
    canvas.getContext('2d').drawImage(image, 0, 0)
    return canvas
  }
  async function renderMac(size) {
    const image = await loadImage(Buffer.from(macArtwork(source, size)))
    const canvas = createCanvas(size, size), context = canvas.getContext('2d')
    // A soft drop shadow below the body, as in Apple's app icon template.
    const scale = size / macGrid.canvas
    context.shadowColor = 'rgba(0, 0, 0, 0.28)'; context.shadowBlur = 24 * scale; context.shadowOffsetY = 10 * scale
    context.drawImage(image, 0, 0)
    return canvas.toBuffer('image/png')
  }
  function iconFrame(canvas) {
    const size = canvas.width
    if (size === 256) return { size, bytes: canvas.toBuffer('image/png') }
    // NSIS/GDI consumers treat small PNG-compressed icon frames as bitmap data.
    // Use bottom-up 32-bit DIBs, followed by their padded 1-bit transparency masks.
    const rgba = canvas.getContext('2d').getImageData(0, 0, size, size).data
    const maskStride = Math.ceil(size / 32) * 4
    const bytes = Buffer.alloc(40 + size * size * 4 + maskStride * size)
    bytes.writeUInt32LE(40, 0)
    bytes.writeInt32LE(size, 4); bytes.writeInt32LE(size * 2, 8)
    bytes.writeUInt16LE(1, 12); bytes.writeUInt16LE(32, 14)
    bytes.writeUInt32LE(size * size * 4, 20)
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const source = (y * size + x) * 4
      const destination = 40 + ((size - y - 1) * size + x) * 4
      bytes[destination] = rgba[source + 2]; bytes[destination + 1] = rgba[source + 1]
      bytes[destination + 2] = rgba[source]; bytes[destination + 3] = rgba[source + 3]
      if (rgba[source + 3] === 0) bytes[40 + size * size * 4 + (size - y - 1) * maskStride + (x >> 3)] |= 0x80 >> (x % 8)
    }
    return { size, bytes }
  }
  async function writeIcon(target, sizes) {
    const images = []
    for (const size of sizes) images.push(iconFrame(await render(size)))
    const header = Buffer.alloc(6 + 16 * images.length)
    header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4)
    let offset = header.length
    images.forEach(({ size, bytes }, index) => {
      const entry = 6 + index * 16
      header[entry] = size === 256 ? 0 : size; header[entry + 1] = header[entry]
      header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6)
      header.writeUInt32LE(bytes.length, entry + 8); header.writeUInt32LE(offset, entry + 12)
      offset += bytes.length
    })
    await fs.writeFile(target, Buffer.concat([header, ...images.map(image => image.bytes)]))
  }
  for (const [filename, size] of [['favicon-16.png', 16], ['favicon-32.png', 32], ['icon-192.png', 192], ['icon-512.png', 512], ['logo.png', 512]]) {
    await fs.writeFile(new URL(filename, publicDirectory), (await render(size)).toBuffer('image/png'))
  }
  // Retain the older public JPEG URL with the same artwork on a white background.
  const jpeg = createCanvas(512, 512), context = jpeg.getContext('2d')
  context.fillStyle = '#fff'; context.fillRect(0, 0, 512, 512)
  context.drawImage(await render(512), 0, 0)
  await fs.writeFile(new URL('favicon.jpg', publicDirectory), jpeg.toBuffer('image/jpeg'))
  await writeIcon(new URL('favicon.ico', publicDirectory), [16, 32, 48])
  await writeIcon(new URL('../build/icon.ico', import.meta.url), [16, 20, 24, 32, 40, 48, 64, 128, 256])
  const rendered = new Map()
  for (const [, size] of icnsTypes) if (!rendered.has(size)) rendered.set(size, await renderMac(size))
  const container = icns(icnsTypes.map(([type, size]) => [type, rendered.get(size)]))
  readIcns(container)
  await fs.writeFile(new URL('../build/icon.icns', import.meta.url), container)
  console.log('Browser, companion, Windows and macOS icons generated from frontend/public/favicon.svg')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
