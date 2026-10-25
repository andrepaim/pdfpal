import { build } from 'esbuild';
import { cp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { createHash, createPublicKey } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
if (!manifest.key) throw new Error('Keep the checked-in public manifest key: changing extension identity loses pairing.');
const publicKey = Buffer.from(manifest.key, 'base64');
createPublicKey({ key: publicKey, format: 'der', type: 'spki' });
const extensionId = createHash('sha256').update(publicKey).digest('hex').slice(0, 32)
  .replace(/[0-9a-f]/g, digit => String.fromCharCode(97 + parseInt(digit, 16)));
const out = path.join(root, 'dist');
await rm(out, { recursive: true, force: true });
await mkdir(path.join(out, 'ocr'), { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: ['src/background.ts', 'src/capture.ts', 'src/panel.ts'],
  bundle: true, outdir: out, format: 'iife', target: 'chrome116',
  define: { 'process.env.NODE_ENV': '"production"' }, jsx: 'automatic',
  loader: { '.woff': 'file', '.woff2': 'file', '.ttf': 'file' }, assetNames: 'assets/[name]-[hash]',
  sourcemap: true, legalComments: 'eof',
});
for (const file of ['manifest.json', 'panel.html', 'README.md']) await cp(path.join(root, file), path.join(out, file));
const tesseract = path.dirname(require.resolve('tesseract.js/package.json'));
const core = path.dirname(require.resolve('tesseract.js-core/package.json'));
const english = path.dirname(require.resolve('@tesseract.js-data/eng/package.json'));
await cp(path.join(tesseract, 'dist/worker.min.js'), path.join(out, 'ocr/worker.min.js'));
for (const file of await readdir(core)) {
  if (/-lstm\.wasm(?:\.js)?$/.test(file)) await cp(path.join(core, file), path.join(out, 'ocr', file));
}
await cp(path.join(english, '4.0.0_best_int/eng.traineddata.gz'), path.join(out, 'ocr/eng.traineddata.gz'));
for (const [name, directory] of [['tesseract', tesseract], ['tesseract-core', core], ['english-data', english]]) {
  const license = (await readdir(directory)).find(file => /^license(?:\.|$)/i.test(file));
  if (license) await cp(path.join(directory, license), path.join(out, 'ocr', `${name}-LICENSE`));
}
console.log(`Unpacked extension built at ${out}`);
console.log(`Stable extension ID: ${extensionId}`);
