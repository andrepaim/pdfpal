import type { Database } from "better-sqlite3";
import { recordRemoteDeletion } from '../core/trash.js';
import {
  records,
  type EntityType,
  type Change,
  type Operation,
  operationSchema,
} from "../shared/sync/schema.js";

export const tables = Object.keys(records) as EntityType[];
export const conversationTables = ["chat_sessions", "chat_messages"] as const;
export const isConversation = (table: string) => conversationTables.some(t => t === table);
const localColumn = (table: string, field: string) => table === "chat_messages"
  ? ({ id: "sync_id", position: "sync_order", turn_id: "sync_turn" } as Record<string, string>)[field] ?? field
  : field;

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
  const messageColumns = (db.prepare("PRAGMA table_info(chat_messages)").all() as Array<{ name: string }>).map(c => c.name);
  for (const [name, type] of [["sync_id", "TEXT"], ["sync_order", "INTEGER"], ["sync_turn", "TEXT"]])
    if (!messageColumns.includes(name!)) db.exec(`ALTER TABLE chat_messages ADD COLUMN ${name} ${type}`);
  db.exec(`UPDATE chat_messages SET
      sync_id=COALESCE(sync_id,lower(hex(randomblob(16)))),
      sync_order=COALESCE(sync_order,id), sync_turn=COALESCE(sync_turn,lower(hex(randomblob(16))))
      WHERE sync_id IS NULL OR sync_order IS NULL OR sync_turn IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS chat_message_sync_id ON chat_messages(sync_id);
    CREATE INDEX IF NOT EXISTS chat_message_sync_order ON chat_messages(session_id,sync_order,sync_turn);
    CREATE TRIGGER IF NOT EXISTS chat_message_sync_identity AFTER INSERT ON chat_messages
      WHEN NEW.sync_id IS NULL OR NEW.sync_order IS NULL OR NEW.sync_turn IS NULL
      BEGIN UPDATE chat_messages SET sync_id=COALESCE(NEW.sync_id,lower(hex(randomblob(16)))),
        sync_order=COALESCE(NEW.sync_order,NEW.id),sync_turn=COALESCE(NEW.sync_turn,lower(hex(randomblob(16))))
        WHERE id=NEW.id; END;`);
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
      `json_object(${fields.map((f) => `'${f}',${prefix}.${localColumn(table, f)}`).join(",")})`;
    for (const [event, prefix] of [
      ["INSERT", "NEW"],
      ["UPDATE", "NEW"],
      ["DELETE", "OLD"],
    ]) {
      db.exec(`DROP TRIGGER IF EXISTS sync_${table}_${event}; CREATE TRIGGER sync_${table}_${event} AFTER ${event} ON ${table}
        WHEN (SELECT value FROM sync_settings WHERE key='enabled')='1' AND (SELECT value FROM sync_settings WHERE key='applying')='0'
        ${isConversation(table) ? `AND (SELECT value FROM sync_settings WHERE key='conversations')='1'
          AND ${prefix}.${localColumn(table, 'id')} IS NOT NULL
          ${event === 'UPDATE' ? `AND (${json('NEW')} IS NOT ${json('OLD')} OR (SELECT value FROM sync_settings WHERE key='seeding_conversations')='1')` : ''}` : ''}
        BEGIN
          INSERT INTO sync_outbox(operation_id,entity_type,entity_id,base_revision,action,payload,owner,generation,library)
          VALUES(CASE WHEN COALESCE((SELECT value FROM sync_settings WHERE key='deleting_prefix'),'')!='' THEN (SELECT value FROM sync_settings WHERE key='deleting_prefix')||lower(hex(randomblob(8))) ELSE lower(hex(randomblob(16))) END,'${table}',${prefix}.${localColumn(table, 'id')},COALESCE((SELECT revision FROM sync_versions WHERE entity_type='${table}' AND entity_id=${prefix}.${localColumn(table, 'id')}),0),'${event === "DELETE" ? "delete" : "put"}',${event === "DELETE" ? "NULL" : json(prefix!)},COALESCE((SELECT value FROM sync_settings WHERE key='owner'),''),COALESCE((SELECT value FROM sync_settings WHERE key='generation'),''),COALESCE((SELECT value FROM sync_settings WHERE key='library'),''));
          INSERT INTO sync_versions VALUES('${table}',${prefix}.${localColumn(table, 'id')},1) ON CONFLICT(entity_type,entity_id) DO UPDATE SET revision=revision+1;
        END;`);
    }
  }
}

export function validateConversations(db: Database) {
  for (const table of conversationTables) {
    const fields = Object.keys(records[table].shape);
    for (const row of db.prepare(`SELECT ${fields.map(f => `${localColumn(table, f)} AS ${f}`).join(',')} FROM ${table}`).iterate() as Iterable<Record<string, unknown>>) {
      if (!operationSchema.safeParse({ operationId: "preflight", entityType: table, entityId: row.id, baseRevision: 0, action: "put", payload: row }).success)
        throw Error("A saved chat exceeds the supported cloud format or size limit. All conversations remain saved locally.");
    }
  }
}

export function seedConversations(db: Database) {
  if (setting(db, "conversations") === "1") return;
  db.transaction(() => {
    validateConversations(db);
    setting(db, "conversations", "1");
    setting(db, "seeding_conversations", "1");
    for (const table of conversationTables) {
      const key = localColumn(table, 'id');
      db.prepare(`UPDATE ${table} SET id=id WHERE NOT EXISTS
        (SELECT 1 FROM sync_versions WHERE entity_type=? AND entity_id=${table}.${key})`).run(table);
    }
    setting(db, "seeding_conversations", "0");
  })();
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
  recordRemoteDeletion(db,change);
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
    const columns = fields.map(f => localColumn(table, f));
    // Activity timestamps and local numeric IDs never overwrite another device's state.
    const extra = table === "chat_sessions" ? ["accessed_at"] : [];
    db.prepare(
      `INSERT INTO ${table}(${[...columns, ...extra].join(",")}) VALUES(${[...fields, ...extra].map(() => "?").join(",")}) ON CONFLICT(${localColumn(table, 'id')}) DO UPDATE SET ${fields
        .filter((f) => f !== "id")
        .map((f) => `${localColumn(table, f)}=excluded.${localColumn(table, f)}`)
        .join(",")}`,
    ).run(...fields.map((f) => (row as any)[f]), ...extra.map(() => row.created_at));
    if (table === "chat_messages") db.prepare("UPDATE chat_sessions SET accessed_at=MAX(accessed_at,?) WHERE id=?").run(row.created_at, (row as any).session_id);
  } else db.prepare(`DELETE FROM ${table} WHERE ${localColumn(table, 'id')}=?`).run(change.entityId);
  db.prepare(
    "INSERT INTO sync_versions VALUES(?,?,?) ON CONFLICT(entity_type,entity_id) DO UPDATE SET revision=excluded.revision",
  ).run(table, change.entityId, change.revision);
}
