import type { Database } from "better-sqlite3";
import { setting } from "../sync/database.js";
export type Consent = { diagnostics: boolean; usage: boolean };
export type TelemetryEvent = {
  name:
    | "pdf_import"
    | "pdf_first_page"
    | "sync_batch"
    | "sync_conflict"
    | "ai_request"
    | "search";
  outcome: "started" | "completed" | "failed" | "interrupted";
  durationMs?: number;
  count?: number;
};
export type TelemetrySink = (event: TelemetryEvent) => void | Promise<void>;
/** Content-free events only. A missing or failing sink cannot break a user action. */
export class Telemetry {
  constructor(
    private db: Database,
    private sink?: TelemetrySink,
  ) {}
  consent(): Consent {
    return {
      diagnostics: setting(this.db, "telemetry_diagnostics") === "1",
      usage: setting(this.db, "telemetry_usage") === "1",
    };
  }
  setConsent(consent: Consent) {
    this.db.transaction(() => {
      setting(
        this.db,
        "telemetry_diagnostics",
        consent.diagnostics ? "1" : "0",
      );
      setting(this.db, "telemetry_usage", consent.usage ? "1" : "0");
      if (!consent.diagnostics)
        this.db.prepare("DELETE FROM telemetry_journal").run();
    })();
  }
  async record(event: TelemetryEvent) {
    if (
      ![
        "pdf_import",
        "pdf_first_page",
        "sync_batch",
        "sync_conflict",
        "ai_request",
        "search",
      ].includes(event.name) ||
      !["started", "completed", "failed", "interrupted"].includes(event.outcome)
    )
      return;
    const safe: TelemetryEvent = { name: event.name, outcome: event.outcome };
    if (Number.isFinite(event.durationMs))
      safe.durationMs = Math.min(
        Math.max(0, Math.round(event.durationMs!)),
        3_600_000,
      );
    if (Number.isFinite(event.count))
      safe.count = Math.min(Math.max(0, Math.round(event.count!)), 10_000);
    try {
      if (this.consent().diagnostics) {
        this.db
          .prepare(
            "INSERT INTO telemetry_journal(event,created_at) VALUES(?,?)",
          )
          .run(JSON.stringify(safe), new Date().toISOString());
        this.db
          .prepare(
            "DELETE FROM telemetry_journal WHERE id NOT IN (SELECT id FROM telemetry_journal ORDER BY id DESC LIMIT 200)",
          )
          .run();
      }
      if (this.consent().usage && this.sink) await this.sink(safe);
    } catch {
      /* Diagnostics are best effort. */
    }
  }
}
