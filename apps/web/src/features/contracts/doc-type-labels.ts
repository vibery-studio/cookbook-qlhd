import type { components } from "@runway/client";

/** SPEC-09 FR-10 / P-11 — document-type labels shared by the list (C-09-008) and the drawer (C-09-009). */
export type DocType = components["schemas"]["DocType"];

export const DOC_TYPES: readonly DocType[] = ["quote", "contract", "payment_request", "delivery_note"];

export const DOC_TYPE_LABEL: Record<DocType, string> = {
  quote: "Báo giá",
  contract: "Hợp đồng",
  payment_request: "Đề nghị thanh toán",
  delivery_note: "Phiếu xuất kho",
};

/** Tab / pill text (narrow screens). */
export const DOC_TYPE_SHORT: Record<DocType, string> = {
  quote: "Báo giá",
  contract: "Hợp đồng",
  payment_request: "Đề nghị TT",
  delivery_note: "Phiếu xuất kho",
};

export const DRAWER_TITLE: Record<DocType, string> = {
  quote: "Chi tiết báo giá",
  contract: "Chi tiết hợp đồng",
  payment_request: "Chi tiết đề nghị thanh toán",
  delivery_note: "Chi tiết phiếu xuất kho",
};

export const PAPER_TITLE: Record<DocType, string> = {
  quote: "Văn bản báo giá",
  contract: "Văn bản hợp đồng",
  payment_request: "Văn bản đề nghị thanh toán",
  delivery_note: "Văn bản phiếu xuất kho",
};
