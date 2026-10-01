// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";

const get = vi.fn<(path: string) => Promise<unknown>>();
vi.mock("../../lib/client", () => ({
  client: { typed: { GET: (p: string) => get(p), POST: vi.fn(), PATCH: vi.fn() } },
  queryClient: {},
  ApiProblemError: class ApiProblemError extends Error {
    constructor(public readonly problem: unknown) {
      super("problem");
    }
  },
}));

import { CurrentUserProvider, type Me } from "../../app/me";
import { UsersScreen } from "./users-screen";

/** FIX-06: the screen renders the API's `can` / `locked_reason` / options — /me here claims every permission and admin. */
const me: Me = { id: "me", email: "me@x.y", display_name: "Tôi", roles: ["admin", "giam_doc"], permissions: ["users:read", "users:write", "jit:grant"] };

const open = { change_role: true, set_status: true, reinvite: false, grant_jit: true, revoke_jit: false };
const none = { change_role: null, set_status: null, grant_jit: null };
const user = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id, email: `${id}@x.y`, display_name: name, status: "active", roles: ["nhan_vien"],
  can: open, locked_reason: none, role_options: [], jit_grant: null, ...extra,
});
const page = {
  items: [
    user("me", "Tôi", {
      can: { ...open, change_role: false, set_status: false, grant_jit: false },
      locked_reason: { change_role: "self_role", set_status: "self_disable", grant_jit: "self_grant" },
    }),
    user("gd", "Giám đốc A", { roles: ["giam_doc"], can: { ...open, change_role: false }, locked_reason: { ...none, change_role: "owner_only" } }),
    user("nv", "Nhân viên B", {
      jit_grant: { id: "g1", expires_at: Math.floor(Date.now() / 1000) + 3600 },
      can: { ...open, grant_jit: false, revoke_jit: true },
      locked_reason: { ...none, grant_jit: "jit_active" },
    }),
  ],
  next_cursor: null,
  invite_roles: [
    { name: "admin", label: "Quản trị hệ thống", locked_reason: "owner_only" },
    { name: "quan_ly", label: "Quản lý", locked_reason: "grant_not_held" },
    { name: "nhan_vien", label: "Nhân viên", locked_reason: null },
  ],
};

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <CurrentUserProvider user={me}>
          <UsersScreen />
        </CurrentUserProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const ok = (data: unknown) => Promise.resolve({ data, response: { ok: true, status: 200 } });

afterEach(cleanup);
beforeEach(() => {
  get.mockReset();
  get.mockImplementation((path: string) => (path === "/admin/users" ? ok(page) : ok({ items: [], catalog: [], grantable: [], two_layer: true })));
});

const rowOf = (table: HTMLElement, name: string) => within(table).getByText(name).closest("tr") as HTMLElement;

describe("UsersScreen renders the API's decisions (FIX-06)", () => {
  it("own row: 🔒 Đổi vai trò + 🔒 Khóa with the API's reasons, JIT 🔒 self_grant — even though /me is admin + Giám đốc", async () => {
    renderScreen();
    const table = await screen.findByTestId("users-table");
    const row = rowOf(table, "Tôi");
    expect(within(row).getByTestId("action-role").textContent).toBe("🔒 Đổi vai trò");
    expect(within(row).getByTestId("action-status").textContent).toBe("🔒 Khóa");
    expect(row.textContent).toContain("🔒 Không tự đổi vai trò của mình");
    expect(row.textContent).toContain("🔒 Không tự khóa tài khoản của mình");
    expect(row.textContent).toContain("🔒 Không tự cấp cho mình");
  });

  it("a Giám đốc row the API locks owner_only → 🔒 with the owner sentence; an open row → real buttons", async () => {
    renderScreen();
    const table = await screen.findByTestId("users-table");
    const gd = rowOf(table, "Giám đốc A");
    expect(within(gd).getByTestId("action-role").getAttribute("aria-disabled")).toBe("true");
    expect(gd.textContent).toContain("🔒 Chỉ Giám đốc đổi vai trò của Giám đốc");
    expect(within(gd).getByRole("button", { name: "Cấp quản trị tạm thời" })).toBeTruthy();
    const nv = rowOf(table, "Nhân viên B");
    expect(within(nv).getByTestId("action-role").textContent).toBe("Đổi vai trò");
    expect(within(nv).getByRole("button", { name: "Thu hồi ngay" })).toBeTruthy(); // jit_grant + can.revoke_jit
  });

  it("invite select = the API's invite_roles: locked options disabled with their reason, default = first open one", async () => {
    renderScreen();
    await userEvent.click((await screen.findAllByRole("button", { name: "+ Mời người dùng" }))[0] as HTMLElement);
    const select = await screen.findByLabelText<HTMLSelectElement>("Vai trò");
    const opts = [...select.options].map((o) => ({ text: o.textContent, disabled: o.disabled }));
    expect(opts).toEqual([
      { text: "🔒 Quản trị hệ thống — Chỉ Giám đốc gán vai trò có quyền Quản lý vai trò", disabled: true },
      { text: "🔒 Quản lý — Bạn không có quyền này nên không cấp được", disabled: true },
      { text: "Nhân viên", disabled: false },
    ]);
    expect(select.value).toBe("nhan_vien");
  });
});
