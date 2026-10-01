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

const noCan = { edit: false, submit: false, approve: false, reject: false, issue: false, void: false, copy: false, withdraw: false, delete: false };
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
  can: { ...noCan, withdraw: true },
};
const me: Me = { id: "me", email: "a@b.c", display_name: "An", roles: ["nhan_vien"], permissions: ["contract:read", "contract:write", "contract:submit"] };

function renderDrawer(paperOpen = false) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CurrentUserProvider user={me}>
        <ContractDrawer id={contract.id} paperOpen={paperOpen} onClose={() => {}} onOpenPaper={() => {}} onClosePaper={() => {}} onGoDetail={() => {}} onDeleted={() => {}} notify={() => {}} />
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
