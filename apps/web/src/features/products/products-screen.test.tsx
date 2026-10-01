// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";

const get = vi.fn<(path: string, init?: unknown) => Promise<unknown>>();
const post = vi.fn<(...a: unknown[]) => Promise<unknown>>();
const patch = vi.fn<(...a: unknown[]) => Promise<unknown>>();
const del = vi.fn<(...a: unknown[]) => Promise<unknown>>();
vi.mock("../../lib/client", () => ({
  client: {
    typed: {
      GET: (p: string, i?: unknown) => get(p, i),
      POST: (...a: unknown[]) => post(...a),
      PATCH: (...a: unknown[]) => patch(...a),
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
import { ProductsScreen } from "./products-screen";
import { tomorrowIso } from "./product-view";

const level = (from: string, ex: number, bps: number | null, inc = ex) => ({ id: `lv_${from}`, effective_from: from, effective_to: null, unit_price_ex_vat: ex, vat_rate_bps: bps, unit_price_inc_vat: inc });
const product = (code: string, extra: Record<string, unknown> = {}, can = { edit: true, price: true }) => ({
  id: `id_${code}`, kind: "service", code, name: `Gói ${code}`, unit: "gói", duration_value: 6, duration_unit: "month", active: true, version: 1,
  price: level("2026-07-01", 2_700_000, null), next_price: level("2027-01-01", 2_600_000, null), can, ...extra,
});
const detail = (p: ReturnType<typeof product>) => ({
  ...p,
  prices: [
    { ...level("2027-01-01", 2_600_000, null), status: "scheduled", created_by_name: "Lan" },
    { ...level("2026-07-01", 2_700_000, null), status: "current", created_by_name: "Lan" },
    { ...level("2026-01-01", 2_400_000, null), effective_to: "2026-06-30", status: "past", created_by_name: null },
  ],
});
const ok = (data: unknown) => Promise.resolve({ data, response: { ok: true, status: 200 } });

const manager: Me = { id: "m", email: "m@x.y", display_name: "QL", roles: ["quan_ly"], permissions: ["contract:read", "product:write", "price:write"] };
const staff: Me = { id: "s", email: "s@x.y", display_name: "NV", roles: ["nhan_vien"], permissions: ["contract:read"] };

function serve(can: { edit: boolean; price: boolean }) {
  const g6 = product("G6", {}, can);
  get.mockImplementation((path: string) => {
    if (path === "/products/{id}") return ok(detail(g6));
    return ok({ date: "2026-10-01", items: [g6] });
  });
}
function renderScreen(me: Me) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <CurrentUserProvider user={me}>
          <ProductsScreen />
        </CurrentUserProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(cleanup);
beforeEach(() => {
  for (const m of [get, post, patch, del]) m.mockReset();
});

describe("ProductsScreen (SPEC-08 §3.6)", () => {
  it("row cells: code, name, KCT, money, and 'Sắp áp dụng' as '<price> từ dd/mm/yyyy'; tabs filter by kind via the API", async () => {
    serve({ edit: true, price: true });
    renderScreen(manager);
    const row = await screen.findByTestId("product-row");
    expect(row.textContent).toContain("G6");
    expect(row.textContent).toContain("Gói G6");
    expect(row.textContent).toContain("6 tháng");
    expect(row.textContent).toContain("2.700.000");
    expect(row.textContent).toContain("KCT");
    expect(row.textContent).toContain("2.600.000 từ 01/01/2027");
    expect((get.mock.calls.at(-1)?.[1] as { params: { query: Record<string, unknown> } }).params.query).not.toHaveProperty("active"); // Tất cả = every product
    await userEvent.click(screen.getByRole("tab", { name: "Hàng hóa" }));
    const last = get.mock.calls.at(-1)?.[1] as { params: { query: Record<string, unknown> } };
    expect(last.params.query).toMatchObject({ kind: "goods", active: "true" });
    await userEvent.click(screen.getByRole("tab", { name: "Ngừng bán" }));
    expect((get.mock.calls.at(-1)?.[1] as { params: { query: Record<string, unknown> } }).params.query).toMatchObject({ active: "false" });
  });

  it("Nhân viên: no write buttons anywhere, drawer shows the levels and the 🔒 sentence", async () => {
    serve({ edit: false, price: false });
    renderScreen(staff);
    await userEvent.click(await screen.findByTestId("product-row"));
    expect(screen.queryByRole("button", { name: "+ Thêm sản phẩm" })).toBeNull();
    const drawer = await screen.findByRole("dialog", { name: "Sản phẩm · G6" });
    expect(await within(drawer).findAllByTestId("price-level")).toHaveLength(3);
    expect(drawer.textContent).toContain("Chỉ Quản lý, Giám đốc sửa sản phẩm/đặt giá");
    for (const name of ["+ Thêm mức giá", "Lưu", "Hủy", "Ngừng bán"]) expect(within(drawer).queryByRole("button", { name })).toBeNull();
  });

  it("Quản lý: Hủy only on the scheduled level; + Thêm mức giá opens the dialog with min = tomorrow and the backdating hint", async () => {
    serve({ edit: true, price: true });
    renderScreen(manager);
    expect(await screen.findByRole("button", { name: "+ Thêm sản phẩm" })).toBeTruthy();
    await userEvent.click(await screen.findByTestId("product-row"));
    const drawer = await screen.findByRole("dialog", { name: "Sản phẩm · G6" });
    const levels = await within(drawer).findAllByTestId("price-level");
    expect(levels.map((l) => within(l).queryAllByRole("button", { name: "Hủy" }).length)).toEqual([1, 0, 0]);
    expect(levels[0]?.textContent).toContain("Sắp áp dụng");
    expect(levels[1]?.textContent).toContain("Đang áp dụng");
    expect(levels[2]?.textContent).toContain("Đã hết");
    await userEvent.click(within(drawer).getByRole("button", { name: "+ Thêm mức giá" }));
    const dlg = await screen.findByRole("dialog", { name: "Thêm mức giá" });
    expect(dlg.textContent).toContain("Tài liệu lập trước ngày này giữ giá cũ");
    expect(within(dlg).getByLabelText<HTMLInputElement>("Áp dụng từ ngày").min).toBe(tomorrowIso());
  });

  it("Hủy a scheduled level asks first; only 'Hủy mức giá' calls DELETE", async () => {
    serve({ edit: true, price: true });
    del.mockImplementation(() => ok({}));
    renderScreen(manager);
    await userEvent.click(await screen.findByTestId("product-row"));
    const drawer = await screen.findByRole("dialog", { name: "Sản phẩm · G6" });
    const scheduled = (await within(drawer).findAllByTestId("price-level"))[0] as HTMLElement;
    await userEvent.click(within(scheduled).getByRole("button", { name: "Hủy" }));
    expect(del).not.toHaveBeenCalled();
    const confirm = await screen.findByRole("dialog", { name: "Xác nhận" });
    expect(confirm.textContent).toContain("Hủy mức giá từ 01/01/2027?");
    await userEvent.click(within(confirm).getByRole("button", { name: "Không" }));
    expect(del).not.toHaveBeenCalled();
    await userEvent.click(within(scheduled).getByRole("button", { name: "Hủy" }));
    await userEvent.click(within(await screen.findByRole("dialog", { name: "Xác nhận" })).getByRole("button", { name: "Hủy mức giá" }));
    expect(del).toHaveBeenCalledTimes(1);
  });

  it("add-product dialog: goods hide Thời hạn; live 'Giá gồm VAT' follows rate; POST sends the first price", async () => {
    serve({ edit: true, price: true });
    post.mockImplementation(() => ok(product("KEP", { kind: "goods", duration_value: null, duration_unit: null })));
    renderScreen(manager);
    await userEvent.click(await screen.findByRole("button", { name: "+ Thêm sản phẩm" }));
    const dlg = await screen.findByRole("dialog", { name: "Thêm sản phẩm" });
    expect(within(dlg).getByLabelText("Thời hạn")).toBeTruthy();
    await userEvent.click(within(dlg).getByRole("radio", { name: "Hàng hóa" }));
    expect(within(dlg).queryByLabelText("Thời hạn")).toBeNull();
    await userEvent.type(within(dlg).getByLabelText("Mã"), "kep-01");
    await userEvent.type(within(dlg).getByLabelText("Tên sản phẩm"), "Kẹp giấy");
    await userEvent.type(within(dlg).getByLabelText("Đơn vị tính"), "hộp");
    await userEvent.type(within(dlg).getByLabelText("Giá chưa VAT"), "50000");
    await userEvent.selectOptions(within(dlg).getByLabelText("Thuế suất"), "10%");
    expect(dlg.textContent).toContain("Giá gồm VAT: 55.000 ₫");
    await userEvent.click(within(dlg).getByRole("button", { name: "Lưu" }));
    const call = post.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(call[0]).toBe("/products");
    expect(call[1].body).toMatchObject({ kind: "goods", code: "kep-01", name: "Kẹp giấy", unit: "hộp", first_price: { unit_price_ex_vat: 50000, vat_rate_bps: 1000 } });
    expect(call[1].body).not.toHaveProperty("duration_value");
  });
});
