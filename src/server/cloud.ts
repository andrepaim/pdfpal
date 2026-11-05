import type { FastifyInstance } from "fastify";
import type { Database } from "better-sqlite3";
import type { PdfpalConfig } from "../core/config.js";
import { CloudAuth } from "../sync/auth.js";
import { SyncWorker } from "../sync/worker.js";
import { setting } from "../sync/database.js";
import { z } from "zod";
import { Telemetry } from "../core/telemetry.js";
import {errorReportsFor} from '../core/error-reports.js'
import {FirebaseTransport} from '../sync/firebase.js'
export async function registerCloudRoutes(
  app: FastifyInstance,
  db: Database,
  config: PdfpalConfig,
) {
  const telemetry = new Telemetry(db);
  app.get("/api/telemetry/config", async () => ({
    apiKey: process.env.PDFPAL_FIREBASE_API_KEY,
    projectId: process.env.PDFPAL_FIREBASE_PROJECT_ID,
    appId: process.env.PDFPAL_FIREBASE_APP_ID,
    measurementId: process.env.PDFPAL_FIREBASE_MEASUREMENT_ID,
  }));
  app.get("/api/telemetry/consent", async () => telemetry.consent());
  app.post("/api/telemetry/consent", async (req) => {
    telemetry.setConsent(
      z
        .object({ diagnostics: z.boolean(), usage: z.boolean() })
        .strict()
        .parse(req.body),
    );
    return telemetry.consent();
  });
  const auth = new CloudAuth(config);
  let vaultError = "";
  try {
    await auth.init();
  } catch {
    vaultError = "Cloud credentials could not be unlocked; sign in again";
  }
  const worker = new SyncWorker(db, config, auth);
  const reports=errorReportsFor(db)
  reports.bind(()=>auth.credentials?.uid??'',()=>{const transport=new FirebaseTransport(auth,reports.signal);return {write:(id,event)=>transport.writeDiagnostic(id,event),list:()=>transport.diagnostics(),delete:id=>transport.deleteDiagnostic(id)}})
  app.get('/api/telemetry/reports',async()=>reports.overview())
  app.post('/api/telemetry/reports/consent',async req=>{reports.setSharing(z.object({enabled:z.boolean()}).strict().parse(req.body).enabled);return reports.overview()})
  app.post('/api/telemetry/reports/retry',async()=>{await reports.flush(true);return reports.overview()})
  app.get('/api/telemetry/reports/shared',async()=>reports.shared())
  app.delete('/api/telemetry/reports/shared',async()=>reports.clearShared())
  app.delete('/api/telemetry/reports/local',async()=>{reports.clearLocal();return {ok:true}})
  app.post('/api/telemetry/reports/renderer',async req=>{z.object({code:z.literal('RENDERER_CRASH')}).strict().parse(req.body);reports.record('RENDERER_CRASH');return {ok:true}})
  app.decorate('errorReports',reports)
  worker.error = vaultError;
  const requireIdle = () => {
    if (worker.running) throw Error("Wait for synchronization to finish");
  };
  const timer = setInterval(() => {void worker.run();void reports.flush()}, 30_000);
  timer.unref();
  app.addHook('preClose',async()=>{worker.stop();reports.stop()});
  const close = async () => {
    clearInterval(timer);
    worker.stop();
    await reports.close();
    while (worker.running)
      await new Promise((resolve) => setTimeout(resolve, 50));
  };
  app.get("/api/cloud/status", async () => worker.status());
  app.post("/api/cloud/login", async (req, reply) => {
    requireIdle();
    if (!["127.0.0.1", "localhost", "::1"].includes(config.host))
      return reply
        .code(400)
        .send({ detail: "Google sign-in requires the local loopback server" });
    const address = app.server.address();
    if (!address || typeof address === "string")
      throw Error("Local server is not listening");
    return { url: auth.start(`http://127.0.0.1:${address.port}`) };
  });
  app.get("/api/cloud/auth/callback", async (req, reply) => {
    requireIdle();
    reply
      .header("Cache-Control", "no-store")
      .header("Referrer-Policy", "no-referrer");
    try {
      const { code, state } = z
        .object({ code: z.string().max(4096), state: z.string().max(256) })
        .parse(req.query);
      await auth.callback(code, state);
      return reply
        .type("text/plain")
        .send(
          "Signed in to pdfpal. You can close this tab and return to the app.",
        );
    } catch {
      return reply
        .code(400)
        .type("text/plain")
        .send(
          "Sign-in could not be completed. Return to pdfpal and try again.",
        );
    }
  });
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string", bodyLimit: 20000 },
    (_request, body, done) => {
      done(null, Object.fromEntries(new URLSearchParams(String(body))));
    },
  );
  app.post(
    "/api/cloud/auth/browser",
    { bodyLimit: 20000 },
    async (req, reply) => {
      requireIdle();
      reply
        .header("Cache-Control", "no-store")
        .header("Referrer-Policy", "no-referrer");
      try {
        const body = z
          .object({
            state: z.string().min(40).max(256),
            idToken: z.string().min(10).max(10000),
            refreshToken: z.string().min(10).max(4000),
          })
          .strict()
          .parse(req.body);
        await auth.browserCallback(
          body.state,
          body.idToken,
          body.refreshToken,
          req.headers.origin ?? "",
        );
        return reply
          .type("text/html")
          .send(
            '<!doctype html><meta charset="utf-8"><title>Connected to pdfpal</title><body style="font:18px system-ui;padding:48px;background:#101218;color:#eee"><h1>Google account connected</h1><p>Return to pdfpal to enable cloud synchronization. You can close this tab.</p></body>',
          );
      } catch {
        return reply
          .code(400)
          .type("text/plain")
          .send(
            "Sign-in could not be completed. Return to pdfpal and try again.",
          );
      }
    },
  );
  app.post("/api/cloud/logout", async () => {
    requireIdle();
    reports.cancel();
    await auth.logout();
    return { ok: true };
  });
  app.get("/api/cloud/libraries", async () => worker.request("/libraries"));
  app.post("/api/cloud/connect", async (req) => {
    requireIdle();
    const body = z
      .object({
        title: z.string().trim().min(1).max(200),
        libraryId: z
          .string()
          .regex(/^[a-zA-Z0-9_-]{1,128}$/)
          .optional(),
      })
      .strict()
      .parse(req.body);
    return worker.connect(body.title, body.libraryId);
  });
  app.post("/api/cloud/pause", async (req) => {
    requireIdle();
    const { paused } = z
      .object({ paused: z.boolean() })
      .strict()
      .parse(req.body);
    setting(db, "paused", paused ? "1" : "0");
    return worker.status();
  });
  app.post("/api/cloud/sync", async () => {
    await worker.run();
    return worker.status();
  });
  app.post("/api/cloud/conversations", async (req) => {
    requireIdle();
    z.object({ enabled: z.literal(true) }).strict().parse(req.body);
    return worker.enableConversations();
  });
  app.get('/api/cloud/files',async()=>({files:await worker.fileStatus(),...worker.status().pdfFiles}))
  app.post('/api/cloud/files',async req=>{requireIdle();return worker.setPdfFiles(z.object({enabled:z.boolean()}).strict().parse(req.body).enabled)})
  app.post<{Params:{id:string}}>('/api/cloud/files/:id/retry',async req=>{
    requireIdle();worker.setPdfFiles(true)
    const id=z.string().uuid().parse(req.params.id)
    db.prepare('DELETE FROM sync_files WHERE source_id=?').run(id)
    await worker.run();return worker.status()
  })
  app.get("/api/cloud/conflicts", async () =>
    db
      .prepare(
        "SELECT id,operation,remote,created_at FROM sync_conflicts WHERE resolved=0",
      )
      .all(),
  );
  app.post("/api/cloud/conflicts/:id/resolve", async (req) => {
    const choice = z.enum(["local", "remote"]).parse((req.body as any)?.choice);
    return worker.resolveNote((req.params as any).id, choice);
  });
  return close;
}
