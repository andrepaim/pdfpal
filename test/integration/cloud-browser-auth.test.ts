import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildServer } from "../../src/server/app.js";
import { testConfig } from "../helpers/test-utils.js";
import fs from "node:fs";
import { CloudAuth } from '../../src/sync/auth.js';
const previousKey = process.env.PDFPAL_FIREBASE_API_KEY;
before(() => { process.env.PDFPAL_FIREBASE_API_KEY = "synthetic-firebase-key"; });
after(() => {
  if (previousKey === undefined) delete process.env.PDFPAL_FIREBASE_API_KEY;
  else process.env.PDFPAL_FIREBASE_API_KEY = previousKey;
});

test('an in-flight sign-in blocks canonical selection, recovery and logout until account verification finishes', async () => {
  const config = testConfig(), app = await buildServer(config);
  const original = CloudAuth.prototype.browserCallback;
  let release!: () => void, started!: () => void;
  const verifying = new Promise<void>(resolve => { started = resolve; });
  const finish = new Promise<void>(resolve => { release = resolve; });
  CloudAuth.prototype.browserCallback = async () => { started(); await finish; };
  try {
    const callback = app.inject({ method: 'POST', url: '/api/cloud/auth/browser',
      headers: { host: '127.0.0.1' }, payload: { state: 'x'.repeat(40), idToken: 'synthetic-token', refreshToken: 'synthetic-refresh' } });
    const pending = callback.then(response => response);
    await verifying;
    for (const route of ['canonical', 'restore-account', 'logout']) {
      const response = await app.inject({ method: 'POST', url: `/api/cloud/${route}`,
        headers: { host: '127.0.0.1' }, payload: route === 'canonical' ? { libraryId: 'windows-library' } : {} });
      assert.equal(response.statusCode, 500);
      assert.match(response.json().detail, /Wait for synchronization to finish/);
    }
    release();
    assert.equal((await pending).statusCode, 200);
    assert.equal((await app.inject({ method: 'POST', url: '/api/cloud/logout', headers: { host: '127.0.0.1' } })).statusCode, 200);
  } finally {
    release();
    CloudAuth.prototype.browserCallback = original;
    await app.close();
    fs.rmSync(config.dataDir, { recursive: true, force: true });
  }
});
test("hosted browser form completes local sign-in, rejects wrong origin/replay, and never echoes tokens", async () => {
  const config = testConfig(),
    app = await buildServer(config),
    original = globalThis.fetch;
  try {
    await app.listen({ host: "127.0.0.1", port: 0 });
    const start = await app.inject({
      method: "POST",
      url: "/api/cloud/login",
      headers: { host: "127.0.0.1" },
    });
    assert.equal(start.statusCode, 200);
    const url = new URL(start.json().url),
      state = new URLSearchParams(url.hash.slice(1)).get("state")!;
    globalThis.fetch = async (input) =>
      new Response(
        JSON.stringify(
          String(input).includes("accounts:lookup")
            ? {
                users: [
                  {
                    localId: "alice",
                    email: "alice@example.test",
                    providerUserInfo: [{ providerId: "google.com" }],
                  },
                ],
              }
            : {
                user_id: "alice",
                id_token: "checked-token",
                refresh_token: "checked-refresh",
                expires_in: "3600",
              },
        ),
      );
    const form = new URLSearchParams({
      state,
      idToken: "synthetic-id-token",
      refreshToken: "synthetic-refresh-token",
    }).toString();
    const callback = (origin: string) =>
      app.inject({
        method: "POST",
        url: "/api/cloud/auth/browser",
        headers: {
          host: "127.0.0.1",
          origin,
          "sec-fetch-site": "cross-site",
          "content-type": "application/x-www-form-urlencoded",
        },
        payload: form,
      });
    assert.equal((await callback("https://evil.example")).statusCode, 400);
    const response = await callback(url.origin);
    assert.equal(response.statusCode, 200);
    assert.ok(!response.body.includes("synthetic-id-token"));
    assert.ok(response.body.includes("Google account connected"));
    const status = (
      await app.inject({
        url: "/api/cloud/status",
        headers: { host: "127.0.0.1" },
      })
    ).json();
    assert.equal(status.account.uid, "alice");
    assert.equal(status.enabled, false);
    assert.equal((await callback(url.origin)).statusCode, 400);
  } finally {
    globalThis.fetch = original;
    await app.close();
    fs.rmSync(config.dataDir, { recursive: true, force: true });
  }
});
