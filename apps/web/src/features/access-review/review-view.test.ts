import { describe, expect, it } from "vitest";
import { headerText, lockText, overdueDays, overdueText, periodLabel, rowStatus } from "./review-view";

type Item = Parameters<typeof rowStatus>[0];
const item = (over: Partial<Item> = {}): Item => ({
  decision: null, state: "open", can: { keep: true, remove: true }, locked_reason: null, ...over,
});

describe("periodLabel", () => {
  it("2026-Q4 → Q4/2026", () => {
    expect(periodLabel("2026-Q4")).toBe("Q4/2026");
    expect(periodLabel("weird")).toBe("weird");
  });
});

describe("headerText", () => {
  it("Đợt Qn/YYYY · hạn dd/mm · x/y dòng (hạn theo giờ VN)", () => {
    const due = Date.UTC(2026, 9, 15, 3) / 1000; // 15/10 10:00 VN
    expect(headerText({ period: "2026-Q4", due_at: due }, { decided: 12, total: 20 })).toBe("Đợt Q4/2026 · hạn 15/10 · 12/20 dòng");
  });
});

describe("rowStatus", () => {
  it("open / keep / remove / changed", () => {
    expect(rowStatus(item())).toEqual({ kind: "open" });
    expect(rowStatus(item({ decision: "keep", state: "decided" }))).toEqual({ kind: "decided", decision: "keep", label: "Giữ" });
    expect(rowStatus(item({ decision: "remove", state: "decided" }))).toEqual({ kind: "decided", decision: "remove", label: "Gỡ" });
    expect(rowStatus(item({ state: "changed" }))).toEqual({ kind: "changed", label: "đã thay đổi" });
  });
});

describe("lockText", () => {
  it("self_review locks both buttons with the SPEC line", () => {
    expect(lockText(item({ locked_reason: "self_review", can: { keep: false, remove: false } }))).toBe("Không tự rà soát chính mình — người quản trị xác nhận");
  });
  it("admin_only locks Gỡ only", () => {
    expect(lockText(item({ locked_reason: "admin_only", can: { keep: true, remove: false } }))).toBe("Chỉ quản trị khóa được tài khoản quản trị");
  });
  it("no lock → null", () => {
    expect(lockText(item())).toBeNull();
  });
  it("not_reviewer has a line too", () => {
    expect(lockText(item({ locked_reason: "not_reviewer", can: { keep: false, remove: false } }))).toMatch(/Rà soát quyền/);
  });
});

describe("overdue", () => {
  const due = 1_000_000;
  it("whole days past due, at least 1 once overdue", () => {
    expect(overdueDays(due, (due + 3 * 86400 + 100) * 1000)).toBe(3);
    expect(overdueDays(due, (due + 60) * 1000)).toBe(1);
    expect(overdueDays(due, (due - 10) * 1000)).toBe(0);
  });
  it("banner sentence", () => {
    expect(overdueText("2026-Q4", 3)).toBe("Đợt rà soát Q4/2026 quá hạn 3 ngày");
  });
});
