import { test } from "node:test";
import assert from "node:assert/strict";
import { loadFirebaseClient } from "../../src/shared/firebase-client.js";

test("Firebase client config loads from Hosting without credentials or caching", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (input, options) => {
    assert.equal(String(input), "https://demo-pdfpal-sync.web.app/__/firebase/init.json");
    assert.equal(options?.credentials, "omit");
    assert.equal(options?.redirect, "error");
    assert.equal(options?.cache, "no-store");
    return Response.json({ projectId: "demo-pdfpal-sync", apiKey: "synthetic-runtime-key", appId: "synthetic-app", authDomain: "demo-pdfpal-sync.firebaseapp.com", unexpected: "discard this field" });
  };
  try {
    const result = await loadFirebaseClient("demo-pdfpal-sync");
    assert.equal(result.apiKey, "synthetic-runtime-key");
    assert.equal(Object.hasOwn(result, "unexpected"), false);
  } finally { globalThis.fetch = original; }
});

test("Firebase config rejects another project without exposing the returned payload", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ projectId: "another-project", apiKey: "do-not-echo-this" });
  try {
    await assert.rejects(loadFirebaseClient("demo-pdfpal-sync"), error => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /configuration is unavailable/);
      assert.ok(!error.message.includes("do-not-echo-this"));
      return true;
    });
  } finally { globalThis.fetch = original; }
});

test("Firebase config rejects invalid project identifiers before making a request", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw Error("Must not request an untrusted URL"); };
  try { await assert.rejects(loadFirebaseClient("../another-host"), /Invalid Firebase project/); }
  finally { globalThis.fetch = original; }
});
