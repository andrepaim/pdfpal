import { expect } from '@playwright/test';

// Reading the carousel exports back in the browser tests: the entries of a stored ZIP and the pages of a PDF.

/** The names of the files in a stored ZIP, read from its central directory. */
export function zipNames(bytes: Buffer): string[] {
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(end).toBeGreaterThan(0);
  const count = bytes.readUInt16LE(end + 10), names: string[] = [];
  let at = bytes.readUInt32LE(end + 16);
  for (let index = 0; index < count; index++) {
    expect(bytes.readUInt32LE(at)).toBe(0x02014b50);
    const nameLength = bytes.readUInt16LE(at + 28), extra = bytes.readUInt16LE(at + 30), comment = bytes.readUInt16LE(at + 32);
    names.push(bytes.subarray(at + 46, at + 46 + nameLength).toString('utf8'));
    // Each entry's local header is where the directory says, and holds a PNG.
    const local = bytes.readUInt32LE(at + 42);
    expect(bytes.readUInt32LE(local)).toBe(0x04034b50);
    const data = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    expect(bytes.subarray(data, data + 8).toString('hex')).toBe('89504e470d0a1a0a');
    at += 46 + nameLength + extra + comment;
  }
  return names;
}

/** The number of pages in a PDF: its page tree's count, checked against its page objects. */
export function pdfPages(bytes: Buffer): number {
  const text = bytes.toString('latin1');
  expect(text.startsWith('%PDF-')).toBe(true);
  expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
  const pages = (text.match(/\/Type \/Page(?!s)\b/g) ?? []).length;
  expect(Number(/\/Type \/Pages [^>]*\/Count (\d+)/.exec(text)?.[1])).toBe(pages);
  expect((text.match(/\/Subtype \/Image/g) ?? []).length).toBe(pages);
  return pages;
}
