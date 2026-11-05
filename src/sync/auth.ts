import { firebaseClient, loadFirebaseClient } from "../shared/firebase-client.js";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import type { PdfpalConfig } from "../core/config.js";
export interface CloudCredentials {
  uid: string;
  email: string;
  idToken: string;
  refreshToken: string;
  expiresAt: number;
}
export interface CredentialVault {
  read(): Promise<CloudCredentials | null>;
  write(value: CloudCredentials | null): Promise<void>;
}
const vaults = new Map<string, CredentialVault>();
export function bindCloudVault(config: PdfpalConfig, vault: CredentialVault) {
  vaults.set(config.dataDir, vault);
}
export function cloudOptions() {
  const projectId =
      process.env.PDFPAL_FIREBASE_PROJECT_ID ?? firebaseClient.projectId,
    apiKey = process.env.PDFPAL_FIREBASE_API_KEY ?? "",
    clientId = process.env.PDFPAL_GOOGLE_CLIENT_ID ?? "";
  if (!/^[a-z][a-z0-9-]{4,62}$/.test(projectId))
    throw Error("Invalid Firebase project");
  const storageBucket=process.env.PDFPAL_STORAGE_BUCKET??''
  if(storageBucket&&![`${projectId}.appspot.com`,`${projectId}.firebasestorage.app`].includes(storageBucket))throw Error('The PDF Storage bucket must belong to the configured Firebase project.')
  return {
    projectId,
    apiKey,
    clientId,
    loginUrl:
      process.env.PDFPAL_FIREBASE_LOGIN_URL ??
      `https://${projectId}.web.app/login.html`,
    storageBucket,
    clientSecret: process.env.PDFPAL_GOOGLE_CLIENT_SECRET ?? "",
  };
}
async function json(url: string, body: URLSearchParams | object) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type":
        body instanceof URLSearchParams
          ? "application/x-www-form-urlencoded"
          : "application/json",
    },
    body: body instanceof URLSearchParams ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw Error("Account authorization failed; sign in again");
  return res.json() as Promise<any>;
}
export class CloudAuth {
  credentials: CloudCredentials | null = null;
  private epoch = 0;
  private writes:Promise<void>=Promise.resolve();
  private persist(value:CloudCredentials|null){
    const write=()=>vaults.get(this.config.dataDir)?.write(value)??Promise.resolve();
    const result=this.writes.then(write,write);
    this.writes=result.catch(()=>{});
    return result;
  }
  private pending?: {
    state: string;
    verifier: string;
    redirect: string;
    expires: number;
    epoch: number;
  };
  constructor(private config: PdfpalConfig) {}
  async init() {
    this.credentials = (await vaults.get(this.config.dataDir)?.read()) ?? null;
  }
  async logout() {
    this.epoch++;
    this.pending = undefined;
    this.credentials = null;
    await this.persist(null);
  }
  start(origin: string) {
    const options = cloudOptions();
    if (!options) throw Error("Cloud service is not configured");
    const state = randomBytes(32).toString("base64url"),
      verifier = randomBytes(32).toString("base64url"),
      redirect = `${origin}/api/cloud/auth/callback`;
    this.pending = {
      epoch: ++this.epoch,
      state,
      verifier,
      redirect,
      expires: Date.now() + 5 * 60_000,
    };
    if (!options.clientId) {
      const hosted = new URL(options.loginUrl);
      if (hosted.protocol !== "https:" || hosted.username || hosted.password)
        throw Error("Invalid Firebase sign-in page");
      hosted.hash = new URLSearchParams({
        state,
        port: new URL(origin).port,
      }).toString();
      return hosted.href;
    }
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({
      client_id: options.clientId,
      redirect_uri: redirect,
      response_type: "code",
      scope: "openid email profile",
      state,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
      prompt: "select_account",
    }).toString();
    return url.href;
  }
  async callback(code: string, state: string) {
    if(!cloudOptions()?.clientId)throw Error("Native OAuth is not configured");
    const pending = this.pending;
    if (
      !pending ||
      Date.now() > pending.expires ||
      state.length !== pending.state.length ||
      !timingSafeEqual(Buffer.from(state), Buffer.from(pending.state))
    )
      throw Error("Sign-in expired; retry from pdfpal");
    this.pending=undefined;
    const options = cloudOptions()!;
    options.apiKey ||= (await loadFirebaseClient(options.projectId)).apiKey;
    const google = await json(
      "https://oauth2.googleapis.com/token",
      new URLSearchParams({
        code,
        client_id: options.clientId,
        client_secret: options.clientSecret,
        redirect_uri: pending.redirect,
        grant_type: "authorization_code",
        code_verifier: pending.verifier,
      }),
    );
    const firebase = await json(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${encodeURIComponent(options.apiKey)}`,
      {
        requestUri: pending.redirect,
        postBody: new URLSearchParams({
          id_token: google.id_token,
          providerId: "google.com",
        }).toString(),
        returnSecureToken: true,
      },
    );
    const response = await json(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(options.apiKey)}`,
      { idToken: firebase.idToken },
    );
    if (response.users?.[0]?.localId !== firebase.localId)
      throw Error("Cloud account could not be verified");
    if (pending.epoch !== this.epoch)
      throw Error("Account action was cancelled");
    this.credentials = {
      uid: firebase.localId,
      email: firebase.email ?? "",
      idToken: firebase.idToken,
      refreshToken: firebase.refreshToken,
      expiresAt: Date.now() + Number(firebase.expiresIn) * 1000,
    };
    await this.persist(this.credentials);
    if(pending.epoch!==this.epoch)throw Error("Account action was cancelled");
  }
  async browserCallback(
    state: string,
    idToken: string,
    refreshToken: string,
    origin: string,
  ) {
    const pending = this.pending,
      options = cloudOptions()!;
    if (
      origin !== new URL(options.loginUrl).origin ||
      !pending ||
      pending.epoch !== this.epoch ||
      Date.now() > pending.expires ||
      state.length !== pending.state.length ||
      !timingSafeEqual(Buffer.from(state), Buffer.from(pending.state))
    )
      throw Error("Sign-in expired or invalid; retry from pdfpal");
    this.pending = undefined;
    options.apiKey ||= (await loadFirebaseClient(options.projectId)).apiKey;
    const lookup = await json(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(options.apiKey)}`,
      { idToken },
    );
    const user = lookup.users?.[0];
    if (
      !user?.localId ||
      !user.providerUserInfo?.some((p: any) => p.providerId === "google.com")
    )
      throw Error("Use a Google account to sign in");
    const refreshed = await json(
      `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(options.apiKey)}`,
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    );
    if (refreshed.user_id !== user.localId || pending.epoch !== this.epoch)
      throw Error("Sign-in account changed");
    this.credentials = {
      uid: user.localId,
      email: user.email ?? "",
      idToken: refreshed.id_token,
      refreshToken: refreshed.refresh_token,
      expiresAt: Date.now() + Number(refreshed.expires_in) * 1000,
    };
    await this.persist(this.credentials);
    if(pending.epoch!==this.epoch)throw Error("Account action was cancelled");
  }
  async token() {
    if (!this.credentials) throw Error("Sign in with Google first");
    const epoch = this.epoch;
    const identity = this.credentials;
    if (this.credentials.expiresAt < Date.now() + 60_000) {
      const options = cloudOptions()!;
      options.apiKey ||= (await loadFirebaseClient(options.projectId)).apiKey;
      if (epoch !== this.epoch || !this.credentials)
        throw Error("Account action was cancelled");
      const result = await json(
          `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(options.apiKey)}`,
          new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: this.credentials.refreshToken,
          }),
        );
      if (epoch !== this.epoch || !this.credentials)
        throw Error("Account action was cancelled");
      if (result.user_id !== identity.uid) throw Error("Cloud account changed");
      this.credentials = {
        ...this.credentials,
        idToken: result.id_token,
        refreshToken: result.refresh_token,
        expiresAt: Date.now() + Number(result.expires_in) * 1000,
      };
      await this.persist(this.credentials);
    }
    if(epoch!==this.epoch||!this.credentials)throw Error("Account action was cancelled");
    return this.credentials.idToken;
  }
}
