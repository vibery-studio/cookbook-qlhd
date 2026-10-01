// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const get = vi.fn<(path: string) => Promise<unknown>>();
const post = vi.fn<(...a: unknown[]) => Promise<unknown>>();
vi.mock("../../lib/client", () => ({
  client: { typed: { GET: (path: string) => get(path), POST: (...a: unknown[]) => post(...a) } },
  queryClient: {},
  ApiProblemError: class ApiProblemError extends Error {
    constructor(public readonly problem: unknown) {
      super("problem");
    }
  },
}));

import { CurrentUserProvider, type Me } from "../../app/me";
import { ContractDrawer } from "./contract-drawer";

const noCan = { edit: false, submit: false, approve: false, reject: false, issue: false, void: false, copy: false, withdraw: false, delete: false, create_child: [] };
const contract = {
  id: "01ARZ3NDEKTSV4RRFFQ69G5FAV", type: "contract", status: "pending", number: null, seq: null, series_year: null,
  template_id: "T", template_version_id: "V", customer_id: "C", customer_name: "Tạp hóa Cô Ba", total: 3665000,
  created_by: "me", doc_date: "2026-09-30", version: 3,
  snapshot: {
    template: { id: "T", version_id: "V", version_no: 2 },
    lines: [
      { product_id: "P1", code: "G6", name: "Gói 6 tháng", kind: "service", unit: "gói", qty: 1, unit_price_ex_vat: 2700000, vat_rate_bps: null, amount_ex_vat: 2700000, discount_amount: 135000, net_ex_vat: 2565000 },
      { product_id: "P2", code: "MIN", name: "Máy in <b>mini</b>", kind: "goods", unit: "cái", qty: 2, unit_price_ex_vat: 500000, vat_rate_bps: 1000, amount_ex_vat: 1000000, discount_amount: 0, net_ex_vat: 1000000 },
    ],
    vat_groups: [{ vat_rate_bps: null, base: 2565000, vat: 0 }, { vat_rate_bps: 1000, base: 1000000, vat: 100000 }],
    subtotal_ex_vat: 3700000, discount_bps: 500, discount_amount: 135000, total_ex_vat: 3565000, vat_total: 100000, total: 3665000,
    total_words: "Ba triệu", dates: { start: "2026-10-01", end: "2027-04-01" }, inputs: {},
  },
  snapshot_hash: "h", source_contract_id: null, replaced_by_id: null, submitted_at: 5, decided_at: null, issued_by: null, issued_at: null, rendered_hash: null,
  voided_by: null, voided_at: null, void_reason: null, created_at: 1, updated_at: 5,
  steps: [{ id: "s1", step_no: 1, label: "Quản lý duyệt", status: "waiting", required_permission: "contract:approve", required_role: "quan_ly", decided_by: null, decided_by_name: null, decided_at: null, note: null, snapshot_hash_at_decision: null }],
  timeline: [{ action: "contract.created", at: 1, actor: "An" }, { action: "contract.submitted", at: 5, actor: "An" }],
  valid_until: null, parent: null, children: [],
  can: { ...noCan, withdraw: true, create_child: [] },
};
const ref = (over: Record<string, unknown>) => ({ id: "01ARZ3NDEKTSV4RRFFQ69G5FAA", type: "contract", number: null, status: "draft", total: 2565000, doc_date: "2026-09-30", ...over });
const issuedQuote = {
  type: "quote", status: "issued", number: "BG-2026-001", seq: 1, series_year: 2026, steps: [], valid_until: "2999-01-01",
  can: { ...noCan, create_child: [{ type: "contract", allowed: true, reason_code: null }] },
};
function serve(over: Record<string, unknown>) {
  get.mockImplementation((path) =>
    Promise.resolve(path === "/contracts/{id}" ? { data: { ...contract, ...over }, response: { ok: true, status: 200 } } : { data: { items: [], next_cursor: null }, response: { ok: true, status: 200 } }),
  );
}
const me: Me = { id: "me", email: "a@b.c", display_name: "An", roles: ["nhan_vien"], permissions: ["contract:read", "contract:write", "contract:submit"] };

function renderDrawer(paperOpen = false, onGoDetail: (id: string) => void = () => {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CurrentUserProvider user={me}>
        <ContractDrawer id={contract.id} paperOpen={paperOpen} onClose={() => {}} onOpenPaper={() => {}} onClosePaper={() => {}} onGoDetail={onGoDetail} onDeleted={() => {}} notify={() => {}} />
      </CurrentUserProvider>
    </QueryClientProvider>,
  );
}

afterEach(cleanup); // no vitest globals → RTL does not auto-clean between tests

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  get.mockImplementation((path) =>
    Promise.resolve(
      path === "/contracts/{id}" ? { data: contract, response: { ok: true, status: 200 } } : { data: { items: [], next_cursor: null }, response: { ok: true, status: 200 } },
    ),
  );
});

describe("ContractDrawer", () => {
  it("a locked action is aria-disabled, shows 🔒 + its reason, and sends nothing when clicked", async () => {
    renderDrawer();
    const dialog = await screen.findByRole("dialog", { name: "Chi tiết hợp đồng" });
    const approve = await within(dialog).findByTestId("action-approve");
    expect(approve.getAttribute("aria-disabled")).toBe("true");
    expect(approve.textContent).toContain("🔒");
    expect(dialog.textContent).toContain("Bạn là người tạo nên không tự duyệt được.");
    await userEvent.click(approve);
    expect(post).not.toHaveBeenCalled();
    // the creator's own way out stays a live button
    expect(within(dialog).getByTestId("action-withdraw").getAttribute("aria-disabled")).toBeNull();
    expect(dialog.textContent).toContain("Chưa có số");
  });

  it("shows the line table and the server totals: VAT per group, Tổng thanh toán, no 'đã gồm VAT'", async () => {
    renderDrawer();
    const dialog = await screen.findByRole("dialog", { name: "Chi tiết hợp đồng" });
    const table = await within(dialog).findByRole("table", { name: "Dòng hàng" });
    for (const head of ["Tên", "SL", "ĐVT", "Đơn giá chưa VAT", "Thuế suất", "Thành tiền chưa VAT"]) expect(within(table).getByRole("columnheader", { name: head })).toBeTruthy();
    const rows = within(table).getAllByTestId("line-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain("KCT");
    expect(rows[1]?.textContent).toContain("10%");
    expect(rows[1]?.textContent).toContain("1.000.000 ₫");
    expect(rows[1]?.querySelector("b")).toBeNull(); // a product name is text, never markup
    const totals = within(dialog).getByTestId("totals");
    for (const t of ["Tiền trước thuế", "3.700.000 ₫", "Giảm giá", "KCT", "Thuế GTGT 10%", "100.000 ₫", "Tổng thanh toán", "3.665.000 ₫"]) expect(totals.textContent).toContain(t);
    expect(dialog.textContent).not.toContain("đã gồm VAT");
    expect(totals.textContent).not.toContain("Máy chủ tính lại khi lưu"); // that note belongs to the form only
  });

  it("the paper is a sandboxed same-origin iframe onto the server render", async () => {
    renderDrawer(true);
    const paper = await screen.findByRole("dialog", { name: "Văn bản hợp đồng" });
    await waitFor(() => expect(paper.querySelector("iframe")).not.toBeNull());
    const frame = paper.querySelector("iframe");
    expect(frame?.getAttribute("sandbox")).toBe("allow-same-origin allow-modals");
    expect(frame?.getAttribute("src")).toBe(`/contracts/${contract.id}/render`);
    expect(frame?.getAttribute("title")).toBe("Văn bản hợp đồng");
    expect(frame?.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(within(paper).getByRole("link", { name: "Mở ở tab mới" }).getAttribute("href")).toBe(`/contracts/${contract.id}/render`);
  });
  it("SPEC-05 AC-7: issued/voided → «Tải PDF» download link (made on click); draft/pending → no link", async () => {
    const serve = (over: Record<string, unknown>) =>
      get.mockImplementation((path) =>
        Promise.resolve(
          path === "/contracts/{id}"
            ? { data: { ...contract, ...over }, response: { ok: true, status: 200 } }
            : { data: { items: [], next_cursor: null }, response: { ok: true, status: 200 } },
        ),
      );
    const issued = { status: "issued", number: "HD-2026-001", seq: 1, series_year: 2026, steps: [], can: noCan };

    for (const over of [{ ...issued, pdf_status: "pending", pdf_size: null }, { ...issued, status: "voided", pdf_status: "ready", pdf_size: 20480 }]) {
      serve(over);
      const r = renderDrawer();
      const dialog = await screen.findByRole("dialog", { name: "Chi tiết hợp đồng" });
      const link = await within(dialog).findByRole("link", { name: "Tải PDF" });
      expect(link.getAttribute("href")).toBe(`/contracts/${contract.id}/pdf`);
      expect(link.hasAttribute("download")).toBe(true);
      r.unmount();
    }

    serve({ pdf_status: "none", pdf_size: null }); // the pending contract above
    renderDrawer();
    const dialog = await screen.findByRole("dialog", { name: "Chi tiết hợp đồng" });
    await within(dialog).findByTestId("action-withdraw");
    expect(within(dialog).queryByRole("link", { name: "Tải PDF" })).toBeNull();
  });
});

describe("ContractDrawer — SPEC-09 document types", () => {
  it("names the drawer and the paper by document type", async () => {
    for (const [type, drawer, paper] of [
      ["quote", "Chi tiết báo giá", "Văn bản báo giá"],
      ["payment_request", "Chi tiết đề nghị thanh toán", "Văn bản đề nghị thanh toán"],
      ["delivery_note", "Chi tiết phiếu xuất kho", "Văn bản phiếu xuất kho"],
    ] as const) {
      serve({ type });
      const r = renderDrawer(true);
      await screen.findByRole("dialog", { name: drawer });
      const dialog = await screen.findByRole("dialog", { name: paper });
      await waitFor(() => expect(dialog.querySelector("iframe")?.getAttribute("title")).toBe(paper));
      r.unmount();
    }
  });

  it("quote: 'Hiệu lực đến dd/mm/yyyy', and the 'Hết hạn' pill only once it is past", async () => {
    serve({ type: "quote", valid_until: "2999-01-15" });
    const a = renderDrawer();
    const live = await screen.findByRole("dialog", { name: "Chi tiết báo giá" });
    await within(live).findByText(/Hiệu lực đến 15\/01\/2999/);
    expect(live.textContent).not.toContain("Hết hạn");
    a.unmount();

    serve({ type: "quote", valid_until: "2020-01-15" });
    renderDrawer();
    const dead = await screen.findByRole("dialog", { name: "Chi tiết báo giá" });
    await within(dead).findByText(/Hiệu lực đến 15\/01\/2020/);
    expect(dead.textContent).toContain("Hết hạn");
  });

  it("related docs: parent ↑ and children ↓ as 'loại · số · trạng thái · tổng'; a click opens that document", async () => {
    serve({
      parent: ref({ id: "01ARZ3NDEKTSV4RRFFQ69G5PAR", type: "quote", number: "BG-2026-001", status: "issued", total: 2565000 }),
      children: [ref({ id: "01ARZ3NDEKTSV4RRFFQ69G5KID", type: "payment_request", number: null, status: "draft", total: 3665000 })],
    });
    const onGoDetail = vi.fn();
    renderDrawer(false, onGoDetail);
    const dialog = await screen.findByRole("dialog", { name: "Chi tiết hợp đồng" });
    const block = await within(dialog).findByTestId("related-docs");
    expect(block.textContent).toContain("Tài liệu liên quan");
    const rows = within(block).getAllByTestId("related-doc");
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain("↑");
    for (const t of ["Báo giá", "BG-2026-001", "Đã phát hành", "2.565.000"]) expect(rows[0]?.textContent).toContain(t);
    expect(rows[1]?.textContent).toContain("↓");
    for (const t of ["Đề nghị thanh toán", "Nháp · chưa có số", "Nháp", "3.665.000"]) expect(rows[1]?.textContent).toContain(t);
    await userEvent.click(rows[0] as HTMLElement);
    expect(onGoDetail).toHaveBeenCalledWith("01ARZ3NDEKTSV4RRFFQ69G5PAR");
  });

  it("no parent and no children → no 'Tài liệu liên quan' block", async () => {
    renderDrawer();
    const dialog = await screen.findByRole("dialog", { name: "Chi tiết hợp đồng" });
    await within(dialog).findByTestId("action-withdraw");
    expect(within(dialog).queryByTestId("related-docs")).toBeNull();
  });

  it("issued quote: 'Lập hợp đồng' is live and opens the child form with the lines locked at the quote's price", async () => {
    serve(issuedQuote);
    renderDrawer();
    const dialog = await screen.findByRole("dialog", { name: "Chi tiết báo giá" });
    const button = await within(dialog).findByTestId("action-create-child");
    expect(button.textContent).toBe("Lập hợp đồng");
    expect(button.getAttribute("aria-disabled")).toBeNull();
    await userEvent.click(button);
    const form = await screen.findByRole("dialog", { name: "Lập hợp đồng từ báo giá BG-2026-001" });
    expect(form.textContent).toContain("Giữ giá báo giá BG-2026-001");
    expect(within(form).getAllByTestId("locked-line-row")).toHaveLength(2);
    expect(within(form).getByTestId("totals").textContent).toContain("3.665.000");
    expect(within(form).getByLabelText("Chức vụ người ký")).toBeTruthy();
    expect(within(form).queryByLabelText("Giảm giá (%)")).toBeNull();
  });

  it("locked create-child: aria-disabled + 🔒 + the reason for each reason_code, nothing sent on click", async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ ...issuedQuote, valid_until: "2026-01-05", can: { ...noCan, create_child: [{ type: "contract", allowed: false, reason_code: "quote-expired" }] } }, "Báo giá đã hết hạn ngày 05/01/2026"],
      [
        { ...issuedQuote, children: [ref({ type: "contract", number: "HD-2026-004", status: "pending" })], can: { ...noCan, create_child: [{ type: "contract", allowed: false, reason_code: "child-exists" }] } },
        "Đã có hợp đồng HD-2026-004 (Chờ duyệt)",
      ],
      [{ ...issuedQuote, status: "draft", number: null, can: { ...noCan, create_child: [{ type: "contract", allowed: false, reason_code: "parent-not-issued" }] } }, "Chỉ lập từ tài liệu đã phát hành"],
      [{ ...issuedQuote, can: { ...noCan, create_child: [{ type: "contract", allowed: false, reason_code: "forbidden" }] } }, "Bạn không có quyền lập hợp đồng"],
    ];
    for (const [over, sentence] of cases) {
      serve(over);
      const r = renderDrawer();
      const dialog = await screen.findByRole("dialog", { name: "Chi tiết báo giá" });
      const button = await within(dialog).findByTestId("action-create-child");
      expect(button.getAttribute("aria-disabled")).toBe("true");
      expect(button.textContent).toContain("🔒");
      expect(dialog.textContent).toContain(sentence);
      await userEvent.click(button);
      expect(screen.queryByRole("dialog", { name: /Lập hợp đồng từ/ })).toBeNull();
      expect(post).not.toHaveBeenCalled();
      r.unmount();
    }
  });

  it("issued contract: 'Lập đề nghị thanh toán' → form shows the contract total as the amount and a due date", async () => {
    serve({ ...issuedQuote, type: "contract", number: "HD-2026-001", can: { ...noCan, create_child: [{ type: "payment_request", allowed: true, reason_code: null }] } });
    renderDrawer();
    const dialog = await screen.findByRole("dialog", { name: "Chi tiết hợp đồng" });
    await userEvent.click(await within(dialog).findByTestId("action-create-child"));
    const form = await screen.findByRole("dialog", { name: "Lập đề nghị thanh toán" });
    expect(form.textContent).toContain("Số tiền đề nghị");
    expect(form.textContent).toContain("3.665.000");
    expect(form.textContent).toMatch(/Hạn thanh toán\s*\d{2}\/\d{2}\/\d{4}/);
  });

  it("child draft: the edit form shows the lines locked (🔒 Giữ giá báo giá …) and has no 'Giảm giá (%)' input", async () => {
    serve({
      status: "draft", steps: [], can: { ...noCan, edit: true, submit: true, delete: true, create_child: [] },
      parent: ref({ id: "01ARZ3NDEKTSV4RRFFQ69G5PAR", type: "quote", number: "BG-2026-001", status: "issued" }),
    });
    renderDrawer();
    const dialog = await screen.findByRole("dialog", { name: "Chi tiết hợp đồng" });
    await userEvent.click(await within(dialog).findByTestId("action-edit"));
    const form = await screen.findByRole("dialog", { name: "Sửa hợp đồng nháp" });
    expect(form.textContent).toContain("Giữ giá báo giá BG-2026-001");
    expect(within(form).getAllByTestId("locked-line-row")).toHaveLength(2);
    expect(within(form).queryByLabelText("Giảm giá (%)")).toBeNull();
    expect(within(form).getByLabelText("Chức vụ người ký")).toBeTruthy();
  });
});
