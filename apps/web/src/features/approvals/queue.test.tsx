// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const get = vi.fn<(...a: unknown[]) => Promise<unknown>>();
vi.mock("../../lib/client", () => ({ client: { typed: { GET: (...a: unknown[]) => get(...a) as unknown } } }));

import { formatApprovalCount, useApprovalQueue } from "./queue";

describe("formatApprovalCount", () => {
  it("hides at 0, shows the number, and 50+ when a next page exists", () => {
    expect(formatApprovalCount(undefined)).toBeUndefined();
    expect(formatApprovalCount({ items: [], next_cursor: null })).toBeUndefined();
    expect(formatApprovalCount({ items: [{}, {}], next_cursor: null })).toBe(2);
    expect(formatApprovalCount({ items: new Array(50).fill({}), next_cursor: "c" })).toBe("50+");
  });
});

describe("useApprovalQueue", () => {
  beforeEach(() => get.mockReset());
  const wrap = (qc: QueryClient) => ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );

  it("does not call the API when enabled=false", async () => {
    const qc = new QueryClient();
    renderHook(() => useApprovalQueue(false), { wrapper: wrap(qc) });
    await new Promise((r) => setTimeout(r, 20));
    expect(get).not.toHaveBeenCalled();
  });

  it("calls GET /approvals/mine with limit 50 once for two consumers", async () => {
    get.mockResolvedValue({ data: { items: [], next_cursor: null }, response: { ok: true } });
    const qc = new QueryClient();
    const { result } = renderHook(() => [useApprovalQueue(true), useApprovalQueue(true)], { wrapper: wrap(qc) });
    await waitFor(() => expect(result.current[0]?.isSuccess).toBe(true));
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith("/approvals/mine", { params: { query: { limit: 50 } } });
  });
});
