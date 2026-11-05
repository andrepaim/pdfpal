import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  initializeTestEnvironment,
  assertFails,
} from "@firebase/rules-unit-testing";
import { createMockUserToken } from "@firebase/util";
import { doc, setDoc, getDoc, writeBatch, updateDoc, deleteDoc } from "firebase/firestore";
import { CloudAuth } from "../../src/sync/auth.js";
import { FirebaseTransport } from "../../src/sync/firebase.js";
import { createHash, randomUUID } from "node:crypto";
import { SyncWorker } from "../../src/sync/worker.js";
import { ProjectService } from "../../src/core/projects.js";
import { SourceService } from "../../src/core/sources.js";
import { NoteService } from "../../src/core/notes.js";
import { ChatService } from "../../src/core/chat.js";
import { testConfig, testDb, cleanup } from "../helpers/test-utils.js";
import type { Operation } from "../../src/shared/sync/schema.js";
const endpoint = process.env.FIRESTORE_EMULATOR_HOST;
if (endpoint && !/^127\.0\.0\.1:8081$/.test(endpoint))
  throw Error("Isolated emulator required");
test(
  "direct Firebase transport and Security Rules",
  { skip: !endpoint },
  async (t) => {
    process.env.PDFPAL_FIREBASE_PROJECT_ID = "demo-pdfpal-sync";
    process.env.PDFPAL_FIREBASE_API_KEY = "test";
    process.env.PDFPAL_GOOGLE_CLIENT_ID = "test";
    const env = await initializeTestEnvironment({
      projectId: "demo-pdfpal-sync",
      ...(process.env.FIREBASE_STORAGE_EMULATOR_HOST
        ? {
            storage: {
              host: "127.0.0.1",
              port: 9199,
              rules: await fs.readFile("cloud/storage.rules", "utf8"),
            },
          }
        : {}),
      firestore: {
        host: "127.0.0.1",
        port: 8081,
        rules: await fs.readFile("cloud/firestore.rules", "utf8"),
      },
    });
    const client = (uid: string) => {
      const auth = new CloudAuth({} as any);
      auth.credentials = {
        uid,
        email: "",
        idToken: "",
        refreshToken: "",
        expiresAt: Infinity,
      };
      auth.token = async () =>
        createMockUserToken({ sub: uid, user_id: uid }, "demo-pdfpal-sync");
      return new FirebaseTransport(auth);
    };
    await t.test('error reports enforce the safe schema, owner isolation and immutable receipts',async()=>{
      const aliceDb=env.authenticatedContext('report-alice').firestore(),bobDb=env.authenticatedContext('report-bob').firestore()
      const id=randomUUID(),route=`users/report-alice/diagnostics/${id}`
      const safe={format:1,code:'SYNC_FAILED',appVersion:'2.5.0-preview.1',platform:'win32',at:Date.now(),durationMs:120}
      await setDoc(doc(aliceDb,route),safe)
      await setDoc(doc(aliceDb,route),safe)
      await assertFails(setDoc(doc(aliceDb,route),{...safe,code:'SERVER_ERROR'}))
      await assertFails(setDoc(doc(aliceDb,`users/report-alice/diagnostics/${randomUUID()}`),{...safe,message:'private contents'}))
      await assertFails(setDoc(doc(aliceDb,`users/report-alice/diagnostics/${randomUUID()}`),{...safe,code:'Private question'}))
      await assertFails(getDoc(doc(bobDb,route)))
      await assertFails(deleteDoc(doc(bobDb,route)))
      await deleteDoc(doc(aliceDb,route))
      const auth=new CloudAuth({} as any);auth.credentials={uid:'report-alice',email:'',idToken:'',refreshToken:'',expiresAt:Infinity};auth.token=async()=>createMockUserToken({sub:'report-alice',user_id:'report-alice'},'demo-pdfpal-sync')
      const transport=new FirebaseTransport(auth)
      await transport.writeDiagnostic(id,safe as any)
      assert.equal((await transport.diagnostics()).length,1)
      await transport.deleteDiagnostic(id)
      assert.equal((await transport.diagnostics()).length,0)
    })
    const alice = client("alice"),
      bob = client("bob");
    const project = (id = randomUUID()): Operation => ({
      operationId: randomUUID(),
      entityType: "projects",
      entityId: id,
      baseRevision: 0,
      action: "put",
      payload: {
        id,
        title: "Synthetic",
        description: "",
        created_at: "now",
        accessed_at: "now",
      },
    });
    try {
      await t.test(
        "owner commits, retries, and paginates production REST transport",
        async () => {
          const library = await alice.create("Private");
          const op = project();
          assert.deepEqual(
            await alice.apply(library.id, library.generation, op),
            { status: "applied", revision: 1 },
          );
          assert.deepEqual(
            await alice.apply(library.id, library.generation, op),
            { status: "applied", revision: 1 },
          );
          assert.equal((await alice.changes(library.id, 0)).changes.length, 1);
          assert.equal((await alice.changes(library.id, 1)).changes.length, 0);
        },
      );
      await t.test(
        "concurrent devices allocate distinct sequences",
        async () => {
          const library = await alice.create("Concurrent");
          await Promise.all([
            alice.apply(library.id, library.generation, project()),
            client("alice").apply(library.id, library.generation, project()),
          ]);
          assert.deepEqual(
            (await alice.changes(library.id, 0)).changes.map((c) => c.sequence),
            [1, 2],
          );
        },
      );
      await t.test(
        "cross-user access is denied for reads and lists",
        async () => {
          const library = await alice.create("Owned");
          await assert.rejects(bob.head(library.id));
          const database = env.authenticatedContext("bob").firestore();
          await assertFails(
            getDoc(doc(database, `users/alice/libraries/${library.id}`)),
          );
          assert.equal((await bob.libraries()).length, 0);
        },
      );
      await t.test("partial writes and history overwrite fail", async () => {
        const library = await alice.create("Protected"),
          database = env.authenticatedContext("alice").firestore(),
          op = project();
        await assertFails(
          setDoc(
            doc(
              database,
              `users/alice/libraries/${library.id}/entities/projects_${op.entityId}`,
            ),
            { payload: op.payload, revision: 1 },
          ),
        );
        await alice.apply(library.id, library.generation, op);
        await assertFails(
          setDoc(
            doc(database, `users/alice/libraries/${library.id}/changes/1`),
            { sequence: 2 },
          ),
        );
        await assertFails(
          setDoc(doc(database, `users/alice/libraries/${library.id}`), {
            generation: "other",
          }),
        );
      });
      await t.test(
        "stale edits conflict and receipts reject changed payloads",
        async () => {
          const library = await alice.create("Conflict"),
            op = project();
          await alice.apply(library.id, library.generation, op);
          await assert.rejects(
            alice.apply(library.id, library.generation, {
              ...op,
              payload: { ...op.payload, title: "changed" },
            }),
            /reused/,
          );
          assert.equal(
            (
              await alice.apply(library.id, library.generation, {
                ...op,
                operationId: randomUUID(),
              })
            ).status,
            "conflict",
          );
          await alice.apply(library.id, library.generation, {
            ...op,
            operationId: randomUUID(),
            baseRevision: 1,
            action: "delete",
            payload: null,
          });
          assert.equal(
            (
              await alice.apply(library.id, library.generation, {
                ...op,
                operationId: randomUUID(),
              })
            ).status,
            "conflict",
          );
        },
      );
      await t.test('conversation consent, ownership, parent links and portable fields are enforced by production rules', async () => {
        const library = await alice.create('Conversation rules'), projectOp = project();
        await alice.apply(library.id, library.generation, projectOp);
        const session: Operation = { operationId: randomUUID(), entityType: 'chat_sessions', entityId: 'thread', baseRevision: 0, action: 'put', payload: {
          id: 'thread', project_id: projectOp.entityId, source_id: null, title: 'Project Chat', created_at: 'now',
        } };
        const database = env.authenticatedContext('alice').firestore();
        const raw = async (op: Operation) => {
          const sequence = (await alice.head(library.id)).sequence + 1;
          const value = { sequence, operationId: op.operationId, entityType: op.entityType, entityId: op.entityId, revision: 1, payload: op.payload, generation: library.generation };
          const key = op.entityType + '_' + op.entityId, root = `users/alice/libraries/${library.id}`;
          const batch = writeBatch(database);
          batch.update(doc(database, root), { sequence });
          batch.set(doc(database, root + '/entities/' + key), value);
          batch.set(doc(database, root + '/changes/' + sequence), value);
          batch.set(doc(database, root + '/receipts/' + op.operationId), { signature: 'a'.repeat(64), key, revision: 1, sequence, generation: library.generation });
          return batch.commit();
        };
        await assert.rejects(alice.apply(library.id, library.generation, session), /Enable conversation/);
        await assertFails(raw(session));
        await alice.enableConversations(library.id);
        assert.equal((await alice.head(library.id)).protocol, 2);
        await alice.apply(library.id, library.generation, session);
        const message: Operation = { operationId: randomUUID(), entityType: 'chat_messages', entityId: 'message', baseRevision: 0, action: 'put', payload: {
          id: 'message', session_id: 'thread', role: 'user', content: 'Synthetic question', sources_used: '[]', created_at: 'now', position: 1, turn_id: 'turn',
        } };
        await assertFails(raw({ ...message, payload: { ...message.payload, client_id: 'do-not-sync-pairing' } }));
        await assertFails(raw({ ...message, payload: { ...message.payload, session_id: 'missing-thread' } }));
        await alice.apply(library.id, library.generation, message);
        await assertFails(getDoc(doc(env.authenticatedContext('bob').firestore(), `users/alice/libraries/${library.id}/entities/chat_messages_message`)));
        await assertFails(updateDoc(doc(database, `users/alice/libraries/${library.id}`), { protocol: 1 }));
      });

      await t.test('saved conversations restore into an empty SQLite library through Firebase without PDF storage', async () => {
        const oldBucket = process.env.PDFPAL_STORAGE_BUCKET; delete process.env.PDFPAL_STORAGE_BUCKET;
        const a = testConfig(), b = testConfig(), adb = testDb(a), bdb = testDb(b);
        const worker = (config: typeof a, db: typeof adb) => {
          const auth = new CloudAuth(config);
          auth.credentials = { uid: 'alice', email: '', idToken: '', refreshToken: '', expiresAt: Infinity };
          auth.token = async () => createMockUserToken({ sub: 'alice', user_id: 'alice' }, 'demo-pdfpal-sync');
          return new SyncWorker(db, config, auth);
        };
        try {
          const library = await alice.create('Restored conversations'), wa = worker(a, adb), wb = worker(b, bdb);
          await wa.connect('Research', library.id);
          const p = new ProjectService(adb).create('Synthetic reading');
          const source = await new SourceService(adb, a).add(p.id, { filename: 'sample.pdf', bytes: await fs.readFile('test/fixtures/sample.pdf') });
          const chat = new ChatService(adb, a);
          for (let i = 0; i < 55; i++) chat.persist(p.id, source.id, `Question ${i}`, `Answer ${i} — $x^2$`, [source.id]);
          await wa.run(); assert.equal(wa.error, '');
          assert.equal((await alice.changes(library.id, 0)).changes.some(c => c.entityType.startsWith('chat_')), false);
          await wa.enableConversations();
          for (let i = 0; wa.status().pending && i < 5; i++) { await wa.run(); assert.equal(wa.error, ''); }
          assert.equal(wa.status().pending, 0);
          await wb.connect('Research', library.id);
          bdb.prepare("INSERT INTO sqlite_sequence(name,seq) VALUES('chat_messages',1000)").run();
          await wb.run(); assert.equal(wb.error, '');
          const expected = chat.history(p.id, source.id), restored = new ChatService(bdb, b).history(p.id, source.id);
          assert.equal(restored.length, 110);
          assert.ok(restored[0]!.id > 1000);
          assert.deepEqual(restored.map(m => [m.role,m.content,m.sources_used,m.created_at]), expected.map(m => [m.role,m.content,m.sources_used,m.created_at]));
          assert.equal(wb.status().pdfStorage, false);
          assert.equal(wb.status().pending, 0);
          assert.equal(new SourceService(bdb, b).resolve(p.id, source.id).local_path, null);
        } finally {
          cleanup(a, adb); cleanup(b, bdb);
          if (oldBucket === undefined) delete process.env.PDFPAL_STORAGE_BUCKET; else process.env.PDFPAL_STORAGE_BUCKET = oldBucket;
        }
      });

      await t.test(
        "private immutable PDF upload and download",
        { skip: !process.env.FIREBASE_STORAGE_EMULATOR_HOST },
        async () => {
          process.env.PDFPAL_STORAGE_BUCKET = "demo-pdfpal-sync.appspot.com";
          const library = await alice.create("Files"),
            id = randomUUID(),
            bytes = Buffer.from("%PDF-1.4 synthetic test fixture"),
            hash = createHash("sha256").update(bytes).digest("hex");
          const payload = {
            id,
            project_id: "project",
            type: "pdf",
            url: null,
            title: "Fixture",
            pages: 1,
            last_page_read: 1,
            created_at: "now",
            accessed_at: "now",
            media_type: "application/pdf",
            byte_size: bytes.length,
            content_hash: hash,
            author: null,
            kindle_book_key: null,
            collection_id: null,
          };
          await alice.apply(library.id, library.generation, {
            operationId: randomUUID(),
            entityType: "sources",
            entityId: id,
            baseRevision: 0,
            action: "put",
            payload,
          });
          await alice.file(library.id, id, hash, bytes);
          assert.deepEqual(
            Buffer.from(
              await (await alice.file(library.id, id, hash)).arrayBuffer(),
            ),
            bytes,
          );
          await assert.rejects(bob.file(library.id, id, hash));
          await assert.rejects(alice.file(library.id, id, hash, bytes));
        },
      );
      await t.test(
        "two SQLite libraries restore a verified PDF and notes through production transport",
        { skip: !process.env.FIREBASE_STORAGE_EMULATOR_HOST },
        async () => {
          process.env.PDFPAL_STORAGE_BUCKET = "demo-pdfpal-sync.appspot.com";
          const a = testConfig(),
            b = testConfig(),
            adb = testDb(a),
            bdb = testDb(b);
          const worker = (config: typeof a, db: typeof adb) => {
            const auth = new CloudAuth(config);
            auth.credentials = {
              uid: "alice",
              email: "test@example.test",
              idToken: "",
              refreshToken: "",
              expiresAt: Infinity,
            };
            auth.token = async () =>
              createMockUserToken(
                { sub: "alice", user_id: "alice" },
                "demo-pdfpal-sync",
              );
            return new SyncWorker(db, config, auth);
          };
          try {
            const library = await alice.create("Two devices"),
              wa = worker(a, adb),
              wb = worker(b, bdb);
            await wa.connect("Two devices", library.id);
            await wb.connect("Two devices", library.id);
            const project = new ProjectService(adb).create("Fixture project");
            const source = await new SourceService(adb, a).add(project.id, {
              filename: "sample.pdf",
              bytes: await fs.readFile("test/fixtures/sample.pdf"),
            });
            const note = new NoteService(adb, a).create(project.id, {
              sourceSelector: source.id,
              title: "Fixture note",
              content: "Portable note",
            });
            assert.equal(wa.status().pdfFiles.enabled,false)
            await wa.run();await wb.run();
            assert.equal(new SourceService(bdb,b).resolve(project.id,source.id).local_path,null)
            assert.equal((adb.prepare('SELECT COUNT(*) n FROM sync_files').get() as {n:number}).n,0)
            wa.setPdfFiles(true);wb.setPdfFiles(true);
            await wa.run();
            assert.equal(wa.error, "");
            await wb.run();
            assert.equal(wb.error, "");
            const restored = new SourceService(bdb, b).resolve(
              project.id,
              source.id,
            );
            assert.equal(restored.content_hash, source.content_hash);
            assert.ok(restored.local_path);
            assert.ok(restored.pdf_text);
            assert.equal(
              new NoteService(bdb, b).resolve(project.id, note.id).content,
              "Portable note",
            );
            assert.equal(wb.status().pending, 0);
          } finally {
            cleanup(a, adb);
            cleanup(b, bdb);
          }
        },
      );
    } finally {
      await env.cleanup();
    }
  },
);
