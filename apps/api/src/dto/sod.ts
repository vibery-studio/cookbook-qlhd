import { z } from "@hono/zod-openapi";
import { UlidSchema } from "./common";
import { PermissionKeySchema } from "./roles";

/** SPEC-07 §3.2 — separation-of-duties permission pairs (DEC-9 B). Stored `perm_a < perm_b`. */

export const SodPairSchema = z
  .object({
    id: UlidSchema,
    perm_a: z.string(),
    perm_b: z.string(),
    reason: z.string().nullable(),
    created_by_name: z.string().nullable(),
    created_at: z.number().int(),
  })
  .openapi("SodPair");

export const SodPairList = z.object({ items: z.array(SodPairSchema) }).openapi("SodPairList");

export const CreateSodPairBody = z
  .object({
    perm_a: PermissionKeySchema,
    perm_b: PermissionKeySchema,
    reason: z.string().trim().max(200).optional(),
  })
  .strict()
  .refine((b) => b.perm_a !== b.perm_b, { message: "perm_a and perm_b must differ", path: ["perm_b"] })
  .openapi("CreateSodPair");

export const SodPairIdParam = z.object({ id: UlidSchema });
