import { formatDayMonth } from "../roles/requests";

/** Pure view rules for the quarterly access review (SPEC-07 §3.4 Rà soát quyền). */
type ItemLike = {
  decision: "keep" | "remove" | null;
  state: "open" | "decided" | "changed";
  can: { keep: boolean; remove: boolean };
  locked_reason: "self_review" | "admin_only" | "not_reviewer" | null;
};

/** "2026-Q4" → "Q4/2026". */
export function periodLabel(period: string): string {
  const m = /^(\d{4})-Q([1-4])$/.exec(period);
  return m ? `Q${m[2]}/${m[1]}` : period;
}

/** "Đợt Q4/2026 · hạn 15/10 · 12/20 dòng" (hạn theo giờ VN). */
export function headerText(review: { period: string; due_at: number }, progress: { decided: number; total: number }): string {
  return `Đợt ${periodLabel(review.period)} · hạn ${formatDayMonth(review.due_at)} · ${progress.decided}/${progress.total} dòng`;
}

export type RowStatus = { kind: "open" } | { kind: "decided"; decision: "keep" | "remove"; label: string } | { kind: "changed"; label: string };

export function rowStatus(item: ItemLike): RowStatus {
  if (item.decision) return { kind: "decided", decision: item.decision, label: item.decision === "keep" ? "Giữ" : "Gỡ" };
  if (item.state === "changed") return { kind: "changed", label: "đã thay đổi" };
  return { kind: "open" };
}

const LOCKS = {
  self_review: "Không tự rà soát chính mình — người quản trị xác nhận",
  admin_only: "Chỉ quản trị khóa được tài khoản quản trị",
  not_reviewer: "Dòng này do người có quyền Rà soát quyền quyết",
} as const;

/** 🔒 line for a row (the API's `locked_reason`), or null. */
export function lockText(item: ItemLike): string | null {
  return item.locked_reason ? LOCKS[item.locked_reason] : null;
}

/** Whole days past `dueAt` (unix s); 0 before it, at least 1 once past. */
export function overdueDays(dueAt: number, nowMs: number): number {
  const late = nowMs / 1000 - dueAt;
  return late <= 0 ? 0 : Math.max(1, Math.floor(late / 86400));
}

/** "Đợt rà soát Q4/2026 quá hạn 3 ngày". */
export function overdueText(period: string, days: number): string {
  return `Đợt rà soát ${periodLabel(period)} quá hạn ${days} ngày`;
}
