import { describe, expect, it } from "vitest";
import { KNOWN_PROBLEM_SLUGS, problemMessage } from "./problem-messages";

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
});
