import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CloudAuth } from '../../src/sync/auth.js';
import { FirebaseTransport, encode } from '../../src/sync/firebase.js';

function transport() {
  const auth = new CloudAuth({} as any);
  auth.credentials = { uid: 'alice', email: '', idToken: 'synthetic', refreshToken: '', expiresAt: Infinity };
  return new FirebaseTransport(auth);
}
const doc = (value: unknown) => ({ fields: encode(value).mapValue.fields });
const library = (id: string) => ({ name: `users/alice/libraries/${id}`, ...doc({ active: true, protocol: 2, generation: 'g1', sequence: 10 }) });

test('account discovery failures never fall back to creating a library', async () => {
  const original = globalThis.fetch;
  try {
    for (const status of [401, 403, 429, 503]) {
      const methods: string[] = [];
      globalThis.fetch = async (_input, options) => {
        methods.push(options?.method ?? 'GET');
        return Response.json({ error: { status: 'UNAVAILABLE' } }, { status });
      };
      await assert.rejects(transport().resolveLibrary('Device library'));
      assert.deepEqual(methods, ['GET']);
    }
    let calls = 0;
    globalThis.fetch = async () => { calls++; throw Error('Offline'); };
    await assert.rejects(transport().resolveLibrary('Device library'), /Offline/);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});

test('legacy duplicates require an explicit canonical selection, including direct create callers', async () => {
  const original = globalThis.fetch;
  const methods: string[] = [];
  globalThis.fetch = async (input, options) => {
    methods.push(options?.method ?? 'GET');
    return String(input).endsWith('/settings/cloudLibrary')
      ? new Response('', { status: 404 })
      : Response.json({ documents: [library('windows'), library('linux')] });
  };
  try {
    await assert.rejects(transport().resolveLibrary('Device library'), /Choose the account library/);
    await assert.rejects(transport().create('Device library'), /Choose the account library/);
    assert.ok(methods.every(method => method === 'GET'));
  } finally { globalThis.fetch = original; }
});

test('canonical selection is immutable and does not accept another library', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json(doc({ libraryId: 'windows' })); };
  try {
    assert.deepEqual(await transport().resolveLibrary('Device library'), { id: 'windows', created: false });
    await assert.rejects(transport().resolveLibrary('Device library', 'linux'), /account library selected/);
    await assert.rejects(transport().claimCanonical('linux'), /different account library/);
    assert.equal(calls, 3);
  } finally { globalThis.fetch = original; }
});

test('legacy discovery follows all pages before deciding whether selection is ambiguous', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (input, options) => {
    calls++;
    assert.equal(options?.method, 'GET');
    const url = String(input);
    if (url.endsWith('/settings/cloudLibrary')) return new Response('', { status: 404 });
    if (url.includes('pageToken=second')) return Response.json({ documents: [library('linux')] });
    return Response.json({ documents: [library('windows')], nextPageToken: 'second' });
  };
  try {
    await assert.rejects(transport().resolveLibrary('Device library'), /Choose the account library/);
    assert.equal(calls, 3);
  } finally { globalThis.fetch = original; }
});
