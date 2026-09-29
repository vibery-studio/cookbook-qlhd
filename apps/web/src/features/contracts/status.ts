import type { PillTone } from "../../ui";
import { CONTRACT_STATUS_LABELS } from "../../lib/problem-messages";
import type { ContractStatus } from "./api";

export const STATUS_TONE: Record<ContractStatus, PillTone> = {
  draft: "neutral",
  pending: "pending",
  approved: "approved",
  issued: "issued",
  rejected: "danger",
  voided: "neutral",
};

export function statusLabel(status: string): string {
  return CONTRACT_STATUS_LABELS[status] ?? status;
}

/** "Nháp · chưa có số" for a draft, "Chưa có số" while it awaits a number, else the number. */
export function numberLabel(number: string | null, status: string): string {
  if (number) return number;
  return status === "draft" ? "Nháp · chưa có số" : "Chưa có số";
}

export const TABS: ReadonlyArray<{ value: ContractStatus | "all"; label: string }> = [
  { value: "all", label: "Tất cả" },
  { value: "draft", label: "Nháp" },
  { value: "pending", label: "Chờ duyệt" },
  { value: "approved", label: "Đã duyệt" },
  { value: "issued", label: "Đã phát hành" },
  { value: "rejected", label: "Từ chối" },
  { value: "voided", label: "Đã hủy" },
];
