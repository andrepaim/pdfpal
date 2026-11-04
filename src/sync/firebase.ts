import { createHash, randomUUID } from "node:crypto";
import {
  identifier,
  operationSchema,
  type Operation,
  type Receipt,
  type Change,
} from "../shared/sync/schema.js";
import { CloudAuth, cloudOptions } from "./auth.js";
export function encode(value: any): any {
  if (value === null) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number")
    return Number.isInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  if (Array.isArray(value))
    return { arrayValue: { values: value.map(encode) } };
  return {
    mapValue: {
      fields: Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, encode(v)]),
      ),
    },
  };
}
export function decode(value: any): any {
  if ("nullValue" in value) return null;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("arrayValue" in value) return (value.arrayValue.values ?? []).map(decode);
  return Object.fromEntries(
    Object.entries(value.mapValue?.fields ?? {}).map(([k, v]) => [
      k,
      decode(v),
    ]),
  );
}
function canonical(value: any): string {
  return JSON.stringify(value, (_, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => a.localeCompare(b)),
        )
      : v,
  );
}
export class FirebaseTransport {
  constructor(
    private auth: CloudAuth,
    private signal?: AbortSignal,
  ) {}
  private get prefix() {
    return `projects/${cloudOptions()!.projectId}/databases/(default)/documents`;
  }
  private get base() {
    const emulator = process.env.FIRESTORE_EMULATOR_HOST;
    if (
      emulator &&
      (!cloudOptions()!.projectId.startsWith("demo-") ||
        !/^127\.0\.0\.1:\d+$/.test(emulator))
    )
      throw Error("Emulators require an isolated demo project");
    return emulator
      ? `http://${emulator}/v1/`
      : "https://firestore.googleapis.com/v1/";
  }
  private get uid() {
    return identifier.parse(this.auth.credentials?.uid);
  }
  private root(id: string) {
    return `users/${this.uid}/libraries/${identifier.parse(id)}`;
  }
  private async http(
    route: string,
    body?: unknown,
    method = body === undefined ? "GET" : "POST",
  ): Promise<any> {
    const res = await fetch(this.base + this.prefix + route, {
      method,
      headers: {
        authorization: `Bearer ${await this.auth.token()}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.any([
        AbortSignal.timeout(30_000),
        ...(this.signal ? [this.signal] : []),
      ]),
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      const error = new Error(
        res.status === 401
          ? "Sign in again"
          : res.status === 403
            ? "Firebase access denied"
            : res.status === 429
              ? "Firebase quota reached; sync will retry"
              : "Firebase temporarily unavailable",
      ) as Error & { status: number };
      error.status = res.status;
      const detail = await res.json().catch(() => ({}));
      (error as any).firebaseCode = detail.error?.status;
      throw error;
    }
    return res.json();
  }
  async entity(id: string, type: string, entityId: string) {
    const doc = await this.http(
      "/" +
        this.root(id) +
        "/entities/" +
        identifier.parse(type) +
        "_" +
        identifier.parse(entityId),
    );
    return doc
      ? (decode({ mapValue: { fields: doc.fields } }) as Change)
      : null;
  }
  async head(id: string) {
    const doc = await this.http("/" + this.root(id));
    if (!doc) throw Error("Library not found");
    return decode({ mapValue: { fields: doc.fields } });
  }
  async enableConversations(id: string) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const document = await this.http('/' + this.root(id));
      if (!document) throw Error('Library not found');
      const head = decode({ mapValue: { fields: document.fields } });
      if (head.protocol === 2) return;
      if (head.protocol !== 1 || !head.active) throw Error('Update pdfpal before connecting this cloud library');
      try {
        await this.http(':commit', { writes: [{
          update: { name: `${this.prefix}/${this.root(id)}`, fields: encode({ ...head, protocol: 2 }).mapValue.fields },
          currentDocument: { updateTime: document.updateTime },
        }] });
        return;
      } catch (error) {
        if (attempt === 4 || ![400, 403, 409, 503].includes((error as any).status)) throw error;
      }
    }
  }
  async libraries() {
    const result = await this.http(`/users/${this.uid}/libraries?pageSize=100`);
    return (result?.documents ?? []).map((d: any) => ({
      id: d.name.split("/").at(-1),
      ...decode({ mapValue: { fields: d.fields } }),
    }));
  }
  async create(title: string) {
    const id = randomUUID(),
      generation = randomUUID();
    await this.http(
      "/" + this.root(id),
      {
        fields: encode({
          title,
          generation,
          sequence: 0,
          active: true,
          protocol: 1,
        }).mapValue.fields,
      },
      "PATCH",
    );
    return { id, generation, title };
  }
  async changes(id: string, cursor: number) {
    const result = await this.http("/" + this.root(id) + ":runQuery", {
      structuredQuery: {
        from: [{ collectionId: "changes" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "sequence" },
            op: "GREATER_THAN",
            value: encode(cursor),
          },
        },
        orderBy: [{ field: { fieldPath: "sequence" }, direction: "ASCENDING" }],
        limit: 100,
      },
    });
    const changes = (result ?? [])
      .filter((r: any) => r.document)
      .map(
        (r: any) =>
          decode({ mapValue: { fields: r.document.fields } }) as Change,
      );
    return { changes, cursor: changes.at(-1)?.sequence ?? cursor };
  }
  async apply(
    id: string,
    generation: string,
    input: Operation,
  ): Promise<Receipt> {
    const op = operationSchema.parse(input),
      root = this.root(id),
      key = `${op.entityType}_${op.entityId}`;
    const names = [
      root,
      `${root}/entities/${key}`,
      `${root}/receipts/${op.operationId}`,
    ].map((p) => `${this.prefix}/${p}`);
    const signature = createHash("sha256")
      .update(canonical({ ...op, generation }))
      .digest("hex");
    let observed = -1;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const result = (await this.http(":batchGet", {
          documents: names,
        })) as any[];
        const read = (name: string) => {
          const item = result.find((r) => r.found?.name === name);
          return item
            ? decode({ mapValue: { fields: item.found.fields } })
            : null;
        };
        const head = read(names[0]!),
          entity = read(names[1]!),
          receipt = read(names[2]!);
        if (
          !head?.active ||
          head.generation !== generation ||
          ![1, 2].includes(head.protocol)
        )
          throw Error("Cloud library generation changed; reconnect required");
        if (op.entityType.startsWith('chat_') && head.protocol !== 2)
          throw Error('Enable conversation sync before uploading saved chats');
        observed = head.sequence;
        if (receipt) {
          if (receipt.signature !== signature)
            throw Error("Operation ID reused");
          return { status: "applied", revision: receipt.revision };
        }
        if ((entity?.revision ?? 0) !== op.baseRevision)
          return { status: "conflict", current: entity };
        const sequence = head.sequence + 1;
        const change = {
          sequence,
          operationId: op.operationId,
          entityType: op.entityType,
          entityId: op.entityId,
          revision: op.baseRevision + 1,
          payload: op.payload,
          generation,
        };
        // Firebase client transactions use optimistic document preconditions.
        // The standalone beginTransaction endpoint requires server IAM access.
        const write = (name: string, value: unknown) => {
          const existing = result.find((r) => r.found?.name === name)?.found;
          return {
            update: { name, fields: encode(value).mapValue.fields },
            currentDocument: existing
              ? { updateTime: existing.updateTime }
              : { exists: false },
          };
        };
        await this.http(":commit", {
          writes: [
            write(names[0]!, { ...head, sequence }),
            write(names[1]!, change),
            write(`${this.prefix}/${root}/changes/${sequence}`, change),
            write(names[2]!, {
              signature,
              key,
              revision: change.revision,
              sequence,
              generation,
            }),
          ],
        });
        return { status: "applied", revision: change.revision };
      } catch (error) {
        const status = (error as any).status;
        const precondition =
          status === 400 &&
          (error as any).firebaseCode === "FAILED_PRECONDITION";
        if (
          (!precondition && ![403, 409, 503].includes(status)) ||
          attempt === 4
        )
          throw error;
        const latest = await this.head(id);
        if (
          !latest.active ||
          latest.generation !== generation ||
          (status === 403 && latest.sequence <= observed)
        )
          throw error;
        await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
      }
    }
    throw Error("Cloud transaction retry limit reached");
  }
  async file(
    library: string,
    source: string,
    hash: string,
    bytes?: Buffer,
  ): Promise<Response> {
    const options = cloudOptions()!;
    if (!options.storageBucket)
      throw Error(
        "PDF cloud storage is not configured; metadata only is synchronized",
      );
    identifier.parse(library);
    identifier.parse(source);
    if (!/^[a-f0-9]{64}$/.test(hash)) throw Error("Invalid file hash");
    const name = `users/${this.uid}/libraries/${library}/sources/${source}/${hash}.pdf`;
    const emulator = process.env.FIREBASE_STORAGE_EMULATOR_HOST;
    if (
      emulator &&
      (!options.projectId.startsWith("demo-") ||
        !/^127\.0\.0\.1:\d+$/.test(emulator))
    )
      throw Error("Isolated storage emulator required");
    const storageOrigin = emulator
      ? `http://${emulator}`
      : "https://firebasestorage.googleapis.com";
    const url = `${storageOrigin}/v0/b/${encodeURIComponent(options.storageBucket)}/o${bytes ? "?name=" + encodeURIComponent(name) : "/" + encodeURIComponent(name) + "?alt=media"}`;
    const boundary = "pdfpal_" + randomUUID();
    const upload = bytes
      ? Buffer.concat([
          Buffer.from(
            `--${boundary}\r\nContent-Type: application/json; charset=utf-8\r\n\r\n${JSON.stringify({ name, contentType: "application/pdf" })}\r\n--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`,
          ),
          bytes,
          Buffer.from(`\r\n--${boundary}--`),
        ])
      : undefined;
    const response = await fetch(url, {
      method: bytes ? "POST" : "GET",
      headers: {
        authorization: `Firebase ${await this.auth.token()}`,
        ...(bytes
          ? {
              "content-type": `multipart/related; boundary=${boundary}`,
              "x-goog-upload-protocol": "multipart",
            }
          : {}),
      },
      body: upload ? new Uint8Array(upload) : undefined,
      signal: AbortSignal.any([
        AbortSignal.timeout(120_000),
        ...(this.signal ? [this.signal] : []),
      ]),
    });
    if (!response.ok)
      throw Error(
        `PDF ${bytes ? "upload" : "download"} failed (${response.status})`,
      );
    return response;
  }
}
