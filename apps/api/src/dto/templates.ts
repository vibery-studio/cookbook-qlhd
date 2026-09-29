import { z } from "@hono/zod-openapi";
import { TimestampSchema, UlidSchema } from "./common";

/** SPEC-02 §3.3 — `[a-z][a-z0-9_]*`. */
const FieldKey = z.string().regex(/^[a-z][a-z0-9_]*$/, "key must match [a-z][a-z0-9_]*").max(64);

export const FIELD_TYPES = ["text", "paragraph", "money", "number", "percent", "date", "choice"] as const;

/** `manual` | `<kind>:<ref>`; which kinds/refs exist is a template-check (FR-6), not a shape rule. */
const SourceString = z
  .string()
  .regex(/^[a-z_]+(:[a-z_]+)?$/, "source must be 'kind' or 'kind:ref' (lowercase, underscore)")
  .max(64);

export const TemplateFieldSchema = z
  .object({
    key: FieldKey,
    label: z.string().min(1).max(200),
    type: z.enum(FIELD_TYPES),
    required: z.boolean(),
    source: SourceString,
    options: z.array(z.string().min(1).max(200)).min(1).max(100).optional(),
    options_from: z.string().min(1).max(64).optional(),
    default: z.union([z.string().max(200), z.number()]).optional(),
  })
  .strict()
  .refine((f) => f.type !== "choice" || f.options !== undefined || f.options_from !== undefined, {
    message: "a choice field needs options or options_from",
    path: ["options"],
  })
  .openapi("TemplateField");

export const FieldRuleSchema = z
  .object({ all_or_none: z.array(FieldKey).min(2).max(10) })
  .strict()
  .openapi("TemplateFieldRule");

/** Line items / clauses: fixed shape belongs to row 3 (SPEC-02 §3.6); here only "an object". */
const OpaqueItem = z.record(z.string(), z.unknown());

const PolicyStep = z
  .object({
    step_no: z.number().int().min(1).optional(),
    label: z.string().min(1).max(200),
    permission: z.string().min(1).max(100),
    role: z.string().min(1).max(64).optional(),
  })
  .strict();

export const ApprovalPolicySchema = z
  .object({
    mode: z.enum(["none", "steps", "threshold", "combined"]),
    steps: z.array(PolicyStep).max(10).optional(),
    rules: z
      .array(
        z
          .object({
            when: z
              .object({
                var: z.string().min(1).max(64),
                op: z.enum(["gt", "gte", "lt", "lte", "eq"]),
                value: z.number(),
              })
              .strict(),
            add_steps: z.array(PolicyStep).min(1).max(10),
          })
          .strict(),
      )
      .max(20)
      .optional(),
  })
  .strict()
  .openapi("TemplateApprovalPolicy");

/** Duplicate keys inside `fields[]` are a shape error (422 `validation`). */
function refineUniqueKeys(v: { fields: { key: string }[] }, ctx: z.RefinementCtx): void {
  const seen = new Set<string>();
  v.fields.forEach((f, i) => {
    if (seen.has(f.key)) {
      ctx.addIssue({ code: "custom", message: `duplicate field key '${f.key}'`, path: ["fields", i, "key"] });
    }
    seen.add(f.key);
  });
}

const versionContent = {
  body: z.string().min(1),
  fields: z.array(TemplateFieldSchema).max(200),
  field_rules: z.array(FieldRuleSchema).max(50).default([]),
  default_line_items: z.array(OpaqueItem).max(200),
  default_clauses: z.array(OpaqueItem).max(200),
  approval_policy: ApprovalPolicySchema,
  note: z.string().max(1000).optional(),
};

export const TemplateVersionInput = z
  .object(versionContent)
  .strict()
  .superRefine(refineUniqueKeys)
  .openapi("TemplateVersionInput");

export const CreateTemplateBody = z
  .object({
    type: z.literal("contract"),
    name: z.string().trim().min(1).max(200),
    subject_type: z.literal("customer"),
    version: TemplateVersionInput,
  })
  .strict()
  .openapi("CreateTemplateRequest");

export const CreateTemplateVersionBody = z
  .object({ expected_version_no: z.number().int().min(1), ...versionContent })
  .strict()
  .superRefine(refineUniqueKeys)
  .openapi("CreateTemplateVersionRequest");

const CurrentVersionSummary = z.object({
  id: UlidSchema,
  version_no: z.number().int().min(1),
  created_at: TimestampSchema,
  created_by_name: z.string().nullable(),
});

export const TemplateListItemSchema = z
  .object({
    id: UlidSchema,
    type: z.string(),
    name: z.string(),
    active: z.boolean(),
    current_version: CurrentVersionSummary,
    required_fields: z.array(z.string()),
    steps_summary: z.array(z.string()),
  })
  .openapi("TemplateListItem");

export const TemplateListResponse = z
  .object({ items: z.array(TemplateListItemSchema), next_cursor: z.string().nullable() })
  .openapi("TemplateList");

export const TemplateListQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const TemplateVersionSchema = z
  .object({
    id: UlidSchema,
    version_no: z.number().int().min(1),
    body: z.string(),
    fields: z.array(TemplateFieldSchema),
    field_rules: z.array(FieldRuleSchema),
    default_line_items: z.array(OpaqueItem),
    default_clauses: z.array(OpaqueItem),
    approval_policy: ApprovalPolicySchema,
    note: z.string().nullable(),
    created_at: TimestampSchema,
    created_by_name: z.string().nullable(),
  })
  .openapi("TemplateVersion");

export const TemplateVersionRefSchema = z
  .object({
    id: UlidSchema,
    version_no: z.number().int().min(1),
    created_at: TimestampSchema,
    created_by_name: z.string().nullable(),
    note: z.string().nullable(),
  })
  .openapi("TemplateVersionRef");

export const TemplateDetailSchema = z
  .object({
    id: UlidSchema,
    type: z.string(),
    name: z.string(),
    subject_type: z.string(),
    active: z.boolean(),
    version: TemplateVersionSchema,
    versions: z.array(TemplateVersionRefSchema),
  })
  .openapi("TemplateDetail");

export const TemplateDetailQuery = z.object({
  version_no: z.coerce.number().int().min(1).optional(),
});
