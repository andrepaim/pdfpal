import { z } from "zod";
export const identifier = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
const text = z.string().max(200_000);
const timestamp = z.string().max(40);
const nullableId = identifier.nullable();
const base = { id: identifier, created_at: timestamp };
export const records = {
  projects: z
    .object({ ...base, title: text, description: text, accessed_at: timestamp })
    .strict(),
  collections: z
    .object({
      ...base,
      project_id: identifier,
      parent_id: nullableId,
      name: text,
      position: z.number().int(),
    })
    .strict(),
  sources: z
    .object({
      ...base,
      project_id: identifier,
      type: z.enum(["pdf", "url", "text", "kindle"]),
      url: text.nullable(),
      title: text.nullable(),
      pages: z.number().int().nonnegative(),
      last_page_read: z.number().int().positive(),
      accessed_at: timestamp,
      media_type: text.nullable(),
      byte_size: z.number().int().nonnegative().nullable(),
      content_hash: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .nullable(),
      author: text.nullable(),
      kindle_book_key: text.nullable(),
      collection_id: nullableId,
    })
    .strict(),
  notes: z
    .object({
      ...base,
      project_id: identifier,
      source_id: nullableId,
      title: text,
      content: text,
      updated_at: timestamp,
    })
    .strict(),
  annotations: z
    .object({
      ...base,
      source_id: identifier,
      project_id: identifier,
      page_number: z.number().int().positive(),
      x1: z.number(),
      y1: z.number(),
      x2: z.number(),
      y2: z.number(),
      text,
      color: text,
      rects: text.nullable(),
    })
    .strict(),
};
export const entityType = z.enum([
  "projects",
  "collections",
  "sources",
  "notes",
  "annotations",
]);
export type EntityType = z.infer<typeof entityType>;
export const operationSchema = z
  .object({
    operationId: identifier,
    entityType,
    entityId: identifier,
    baseRevision: z.number().int().nonnegative(),
    action: z.enum(["put", "delete"]),
    payload: z.record(z.string(), z.unknown()).nullable(),
  })
  .strict()
  .superRefine((op, ctx) => {
    if (op.action === "delete") {
      if (op.payload !== null)
        ctx.addIssue({
          code: "custom",
          message: "Delete payload must be null",
        });
      return;
    }
    const parsed = records[op.entityType].safeParse(op.payload);
    if (!parsed.success || parsed.data.id !== op.entityId)
      ctx.addIssue({ code: "custom", message: "Invalid entity payload" });
    if (Buffer.byteLength(JSON.stringify(op.payload)) > 600_000)
      ctx.addIssue({
        code: "custom",
        message: "Entity exceeds synchronization limit",
      });
  });
export type Operation = z.infer<typeof operationSchema>;
export interface Change {
  sequence: number;
  operationId: string;
  entityType: EntityType;
  entityId: string;
  revision: number;
  payload: Record<string, unknown> | null;
}
export type Receipt =
  | { status: "applied"; revision: number }
  | { status: "conflict"; current: Change | null };
