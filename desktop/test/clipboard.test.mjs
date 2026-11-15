import test from 'node:test'
import assert from 'node:assert/strict'
import { MAX_CLIPBOARD_IMAGE_BYTES, clipboardPng } from '../src/clipboard.mjs'

const png = body => Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...body])

test('a PNG within the size limit is accepted as a buffer of the same bytes', () => {
  const bytes = png([1, 2, 3])
  const buffer = clipboardPng(bytes)
  assert.ok(Buffer.isBuffer(buffer)); assert.deepEqual([...buffer], [...bytes])
  const offset = new Uint8Array(new ArrayBuffer(20), 4, 12); offset.set(png([9, 9, 9, 9]))
  assert.deepEqual([...clipboardPng(offset)], [...offset])
  const largest = new Uint8Array(MAX_CLIPBOARD_IMAGE_BYTES); largest.set(png([]))
  assert.equal(clipboardPng(largest).length, MAX_CLIPBOARD_IMAGE_BYTES)
})

test('anything else is refused before it reaches the native image decoder', () => {
  for (const value of [undefined, null, 'png', [0x89, 0x50], new ArrayBuffer(16), { length: 9 }]) assert.throws(() => clipboardPng(value), /must be sent as bytes/)
  assert.throws(() => clipboardPng(png([])), /must be a PNG/)
  assert.throws(() => clipboardPng(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0])), /must be a PNG/)
  assert.throws(() => clipboardPng(new Uint8Array(0)), /must be a PNG/)
  const tooLarge = new Uint8Array(MAX_CLIPBOARD_IMAGE_BYTES + 1); tooLarge.set(png([]))
  assert.throws(() => clipboardPng(tooLarge), /too large/)
})
