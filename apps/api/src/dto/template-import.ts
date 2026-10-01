import { z } from "@hono/zod-openapi";
import { UlidSchema } from "./common";
import { ApprovalPolicySchema, FieldRuleSchema, TemplateFieldSchema } from "./templates";

/** SPEC-10 §3.4 / PLAN-10 §2b — preview of a Word (.docx) template import. Stateless: nothing is stored. */

export const TemplateImportQuery = z.object({
  template_id: UlidSchema.optional(),
  lines_table: z.coerce.number().int().min(0).max(99).optional(),
});

const OpaqueItem = z.record(z.string(), z.unknown());

const CheckFailedItem = z
  .object({
    path: z.string(),
    code: z.string(),
    key: z.string().optional(),
    source: z.string().optional(),
    message: z.string(),
  })
  .openapi("TemplateImportCheckError");

const ImportPlaceholder = z
  .object({
    key: z.string(),
    /** First original spelling found in the file (before slugging). */
    original: z.string(),
    count: z.number().int(),
    table_index: z.number().int().nullable(),
    suggested: TemplateFieldSchema,
    suggestion_from: z.enum(["current_version", "other_template", "none"]),
  })
  .openapi("TemplateImportPlaceholder");

const ImportTable = z
  .object({
    index: z.number().int(),
    rows: z.number().int(),
    cols: z.number().int(),
    placeholder_keys: z.array(z.string()),
  })
  .openapi("TemplateImportTable");

const ImportRemoved = z
  .object({ kind: z.literal("internal_note"), text: z.string() })
  .openapi("TemplateImportRemoved");

const ImportWarning = z
  .object({ code: z.string(), message: z.string(), count: z.number().int() })
  .openapi("TemplateImportWarning");

const ImportBase = z
  .object({
    template_id: UlidSchema.nullable(),
    version_no: z.number().int().nullable(),
    approval_policy: ApprovalPolicySchema,
    field_rules: z.array(FieldRuleSchema),
    default_line_items: z.array(OpaqueItem),
    default_clauses: z.array(OpaqueItem),
  })
  .openapi("TemplateImportBase");

export const TemplateImportPreviewSchema = z
  .object({
    body: z.string(),
    placeholders: z.array(ImportPlaceholder),
    tables: z.array(ImportTable),
    removed: z.array(ImportRemoved),
    warnings: z.array(ImportWarning),
    sources: z.array(z.string()),
    base: ImportBase,
    check_errors: z.array(CheckFailedItem),
    stats: z.object({ body_bytes: z.number().int(), fields: z.number().int() }),
  })
  .openapi("TemplateImportPreview");
