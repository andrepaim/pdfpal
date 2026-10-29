// Repackage the existing pdfpal logo for Windows; no new artwork.
import fs from 'node:fs/promises'
import { createCanvas, loadImage } from '@napi-rs/canvas'
const source = new URL('../../frontend/public/icon-512.png', import.meta.url)
const target = new URL('../build/icon.ico', import.meta.url)
const logo = await loadImage(await fs.readFile(source))
const images = [16, 32, 48, 64, 128, 256].map(size => {
  const canvas = createCanvas(size, size), context = canvas.getContext('2d')
  context.drawImage(logo, 0, 0, size, size)
  return { size, bytes: canvas.toBuffer('image/png') }
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
