import { describe, expect, it } from "vitest";
import { expiryText, GRANT_DURATIONS, hhmm, remainingText, validReason } from "./jit-rules";

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
