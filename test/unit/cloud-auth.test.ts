import { test } from "node:test";
import assert from "node:assert/strict";
import { CloudAuth } from "../../src/sync/auth.js";
import { testConfig } from "../helpers/test-utils.js";
import fs from "node:fs";
test("logout invalidates a token refresh in flight", async () => {
  const config = testConfig(),
    auth = new CloudAuth(config),
    original = globalThis.fetch;
  const old = {
    project: process.env.PDFPAL_FIREBASE_PROJECT_ID,
    key: process.env.PDFPAL_FIREBASE_API_KEY,
    client: process.env.PDFPAL_GOOGLE_CLIENT_ID,
  };
  process.env.PDFPAL_FIREBASE_PROJECT_ID = "demo-pdfpal-sync";
  process.env.PDFPAL_FIREBASE_API_KEY = "test";
  process.env.PDFPAL_GOOGLE_CLIENT_ID = "test";
  let finish!: (value: Response) => void;
  globalThis.fetch = async () =>
    await new Promise<Response>((resolve) => {
      finish = resolve;
    });
  try {
    auth.credentials = {
      uid: "alice",
      email: "",
      idToken: "old",
      refreshToken: "old",
      expiresAt: 0,
    };
    const pending = auth.token();
    await auth.logout();
    finish(
      new Response(
        JSON.stringify({
          user_id: "alice",
          id_token: "new",
          refresh_token: "new",
          expires_in: "3600",
        }),
      ),
    );
    await assert.rejects(pending, /cancelled/);
    assert.equal(auth.credentials, null);
  } finally {
    globalThis.fetch = original;
    for (const [key, value] of Object.entries({
      PDFPAL_FIREBASE_PROJECT_ID: old.project,
      PDFPAL_FIREBASE_API_KEY: old.key,
      PDFPAL_GOOGLE_CLIENT_ID: old.client,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(config.dataDir, { recursive: true, force: true });
  }
});
