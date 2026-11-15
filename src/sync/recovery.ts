import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { loadConfig, type PdfpalConfig } from '../core/config.js';
import { openDatabase } from '../core/database.js';
import { CloudAuth, cloudOptions } from './auth.js';
import { FirebaseTransport } from './firebase.js';
import { setting } from './database.js';
import { SyncWorker } from './worker.js';

type RecoveryWorker = Pick<SyncWorker, 'connect' | 'run' | 'stop' | 'error' | 'status'>;
export interface AccountRecoveryOptions {
  signal?: AbortSignal;
  transport?: Pick<FirebaseTransport, 'canonicalLibrary' | 'head'>;
  createWorker?: (db: Database, config: PdfpalConfig, auth: CloudAuth) => RecoveryWorker;
}

/** Download into a separate library; the current library is never rebound or merged. */
export async function restoreAccountLibrary(
  db: Database,
  config: PdfpalConfig,
  auth: CloudAuth,
  snapshot: () => Promise<unknown>,
  options: AccountRecoveryOptions = {},
) {
  const owner = auth.credentials?.uid;
  if (!owner) throw Error('Sign in first');
  if (setting(db, 'owner') && setting(db, 'owner') !== owner)
    throw Error('Sign in with the library owner');
  if (setting(db, 'backend') && setting(db, 'backend') !== cloudOptions()?.projectId)
    throw Error('Use the backend that owns this local library');
  const checkAccount = () => {
    options.signal?.throwIfAborted();
    if (auth.credentials?.uid !== owner) throw Error('Account action was cancelled');
  };
  checkAccount();
  const transport = options.transport ?? new FirebaseTransport(auth, options.signal);
  const libraryId = await transport.canonicalLibrary();
  if (!libraryId) throw Error('Choose the account library in Cloud Sync before restoring it');
  const initial = await transport.head(libraryId);
  if (!initial.active || ![1, 2].includes(initial.protocol))
    throw Error('The account library is unavailable or needs a newer version of pdfpal');
  checkAccount();
  await snapshot();
  checkAccount();

  const id = randomUUID(), root = path.join(config.dataDir, 'recovered-libraries');
  const temporary = path.join(root, `.building-${id}`), target = path.join(root, id);
  let copy: Database | undefined, worker: RecoveryWorker | undefined;
  const stopWorker = () => worker?.stop();
  options.signal?.addEventListener('abort', stopWorker, { once: true });
  try {
    checkAccount();
    await fs.mkdir(temporary, { recursive: true, mode: 0o700 });
    const restoredConfig = loadConfig({ ...config, dataDir: temporary,
      dbPath: path.join(temporary, 'pdfpal.db'), filesDir: path.join(temporary, 'files'),
      backupsDir: path.join(temporary, 'backups') });
    copy = openDatabase(restoredConfig);
    checkAccount();
    worker = options.createWorker?.(copy, restoredConfig, auth) ?? new SyncWorker(copy, restoredConfig, auth);
    await worker.connect('Account library', libraryId);
    let complete = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      checkAccount();
      await worker.run();
      if (worker.error) throw Error(worker.error);
      const latest = await transport.head(libraryId);
      if (!latest.active || latest.generation !== initial.generation)
        throw Error('The account library changed during recovery. Retry the download');
      if (setting(copy, 'generation') !== initial.generation || setting(copy, 'library') !== libraryId)
        throw Error('The account library changed during recovery. Retry the download');
      const cursor = Number(setting(copy, 'cursor') ?? '0');
      if (cursor === latest.sequence && worker.status().pending === 0) { complete = true; break; }
      if (cursor > latest.sequence) throw Error('The account library history changed during recovery');
    }
    if (!complete) throw Error('The account library is still changing. Retry the download after synchronization finishes');
    checkAccount();
    if (copy.pragma('quick_check', { simple: true }) !== 'ok' || (copy.pragma('foreign_key_check') as unknown[]).length)
      throw Error('The downloaded library failed its integrity check');
    const tables = ['projects', 'sources', 'collections', 'notes', 'annotations', 'chat_sessions', 'chat_messages'];
    const counts = Object.fromEntries(tables.map(table => [table, (copy!.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as { n: number }).n]));
    const missingFiles = (copy.prepare("SELECT COUNT(*) n FROM sources WHERE type IN ('pdf','url') AND local_path IS NULL").get() as { n: number }).n;
    // Opening a recovered copy does not immediately start uploads. The user can
    // inspect it and explicitly resume from Cloud Sync using the normal control.
    setting(copy, 'paused', '1');
    worker.stop();
    copy.pragma('wal_checkpoint(TRUNCATE)');
    copy.close(); copy = undefined;
    const info = { format: 1, id, label: 'Account library', createdAt: new Date().toISOString(), libraryId, counts, missingFiles };
    await fs.writeFile(path.join(temporary, '.pdfpal-recovered.json'), JSON.stringify(info), { mode: 0o600, flag: 'wx' });
    checkAccount();
    await fs.rename(temporary, target);
    return { ...info, dataDir: target };
  } catch (error) {
    worker?.stop();
    copy?.close();
    await fs.rm(temporary, { recursive: true, force: true }).catch(() => {});
    throw error;
  } finally {
    options.signal?.removeEventListener('abort', stopWorker);
  }
}
