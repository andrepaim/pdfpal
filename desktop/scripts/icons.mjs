// Render the shared open-book artwork at each target size, then encode native ICOs.
import fs from 'node:fs/promises'
import { createCanvas, loadImage } from '@napi-rs/canvas'
const publicDirectory = new URL('../../frontend/public/', import.meta.url)
const source = await fs.readFile(new URL('favicon.svg', publicDirectory), 'utf8')
async function render(size) {
  const image = await loadImage(Buffer.from(source.replace('width="512" height="512"', `width="${size}" height="${size}"`)))
  const canvas = createCanvas(size, size)
  canvas.getContext('2d').drawImage(image, 0, 0)
  return canvas
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
console.log('Browser, companion and Windows icons generated from frontend/public/favicon.svg')
