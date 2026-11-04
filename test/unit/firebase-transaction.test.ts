import { test } from "node:test";
import assert from "node:assert/strict";
import { CloudAuth } from "../../src/sync/auth.js";
import { FirebaseTransport, encode } from "../../src/sync/firebase.js";
test("Firebase user transactions use atomic version preconditions, never server-IAM transaction endpoints", async () => {
  const original = globalThis.fetch,
    auth = new CloudAuth({} as any);
  auth.credentials = {
    uid: "alice",
    email: "",
    idToken: "user-token",
    refreshToken: "",
    expiresAt: Infinity,
  };
  const writes: any[] = [];
  let calls = 0;
  globalThis.fetch = async (input, options) => {
    calls++;
    const url = String(input),
      body = JSON.parse(String(options?.body));
    assert.ok(
      !url.endsWith(":beginTransaction") && !url.endsWith(":rollback"),
      "Firebase ID tokens cannot use server-IAM transaction endpoints",
    );
    if (url.endsWith(":batchGet"))
      return new Response(
        JSON.stringify([
          {
            found: {
              name: body.documents[0],
              fields: encode({
                title: "Library",
                generation: "g1",
                sequence: 0,
                active: true,
                protocol: 1,
              }).mapValue.fields,
              updateTime: "2026-11-04T12:00:00.000000Z",
            },
          },
          { missing: body.documents[1] },
          { missing: body.documents[2] },
        ]),
      );
    assert.ok(url.endsWith(":commit"));
    assert.equal(body.transaction, undefined);
    writes.push(...body.writes);
    return new Response(JSON.stringify({ commitTime: "now" }));
  };
  try {
    const result = await new FirebaseTransport(auth).apply("library", "g1", {
      operationId: "op1",
      entityType: "projects",
      entityId: "project1",
      baseRevision: 0,
      action: "put",
      payload: {
        id: "project1",
        title: "Synthetic",
        description: "",
        created_at: "now",
        accessed_at: "now",
      },
    });
    assert.equal(result.status, "applied");
    assert.equal(calls, 2);
    assert.equal(writes.length, 4);
    assert.deepEqual(writes[0].currentDocument, {
      updateTime: "2026-11-04T12:00:00.000000Z",
    });
    for (const write of writes.slice(1))
      assert.deepEqual(write.currentDocument, { exists: false });
  } finally {
    globalThis.fetch = original;
  }
});
