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


describe("role problem messages (SPEC-06)", () => {
  it.each([
    ["own_role", "🔒 Bạn đang mang vai trò này nên không tự sửa được. Nhờ người khác có quyền quản lý vai trò."],
    ["admin_role", "🔒 Quản trị hệ thống luôn đủ quyền — không sửa hay xóa được."],
    ["system_role", "🔒 Vai trò hệ thống — không xóa/đổi tên."],
  ])("forbidden rule %s", (rule, expected) => {
    const m = problemMessage(base("forbidden", 403, { rule }), {}, { resource: "role" });
    expect(m.message).toBe(expected);
    expect(m.message).not.toMatch(/own_role|admin_role|system_role/);
  });

  it("grant_not_held names the missing permissions in Vietnamese (same sentence for roles and for assigning people)", () => {
    const p = base("forbidden", 403, { rule: "grant_not_held", permissions: ["audit:read", "settings:write"] });
    expect(problemMessage(p).message).toBe("🔒 Bạn không có quyền «Xem nhật ký», «Đổi cài đặt hệ thống» nên không cấp được.");
    expect(problemMessage(base("forbidden", 403, { rule: "grant_not_held" })).message).toContain("không cấp được");
  });

  it("role-in-use carries the holder count; role-limit and unknown-role have their own copy", () => {
    expect(problemMessage(base("role-in-use", 409, { holders: 3 })).message).toBe(
      "Còn 3 người mang vai trò này — đổi vai trò họ ở màn Người dùng trước.",
    );
    expect(problemMessage(base("role-in-use", 409)).message).toContain("Người dùng");
    expect(problemMessage(base("role-limit", 409)).message).toBe("Đã đủ 50 vai trò tự tạo. Xóa bớt vai trò không dùng rồi thêm.");
    expect(problemMessage(base("unknown-role", 422)).message).toBe("Vai trò này không còn nữa. Tải lại danh sách rồi chọn lại.");
  });

  it("stale and duplicate switch to role wording only for the role resource", () => {
    expect(problemMessage(base("stale", 409), {}, { resource: "role" }).message).toBe("Người khác vừa sửa vai trò này.");
    expect(problemMessage(base("duplicate", 409), {}, { resource: "role" }).message).toBe("Đã có vai trò tên này. Đặt tên khác.");
    expect(problemMessage(base("duplicate", 409)).message).toBe("Khách này đã có (trùng SĐT/MST).");
  });
});

describe("SPEC-07 2b problem messages (C-07-007; 008 reuses them)", () => {
  const cases: Array<[string, ProblemWithExtensions, string]> = [
    ["request-pending", base("request-pending", 409), "Vai trò này đang có yêu cầu đổi quyền chờ duyệt. Duyệt, từ chối hoặc rút yêu cầu đó trước."],
    ["not-pending", base("not-pending", 409), "Yêu cầu này không còn chờ duyệt nữa. Đã tải lại."],
    ["expired", base("expired", 409), "Yêu cầu này đã hết hạn. Gửi yêu cầu mới."],
    [
      "sod-conflict pairs",
      base("sod-conflict", 409, { pairs: [["contract:write", "contract:approve"]] }),
      "«Tạo & sửa nháp» xung đột với «Duyệt / từ chối» — bỏ một trong hai.",
    ],
    [
      "sod-conflict roles",
      base("sod-conflict", 409, { roles: [{ id: "1", name: "quan_ly", label: "Quản lý" }, { id: "2", name: "giam_doc", label: "Giám đốc" }] }),
      "Đang có vai trò chứa cả hai quyền: «Quản lý», «Giám đốc» — bỏ một quyền khỏi các vai trò đó trước.",
    ],
    [
      "no-eligible-approver (role)",
      base("no-eligible-approver", 409),
      "Không còn người nào khác có quyền Quản lý vai trò để duyệt — đổi quyền phải qua người quản trị kỹ thuật (migration).",
    ],
    ["jit-active", base("jit-active", 409), "Người này đang có quyền quản trị tạm thời. Thu hồi trước khi cấp lại."],
    ["already-admin", base("already-admin", 409), "Người này đã là Quản trị hệ thống thường trực — không cần cấp tạm."],
    ["not-active", base("not-active", 409), "Quyền tạm này đã hết hạn hoặc đã thu hồi. Đã tải lại."],
    ["item-changed", base("item-changed", 409), "Tài khoản này vừa thay đổi sau khi mở đợt rà soát nên không quyết được dòng này. Đã tải lại."],
    ["review-closed", base("review-closed", 409), "Đợt rà soát đã kết thúc."],
    ["review-incomplete", base("review-incomplete", 409), "Còn dòng chưa rà soát. Quyết hết các dòng rồi kết thúc đợt."],
    ["self_approve", base("forbidden", 403, { rule: "self_approve" }), "🔒 Bạn gửi yêu cầu này nên không tự duyệt được. Nhờ người khác duyệt."],
    ["jit_actor", base("forbidden", 403, { rule: "jit_actor" }), "🔒 Bạn đang có quyền quản trị tạm thời nên không làm được việc này."],
    ["self_grant", base("forbidden", 403, { rule: "self_grant" }), "🔒 Không tự cấp quản trị tạm thời cho mình."],
    ["self_review", base("forbidden", 403, { rule: "self_review" }), "🔒 Không tự rà soát chính mình — người quản trị xác nhận."],
  ];
  it.each(cases)("%s", (_name, problem, expected) => {
    const m = problemMessage(problem, {}, { resource: "role" });
    expect(m.message).toBe(expected);
    expect(m.message).not.toContain("Raw English");
    expect(m.message).not.toMatch(/self_approve|jit_actor|self_grant|self_review/);
  });

  it("no-eligible-approver keeps the contract wording outside the role context", () => {
    expect(problemMessage(base("no-eligible-approver", 409, { label: "Quản lý duyệt" }), {}, { resource: "contract" }).message).toContain("Bước «Quản lý duyệt»");
  });

  it("every new slug is known", () => {
    for (const s of ["request-pending", "not-pending", "expired", "sod-conflict", "jit-active", "already-admin", "not-active", "item-changed", "review-closed", "review-incomplete"]) {
      expect(KNOWN_PROBLEM_SLUGS).toContain(s);
    }
  });
});
