// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";

const get = vi.fn<(path: string) => Promise<unknown>>();
const patch = vi.fn<(...a: unknown[]) => Promise<unknown>>();
const post = vi.fn<(...a: unknown[]) => Promise<unknown>>();
const del = vi.fn<(...a: unknown[]) => Promise<unknown>>();
vi.mock("../../lib/client", () => ({
  client: {
    typed: {
      GET: (p: string) => get(p),
      PATCH: (...a: unknown[]) => patch(...a),
      POST: (...a: unknown[]) => post(...a),
      DELETE: (...a: unknown[]) => del(...a),
    },
  },
  queryClient: {},
  ApiProblemError: class ApiProblemError extends Error {
    constructor(public readonly problem: unknown) {
      super("problem");
    }
  },
}));

import { CurrentUserProvider, type Me } from "../../app/me";
import { RolesScreen } from "./roles-screen";

const catalog = ["contract:read", "contract:write", "contract:approve", "audit:read", "roles:write", "users:read"];
const role = (name: string, label: string, permissions: string[], extra: Record<string, unknown> = {}) => ({
  id: `id_${name}`, name, label, description: null, is_system: true, version: 1, holders: 1, permissions,
  can: { edit: true, delete: false, request: true }, locked_reason: "system", request_locked_reason: null, pending_request: null, ...extra,
});
const roles = {
  items: [
    role("giam_doc", "Giám đốc", catalog, { can: { edit: false, delete: false, request: false }, locked_reason: "own_role" }),
    role("quan_ly", "Quản lý", ["contract:read", "audit:read"]),
  ],
  catalog,
};
const ok = (data: unknown) => Promise.resolve({ data, response: { ok: true, status: 200 } });
const problem = (slug: string, status: number, extra: Record<string, unknown> = {}) =>
  Promise.resolve({ error: { type: `https://runway.dev/errors/${slug}`, title: "Raw English", status, ...extra }, response: { ok: false, status } });
const changeReq = (extra: Record<string, unknown> = {}) => ({
  id: "req1", role_id: "id_quan_ly", role_name: "quan_ly", role_label: "Quản lý", base_version: 1, added: [], removed: ["audit:read"], note: null,
  status: "pending", requested_by: "x", requested_by_name: "An", requested_at: 1_790_000_000, expires_at: Date.UTC(2026, 9, 8, 5) / 1000,
  decided_by: null, decided_by_name: null, decided_at: null, decision_note: null,
  can: { approve: true, reject: true, withdraw: false }, locked_reason: null, ...extra,
});
const pendingSummary = { id: "req1", added: [], removed: ["audit:read"], requested_by_name: "An", expires_at: Date.UTC(2026, 9, 8, 5) / 1000 };
let requests: unknown[] = [];
let pairs: unknown[] = [];
function serve(roleList: unknown = roles) {
  get.mockImplementation((path: string) => {
    if (path === "/role-change-requests") return ok({ items: requests });
    if (path === "/sod-pairs") return ok({ items: pairs });
    return ok(roleList);
  });
}
const director: Me = { id: "d", email: "d@x.y", display_name: "GĐ", roles: ["giam_doc"], permissions: catalog };
const staff: Me = { id: "s", email: "s@x.y", display_name: "NV", roles: ["nhan_vien"], permissions: ["contract:read"] };

function renderScreen(me: Me) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <CurrentUserProvider user={me}>
          <RolesScreen />
        </CurrentUserProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(cleanup);
beforeEach(() => {
  get.mockReset();
  patch.mockReset();
  post.mockReset();
  del.mockReset();
  requests = [];
  pairs = [];
  serve();
});

describe("RolesScreen (SPEC-06 AC-8)", () => {
  it("without roles:write: read-only sentence, no column buttons, no add button", async () => {
    renderScreen(staff);
    expect(await screen.findByText(/Bảng chỉ để xem\./)).toBeTruthy();
    expect(screen.queryAllByTestId("role-col")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "+ Thêm vai trò" })).toBeNull();
    expect(await screen.findByText("roles:write")).toBeTruthy(); // whole catalog is listed
  });

  it("drawer: dropping one permission turns the submit into \"Gửi yêu cầu (−1)\" and POSTs the full new set (never PATCH permissions)", async () => {
    post.mockImplementation(() => ok(changeReq()));
    renderScreen(director);
    await screen.findByText(/Bấm tên vai trò để sửa\./);
    await userEvent.click((await screen.findAllByTestId("role-col")).find((b) => b.textContent?.startsWith("Quản lý")) as HTMLElement);
    const drawer = await screen.findByRole("dialog", { name: "Vai trò · Quản lý" });
    expect(drawer.textContent).toContain("1 người đang mang");
    expect(drawer.textContent).toContain("Vai trò hệ thống — không xóa/đổi tên");
    expect(within(drawer).getByRole("button", { name: "Gửi yêu cầu" })).toHaveProperty("disabled", true);
    await userEvent.click(within(drawer).getByRole("checkbox", { name: /Xem nhật ký/ }));
    expect(within(drawer).queryByRole("button", { name: /^Lưu \(/ })).toBeNull();
    await userEvent.click(within(drawer).getByRole("button", { name: "Gửi yêu cầu (−1)" }));
    expect(post).toHaveBeenCalledWith("/roles/{id}/change-requests", {
      params: { path: { id: "id_quan_ly" } },
      body: { expected_version: 1, permissions: ["contract:read"] },
    });
    expect(patch).not.toHaveBeenCalled();
  });

  it("label/description edits still go through \"Lưu\" with PATCH (no permissions)", async () => {
    patch.mockImplementation(() => ok({ ...roles.items[1], version: 2, description: "Mới" }));
    renderScreen(director);
    await userEvent.click((await screen.findAllByTestId("role-col")).find((b) => b.textContent?.startsWith("Quản lý")) as HTMLElement);
    const drawer = await screen.findByRole("dialog", { name: "Vai trò · Quản lý" });
    await userEvent.type(within(drawer).getByLabelText("Mô tả"), "Mới");
    await userEvent.click(within(drawer).getByRole("button", { name: "Lưu" }));
    expect(patch).toHaveBeenCalledWith("/roles/{id}", {
      params: { path: { id: "id_quan_ly" } },
      body: { expected_version: 1, description: "Mới" },
    });
  });

  it("pending request: band, locked boxes; another roles:write holder gets Duyệt · Từ chối", async () => {
    requests = [changeReq()];
    serve({ ...roles, items: [roles.items[0], role("quan_ly", "Quản lý", ["contract:read", "audit:read"], {
      can: { edit: false, delete: false, request: false }, request_locked_reason: "request_pending", pending_request: pendingSummary,
    })] });
    renderScreen(director);
    await userEvent.click((await screen.findAllByTestId("role-col")).find((b) => b.textContent?.startsWith("Quản lý")) as HTMLElement);
    const drawer = await screen.findByRole("dialog", { name: "Vai trò · Quản lý" });
    const band = within(drawer).getByTestId("pending-band");
    expect(band.textContent).toContain("Đang chờ duyệt: −1");
    expect(band.textContent).toContain("do «An» gửi");
    expect(band.textContent).toContain("hết hạn 08/10");
    expect(drawer.textContent).toContain("🔒 Đang có yêu cầu chờ duyệt");
    expect(within(drawer).getByRole("checkbox", { name: /Xem hợp đồng/ })).toHaveProperty("disabled", true);
    expect(await within(drawer).findByRole("button", { name: "Duyệt" })).toBeTruthy();
    expect(within(drawer).getByRole("button", { name: "Từ chối" })).toBeTruthy();
    expect(within(drawer).queryByRole("button", { name: "Rút yêu cầu" })).toBeNull();
  });

  it("pending request, requester: 🔒 \"Bạn gửi yêu cầu này\" + Rút yêu cầu (no Duyệt)", async () => {
    requests = [changeReq({ can: { approve: false, reject: false, withdraw: true }, locked_reason: "self_approve", requested_by_name: "GĐ" })];
    serve({ ...roles, items: [roles.items[0], role("quan_ly", "Quản lý", ["contract:read", "audit:read"], {
      can: { edit: false, delete: false, request: false }, request_locked_reason: "request_pending", pending_request: { ...pendingSummary, requested_by_name: "GĐ" },
    })] });
    post.mockImplementation(() => ok(changeReq({ status: "withdrawn" })));
    renderScreen(director);
    await userEvent.click((await screen.findAllByTestId("role-col")).find((b) => b.textContent?.startsWith("Quản lý")) as HTMLElement);
    const drawer = await screen.findByRole("dialog", { name: "Vai trò · Quản lý" });
    expect(await within(drawer).findByText(/Bạn gửi yêu cầu này — cần người khác duyệt/)).toBeTruthy();
    expect(within(drawer).queryByRole("button", { name: "Duyệt" })).toBeNull();
    await userEvent.click(within(drawer).getByRole("button", { name: "Rút yêu cầu" }));
    expect(post).toHaveBeenCalledWith("/role-change-requests/{id}/withdraw", { params: { path: { id: "req1" } } });
  });

  it("no_approver: the warning shows before any click and the submit is 🔒 disabled", async () => {
    serve({ ...roles, items: [roles.items[0], role("quan_ly", "Quản lý", ["contract:read", "audit:read"], {
      can: { edit: true, delete: false, request: false }, request_locked_reason: "no_approver",
    })] });
    renderScreen(director);
    await userEvent.click((await screen.findAllByTestId("role-col")).find((b) => b.textContent?.startsWith("Quản lý")) as HTMLElement);
    const drawer = await screen.findByRole("dialog", { name: "Vai trò · Quản lý" });
    expect(drawer.textContent).toContain("Không còn người nào khác có quyền Quản lý vai trò để duyệt — đổi quyền phải qua người quản trị kỹ thuật (migration)");
    await userEvent.click(within(drawer).getByRole("checkbox", { name: /Xem nhật ký/ }));
    const send = within(drawer).getByRole("button", { name: /Gửi yêu cầu/ });
    expect(send).toHaveProperty("disabled", true);
    expect(send.textContent).toContain("🔒");
  });

  it("a set that breaks a declared pair names both permissions and disables the submit", async () => {
    pairs = [{ id: "p1", perm_a: "contract:approve", perm_b: "contract:write", reason: null, created_by_name: "GĐ", created_at: 1 }];
    renderScreen(director);
    await userEvent.click((await screen.findAllByTestId("role-col")).find((b) => b.textContent?.startsWith("Quản lý")) as HTMLElement);
    const drawer = await screen.findByRole("dialog", { name: "Vai trò · Quản lý" });
    await userEvent.click(within(drawer).getByRole("checkbox", { name: /Duyệt \/ từ chối/ }));
    await userEvent.click(within(drawer).getByRole("checkbox", { name: /Tạo & sửa nháp/ }));
    expect(await within(drawer).findByText("«Duyệt / từ chối» xung đột với «Tạo & sửa nháp» — bỏ một trong hai")).toBeTruthy();
    expect(within(drawer).getByRole("button", { name: /Gửi yêu cầu/ })).toHaveProperty("disabled", true);
  });

  it("a 409 request-pending from the API is shown in Vietnamese", async () => {
    post.mockImplementation(() => problem("request-pending", 409));
    renderScreen(director);
    await userEvent.click((await screen.findAllByTestId("role-col")).find((b) => b.textContent?.startsWith("Quản lý")) as HTMLElement);
    const drawer = await screen.findByRole("dialog", { name: "Vai trò · Quản lý" });
    await userEvent.click(within(drawer).getByRole("checkbox", { name: /Xem nhật ký/ }));
    await userEvent.click(within(drawer).getByRole("button", { name: "Gửi yêu cầu (−1)" }));
    expect(await within(drawer).findByText(/đang có yêu cầu đổi quyền chờ duyệt/)).toBeTruthy();
  });

  it("FIX-04: 409 no-eligible-approver on ADDED permissions shows the accurate sentence in the sticky footer, not the body", async () => {
    post.mockImplementation(() => problem("no-eligible-approver", 409));
    renderScreen(director);
    await userEvent.click((await screen.findAllByTestId("role-col")).find((b) => b.textContent?.startsWith("Quản lý")) as HTMLElement);
    const drawer = await screen.findByRole("dialog", { name: "Vai trò · Quản lý" });
    await userEvent.click(within(drawer).getByRole("checkbox", { name: /Tạo & sửa nháp/ }));
    await userEvent.click(within(drawer).getByRole("button", { name: "Gửi yêu cầu (+1)" }));
    const footer = within(drawer).getByTestId("role-drawer-footer");
    const alert = await within(footer).findByRole("alert");
    expect(alert.textContent).toContain("Không ai duyệt được yêu cầu thêm quyền này");
    expect(alert.textContent).toContain("không đang mang vai trò «Quản lý»");
    expect(alert.textContent).toContain("Bớt quyền thì vẫn gửi được");
  });

  it("three tabs; the Yêu cầu tab carries the pending count, lists the request, and Duyệt approves it", async () => {
    requests = [changeReq()];
    post.mockImplementation(() => ok({ request: changeReq({ status: "approved" }), role: roles.items[1] }));
    renderScreen(director);
    expect(await screen.findByRole("tab", { name: /^Ma trận/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /^Cặp xung đột/ })).toBeTruthy();
    const tab = await screen.findByRole("tab", { name: /^Yêu cầu đổi quyền 1/ });
    await userEvent.click(tab);
    const table = await screen.findByTestId("change-requests");
    const row = within(table).getAllByRole("row")[1] as HTMLElement;
    expect(row.textContent).toContain("Quản lý");
    expect(row.textContent).toContain("Chờ duyệt");
    expect(row.textContent).toContain("An");
    await userEvent.click(within(row).getByRole("button", { name: "Duyệt" }));
    expect(post).toHaveBeenCalledWith("/role-change-requests/{id}/approve", { params: { path: { id: "req1" } }, body: {} });
  });

  it("Từ chối asks a reason", async () => {
    requests = [changeReq()];
    post.mockImplementation(() => ok(changeReq({ status: "rejected" })));
    renderScreen(director);
    await userEvent.click(await screen.findByRole("tab", { name: /^Yêu cầu đổi quyền/ }));
    const row = within(await screen.findByTestId("change-requests")).getAllByRole("row")[1] as HTMLElement;
    await userEvent.click(within(row).getByRole("button", { name: "Từ chối" }));
    const dialog = await screen.findByRole("dialog", { name: "Xác nhận" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Xác nhận" }));
    expect(await within(dialog).findByText("Nhập lý do.")).toBeTruthy();
    await userEvent.type(within(dialog).getByLabelText("Lý do"), "Chưa cần");
    await userEvent.click(within(dialog).getByRole("button", { name: "Xác nhận" }));
    expect(post).toHaveBeenCalledWith("/role-change-requests/{id}/reject", { params: { path: { id: "req1" } }, body: { note: "Chưa cần" } });
  });

  it("empty Yêu cầu tab: one sentence", async () => {
    renderScreen(director);
    await userEvent.click(await screen.findByRole("tab", { name: /^Yêu cầu đổi quyền/ }));
    expect(await screen.findByText("Không có yêu cầu nào đang chờ.")).toBeTruthy();
  });

  it("without roles:write there is no Yêu cầu tab and no request is fetched", async () => {
    renderScreen(staff);
    await screen.findByText(/Bảng chỉ để xem\./);
    expect(screen.queryByRole("tab", { name: /^Yêu cầu đổi quyền/ })).toBeNull();
    expect(get).not.toHaveBeenCalledWith("/role-change-requests");
  });

  it("Cặp xung đột tab: lists pairs with labels; + Thêm cặp posts; 409 names the roles and they open the drawer", async () => {
    pairs = [{ id: "p1", perm_a: "contract:approve", perm_b: "contract:issue", reason: "Tách người duyệt và người phát hành", created_by_name: "GĐ", created_at: 1 }];
    post.mockImplementation(() => problem("sod-conflict", 409, { roles: [{ id: "id_quan_ly", name: "quan_ly", label: "Quản lý" }] }));
    renderScreen(director);
    await userEvent.click(await screen.findByRole("tab", { name: /^Cặp xung đột/ }));
    const list = await screen.findByTestId("sod-pairs");
    expect(list.textContent).toContain("«Duyệt / từ chối» ⟷ «Phát hành & hủy»");
    expect(list.textContent).toContain("Tách người duyệt và người phát hành");
    await userEvent.click(screen.getByRole("button", { name: "+ Thêm cặp" }));
    const modal = await screen.findByRole("dialog", { name: "Thêm cặp xung đột" });
    await userEvent.selectOptions(within(modal).getByLabelText("Quyền thứ nhất"), "contract:write");
    await userEvent.selectOptions(within(modal).getByLabelText("Quyền thứ hai"), "contract:approve");
    await userEvent.click(within(modal).getByRole("button", { name: "Thêm cặp" }));
    expect(post).toHaveBeenCalledWith("/sod-pairs", { body: { perm_a: "contract:write", perm_b: "contract:approve" } });
    expect(await within(modal).findByText(/Đang có vai trò chứa cả hai quyền:/)).toBeTruthy();
    await userEvent.click(within(modal).getByRole("button", { name: "Quản lý" }));
    expect(await screen.findByRole("dialog", { name: "Vai trò · Quản lý" })).toBeTruthy();
  });

  it("removing a pair: Xóa → confirm → DELETE", async () => {
    pairs = [{ id: "p1", perm_a: "contract:approve", perm_b: "contract:issue", reason: null, created_by_name: "GĐ", created_at: 1 }];
    del.mockImplementation(() => Promise.resolve({ response: { ok: true, status: 204 } }));
    renderScreen(director);
    await userEvent.click(await screen.findByRole("tab", { name: /^Cặp xung đột/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Xóa cặp" }));
    await userEvent.click(within(await screen.findByRole("dialog", { name: "Xác nhận" })).getByRole("button", { name: "Xác nhận" }));
    expect(del).toHaveBeenCalledWith("/sod-pairs/{id}", { params: { path: { id: "p1" } } });
  });

  it("own role is 🔒 with its reason: checkboxes disabled, no Lưu button", async () => {
    renderScreen(director);
    await userEvent.click((await screen.findAllByTestId("role-col")).find((b) => b.textContent?.startsWith("Giám đốc")) as HTMLElement);
    const drawer = await screen.findByRole("dialog", { name: "Vai trò · Giám đốc" });
    expect(drawer.textContent).toContain("🔒");
    expect(drawer.textContent).toContain("Bạn đang mang vai trò này");
    expect((within(drawer).getAllByRole("checkbox")[0] as HTMLInputElement).disabled).toBe(true);
    expect(within(drawer).queryByRole("button", { name: /^Lưu/ })).toBeNull();
    expect(within(drawer).queryByRole("button", { name: /Gửi yêu cầu/ })).toBeNull();
  });

  it("clone opens \"Thêm vai trò\" prefilled with \"Bản sao của …\" and the source permissions", async () => {
    renderScreen(director);
    await userEvent.click((await screen.findAllByTestId("role-col")).find((b) => b.textContent?.startsWith("Quản lý")) as HTMLElement);
    await userEvent.click(within(await screen.findByRole("dialog", { name: "Vai trò · Quản lý" })).getByRole("button", { name: "Clone" }));
    const add = await screen.findByRole("dialog", { name: "Thêm vai trò" });
    expect(within(add).getByLabelText("Tên vai trò")).toHaveProperty("value", "Bản sao của Quản lý");
    expect(within(add).getByRole("checkbox", { name: /Xem hợp đồng/ })).toHaveProperty("checked", true);
    expect(within(add).getByRole("checkbox", { name: /Tạo & sửa nháp/ })).toHaveProperty("checked", false);
    expect(within(add).getByRole("button", { name: "Tạo vai trò" })).toBeTruthy();
  });
});
