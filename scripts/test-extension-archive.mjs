import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';

const build = () => execFileSync(process.execPath, ['extension/build.mjs'], { stdio: 'inherit' });
build();
const first = await readFile('extension/package/companion.zip');
build();
const second = await readFile('extension/package/companion.zip');
assert.equal(createHash('sha256').update(first).digest('hex'), createHash('sha256').update(second).digest('hex'));
const files = unzipSync(second), manifest = JSON.parse(Buffer.from(files['manifest.json']).toString());
assert.equal(manifest.version, JSON.parse(await readFile('extension/package.json', 'utf8')).version);
for (const name of ['panel.html', 'panel.js', 'panel.css', 'background.js', 'capture.js', 'launch.js', 'ocr/worker.min.js', 'ocr/eng.traineddata.gz']) assert.ok(files[name], name);
assert.ok(Object.keys(files).some(name => name.endsWith('.wasm')));
assert.ok(!Object.keys(files).some(name => /\.map$|test-results|node_modules/.test(name)));
console.log('Deterministic extension archive and required assets verified.');
