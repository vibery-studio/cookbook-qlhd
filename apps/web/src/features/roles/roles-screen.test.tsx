// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";

const get = vi.fn<(path: string) => Promise<unknown>>();
const patch = vi.fn<(...a: unknown[]) => Promise<unknown>>();
vi.mock("../../lib/client", () => ({
  client: { typed: { GET: (p: string) => get(p), PATCH: (...a: unknown[]) => patch(...a) } },
  queryClient: {},
  ApiProblemError: class ApiProblemError extends Error {
    constructor(public readonly problem: unknown) {
      super("problem");
    }
  },
}));

import { CurrentUserProvider, type Me } from "../../app/me";
import { RolesScreen } from "./roles-screen";

const catalog = ["contract:read", "contract:write", "audit:read", "roles:write", "users:read"];
const role = (name: string, label: string, permissions: string[], extra: Record<string, unknown> = {}) => ({
  id: `id_${name}`, name, label, description: null, is_system: true, version: 1, holders: 1, permissions,
  can: { edit: true, delete: false }, locked_reason: "system", ...extra,
});
const roles = {
  items: [
    role("giam_doc", "Giám đốc", catalog, { can: { edit: false, delete: false }, locked_reason: "own_role" }),
    role("quan_ly", "Quản lý", ["contract:read", "audit:read"]),
  ],
  catalog,
};
const ok = (data: unknown) => Promise.resolve({ data, response: { ok: true, status: 200 } });
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
  get.mockImplementation(() => ok(roles));
});

describe("RolesScreen (SPEC-06 AC-8)", () => {
  it("without roles:write: read-only sentence, no column buttons, no add button", async () => {
    renderScreen(staff);
    expect(await screen.findByText(/Bảng chỉ để xem\./)).toBeTruthy();
    expect(screen.queryAllByTestId("role-col")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "+ Thêm vai trò" })).toBeNull();
    expect(await screen.findByText("roles:write")).toBeTruthy(); // whole catalog is listed
  });

  it("drawer: dropping one permission turns the save button into \"Lưu (−1 quyền)\" and PATCHes with expected_version", async () => {
    patch.mockImplementation(() => ok({ ...roles.items[1], version: 2, permissions: ["contract:read"] }));
    renderScreen(director);
    await screen.findByText(/Bấm tên vai trò để sửa\./);
    await userEvent.click((await screen.findAllByTestId("role-col")).find((b) => b.textContent?.startsWith("Quản lý")) as HTMLElement);
    const drawer = await screen.findByRole("dialog", { name: "Vai trò · Quản lý" });
    expect(drawer.textContent).toContain("1 người đang mang");
    expect(drawer.textContent).toContain("Vai trò hệ thống — không xóa/đổi tên");
    await userEvent.click(within(drawer).getByRole("checkbox", { name: /Xem nhật ký/ }));
    const save = within(drawer).getByRole("button", { name: "Lưu (−1 quyền)" });
    await userEvent.click(save);
    expect(patch).toHaveBeenCalledWith("/roles/{id}", {
      params: { path: { id: "id_quan_ly" } },
      body: { expected_version: 1 }, // SPEC-07 DEC-1: no permissions on PATCH (request flow in C-07-007)
    });
    await waitFor(() => expect(within(drawer).queryByRole("button", { name: /^Lưu \(/ })).toBeNull());
  });

  it("own role is 🔒 with its reason: checkboxes disabled, no Lưu button", async () => {
    renderScreen(director);
    await userEvent.click((await screen.findAllByTestId("role-col")).find((b) => b.textContent?.startsWith("Giám đốc")) as HTMLElement);
    const drawer = await screen.findByRole("dialog", { name: "Vai trò · Giám đốc" });
    expect(drawer.textContent).toContain("🔒");
    expect(drawer.textContent).toContain("Bạn đang mang vai trò này");
    expect((within(drawer).getAllByRole("checkbox")[0] as HTMLInputElement).disabled).toBe(true);
    expect(within(drawer).queryByRole("button", { name: /^Lưu/ })).toBeNull();
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
