import { z } from "@hono/zod-openapi";
import { TimestampSchema, UlidSchema } from "./common";

const trimmedNonEmpty = (max: number) => z.string().trim().min(1).max(max);
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

export const ContractStatusEnum = z.enum(["draft", "pending", "approved", "rejected", "issued", "voided"]);

/**
 * `values` keys = template field `key`s (SPEC-02). `ma_goi` is a plain string on purpose: DT14 (and any unknown
 * code) must reach the snapshot builder so the 422 names `ma_goi`. Unknown keys (`total`, `unit_price`…) → 422.
 */
export const ContractValues = z
  .object({
    ma_goi: z.string(),
    so_cua_hang: z.number().int(),
    giam_gia: z.number().int().min(0).max(10000).optional(),
    chuc_vu_nguoi_ky: z.string().optional(), // absent/blank -> 422 missing-fields (builder), not validation
    ngay_bat_dau: IsoDate.optional(),
    so_bao_gia: z.string().optional(),
    ngay_bao_gia: IsoDate.optional(),
  })
  .strict()
  .openapi("ContractValues");

export const CreateContractBody = z
  .object({ template_id: UlidSchema, customer_id: UlidSchema, values: ContractValues })
  .strict()
  .openapi("CreateContractRequest");

export const UpdateContractBody = z
  .object({
    expected_version: z.number().int().min(1),
    customer_id: UlidSchema.optional(),
    values: ContractValues.optional(),
    use_latest_template: z.boolean().optional(),
  })
  .strict()
  .openapi("UpdateContractRequest");

export const ApproveBody = z.object({ note: z.string().trim().max(1000).optional() }).strict().openapi("ApproveRequest");
export const RejectBody = z.object({ note: trimmedNonEmpty(1000) }).strict().openapi("RejectRequest");
export const VoidBody = z.object({ reason: trimmedNonEmpty(1000) }).strict().openapi("VoidRequest");
export const EmptyBody = z.object({}).strict().openapi("EmptyRequest");

export const ContractStepSchema = z
  .object({
    id: z.string(),
    step_no: z.number().int(),
    label: z.string(),
    status: z.enum(["waiting", "approved", "rejected"]),
    required_permission: z.string(),
    required_role: z.string().nullable(),
    decided_by: z.string().nullable(),
    decided_at: TimestampSchema.nullable(),
    note: z.string().nullable(),
    snapshot_hash_at_decision: z.string().nullable(),
  })
  .openapi("ContractStep");

export const ContractTimelineItem = z
  .object({ action: z.string(), at: TimestampSchema, actor: z.string().nullable().optional() })
  .openapi("ContractTimelineItem");

export const ContractCan = z
  .object({
    edit: z.boolean(),
    submit: z.boolean(),
    approve: z.boolean(),
    reject: z.boolean(),
    issue: z.boolean(),
    void: z.boolean(),
    copy: z.boolean(),
  })
  .openapi("ContractCan");

export const ContractSchema = z
  .object({
    id: UlidSchema,
    type: z.string(),
    status: ContractStatusEnum,
    number: z.string().nullable(),
    seq: z.number().int().nullable(),
    series_year: z.number().int().nullable(),
    template_id: z.string(),
    template_version_id: z.string(),
    customer_id: z.string(),
    customer_name: z.string(),
    total: z.number().int(),
    created_by: z.string(),
    doc_date: z.string(),
    version: z.number().int(),
    snapshot: z.record(z.string(), z.unknown()),
    snapshot_hash: z.string(),
    source_contract_id: z.string().nullable(),
    replaced_by_id: z.string().nullable(),
    submitted_at: TimestampSchema.nullable(),
    decided_at: TimestampSchema.nullable(),
    issued_by: z.string().nullable(),
    issued_at: TimestampSchema.nullable(),
    rendered_hash: z.string().nullable(),
    voided_by: z.string().nullable(),
    voided_at: TimestampSchema.nullable(),
    void_reason: z.string().nullable(),
    created_at: TimestampSchema,
    updated_at: TimestampSchema,
    steps: z.array(ContractStepSchema),
    timeline: z.array(ContractTimelineItem),
    can: ContractCan,
  })
  .openapi("Contract");

export const ContractListQuery = z.object({
  status: ContractStatusEnum.optional(),
  customer_id: z.string().optional(),
  created_by: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(50),
});

export const ContractListItem = z
  .object({
    id: z.string(),
    number: z.string().nullable(),
    status: ContractStatusEnum,
    customer_name: z.string(),
    total: z.number().int(),
    created_by: z.string(),
    created_by_name: z.string().nullable(),
    updated_at: TimestampSchema,
  })
  .openapi("ContractListItem");

export const ContractCounts = z
  .object({
    draft: z.number().int(),
    pending: z.number().int(),
    approved: z.number().int(),
    issued: z.number().int(),
    rejected: z.number().int(),
    voided: z.number().int(),
  })
  .openapi("ContractCounts");

export const ContractListResponse = z
  .object({ items: z.array(ContractListItem), next_cursor: z.string().nullable(), counts: ContractCounts })
  .openapi("ContractList");

export const ContractAuditQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(50),
});

export const ApprovalQueueQuery = ContractAuditQuery;

export const ApprovalQueueItem = z
  .object({
    contract_id: z.string(),
    step_no: z.number().int(),
    label: z.string(),
    customer_name: z.string(),
    total: z.number().int(),
    created_by: z.string(),
    created_by_name: z.string().nullable(),
    submitted_at: TimestampSchema.nullable(),
  })
  .openapi("ApprovalQueueItem");

export const ApprovalQueueResponse = z
  .object({ items: z.array(ApprovalQueueItem), next_cursor: z.string().nullable() })
  .openapi("ApprovalQueue");

export type ContractDto = z.infer<typeof ContractSchema>;
export type ContractListDto = z.infer<typeof ContractListResponse>;
export type ApprovalQueueDto = z.infer<typeof ApprovalQueueResponse>;
export type CreateContractInput = z.infer<typeof CreateContractBody>;
export type UpdateContractInput = z.infer<typeof UpdateContractBody>;
