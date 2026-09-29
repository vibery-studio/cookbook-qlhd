// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { formatIssuedLine } from "./issued-line";
import { DuplicateNotice } from "./customer-modal";

vi.mock("../../lib/client", () => ({ client: {}, queryClient: {}, ApiProblemError: class extends Error {} }));

describe("formatIssuedLine", () => {
  it("0 → no issued contracts, 1 and N → count + money", () => {
    expect(formatIssuedLine(0, 0)).toBe("Chưa có hợp đồng đã phát hành");
    expect(formatIssuedLine(1, 500000)).toBe("1 hợp đồng · 500.000 ₫");
    expect(formatIssuedLine(3, 12345000)).toBe("3 hợp đồng · 12.345.000 ₫");
  });
});

describe("DuplicateNotice", () => {
  it("'Dùng khách này' hands back the existing customer; hidden without onUse", async () => {
    const onUse = vi.fn();
    const { rerender } = render(<DuplicateNotice existingName="Cty A" onView={() => {}} onUse={onUse} />);
    await userEvent.click(screen.getByRole("button", { name: "Dùng khách này" }));
    expect(onUse).toHaveBeenCalledOnce();
    rerender(<DuplicateNotice existingName="Cty A" onView={() => {}} />);
    expect(screen.queryByRole("button", { name: "Dùng khách này" })).toBeNull();
    expect(screen.getByRole("button", { name: "Xem khách đó" })).toBeTruthy();
  });
});
