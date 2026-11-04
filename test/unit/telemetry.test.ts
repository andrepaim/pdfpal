import { test } from "node:test";
import assert from "node:assert/strict";
import { Telemetry } from "../../src/core/telemetry.js";
import { testConfig, testDb, cleanup } from "../helpers/test-utils.js";
test("telemetry is opt in, redacts unknown fields, contains sink failures and clears diagnostics on revocation", async () => {
  const config = testConfig(),
    db = testDb(config),
    sent: unknown[] = [];
  try {
    const telemetry = new Telemetry(db, (event) => {
      sent.push(event);
      throw Error("Unavailable");
    });
    await telemetry.record({ name: "sync_batch", outcome: "completed" });
    assert.equal(sent.length, 0);
    assert.equal(
      (db.prepare("SELECT COUNT(*) n FROM telemetry_journal").get() as any).n,
      0,
    );
    telemetry.setConsent({ diagnostics: true, usage: false });
    await telemetry.record({
      name: "sync_batch",
      outcome: "failed",
      email: "secret@example.com",
      content: "private PDF",
    } as any);
    const entry = (
      db.prepare("SELECT event FROM telemetry_journal").get() as any
    ).event;
    assert.ok(!entry.includes("private"));
    assert.ok(!entry.includes("secret"));
    assert.equal(sent.length, 0);
    telemetry.setConsent({ diagnostics: false, usage: true });
    assert.equal(
      (db.prepare("SELECT COUNT(*) n FROM telemetry_journal").get() as any).n,
      0,
    );
    await telemetry.record({ name: "search", outcome: "completed" });
    assert.equal(sent.length, 1);
    telemetry.setConsent({ diagnostics: false, usage: false });
    await telemetry.record({ name: "search", outcome: "completed" });
    assert.equal(sent.length, 1);
  } finally {
    cleanup(config, db);
  }
});
