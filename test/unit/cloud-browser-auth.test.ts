import { test } from "node:test";
import assert from "node:assert/strict";
import { CloudAuth, bindCloudVault } from "../../src/sync/auth.js";
import { testConfig } from "../helpers/test-utils.js";
import fs from "node:fs";
test("hosted Google sign-in binds its origin/state and verifies both returned credentials", async () => {
  const config = testConfig(),
    auth = new CloudAuth(config),
    original = globalThis.fetch;
  const previous = process.env.PDFPAL_GOOGLE_CLIENT_ID;
  delete process.env.PDFPAL_GOOGLE_CLIENT_ID;
  let saved: any = null,
    calls = 0;
  bindCloudVault(config, {
    read: async () => null,
    write: async (value) => {
      saved = value;
    },
  });
  globalThis.fetch = async (input) => {
    calls++;
    return new Response(
      JSON.stringify(
        String(input).includes("accounts:lookup")
          ? {
              users: [
                {
                  localId: "alice",
                  email: "alice@example.test",
                  providerUserInfo: [{ providerId: "google.com" }],
                },
              ],
            }
          : {
              user_id: "alice",
              id_token: "verified-id",
              refresh_token: "rotated-refresh",
              expires_in: "3600",
            },
      ),
    );
  };
  try {
    const url = new URL(auth.start("http://127.0.0.1:8202")),
      args = new URLSearchParams(url.hash.slice(1)),
      state = args.get("state")!;
    assert.equal(url.origin, "https://pdfpal-cloud-20261104.web.app");
    assert.equal(args.get("port"), "8202");
    assert.equal(url.search, "");
    await assert.rejects(
      auth.browserCallback(
        state,
        "id-token",
        "refresh-token",
        "https://evil.example",
      ),
    );
    assert.equal(calls, 0);
    await assert.rejects(
      auth.browserCallback(
        "x".repeat(43),
        "id-token",
        "refresh-token",
        url.origin,
      ),
    );
    assert.equal(calls, 0);
    await assert.rejects(auth.callback("wrong-code","wrong-state"));
    await auth.browserCallback(state, "id-token", "refresh-token", url.origin);
    assert.equal(saved.uid, "alice");
    assert.equal(saved.idToken, "verified-id");
    assert.equal(calls, 2);
    await assert.rejects(
      auth.browserCallback(state, "id-token", "refresh-token", url.origin),
    );
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = original;
    if (previous === undefined) delete process.env.PDFPAL_GOOGLE_CLIENT_ID;
    else process.env.PDFPAL_GOOGLE_CLIENT_ID = previous;
    fs.rmSync(config.dataDir, { recursive: true, force: true });
  }
});

test('logout clearing is persisted after an earlier delayed credential write',async()=>{
 const config=testConfig(),auth=new CloudAuth(config),original=globalThis.fetch;
 let stored:any=null,release!:()=>void,started!:()=>void;
 const writing=new Promise<void>(resolve=>{started=resolve});
 bindCloudVault(config,{read:async()=>stored,write:async value=>{if(value){started();await new Promise<void>(resolve=>{release=resolve})}stored=value}});
 globalThis.fetch=async input=>new Response(JSON.stringify(String(input).includes('accounts:lookup')?{users:[{localId:'alice',providerUserInfo:[{providerId:'google.com'}]}]}:{user_id:'alice',id_token:'id',refresh_token:'refresh',expires_in:'3600'}));
 try{const url=new URL(auth.start('http://127.0.0.1:8202')),state=new URLSearchParams(url.hash.slice(1)).get('state')!;
 const signingIn=auth.browserCallback(state,'id-token','refresh-token',url.origin);await writing;
 const loggingOut=auth.logout();release();await Promise.allSettled([signingIn,loggingOut]);
 assert.equal(auth.credentials,null);assert.equal(stored,null);
 }finally{globalThis.fetch=original;fs.rmSync(config.dataDir,{recursive:true,force:true})}
});
