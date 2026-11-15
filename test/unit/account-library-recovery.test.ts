import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { BackupService } from '../../src/core/backups.js';
import { CloudAuth } from '../../src/sync/auth.js';
import { SyncWorker } from '../../src/sync/worker.js';
import { setting } from '../../src/sync/database.js';
import { restoreAccountLibrary } from '../../src/sync/recovery.js';
import type { Change } from '../../src/shared/sync/schema.js';
import { cleanup, createProject, createSource, testConfig, testDb } from '../helpers/test-utils.js';

test('account recovery preserves the current library and registers only complete downloads', async t => {
  const previous = process.env.PDFPAL_FIREBASE_PROJECT_ID;
  process.env.PDFPAL_FIREBASE_PROJECT_ID = 'demo-recovery';
  const config = testConfig(), db = testDb(config), auth = new CloudAuth(config);
  auth.credentials = { uid: 'owner', email: '', idToken: 'in-memory', refreshToken: 'in-memory', expiresAt: Infinity };
  for (const [key, value] of Object.entries({ owner: 'owner', backend: 'demo-recovery', library: 'linux-library', generation: 'linux-generation', cursor: '9', enabled: '1' })) setting(db, key, value);
  const localProject = createProject(db, 'Local work'), source = createSource(db, localProject);
  await fs.writeFile(path.join(config.filesDir, 'local.pdf'), '%PDF-local');
  db.prepare('UPDATE sources SET local_path=? WHERE id=?').run('local.pdf', source);
  const original = () => ({
    settings: db.prepare("SELECT * FROM sync_settings WHERE key NOT LIKE 'backup_%' ORDER BY key").all(),
    outbox: db.prepare('SELECT * FROM sync_outbox ORDER BY seq').all(),
    projects: db.prepare('SELECT * FROM projects ORDER BY id').all(),
    sources: db.prepare('SELECT * FROM sources ORDER BY id').all(),
  });
  const before = original(), backups = new BackupService(db, config);
  const history: Change[] = [];
  const add = (entityType: Change['entityType'], entityId: string, payload: Record<string, unknown>) => history.push({ sequence: history.length + 1, operationId: `operation-${history.length + 1}`, entityType, entityId, payload, generation: 'windows-generation', revision: 1 });
  for (let i = 0; i < 101; i++) add('projects', `remote-${i}`, { id: `remote-${i}`, title: `Cloud ${i}`, description: '', created_at: 'now', accessed_at: 'now' });
  add('chat_sessions', 'thread', { id: 'thread', project_id: 'remote-0', source_id: null, title: 'Project Chat', created_at: 'now' });
  add('chat_messages', 'message', { id: 'message', session_id: 'thread', role: 'user', content: 'Saved question', sources_used: '[]', created_at: 'now', position: 1, turn_id: 'turn' });
  let downloads = 0, uploads = 0;
  const transport = {
    canonicalLibrary: async () => 'windows-library',
    head: async () => ({ active: true, protocol: 2, generation: 'windows-generation', sequence: history.length }),
    resolveLibrary: async () => ({ id: 'windows-library', created: false }),
    changes: async (_library: string, cursor: number) => {
      downloads++;
      const changes = history.filter(change => change.sequence > cursor).slice(0, 100);
      return { changes, cursor: changes.at(-1)?.sequence ?? cursor };
    },
    apply: async () => { uploads++; throw Error('Recovery must not upload'); },
  };
  const options = { transport, createWorker: (...args: ConstructorParameters<typeof SyncWorker>) => {
    const worker = new SyncWorker(...args);
    Object.assign(worker.transport, transport);
    return worker;
  } };
  const registered = () => backups.listRecovered();
  try {
    await t.test('cancelled recovery does not create a copy or start a backup', async () => {
      let snapshots = 0;
      await assert.rejects(restoreAccountLibrary(db, config, auth, async () => { snapshots++; }, {
        ...options, signal: AbortSignal.abort(),
      }), { name: 'AbortError' });
      assert.equal(snapshots, 0);
      assert.equal((await registered()).length, 0);
      assert.deepEqual(original(), before);
    });
    await t.test('an unselected account cannot start a recovery or a backup', async () => {
      let snapshots = 0;
      await assert.rejects(restoreAccountLibrary(db, config, auth, async () => { snapshots++; }, {
        ...options, transport: { ...transport, canonicalLibrary: async () => null },
      }), /Choose the account library/);
      assert.equal(snapshots, 0);
      assert.deepEqual(original(), before);
    });
    await t.test('backup failure creates no recovery folder and changes no local work', async () => {
      await assert.rejects(restoreAccountLibrary(db, config, auth, async () => { throw Error('disk full'); }, options), /disk full/);
      assert.equal((await registered()).length, 0);
      await assert.rejects(fs.stat(path.join(config.dataDir, 'recovered-libraries')), { code: 'ENOENT' });
      assert.deepEqual(original(), before);
    });
    await t.test('failed pull removes its incomplete download and keeps the original binding and outbox', async () => {
      const broken = { ...options, createWorker: (...args: ConstructorParameters<typeof SyncWorker>) => {
        const worker = options.createWorker(...args);
        worker.transport.changes = async () => { throw Error('connection interrupted'); };
        return worker;
      } };
      await assert.rejects(restoreAccountLibrary(db, config, auth, () => backups.create('before-restore'), broken), /connection interrupted/);
      assert.deepEqual(await fs.readdir(path.join(config.dataDir, 'recovered-libraries')), []);
      assert.equal((await registered()).length, 0);
      assert.deepEqual(original(), before);
      assert.equal((await backups.list()).length, 1);
    });
    await t.test('a generation change prevents incomplete recovery from becoming available', async () => {
      let reads = 0;
      await assert.rejects(restoreAccountLibrary(db, config, auth, async () => {}, {
        ...options, transport: { ...transport, head: async () => ({ ...await transport.head(), generation: ++reads === 1 ? 'windows-generation' : 'replacement-generation' }) },
      }), /changed during recovery/);
      assert.deepEqual(await fs.readdir(path.join(config.dataDir, 'recovered-libraries')), []);
      assert.deepEqual(original(), before);
    });
    await t.test('cancellation during a pull removes the temporary copy and keeps original work', async () => {
      const controller = new AbortController();
      await assert.rejects(restoreAccountLibrary(db, config, auth, async () => {}, {
        ...options, signal: controller.signal, createWorker: (...args: ConstructorParameters<typeof SyncWorker>) => {
          const worker = options.createWorker(...args);
          worker.transport.changes = async () => { controller.abort(); throw Error('Recovery cancelled'); };
          return worker;
        },
      }), /Recovery cancelled/);
      assert.deepEqual(await fs.readdir(path.join(config.dataDir, 'recovered-libraries')), []);
      assert.deepEqual(original(), before);
    });
    await t.test('complete multipage protocol2 download is registered separately without credentials or uploads', async () => {
      downloads = 0;
      const result = await restoreAccountLibrary(db, config, auth, () => backups.create('before-restore'), options);
      assert.equal(result.counts.projects, 101);
      assert.equal(result.counts.chat_messages, 1);
      assert.equal(result.libraryId, 'windows-library');
      assert.equal(downloads, 2);
      assert.equal(uploads, 0);
      assert.deepEqual(original(), before);
      assert.equal(await fs.readFile(path.join(config.filesDir, 'local.pdf'), 'utf8'), '%PDF-local');
      assert.equal((await registered()).length, 1);
      assert.deepEqual(await backups.recovered(result.id), result);
      const recovered = new Database(path.join(result.dataDir, 'pdfpal.db'), { readonly: true });
      try {
        assert.equal(setting(recovered, 'library'), 'windows-library');
        assert.equal(setting(recovered, 'cursor'), '103');
        assert.equal(setting(recovered, 'conversations'), '1');
        assert.equal(setting(recovered, 'paused'), '1');
        assert.equal((recovered.prepare('SELECT content FROM chat_messages').get() as { content: string }).content, 'Saved question');
        assert.equal(recovered.pragma('quick_check', { simple: true }), 'ok');
      } finally { recovered.close(); }
      assert.ok((await fs.readdir(result.dataDir)).every(name =>
        ['.pdfpal-recovered.json', 'backups', 'files'].includes(name) || /^pdfpal\.db(?:-(?:shm|wal)|\.(?:server|startup|sync)-lock)?$/.test(name)));
      assert.equal((await backups.list()).length, 2);
    });
    await t.test('another signed-in account cannot start a recovery or a backup', async () => {
      auth.credentials!.uid = 'someone-else';
      let snapshots = 0;
      await assert.rejects(restoreAccountLibrary(db, config, auth, async () => { snapshots++; }, options), /library owner/);
      assert.equal(snapshots, 0);
      assert.deepEqual(original(), before);
    });
  } finally {
    await backups.close(); cleanup(config, db);
    if (previous === undefined) delete process.env.PDFPAL_FIREBASE_PROJECT_ID; else process.env.PDFPAL_FIREBASE_PROJECT_ID = previous;
  }
});
