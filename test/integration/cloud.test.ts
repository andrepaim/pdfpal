import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { SyncWorker } from "../../src/sync/worker.js";
import { CloudAuth } from "../../src/sync/auth.js";
import { applyChange, pending, setting, seedConversations } from "../../src/sync/database.js";
import {
  operationSchema,
  type Change,
  type Operation,
  type Receipt,
} from "../../src/shared/sync/schema.js";
import { ProjectService } from "../../src/core/projects.js";
import { ChatService } from "../../src/core/chat.js";
import { createSource } from "../helpers/test-utils.js";
import { NoteService } from "../../src/core/notes.js";
import { testConfig, testDb, cleanup } from "../helpers/test-utils.js";

class MemoryStore {
  roots = new Map<
    string,
    { title: string; protocol: number; changes: Change[]; receipts: Map<string, Receipt> }
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
      protocol: 1,
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
  try {
    const id = randomUUID();
    await store.create("alice", id, "Shared");
    const wa = memoryClient(store, a, adb),
      wb = memoryClient(store, b, bdb);
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

test('saved chats require explicit opt-in, backfill once, and restore in order across pages and local message IDs', async () => {
  const store = new MemoryStore(), a = testConfig(), b = testConfig(), adb = testDb(a), bdb = testDb(b);
  try {
    const library = randomUUID(); await store.create('alice', library, 'Chats');
    const wa = memoryClient(store, a, adb), wb = memoryClient(store, b, bdb);
    await wa.connect('Chats', library);
    const project = new ProjectService(adb).create('Restored research');
    const source = createSource(adb, project.id);
    const chat = new ChatService(adb, a);
    for (let i = 0; i < 65; i++) chat.persist(project.id, source, `Question ${i} — π`, `Answer ${i}\n\n**Markdown** and $x^2$.`, [source]);
    assert.equal(pending(adb).filter(op => op.entityType.startsWith('chat_')).length, 0);
    await wa.run(); assert.equal(wa.error, '');
    await wa.enableConversations();
    assert.equal(wa.status().conversations, true);
    const count = wa.status().pending;
    seedConversations(adb); assert.equal(wa.status().pending, count);
    for (const op of pending(adb)) { operationSchema.parse(op); assert.ok(!Object.hasOwn(op.payload ?? {}, 'visual_id')); }
    for (let i = 0; wa.status().pending && i < 5; i++) { await wa.run(); assert.equal(wa.error, ''); }
    assert.equal(wa.status().pending, 0);
    await wb.connect('Chats', library);
    // A restored message must never reuse the source machine's numeric row ID.
    bdb.prepare("INSERT INTO sqlite_sequence(name,seq) VALUES('chat_messages',1000)").run();
    await wb.run(); assert.equal(wb.error, '');
    const restored = new ChatService(bdb, b).history(project.id, source);
    assert.equal(restored.length, 130);
    assert.ok(restored[0]!.id > 1000);
    assert.deepEqual(restored.map(({ role, content, sources_used, created_at }) => ({ role, content, sources_used, created_at })), chat.history(project.id, source).map(({ role, content, sources_used, created_at }) => ({ role, content, sources_used, created_at })));
    assert.equal(wb.status().pending, 0);
    // Activity and local visual changes do not generate redundant text uploads.
    const session = (adb.prepare('SELECT id FROM chat_sessions').get() as { id: string }).id;
    adb.prepare("UPDATE chat_sessions SET accessed_at='later' WHERE id=?").run(session);
    assert.equal(wa.status().pending, 0);
    adb.prepare('DELETE FROM chat_messages WHERE session_id=?').run(session);
    for (let i = 0; wa.status().pending && i < 5; i++) { await wa.run(); assert.equal(wa.error, ''); }
    await wb.run(); assert.equal(wb.error, '');
    assert.equal(new ChatService(bdb, b).history(project.id, source).length, 0);
  } finally { cleanup(a, adb); cleanup(b, bdb); }
});

test('two offline devices append to the same new thread without collisions or split question/answer pairs', async () => {
  const store = new MemoryStore(), a = testConfig(), b = testConfig(), adb = testDb(a), bdb = testDb(b);
  try {
    const library = randomUUID(); await store.create('alice', library, 'Concurrent chats');
    const wa = memoryClient(store, a, adb), wb = memoryClient(store, b, bdb);
    await wa.connect('Chats', library);
    const project = new ProjectService(adb).create('Concurrent');
    await wa.run(); await wa.enableConversations();
    await wb.connect('Chats', library); await wb.run();
    const ca = new ChatService(adb, a), cb = new ChatService(bdb, b);
    assert.equal(ca.persist(project.id, null, 'Question A', 'Answer A', []), cb.persist(project.id, null, 'Question B', 'Answer B', []));
    await wa.run(); assert.equal(wa.error, '');
    await wb.run(); assert.equal(wb.error, '');
    await wa.run(); assert.equal(wa.error, '');
    const history = ca.history(project.id).map(m => m.content);
    assert.equal(history.length, 4);
    assert.ok(history.join('|') === 'Question A|Answer A|Question B|Answer B' || history.join('|') === 'Question B|Answer B|Question A|Answer A');
    assert.deepEqual(cb.history(project.id).map(m => m.content), history);
    assert.equal(wa.status().conflicts + wb.status().conflicts, 0);
    assert.equal(wa.status().pending + wb.status().pending, 0);
  } finally { cleanup(a, adb); cleanup(b, bdb); }
});

test('oversized saved chats fail opt-in before changing the cloud protocol and leave metadata sync usable', async () => {
  const store = new MemoryStore(), config = testConfig(), db = testDb(config);
  try {
    const library = randomUUID(); await store.create('alice', library, 'Large local chat');
    const worker = memoryClient(store, config, db); await worker.connect('Chats', library);
    const project = new ProjectService(db).create('Local');
    new ChatService(db, config).persist(project.id, null, 'Question', 'x'.repeat(200001), []);
    await assert.rejects(worker.enableConversations(), /size limit/);
    assert.equal(store.root('alice', library).protocol, 1);
    assert.equal(worker.status().conversations, false);
    await worker.run(); assert.equal(worker.error, '');
    assert.equal(new ChatService(db, config).history(project.id)[1]!.content.length, 200001);
  } finally { cleanup(config, db); }
});

test('independent legacy session UUIDs remain visible together when existing device histories meet', async () => {
  const store = new MemoryStore(), a = testConfig(), b = testConfig(), adb = testDb(a), bdb = testDb(b);
  try {
    const library = randomUUID(); await store.create('alice', library, 'Existing histories');
    const wa = memoryClient(store, a, adb), wb = memoryClient(store, b, bdb);
    await wa.connect('Chats', library);
    const project = new ProjectService(adb).create('Shared project'); await wa.run();
    await wb.connect('Chats', library); await wb.run();
    for (const [db, id, time] of [[adb, 'legacy-a', '2020-01-01'], [bdb, 'legacy-b', '2020-01-02']] as const)
      db.prepare('INSERT INTO chat_sessions(id,project_id,source_id,title,created_at,accessed_at) VALUES(?,?,NULL,?,?,?)').run(id, project.id, 'Project Chat', time, time);
    const ca = new ChatService(adb, a), cb = new ChatService(bdb, b);
    ca.persist(project.id, null, 'Older A', 'Answer A', []);
    cb.persist(project.id, null, 'Older B', 'Answer B', []);
    await wa.enableConversations(); await wa.run(); assert.equal(wa.error, '');
    await wb.run(); assert.equal(wb.error, '');
    await wa.run(); assert.equal(wa.error, '');
    assert.deepEqual(ca.history(project.id).map(m => m.content), ['Older A','Answer A','Older B','Answer B']);
    assert.deepEqual(cb.history(project.id).map(m => m.content), ['Older A','Answer A','Older B','Answer B']);
  } finally { cleanup(a, adb); cleanup(b, bdb); }
});

function memoryClient(store: MemoryStore, config: ReturnType<typeof testConfig>, db: ReturnType<typeof testDb>) {
    const auth = new CloudAuth(config);
    auth.credentials = {
      uid: "alice",
      email: "a@example.com",
      idToken: "alice",
      refreshToken: "test",
      expiresAt: Date.now() + 100000,
    };
    const worker = new SyncWorker(db, config, auth);
    worker.transport.head = async id => ({ generation: "g1", protocol: store.root("alice", id).protocol });
    worker.transport.enableConversations = async id => { store.root("alice", id).protocol = 2; };
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
          cursor: (await store.changes("alice", id, Number(new URL(route, "http://x").searchParams.get("cursor")))).at(-1)?.sequence ?? Number(new URL(route, "http://x").searchParams.get("cursor")),
        };
      throw Error(route);
    };
    return worker;
  }

test('cloud deletion recovery stays incomplete across upload batches and restores the entire project',async()=>{
 const {TrashService}=await import('../../src/core/trash.js')
 const old={...process.env};process.env.PDFPAL_FIREBASE_PROJECT_ID='demo-pdfpal-sync'
 const store=new MemoryStore(),a=testConfig(),b=testConfig(),adb=testDb(a),bdb=testDb(b)
 try{
  const id=randomUUID();await store.create('alice',id,'Recoverable')
  const wa=memoryClient(store,a,adb),wb=memoryClient(store,b,bdb)
  await wa.connect('Recoverable',id);await wb.connect('Recoverable',id)
  const p=new ProjectService(adb).create('Deleted across pages'),notes=new NoteService(adb,a)
  for(let i=0;i<120;i++)notes.create(p.id,{content:`Note ${i}`})
  for(let i=0;i<3;i++)await wa.run()
  await wb.run();assert.equal(new NoteService(bdb,b).list(p.id).length,120)
  new ProjectService(adb).delete(p.id)
  await wa.run();await wb.run()
  const trash=new TrashService(bdb),partial=(trash.list() as {id:string;ready:number}[])[0]!
  assert.equal(partial.ready,0);assert.throws(()=>trash.restore(partial.id),/finish syncing/)
  await wa.run();await wb.run()
  const complete=trash.list() as {id:string;ready:number}[]
  assert.equal(complete.length,1);assert.equal(complete[0]!.ready,1)
  trash.restore(complete[0]!.id)
  assert.equal(new ProjectService(bdb).resolve(p.id).title,p.title)
  assert.equal(new NoteService(bdb,b).list(p.id).length,120)
  for(let i=0;i<3;i++)await wb.run()
  await wa.run();assert.equal(wa.error,'');assert.equal(new NoteService(adb,a).list(p.id).length,120)
 }finally{cleanup(a,adb);cleanup(b,bdb);if(old.PDFPAL_FIREBASE_PROJECT_ID===undefined)delete process.env.PDFPAL_FIREBASE_PROJECT_ID;else process.env.PDFPAL_FIREBASE_PROJECT_ID=old.PDFPAL_FIREBASE_PROJECT_ID}
})
