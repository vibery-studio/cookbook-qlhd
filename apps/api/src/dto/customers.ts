import { z } from "@hono/zod-openapi";
import { EmailSchema, TimestampSchema, UlidSchema } from "./common";

export const CustomerSchema = z
  .object({
    id: UlidSchema,
    name: z.string(),
    contact_person: z.string().nullable(),
    tax_code: z.string().nullable(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
    address: z.string().nullable(),
    created_by: z.string().nullable(),
    created_at: TimestampSchema,
    updated_at: TimestampSchema,
    version: z.number().int().min(1),
  })
  .openapi("Customer");

/** Trim; an empty string means "no value" (SPEC-01 §4 Input) — the service stores NULL. */
const blankToUndefined = (v: unknown) => {
  if (typeof v !== "string") return v;
  const t = v.trim();
  return t === "" ? undefined : t;
};

const customerFields = {
  contact_person: z.preprocess(blankToUndefined, z.string().max(200).optional()),
  tax_code: z.preprocess(
    blankToUndefined,
    z
      .string()
      .max(20)
      .regex(/^[0-9-]+$/, "digits and '-' only")
      .optional(),
  ),
  phone: z.preprocess(blankToUndefined, z.string().max(30).optional()),
  email: z.preprocess(blankToUndefined, EmailSchema.optional()),
  address: z.preprocess(blankToUndefined, z.string().max(500).optional()),
};

export const CreateCustomerBody = z
  .object({ name: z.string().min(1).max(200), ...customerFields })
  .strict()
  .openapi("CreateCustomerRequest");

export const UpdateCustomerBody = z
  .object({
    name: z.string().min(1).max(200).optional(),
    ...customerFields,
    expected_version: z.number().int().min(1),
  })
  .strict()
  .openapi("UpdateCustomerRequest");

export const CustomerListQuery = z.object({
  q: z.string().max(200).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const CustomerListResponse = z
  .object({ items: z.array(CustomerSchema), next_cursor: z.string().nullable() })
  .openapi("CustomerList");
