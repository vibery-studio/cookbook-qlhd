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
  template_id: "T", template_version_id: "V", customer_id: "C", customer_name: "Tạp hóa Cô Ba", total: 2565000,
  created_by: "me", doc_date: "2026-09-30", version: 3,
  snapshot: { template: { id: "T", version_id: "V", version_no: 1 }, package: { name: "Gói 6 tháng" }, lines: [{ description: "Gói 6 tháng", qty: 1, unit_price: 2700000, discount_bps: 500, amount: 2565000 }], total_words: "Hai triệu", dates: { start: "2026-10-01", end: "2027-04-01" }, inputs: {} },
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
    expect(dialog.textContent).toContain("2.565.000 ₫");
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
