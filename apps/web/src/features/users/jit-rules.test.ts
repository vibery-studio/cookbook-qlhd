import { describe, expect, it } from "vitest";
import { expiryText, GRANT_DURATIONS, hhmm, jitRowAction, remainingText, validReason } from "./jit-rules";

const me = { id: "me", roles: ["giam_doc"] };
const user = (over: Partial<{ id: string; status: "pending" | "active" | "disabled"; roles: string[] }> = {}) => ({
  id: "u1", status: "active" as const, roles: ["nhan_vien"], ...over,
});
const grant = { id: "g1", user_id: "u1", expires_at: 1000 };

describe("jitRowAction (SPEC-07 §3.4 Người dùng)", () => {
  it("offers the grant to another active non-admin", () => {
    expect(jitRowAction(user(), me, undefined)).toEqual({ kind: "grant" });
  });
  it("own row is locked", () => {
    expect(jitRowAction(user({ id: "me" }), me, undefined)).toEqual({ kind: "locked", reason: "Không tự cấp cho mình" });
  });
  it("a permanent admin is locked", () => {
    expect(jitRowAction(user({ roles: ["admin"] }), me, undefined).kind).toBe("locked");
  });
  it("a non-active account is locked", () => {
    expect(jitRowAction(user({ status: "pending" }), me, undefined).kind).toBe("locked");
    expect(jitRowAction(user({ status: "disabled" }), me, undefined).kind).toBe("locked");
  });
  it("an active grant → revoke (wins over the other locks except own row)", () => {
    expect(jitRowAction(user(), me, grant)).toEqual({ kind: "revoke", grant });
    expect(jitRowAction(user({ id: "me" }), me, { ...grant, user_id: "me" }).kind).toBe("locked");
  });
});

describe("time text (Asia/Ho_Chi_Minh)", () => {
  it("hhmm reads the Vietnam wall clock", () => {
    // 2026-10-01T08:30:00Z = 15:30 in Vietnam
    expect(hhmm(Date.UTC(2026, 9, 1, 8, 30) / 1000)).toBe("15:30");
  });
  it("expiryText = now + minutes", () => {
    const now = Date.UTC(2026, 9, 1, 8, 30);
    expect(expiryText(60, now)).toBe("Tự thu hồi lúc 16:30");
  });
  it("remainingText counts minutes, hours + minutes", () => {
    const now = 1_000_000_000_000;
    const at = (sec: number) => now / 1000 + sec;
    expect(remainingText(at(15 * 60), now)).toBe("còn 15 phút");
    expect(remainingText(at(60 * 60), now)).toBe("còn 1 giờ");
    expect(remainingText(at(2 * 3600 + 10 * 60), now)).toBe("còn 2 giờ 10 phút");
    expect(remainingText(at(90), now)).toBe("còn 2 phút");
    expect(remainingText(at(-1), now)).toBe("đã hết hạn");
  });
});

describe("form rules", () => {
  it("durations cover 15 phút … 8 giờ incl. 1 giờ", () => {
    expect(GRANT_DURATIONS.map((d) => d.label)).toEqual(["15 phút", "30 phút", "1 giờ", "2 giờ", "4 giờ", "8 giờ"]);
    expect(GRANT_DURATIONS.map((d) => d.minutes)).toEqual([15, 30, 60, 120, 240, 480]);
  });
  it("reason 10–500 after trim", () => {
    expect(validReason("ngắn")).toBe(false);
    expect(validReason("   mười ký tự   ")).toBe(true);
    expect(validReason("x".repeat(501))).toBe(false);
    expect(validReason("x".repeat(500))).toBe(true);
  });
});
