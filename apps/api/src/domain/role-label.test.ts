import { describe, expect, it } from "vitest";
import { normalizeLabel } from "./role-label";

describe("normalizeLabel (roles.label_key)", () => {
  it("maps every spelling of one label to the same key — case, spaces, NFD vs NFC", () => {
    const nfd = "Kế toán".normalize("NFD");
    for (const raw of ["Kế toán", " kế  toán ", "KẾ TOÁN", "kế\ttoán", nfd, ` ${nfd.toUpperCase()}\n`]) {
      expect(normalizeLabel(raw)).toBe("kế toán");
    }
  });

  it("matches the system-role literals backfilled by migration 0017", () => {
    expect(normalizeLabel("Quản trị hệ thống")).toBe("quản trị hệ thống");
    expect(normalizeLabel("Thành viên (nền)")).toBe("thành viên (nền)");
    expect(normalizeLabel("Giám đốc")).toBe("giám đốc");
    expect(normalizeLabel("Quản lý")).toBe("quản lý");
    expect(normalizeLabel("Nhân viên")).toBe("nhân viên");
  });

  it("keeps different words apart", () => {
    expect(normalizeLabel("Kế toán")).not.toBe(normalizeLabel("Kế toán trưởng"));
  });
});
