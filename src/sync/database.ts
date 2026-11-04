import type { Database } from "better-sqlite3";
import {
  records,
  type EntityType,
  type Change,
  type Operation,
} from "../shared/sync/schema.js";

export const tables = Object.keys(records) as EntityType[];
export function installSync(db: Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS sync_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    INSERT OR IGNORE INTO sync_settings VALUES ('applying','0');
    CREATE TABLE IF NOT EXISTS sync_versions(entity_type TEXT NOT NULL,entity_id TEXT NOT NULL,revision INTEGER NOT NULL,PRIMARY KEY(entity_type,entity_id));
    CREATE TABLE IF NOT EXISTS sync_outbox(seq INTEGER PRIMARY KEY AUTOINCREMENT,operation_id TEXT NOT NULL UNIQUE,entity_type TEXT NOT NULL,entity_id TEXT NOT NULL,base_revision INTEGER NOT NULL,action TEXT NOT NULL,payload TEXT);
    CREATE TABLE IF NOT EXISTS sync_conflicts(id TEXT PRIMARY KEY,operation TEXT NOT NULL,remote TEXT,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS telemetry_journal(id INTEGER PRIMARY KEY AUTOINCREMENT,event TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sync_remote(entity_type TEXT NOT NULL,entity_id TEXT NOT NULL,revision INTEGER NOT NULL,payload TEXT,PRIMARY KEY(entity_type,entity_id));
    CREATE TABLE IF NOT EXISTS sync_files(source_id TEXT PRIMARY KEY,content_hash TEXT NOT NULL);
  `);
  for (const column of ["owner", "generation", "library"])
    if (
      !(
        db.prepare("PRAGMA table_info(sync_outbox)").all() as Array<{
          name: string;
        }>
      ).some((c) => c.name === column)
    )
      db.exec(
        `ALTER TABLE sync_outbox ADD COLUMN ${column} TEXT NOT NULL DEFAULT ''`,
      );
  if (
    !(
      db.prepare("PRAGMA table_info(sync_conflicts)").all() as Array<{
        name: string;
      }>
    ).some((c) => c.name === "resolved")
  )
    db.exec(
      "ALTER TABLE sync_conflicts ADD COLUMN resolved INTEGER NOT NULL DEFAULT 0",
    );
  for (const table of tables) {
    if (
      !db
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
        .get(table)
    )
      continue;
    const fields = Object.keys(records[table].shape);
    const json = (prefix: string) =>
      `json_object(${fields.map((f) => `'${f}',${prefix}.${f}`).join(",")})`;
    for (const [event, prefix] of [
      ["INSERT", "NEW"],
      ["UPDATE", "NEW"],
      ["DELETE", "OLD"],
    ]) {
      db.exec(`DROP TRIGGER IF EXISTS sync_${table}_${event}; CREATE TRIGGER sync_${table}_${event} AFTER ${event} ON ${table}
        WHEN (SELECT value FROM sync_settings WHERE key='enabled')='1' AND (SELECT value FROM sync_settings WHERE key='applying')='0'
        BEGIN
          INSERT INTO sync_outbox(operation_id,entity_type,entity_id,base_revision,action,payload,owner,generation,library)
          VALUES(lower(hex(randomblob(16))),'${table}',${prefix}.id,COALESCE((SELECT revision FROM sync_versions WHERE entity_type='${table}' AND entity_id=${prefix}.id),0),'${event === "DELETE" ? "delete" : "put"}',${event === "DELETE" ? "NULL" : json(prefix!)},COALESCE((SELECT value FROM sync_settings WHERE key='owner'),''),COALESCE((SELECT value FROM sync_settings WHERE key='generation'),''),COALESCE((SELECT value FROM sync_settings WHERE key='library'),''));
          INSERT INTO sync_versions VALUES('${table}',${prefix}.id,1) ON CONFLICT(entity_type,entity_id) DO UPDATE SET revision=revision+1;
        END;`);
    }
  }
}
export function setting(
  db: Database,
  key: string,
  value?: string,
): string | undefined {
  if (value !== undefined)
    db.prepare(
      "INSERT INTO sync_settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    ).run(key, value);
  return (
    db.prepare("SELECT value FROM sync_settings WHERE key=?").get(key) as
      | { value: string }
      | undefined
  )?.value;
}
export function pending(db: Database): Operation[] {
  return (
    db
      .prepare("SELECT * FROM sync_outbox ORDER BY seq LIMIT 100")
      .all() as Array<any>
  ).map((r) => ({
    operationId: r.operation_id,
    entityType: r.entity_type,
    entityId: r.entity_id,
    baseRevision: r.base_revision,
    action: r.action,
    payload: r.payload ? JSON.parse(r.payload) : null,
  }));
}
export function applyChange(db: Database, change: Change) {
  db.prepare(
    "INSERT INTO sync_remote VALUES(?,?,?,?) ON CONFLICT(entity_type,entity_id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload",
  ).run(
    change.entityType,
    change.entityId,
    change.revision,
    JSON.stringify(change.payload),
  );
  const table = change.entityType;
  if (!tables.includes(table)) throw Error("Unsupported cloud entity");
  if (change.payload) {
    const row = records[table].parse(change.payload);
    const fields = Object.keys(row);
    db.prepare(
      `INSERT INTO ${table}(${fields.join(",")}) VALUES(${fields.map(() => "?").join(",")}) ON CONFLICT(id) DO UPDATE SET ${fields
        .filter((f) => f !== "id")
        .map((f) => `${f}=excluded.${f}`)
        .join(",")}`,
    ).run(...fields.map((f) => (row as any)[f]));
  } else db.prepare(`DELETE FROM ${table} WHERE id=?`).run(change.entityId);
  db.prepare(
    "INSERT INTO sync_versions VALUES(?,?,?) ON CONFLICT(entity_type,entity_id) DO UPDATE SET revision=excluded.revision",
  ).run(table, change.entityId, change.revision);
}
