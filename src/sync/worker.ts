import { Telemetry } from "../core/telemetry.js";
import { FirebaseTransport } from "./firebase.js";
import type { Database } from "better-sqlite3";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { PdfpalConfig } from "../core/config.js";
import { acquireLease } from "../core/locking.js";
import { applyChange, pending, setting, tables } from "./database.js";
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
      if (
        head.generation !== setting(this.db, "generation") ||
        head.active === false
      )
        throw Error("Cloud library generation changed; synchronization paused");
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
        const receipt = await this.request<Receipt>(
          `/libraries/${library}/operations`,
          op,
        );
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
      if (cloudOptions()?.storageBucket) await this.files(library);
      this.error = "";
      this.lastSync = new Date().toISOString();
      setting(this.db,"last_sync",this.lastSync);
    } catch (e) {
      this.error = (e as Error).message;
    } finally {
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
      if (
        this.db
          .prepare(
            "SELECT 1 FROM sync_files WHERE source_id=? AND content_hash=?",
          )
          .get(row.id, row.content_hash)
      )
        continue;
      if (row.byte_size > 25 * 1024 * 1024)
        throw Error("A PDF exceeds the 25 MB cloud limit");
      const route = `/libraries/${library}/files/${row.id}`,
        body = { hash: row.content_hash, size: row.byte_size };
      const local = row.local_path
        ? path.join(this.config.filesDir, path.basename(row.local_path))
        : null;
      if (local) {
        const bytes = await fs.readFile(local);
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
      }
      this.db
        .prepare(
          "INSERT INTO sync_files VALUES(?,?) ON CONFLICT(source_id) DO UPDATE SET content_hash=excluded.content_hash",
        )
        .run(row.id, row.content_hash);
    }
  }
}
