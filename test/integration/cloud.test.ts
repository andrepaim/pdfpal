import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { SyncWorker } from "../../src/sync/worker.js";
import { CloudAuth } from "../../src/sync/auth.js";
import { applyChange, pending, setting } from "../../src/sync/database.js";
import {
  operationSchema,
  type Change,
  type Operation,
  type Receipt,
} from "../../src/shared/sync/schema.js";
import { ProjectService } from "../../src/core/projects.js";
import { NoteService } from "../../src/core/notes.js";
import { testConfig, testDb, cleanup } from "../helpers/test-utils.js";

class MemoryStore {
  roots = new Map<
    string,
    { title: string; changes: Change[]; receipts: Map<string, Receipt> }
  >();
  key(uid: string, id: string) {
    return `${uid}/${id}`;
  }
  async libraries(uid: string) {
    return [...this.roots]
      .filter(([k]) => k.startsWith(uid + "/"))
      .map(([k, v]) => ({ id: k.split("/")[1]!, title: v.title }));
  }
  async create(uid: string, id: string, title: string) {
    this.roots.set(this.key(uid, id), {
      title,
      changes: [],
      receipts: new Map(),
    });
  }
  root(uid: string, id: string) {
    const root = this.roots.get(this.key(uid, id));
    if (!root) throw Error("Not found");
    return root;
  }
  async apply(uid: string, id: string, op: Operation): Promise<Receipt> {
    const root = this.root(uid, id);
    if (root.receipts.has(op.operationId))
      return root.receipts.get(op.operationId)!;
    const current =
      root.changes
        .filter(
          (c) => c.entityType === op.entityType && c.entityId === op.entityId,
        )
        .at(-1) ?? null;
    const result: Receipt =
      (current?.revision ?? 0) !== op.baseRevision
        ? { status: "conflict", current }
        : { status: "applied", revision: op.baseRevision + 1 };
    if (result.status === "applied")
      root.changes.push({
        sequence: root.changes.length + 1,
        operationId: op.operationId,
        entityType: op.entityType,
        entityId: op.entityId,
        revision: result.revision,
        payload: op.payload,
      });
    root.receipts.set(op.operationId, result);
    return result;
  }
  async changes(uid: string, id: string, cursor: number) {
    return this.root(uid, id)
      .changes.filter((c) => c.sequence > cursor)
      .slice(0, 100);
  }
  async source(uid: string, id: string, source: string) {
    return (
      this.root(uid, id)
        .changes.filter(
          (c) => c.entityType === "sources" && c.entityId === source,
        )
        .at(-1)?.payload ?? null
    );
  }
}
test("SQLite outbox captures CLI writes atomically and excludes local PDF paths", () => {
  const config = testConfig(),
    db = testDb(config);
  try {
    setting(db, "enabled", "1");
    const project = new ProjectService(db).create("Research");
    const notes = new NoteService(db, config);
    notes.create(project.id, { content: "First" });
    assert.equal(pending(db).length, 2);
    assert.throws(() =>
      db.transaction(() => {
        notes.create(project.id, { content: "Rolled back" });
        throw Error("rollback");
      })(),
    );
    assert.equal(pending(db).length, 2);
    for (const op of pending(db))
      assert.ok(operationSchema.safeParse(op).success);
    setting(db, "paused", "1");
    notes.create(project.id, { content: "Offline" });
    assert.equal(pending(db).length, 3);
    setting(db, "applying", "1");
    applyChange(db, {
      sequence: 1,
      operationId: "remote",
      entityType: "projects",
      entityId: "remote",
      revision: 1,
      payload: {
        id: "remote",
        title: "Remote",
        description: "",
        created_at: "now",
        accessed_at: "now",
      },
    });
    setting(db, "applying", "0");
    assert.equal(pending(db).length, 3);
  } finally {
    cleanup(config, db);
  }
});
test("two clients converge, retries are idempotent, and conflicting notes retain both versions", async () => {
  const old = { ...process.env };
  process.env.PDFPAL_FIREBASE_PROJECT_ID = "demo-pdfpal-sync";
  process.env.PDFPAL_FIREBASE_API_KEY = "test";
  process.env.PDFPAL_GOOGLE_CLIENT_ID = "test";
  const store = new MemoryStore(),
    a = testConfig(),
    b = testConfig(),
    adb = testDb(a),
    bdb = testDb(b);
  function client(config: typeof a, db: typeof adb) {
    const auth = new CloudAuth(config);
    auth.credentials = {
      uid: "alice",
      email: "a@example.com",
      idToken: "alice",
      refreshToken: "test",
      expiresAt: Date.now() + 100000,
    };
    const worker = new SyncWorker(db, config, auth);
    worker.transport.head = async () => ({ generation: "g1" });
    worker.request = async (route: string, body?: unknown): Promise<any> => {
      if (route === "/libraries") return store.libraries("alice");
      const parts = route.split("/");
      const id = parts[2]!;
      if (route.includes("/operations"))
        return store.apply("alice", id, body as Operation);
      if (route.includes("/changes"))
        return {
          changes: await store.changes(
            "alice",
            id,
            Number(new URL(route, "http://x").searchParams.get("cursor")),
          ),
          cursor: store.root("alice", id).changes.length,
        };
      throw Error(route);
    };
    return worker;
  }
  try {
    const id = randomUUID();
    await store.create("alice", id, "Shared");
    const wa = client(a, adb),
      wb = client(b, bdb);
    await wa.connect("Shared", id);
    await wb.connect("Shared", id);
    const project = new ProjectService(adb).create("Synced");
    const note = new NoteService(adb, a).create(project.id, {
      content: "Original",
    });
    const op = pending(adb)[0]!;
    assert.deepEqual(
      await store.apply("alice", id, op),
      await store.apply("alice", id, op),
    );
    await wa.run();
    assert.equal(wa.error, "");
    assert.equal(new SyncWorker(adb,a,wa.auth).lastSync,wa.lastSync);
    await wb.run();
    assert.equal(wb.error, "");
    assert.equal(
      new NoteService(bdb, b).resolve(project.id, note.id).content,
      "Original",
    );
    new NoteService(adb, a).update(project.id, note.id, {
      content: "Alice edit",
    });
    new NoteService(bdb, b).update(project.id, note.id, {
      content: "Other edit",
    });
    await wa.run();
    await wb.run();
    assert.match(wb.error, /conflicting/);
    assert.equal(
      new NoteService(bdb, b).resolve(project.id, note.id).content,
      "Other edit",
    );
    assert.equal(wb.status().conflicts, 1);
    const conflict = JSON.parse(
      (bdb.prepare("SELECT remote FROM sync_conflicts").get() as any).remote,
    );
    assert.equal(conflict.payload.content, "Alice edit");
    wb.auth.credentials!.uid = "bob";
    await wb.run();
    assert.match(wb.error, /account/);
  } finally {
    cleanup(a, adb);
    cleanup(b, bdb);
    for (const key of [
      "PDFPAL_FIREBASE_PROJECT_ID",
      "PDFPAL_FIREBASE_API_KEY",
      "PDFPAL_GOOGLE_CLIENT_ID",
    ]) {
      if (old[key] === undefined) delete process.env[key];
      else process.env[key] = old[key];
    }
  }
});
