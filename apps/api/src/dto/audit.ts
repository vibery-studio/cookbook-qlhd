import { z } from "@hono/zod-openapi";
import { TimestampSchema } from "./common";

export const AuditQuery = z.object({
  action: z.string().optional(),
  actor: z.string().optional(),
  target: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(50),
});

export const AuditEventSchema = z
  .object({
    id: z.string(),
    ts: TimestampSchema,
    actor: z.string().nullable(),
    actor_name: z.string().nullable(),
    action: z.string(),
    target: z.string().nullable(),
    metadata: z.record(z.string(), z.unknown()).nullable(),
    ip: z.string().nullable(),
  })
  .openapi("AuditEvent");

export const AuditListResponse = z
  .object({ items: z.array(AuditEventSchema), next_cursor: z.string().nullable() })
  .openapi("AuditList");
