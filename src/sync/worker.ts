import { Telemetry } from "../core/telemetry.js";
import {errorReportsFor} from '../core/error-reports.js'
import { FirebaseTransport } from "./firebase.js";
import type { Database } from "better-sqlite3";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { PdfpalConfig } from "../core/config.js";
import { acquireLease, acquireFilesLease } from "../core/locking.js";
import { applyChange, pending, setting, tables, seedConversations, validateConversations } from "./database.js";
import { CloudAuth, cloudOptions } from "./auth.js";
import type { Change, Receipt } from "../shared/sync/schema.js";
import { extractPdf } from "../core/pdf.js";
import { RetrievalService } from "../core/retrieval.js";
export class SyncWorker {
  private controller = new AbortController();
  stop() {
    this.controller.abort();
  }
  running = false;
  error = "";
  lastSync: string | null = null;
  readonly transport: FirebaseTransport;
  constructor(
    private db: Database,
    private config: PdfpalConfig,
    readonly auth: CloudAuth,
  ) {
    this.transport = new FirebaseTransport(auth, this.controller.signal);
    this.lastSync=setting(db,"last_sync")??null;
  }
  async request<T>(route: string, body?: unknown): Promise<T> {
    const cloud = this.transport;
    if (route === "/libraries")
      return (
        body
          ? await cloud.create((body as { title: string }).title)
          : await cloud.libraries()
      ) as T;
    const url = new URL(route, "http://local"),
      parts = url.pathname.split("/"),
      id = parts[2]!;
    if (parts[3] === "operations")
      return (await cloud.apply(
        id,
        setting(this.db, "generation")!,
        body as import("../shared/sync/schema.js").Operation,
      )) as T;
    if (parts[3] === "changes")
      return (await cloud.changes(
        id,
        Number(url.searchParams.get("cursor") ?? 0),
      )) as T;
    throw Error("Unsupported synchronization operation");
  }

  status() {
    return {
      configured: !!cloudOptions(),
      pdfStorage: !!cloudOptions()?.storageBucket,
      pdfFiles: {configured:!!cloudOptions()?.storageBucket,enabled:setting(this.db,'pdf_files')==='1',error:setting(this.db,'pdf_error')??''},
      conversations: setting(this.db, "conversations") === "1",
      account: this.auth.credentials
        ? { uid: this.auth.credentials.uid, email: this.auth.credentials.email }
        : null,
      libraryId: setting(this.db, "library"),
      owner: setting(this.db, "owner"),
      enabled:
        setting(this.db, "enabled") === "1" &&
        setting(this.db, "paused") !== "1",
      running: this.running,
      error: this.error,
      lastSync: this.lastSync,
      pending: (
        this.db.prepare("SELECT COUNT(*) n FROM sync_outbox").get() as any
      ).n,
      conflicts: (
        this.db
          .prepare("SELECT COUNT(*) n FROM sync_conflicts WHERE resolved=0")
          .get() as any
      ).n,
    };
  }
  async enableConversations() {
    if (this.running) throw Error('Wait for synchronization to finish');
    if (this.auth.credentials?.uid !== setting(this.db, 'owner') || setting(this.db, 'backend') !== cloudOptions().projectId)
      throw Error('Sign in with the library owner');
    const library = setting(this.db, 'library');
    if (!library || setting(this.db, 'enabled') !== '1') throw Error('Connect this library before enabling conversation sync');
    validateConversations(this.db);
    if (setting(this.db, 'conversations') !== '1')
      await this.db.backup(path.join(this.config.backupsDir, `before-conversations-${Date.now()}.db`));
    await this.transport.enableConversations(library);
    if (this.auth.credentials?.uid !== setting(this.db, 'owner')) throw Error('Account action was cancelled');
    seedConversations(this.db);
    return this.status();
  }
  setPdfFiles(enabled:boolean){
    if(this.running)throw Error('Wait for synchronization to finish')
    if(enabled&&(!cloudOptions().storageBucket||!setting(this.db,'library')||this.auth.credentials?.uid!==setting(this.db,'owner')))throw Error('Connect the library owner and configure Firebase Storage before enabling PDF sync.')
    setting(this.db,'pdf_files',enabled?'1':'0');setting(this.db,'pdf_error','');return this.status()
  }
  async fileStatus(){
    const rows=this.db.prepare(`SELECT s.id,s.title,s.local_path,s.content_hash,s.byte_size,f.content_hash AS verified_hash FROM sources s LEFT JOIN sync_files f ON f.source_id=s.id WHERE s.type!='kindle' ORDER BY s.created_at DESC LIMIT 1000`).all() as {id:string;title:string|null;local_path:string|null;content_hash:string|null;byte_size:number|null;verified_hash:string|null}[]
    return Promise.all(rows.map(async row=>{
      const local=!!row.local_path&&await fs.stat(path.join(this.config.filesDir,path.basename(row.local_path))).then(s=>s.isFile()).catch(()=>false)
      return {id:row.id,title:row.title,bytes:row.byte_size,local,verified:!!row.content_hash&&row.content_hash===row.verified_hash,state:!row.content_hash?'metadata-only':(row.byte_size??0)>25*1024*1024?'too-large':row.content_hash===row.verified_hash?(local?'verified':'local-file-missing'):local?'local-only':'needs-download'}
    }))
  }
  async connect(title: string, libraryId?: string) {
    if (setting(this.db, "owner"))
      throw Error(
        "This local library is already bound. Use its original account and library.",
      );
    if (!this.auth.credentials) throw Error("Sign in first");
    const libraries =
      await this.request<Array<{ id: string; title: string }>>("/libraries");
    let id = libraryId;
    if (id && !libraries.some((l) => l.id === id))
      throw Error("Library not found");
    if (
      id &&
      tables.some(
        (t) =>
          (this.db.prepare(`SELECT COUNT(*) n FROM ${t}`).get() as any).n > 0,
      )
    )
      throw Error(
        "Open an empty local library before downloading an existing cloud library",
      );
    if (!id)
      id = (await this.request<{ id: string }>("/libraries", { title })).id;
    const head = await this.transport.head(id!);
    if ((head.protocol ?? 1) > 2) throw Error('Update pdfpal before connecting this cloud library');
    await this.db.backup(
      path.join(this.config.backupsDir, `before-cloud-${Date.now()}.db`),
    );
    this.db.transaction(() => {
      setting(this.db, "generation", head.generation);
      setting(this.db, "owner", this.auth.credentials!.uid);
      setting(this.db, "backend", cloudOptions()!.projectId);
      setting(this.db, "library", id!);
      setting(this.db, "cursor", "0");
      setting(this.db, "enabled", "1");
      if (head.protocol === 2) setting(this.db, "conversations", "1");
      // Triggers seed existing content into the same durable outbox as ordinary writes.
      for (const table of tables) {
        const rows =
          table === "collections"
            ? this.db
                .prepare(
                  "WITH RECURSIVE tree(id,depth) AS (SELECT id,0 FROM collections WHERE parent_id IS NULL UNION ALL SELECT c.id,t.depth+1 FROM collections c JOIN tree t ON c.parent_id=t.id) SELECT id FROM tree ORDER BY depth",
                )
                .all()
            : this.db.prepare(`SELECT id FROM ${table}`).all();
        for (const row of rows as Array<{ id: string }>)
          this.db.prepare(`UPDATE ${table} SET id=id WHERE id=?`).run(row.id);
      }
    })();
    return this.status();
  }
  async run() {
    if (this.running) return;
    if (
      setting(this.db, "enabled") !== "1" ||
      setting(this.db, "paused") === "1" ||
      !this.auth.credentials ||
      this.controller.signal.aborted
    )
      return;
    if (
      setting(this.db, "owner") !== this.auth.credentials.uid ||
      setting(this.db, "backend") !== cloudOptions()?.projectId
    ) {
      this.error =
        "Sign in with the account and backend that own this local library";
      return;
    }
    const started = performance.now();
    this.running = true;
    let release: (() => void) | undefined;
    try {
      release = acquireLease(`${this.config.dbPath}.sync-lock`);
      if (this.status().conflicts > 0)
        throw Error(
          "Synchronization paused: conflicting edits are preserved for recovery",
        );
      const library = setting(this.db, "library")!;
      const head = await this.transport.head(library);
      if ((head.protocol ?? 1) > 2) throw Error('Update pdfpal before connecting this cloud library');
      if (
        head.generation !== setting(this.db, "generation") ||
        head.active === false
      )
        throw Error("Cloud library generation changed; synchronization paused");
      if (head.protocol === 2 && setting(this.db, 'conversations') !== '1') {
        await this.db.backup(path.join(this.config.backupsDir, `before-conversations-${Date.now()}.db`));
        seedConversations(this.db);
      }
      if (
        this.db
          .prepare(
            "SELECT 1 FROM sync_outbox WHERE owner!=? OR generation!=? OR library!=? LIMIT 1",
          )
          .get(
            this.auth.credentials!.uid,
            setting(this.db, "generation"),
            library,
          )
      )
        throw Error(
          "Pending work belongs to a different account or library generation",
        );
      for (const op of pending(this.db)) {
        let receipt = await this.request<Receipt>(
          `/libraries/${library}/operations`,
          op,
        );
        // Independent devices can create the same deterministic thread before
        // seeing one another. Its messages have distinct IDs and can all append.
        const remoteHead = receipt.status === 'conflict' ? receipt.current : null;
        if (remoteHead?.payload && op.entityType === 'chat_sessions' && op.action === 'put' && op.baseRevision === 0 &&
          ['id', 'project_id', 'source_id', 'title'].every(key => op.payload?.[key] === remoteHead.payload![key]) &&
          (this.db.prepare('SELECT COUNT(*) n FROM sync_outbox WHERE entity_type=? AND entity_id=?').get(op.entityType, op.entityId) as { n: number }).n === 1) {
          const remote = remoteHead;
          this.db.transaction(() => {
            setting(this.db, 'applying', '1');
            applyChange(this.db, remote);
            setting(this.db, 'applying', '0');
          })();
          op.payload = remote.payload;
          receipt = { status: 'applied', revision: remote.revision };
        }
        if (receipt.status === "conflict") {
          this.db
            .prepare(
              "INSERT OR IGNORE INTO sync_conflicts(id,operation,remote,created_at) VALUES(?,?,?,?)",
            )
            .run(
              op.operationId,
              JSON.stringify(op),
              JSON.stringify(receipt.current),
              new Date().toISOString(),
            );
          throw Error(
            "Synchronization paused: conflicting edits are preserved for recovery",
          );
        }
        this.db.transaction(() => {
          this.db
            .prepare("DELETE FROM sync_outbox WHERE operation_id=?")
            .run(op.operationId);
          this.db
            .prepare(
              "INSERT INTO sync_remote VALUES(?,?,?,?) ON CONFLICT(entity_type,entity_id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload",
            )
            .run(
              op.entityType,
              op.entityId,
              receipt.revision,
              JSON.stringify(op.payload),
            );
        })();
      }
      let more = true;
      while (more) {
        const batch = await this.request<{ changes: Change[]; cursor: number }>(
          `/libraries/${library}/changes?cursor=${setting(this.db, "cursor") ?? "0"}`,
        );
        this.db.transaction(() => {
          setting(this.db, "applying", "1");
          let expected = Number(setting(this.db, "cursor") ?? "0") + 1;
          for (const change of batch.changes) {
            if (change.sequence !== expected++)
              throw Error(
                "Cloud change history is incomplete; synchronization paused",
              );
            const version = this.db
              .prepare(
                "SELECT revision FROM sync_remote WHERE entity_type=? AND entity_id=?",
              )
              .get(change.entityType, change.entityId) as
              | { revision: number }
              | undefined;
            if (version && version.revision >= change.revision) continue;
            const unsent = this.db
              .prepare(
                "SELECT 1 FROM sync_outbox WHERE entity_type=? AND entity_id=?",
              )
              .get(change.entityType, change.entityId);
            if (unsent)
              throw Error(
                "Local edits are waiting to upload; retry synchronization",
              );
            applyChange(this.db, change);
          }
          setting(this.db, "cursor", String(batch.cursor));
          setting(this.db, "applying", "0");
        })();
        more = batch.changes.length === 100;
      }
      if (cloudOptions()?.storageBucket&&setting(this.db,'pdf_files')==='1') await this.files(library);
      this.error = "";
      this.lastSync = new Date().toISOString();
      setting(this.db,"last_sync",this.lastSync);
    } catch (e) {
      this.error = (e as Error).message;
      if(!this.controller.signal.aborted)errorReportsFor(this.db).record((e as {status?:number}).status===429?'SYNC_QUOTA':'SYNC_FAILED',performance.now()-started)
    } finally {
      if(!this.error&&!this.controller.signal.aborted)errorReportsFor(this.db).record('SYNC_COMPLETED',performance.now()-started)
      await new Telemetry(this.db).record({
        name: "sync_batch",
        outcome: this.error ? "failed" : "completed",
        durationMs: performance.now() - started,
      });
      release?.();
      this.running = false;
    }
  }
  async resolveNote(id: string, choice: "local" | "remote") {
    if (this.running) throw Error("Wait for synchronization to finish");
    if (this.auth.credentials?.uid !== setting(this.db, "owner"))
      throw Error("Sign in with the library owner");
    const conflict = this.db
      .prepare("SELECT * FROM sync_conflicts WHERE id=? AND resolved=0")
      .get(id) as { operation: string } | undefined;
    if (!conflict) throw Error("Conflict not found");
    const op = JSON.parse(
      conflict.operation,
    ) as import("../shared/sync/schema.js").Operation;
    if (op.entityType !== "notes")
      throw Error(
        "This conflict requires exporting both versions and manual recovery",
      );
    const remote = await this.transport.entity(
      setting(this.db, "library")!,
      "notes",
      op.entityId,
    );
    if (!remote) throw Error("Remote record is unavailable");
    const local = this.db
      .prepare("SELECT * FROM notes WHERE id=?")
      .get(op.entityId) as Record<string, unknown> | undefined;
    if (!remote.payload)
      throw Error(
        "Remote note was deleted; export your local note before resolving",
      );
    this.db.transaction(() => {
      setting(this.db, "applying", "1");
      this.db
        .prepare("DELETE FROM sync_outbox WHERE entity_type=? AND entity_id=?")
        .run("notes", op.entityId);
      applyChange(this.db, remote);
      setting(this.db, "applying", "0");
      if (choice === "local" && local)
        this.db
          .prepare("UPDATE notes SET title=?,content=?,updated_at=? WHERE id=?")
          .run(
            local.title,
            local.content,
            new Date().toISOString(),
            op.entityId,
          );
      this.db
        .prepare("UPDATE sync_conflicts SET resolved=1 WHERE id=?")
        .run(id);
    })();
    this.error = "";
    return this.status();
  }
  private async files(library: string) {
    setting(this.db,'pdf_error','')
    const rows = this.db
      .prepare(
        "SELECT id,local_path,content_hash,byte_size FROM sources WHERE type!='kindle' AND content_hash IS NOT NULL AND byte_size>0",
      )
      .all() as Array<{
      id: string;
      local_path: string | null;
      content_hash: string;
      byte_size: number;
    }>;
    for (const row of rows) {
      if(this.controller.signal.aborted)break
      try{
      const acknowledged=this.db.prepare("SELECT payload FROM sync_remote WHERE entity_type='sources' AND entity_id=?").get(row.id) as {payload:string}|undefined
      if(!acknowledged||JSON.parse(acknowledged.payload||'null')?.content_hash!==row.content_hash)continue
      const candidate=row.local_path?path.join(this.config.filesDir,path.basename(row.local_path)):null
      const local=candidate&&await fs.stat(candidate).then(s=>s.isFile()).catch(()=>false)?candidate:null
      if (
        local&&
        this.db
          .prepare(
            "SELECT 1 FROM sync_files WHERE source_id=? AND content_hash=?",
          )
          .get(row.id, row.content_hash)
      )
        continue;
      if (row.byte_size > 25 * 1024 * 1024)
        throw Error("A PDF exceeds the 25 MB cloud limit");
      if (local) {
        const release=await acquireFilesLease(this.config.dbPath);
        let bytes:Buffer;
        try{bytes=await fs.readFile(local)}finally{release()}
        if (
          createHash("sha256").update(bytes).digest("hex") !== row.content_hash
        )
          throw Error("Local PDF integrity check failed");
        try {
          await this.transport.file(library, row.id, row.content_hash, bytes);
        } catch (error) {
          if (!String(error).includes("(403)")) throw error;
          const existing = await this.transport.file(
            library,
            row.id,
            row.content_hash,
          );
          const check = Buffer.from(await existing.arrayBuffer());
          if (
            createHash("sha256").update(check).digest("hex") !==
            row.content_hash
          )
            throw Error("Existing cloud PDF integrity check failed");
        }
      } else {
        const res = await this.transport.file(
          library,
          row.id,
          row.content_hash,
        );
        if (!res.body) throw Error("PDF download failed");
        const chunks: Uint8Array[] = [];
        let size = 0;
        for await (const chunk of res.body) {
          size += chunk.length;
          if (size > row.byte_size) throw Error("PDF exceeds expected size");
          chunks.push(chunk);
        }
        const bytes = Buffer.concat(chunks);
        if (
          bytes.length !== row.byte_size ||
          createHash("sha256").update(bytes).digest("hex") !== row.content_hash
        )
          throw Error("Downloaded PDF integrity check failed");
        const extracted = await extractPdf(bytes),
          filename = `${row.id}.pdf`,
          temp = path.join(this.config.filesDir, `${randomUUID()}.tmp`);
        const release=await acquireFilesLease(this.config.dbPath);
        try{
        const current=this.db.prepare('SELECT content_hash FROM sources WHERE id=?').get(row.id) as {content_hash:string}|undefined;
        if(!current||current.content_hash!==row.content_hash)continue;
        await fs.writeFile(temp, bytes, { mode: 0o600 });
        await fs.rename(temp, path.join(this.config.filesDir, filename));
        this.db.transaction(() => {
          setting(this.db, "applying", "1");
          this.db
            .prepare("UPDATE sources SET local_path=?,pdf_text=? WHERE id=?")
            .run(filename, extracted.text, row.id);
          new RetrievalService(this.db).index(row.id, extracted.text);
          setting(this.db, "applying", "0");
        })();
        }finally{release()}
      }
      this.db
        .prepare(
          "INSERT INTO sync_files VALUES(?,?) ON CONFLICT(source_id) DO UPDATE SET content_hash=excluded.content_hash",
        )
        .run(row.id, row.content_hash);
      }catch{
        if(this.controller.signal.aborted)break
        setting(this.db,'pdf_error','Some PDF files could not transfer. Metadata and saved conversations can still sync. Check file availability, the 25 MB limit and Storage permissions, then retry.')
        errorReportsFor(this.db).record('PDF_SYNC_FAILED')
      }
    }
  }
}
