// Repackage the existing pdfpal logo for Windows; no new artwork.
import fs from 'node:fs/promises'
import { createCanvas, loadImage } from '@napi-rs/canvas'
const source = new URL('../../frontend/public/icon-512.png', import.meta.url)
const target = new URL('../build/icon.ico', import.meta.url)
const logo = await loadImage(await fs.readFile(source))
const images = [16, 20, 24, 32, 40, 48, 64, 128, 256].map(size => {
  let scaled = logo
  // Repeated halving avoids aliasing fine logo details at small Windows sizes.
  while (scaled.width > size * 2) {
    const next = createCanvas(Math.ceil(scaled.width / 2), Math.ceil(scaled.height / 2))
    const sampler = next.getContext('2d')
    sampler.imageSmoothingQuality = 'high'
    sampler.drawImage(scaled, 0, 0, next.width, next.height)
    scaled = next
  }
  const canvas = createCanvas(size, size), context = canvas.getContext('2d')
  context.imageSmoothingQuality = 'high'
  context.drawImage(scaled, 0, 0, size, size)
  if (size === 256) return { size, bytes: canvas.toBuffer('image/png') }
  // NSIS/GDI consumers treat small PNG-compressed icon frames as bitmap data.
  // Use bottom-up 32-bit DIBs, followed by their padded 1-bit transparency masks.
  const rgba = context.getImageData(0, 0, size, size).data
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
})
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
console.log('Windows icon generated from frontend/public/icon-512.png')
