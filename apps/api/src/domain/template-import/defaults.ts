/**
 * SPEC-10 FR-10 / DEC-6 — what a NEW template gets when it is imported from Word: the box approval rule
 * (Quản lý duyệt; giảm > 10% thêm Giám đốc — INTENT-09 Q-3), same shape as the seed's policy, and `[]` for the rest.
 */
export const BOX_APPROVAL_POLICY = {
  mode: "combined",
  steps: [{ step_no: 1, label: "Quản lý duyệt", permission: "contract:approve" }],
  rules: [
    {
      when: { var: "discount_bps", op: "gt", value: 1000 },
      add_steps: [{ label: "Giám đốc duyệt", permission: "contract:approve", role: "giam_doc" }],
    },
  ],
} as const;

/** P-8: label of the forced `bang_hang` field when no template has one. */
export const LINES_FIELD_LABEL = "Bảng hàng hóa, dịch vụ";
export const LINES_FIELD_KEY = "bang_hang";
