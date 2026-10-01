import { z } from "@hono/zod-openapi";
import { DOC_TYPES } from "../domain/contract/doc-types";
import { MAX_LINES } from "../domain/money/line-pricing";
import { TimestampSchema, UlidSchema } from "./common";
import { LineInput } from "./products";

const trimmedNonEmpty = (max: number) => z.string().trim().min(1).max(max);
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

export const ContractStatusEnum = z.enum(["draft", "pending", "approved", "rejected", "issued", "voided"]);

/** SPEC-09 FR-1 (PLAN-09 §2b): BG · HĐ · DNTT · PXK. Unknown → 422 `validation`. */
export const DocTypeEnum = z.enum(DOC_TYPES).openapi("DocType");

/** A related document (parent or child) as shown in the drawer's "Tài liệu liên quan". */
export const ContractRef = z
  .object({
    id: UlidSchema,
    type: DocTypeEnum,
    number: z.string().nullable(),
    status: ContractStatusEnum,
    total: z.number().int(),
    doc_date: z.string(),
  })
  .openapi("ContractRef");

/**
 * `values` keys = template manual field `key`s (SPEC-02). Products + quantities travel in `lines` (SPEC-08 FR-4); prices and
 * totals are never accepted from the client (I4): unknown keys (`total`, `unit_price`, the old `ma_goi`…) → 422.
 */
export const ContractValues = z
  .object({
    giam_gia: z.number().int().min(0).max(10000).optional(),
    chuc_vu_nguoi_ky: z.string().optional(), // absent/blank -> 422 missing-fields (builder), not validation
    ngay_bat_dau: IsoDate.optional(),
    so_bao_gia: z.string().optional(),
    ngay_bao_gia: IsoDate.optional(),
    /** PXK (P-7): `ly_do_xuat_kho` required by the PXK template (422 missing-fields), the other two optional */
    ly_do_xuat_kho: z.string().trim().max(200).optional(),
    xuat_tai_kho: z.string().trim().max(200).optional(),
    dia_diem: z.string().trim().max(200).optional(),
  })
  .strict()
  .openapi("ContractValues");

/** 1–50 `{product_id, qty}`; the server prices them on the doc date (exactly one monthly service line — DEC-10). */
export const ContractLines = z.array(LineInput).min(1).max(MAX_LINES);

export const CreateContractBody = z
  .object({ template_id: UlidSchema, customer_id: UlidSchema, lines: ContractLines, values: ContractValues })
  .strict()
  .openapi("CreateContractRequest");

export const UpdateContractBody = z
  .object({
    expected_version: z.number().int().min(1),
    customer_id: UlidSchema.optional(),
    /** Omitted = keep the draft's lines (re-priced on today's date). */
    lines: ContractLines.optional(),
    values: ContractValues.optional(),
    use_latest_template: z.boolean().optional(),
  })
  .strict()
  .openapi("UpdateContractRequest");

/**
 * `POST /contracts/{id}/children` (FR-4, P-2/P-5): `type` = any doc type (a wrong pair → 422 `child-type`); `template_id`
 * omitted → the seed template of the child type. Lines, prices, discount come frozen from the parent — never from here.
 */
export const CreateChildBody = z
  .object({ type: DocTypeEnum, template_id: UlidSchema.optional(), values: ContractValues.optional() })
  .strict()
  .openapi("CreateChildRequest");

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
    decided_by_name: z.string().nullable(),
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
    withdraw: z.boolean(),
    delete: z.boolean(),
    /** FR-10 / P-9: one entry per type in CHILD_OF[type] (`[]` for DNTT/PXK); first reason wins in this order */
    create_child: z.array(
      z.object({
        type: DocTypeEnum,
        allowed: z.boolean(),
        reason_code: z.enum(["parent-not-issued", "quote-expired", "child-exists", "forbidden"]).nullable(),
      }),
    ),
  })
  .openapi("ContractCan");

export const ContractSchema = z
  .object({
    id: UlidSchema,
    type: DocTypeEnum,
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
    /** BG only: in date through this VN day (doc_date + 15, DEC-5) */
    valid_until: z.string().nullable(),
    /** the business parent (BG of a HĐ, HĐ of a DNTT) — not the copy source */
    parent: ContractRef.nullable(),
    /** children of this document, oldest first */
    children: z.array(ContractRef),
    submitted_at: TimestampSchema.nullable(),
    decided_at: TimestampSchema.nullable(),
    issued_by: z.string().nullable(),
    issued_at: TimestampSchema.nullable(),
    rendered_hash: z.string().nullable(),
    voided_by: z.string().nullable(),
    voided_at: TimestampSchema.nullable(),
    void_reason: z.string().nullable(),
    pdf_status: z.enum(["none", "pending", "ready"]).openapi({
      description: "SPEC-05: none = not issued · pending = made on the first GET /contracts/{id}/pdf · ready = stored",
    }),
    pdf_size: z.number().int().nullable(),
    created_at: TimestampSchema,
    updated_at: TimestampSchema,
    steps: z.array(ContractStepSchema),
    timeline: z.array(ContractTimelineItem),
    can: ContractCan,
  })
  .openapi("Contract");

export const ContractListQuery = z.object({
  type: DocTypeEnum.optional(),
  status: ContractStatusEnum.optional(),
  customer_id: z.string().optional(),
  created_by: z.string().optional(),
  template_id: UlidSchema.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(50),
});

export const ContractListItem = z
  .object({
    id: z.string(),
    type: DocTypeEnum,
    parent_id: z.string().nullable(),
    valid_until: z.string().nullable(),
    number: z.string().nullable(),
    status: ContractStatusEnum,
    customer_name: z.string(),
    template_name: z.string(),
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
    type: DocTypeEnum,
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
export type CreateChildInput = z.infer<typeof CreateChildBody>;
export type ContractRefDto = z.infer<typeof ContractRef>;
