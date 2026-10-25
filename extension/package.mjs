import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { zipSync } from 'fflate';

const root = fileURLToPath(new URL('.', import.meta.url));
const files = {};
async function collect(relative = '') {
  const entries = await readdir(path.join(root, 'dist', relative), { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) await collect(name);
    else if (entry.isFile()) files[name] = [await readFile(path.join(root, 'dist', name)), { mtime: new Date(2000, 0, 1), os: 3, attrs: 0o100644 << 16 }];
  }
}
await collect();
const archive = zipSync(files, { level: 6 });
const manifest = JSON.parse(await readFile(path.join(root, 'dist/manifest.json'), 'utf8'));
const metadata = { version: manifest.version, filename: `pdfpal-kindle-companion-${manifest.version}.zip`, size: archive.length,
  sha256: createHash('sha256').update(archive).digest('hex'), extension_id: 'billjanehfdgcakkbbefbjobocjlinen' };
await mkdir(path.join(root, 'package'), { recursive: true });
await writeFile(path.join(root, 'package/companion.zip'), archive);
await writeFile(path.join(root, 'package/metadata.json'), JSON.stringify(metadata, null, 2) + '\n');
console.log(`Packaged ${metadata.filename} (${(archive.length / 1024 / 1024).toFixed(1)} MB)`);
