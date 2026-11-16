/** The largest card image the reader may put on the clipboard. A 1080×1920 card is well under 2 MB. */
export const MAX_CLIPBOARD_IMAGE_BYTES = 8 * 1024 * 1024
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/**
 * Checks bytes sent by the renderer before they reach nativeImage: a byte array of at most 8 MB that starts with
 * the PNG signature. Returns them as a Buffer, or throws.
 */
export function clipboardPng(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new Error('The card image must be sent as bytes.')
  if (bytes.byteLength > MAX_CLIPBOARD_IMAGE_BYTES) throw new Error('The card image is too large to copy.')
  if (bytes.byteLength <= PNG_SIGNATURE.length || PNG_SIGNATURE.some((value, index) => bytes[index] !== value)) throw new Error('The card image must be a PNG.')
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}
