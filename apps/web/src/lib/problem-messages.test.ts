import { describe, expect, it } from "vitest";
import { KNOWN_PROBLEM_SLUGS, problemMessage, type ProblemWithExtensions } from "./problem-messages";

describe("problemMessage", () => {
  it.each(KNOWN_PROBLEM_SLUGS)("translates %s to non-empty Vietnamese copy", (slug) => {
    const rawDetail = `raw English detail for ${slug}`;
    const message = problemMessage({
      type: `https://runway.dev/errors/${slug}`,
      title: "Raw English title",
      status: slug === "validation" ? 422 : slug === "unauthorized" ? 401 : slug === "internal" ? 500 : 409,
      detail: rawDetail,
      errors: [{ path: "email", message: rawDetail }],
    });

    expect(message.message.trim()).not.toBe("");
    expect(message.message).not.toContain(rawDetail);
    expect(Object.values(message.fieldErrors).join(" ")).not.toContain(rawDetail);
  });

  it("keeps validation errors tied to labels instead of server English", () => {
    const message = problemMessage(
      {
        type: "https://runway.dev/errors/validation",
        title: "Validation failed",
        status: 422,
        errors: [{ path: "phone", message: "must be valid" }],
      },
      { phone: "Số điện thoại" },
    );

    expect(message.message).toBe("Kiểm tra lại các ô đánh dấu.");
    expect(message.fieldErrors.phone).toBe("Số điện thoại chưa hợp lệ");
  });

  it("knows already-decided", () => {
    expect(KNOWN_PROBLEM_SLUGS).toContain("already-decided");
  });
});

const base = (slug: string, status: number, extra: Record<string, unknown> = {}): ProblemWithExtensions =>
  ({ type: `https://runway.dev/errors/${slug}`, title: "Raw English title", status, detail: "Raw English detail", ...extra }) as ProblemWithExtensions;

describe("contract problem messages (SPEC-04b 3.5)", () => {
  const cases: Array<[string, ProblemWithExtensions, string]> = [
    ["creator_only", base("forbidden", 403, { rule: "creator_only" }), "Chỉ người tạo mới làm được việc này."],
    ["creator_cannot_approve", base("forbidden", 403, { rule: "creator_cannot_approve" }), "Bạn là người tạo hợp đồng này nên không tự duyệt được. Nhờ người khác duyệt."],
    ["one_person_one_step", base("forbidden", 403, { rule: "one_person_one_step" }), "Bạn đã quyết một bước của hợp đồng này; bước tiếp theo cần người khác."],
    ["already-decided", base("already-decided", 409), "Đã có người duyệt hoặc từ chối một bước nên không rút về nháp được. Đã tải lại."],
    ["changed-after-approval", base("changed-after-approval", 409), "Nội dung đã đổi sau khi duyệt nên chưa phát hành được. Gửi duyệt lại."],
    ["idempotency-conflict", base("idempotency-conflict", 409), "Yêu cầu này đã gửi với nội dung khác. Tải lại rồi làm lại."],
    ["idempotency-in-flight", base("idempotency-in-flight", 409), "Yêu cầu đang xử lý, đợi một chút."],
    ["unresolved-placeholder", base("unresolved-placeholder", 422, { placeholders: ["x.y"] }), "Mẫu còn chỗ trống chưa điền được. Báo Giám đốc kiểm tra mẫu."],
  ];
  it.each(cases)("%s", (_name, problem, expected) => {
    const m = problemMessage(problem, {}, { resource: "contract" });
    expect(m.message).toBe(expected);
    expect(m.message).not.toContain("Raw English");
    expect(m.message).not.toMatch(/creator_only|creator_cannot_approve|one_person_one_step|placeholders|x\.y/);
  });

  it.each([
    ["self_role", "🔒 Không tự đổi vai trò của mình. Nhờ người khác có quyền quản lý người dùng đổi giúp."],
    ["admin_only", "🔒 Chỉ Quản trị hệ thống mới gán vai trò Quản trị hệ thống hoặc sửa tài khoản quản trị."],
  ])("users rule %s (FIX-03) has its own Vietnamese message", (rule, expected) => {
    const m = problemMessage(base("forbidden", 403, { rule }));
    expect(m.message).toBe(expected);
    expect(m.message).not.toContain("Raw English");
  });

  it("forbidden without rule", () => {
    expect(problemMessage(base("forbidden", 403), {}, { resource: "contract" }).message).toBe("🔒 Bạn không có quyền hoặc vai trò cho bước này.");
  });

  it("missing-fields names every label and marks each field", () => {
    const m = problemMessage(base("missing-fields", 422, { missing_fields: [{ key: "so_bao_gia", label: "Số báo giá" }, { key: "ngay_bat_dau", label: "Ngày bắt đầu" }] }));
    expect(m.message).toBe("Thiếu: Số báo giá, Ngày bắt đầu. Điền rồi tạo lại.");
    expect(Object.keys(m.fieldErrors).sort()).toEqual(["ngay_bat_dau", "so_bao_gia"]);
  });

  it("no-eligible-approver and would-block-later-step name the step", () => {
    const a = problemMessage(base("no-eligible-approver", 409, { label: "Giám đốc duyệt" }));
    expect(a.message).toContain("«Giám đốc duyệt»");
    expect(a.message).toContain("Nhờ người khác tạo hợp đồng này");
    const b = problemMessage(base("would-block-later-step", 409, { label: "Giám đốc duyệt" }));
    expect(b.message).toContain("«Giám đốc duyệt»");
    expect(b.message).toContain("Chưa duyệt được");
  });

  it("state-conflict names the Vietnamese status and asks to reload", () => {
    const m = problemMessage(base("state-conflict", 409, { current_status: "pending" }), {}, { resource: "contract" });
    expect(m.message).toBe("Hợp đồng vừa được người khác chuyển sang «Chờ duyệt». Đã tải lại.");
    expect(m.reload).toBe(true);
    for (const [code, vn] of [["draft", "Nháp"], ["approved", "Đã duyệt"], ["issued", "Đã phát hành"], ["rejected", "Từ chối"], ["voided", "Đã hủy"]]) {
      expect(problemMessage(base("state-conflict", 409, { current_status: code }), {}, { resource: "contract" }).message).toContain(`«${vn}»`);
    }
  });

  it("already-decided also asks to reload", () => {
    expect(problemMessage(base("already-decided", 409)).reload).toBe(true);
  });

  it("stale and not-found are contract-specific only for the contract resource", () => {
    expect(problemMessage(base("stale", 409), {}, { resource: "contract" }).message).toBe("Người khác vừa sửa hợp đồng này.");
    expect(problemMessage(base("not-found", 404), {}, { resource: "contract" }).message).toBe("Không tìm thấy hợp đồng (có thể đã bị xóa khỏi danh sách của bạn).");
    expect(problemMessage(base("not-found", 404)).message).toBe("Không tìm thấy nội dung bạn cần.");
  });

  it("validation labels the values.* fields in Vietnamese and never leaks English", () => {
    const keys = ["ma_goi", "so_cua_hang", "giam_gia", "ngay_bat_dau", "so_bao_gia", "ngay_bao_gia", "chuc_vu_nguoi_ky"];
    const m = problemMessage(base("validation", 422, { errors: keys.map((k) => ({ path: `values.${k}`, message: "must be valid English" })) }));
    expect(m.message).toBe("Kiểm tra lại các ô đánh dấu.");
    expect(Object.keys(m.fieldErrors)).toHaveLength(keys.length);
    for (const text of Object.values(m.fieldErrors)) {
      expect(text).not.toContain("Trường này");
      expect(text).not.toContain("English");
    }
    expect(m.fieldErrors["values.giam_gia"]).toContain("Giảm giá");
    expect(m.fieldErrors["values.so_cua_hang"]).toContain("Số cửa hàng");
    expect(m.fieldErrors["values.ma_goi"]).toBe("Gói này không làm hợp đồng hoặc chưa có giá ngày hôm nay");
  });
});

