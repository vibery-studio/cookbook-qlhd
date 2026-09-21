import { describe, it, expect, vi } from "vitest";
import { createAutoRefresh, type Fetcher } from "../src/runtime/auto-refresh";

function mkResponse(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createAutoRefresh", () => {
  it("passes through 2xx without touching /auth/refresh", async () => {
    const fetcher = vi.fn<Fetcher>(async () => mkResponse(200, { ok: true }));
    const wrap = createAutoRefresh({ baseUrl: "http://api", fetcher });

    const res = await wrap(() => fetcher("http://api/me"));
    expect(res.status).toBe(200);
    // 1 call: the original request. No refresh.
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("401 → refresh → retry succeeds → returns retry response", async () => {
    let call = 0;
    const fetcher = vi.fn<Fetcher>(async (url: string) => {
      if (url.endsWith("/auth/refresh")) return mkResponse(200, {});
      call += 1;
      return call === 1 ? mkResponse(401, { status: 401 }) : mkResponse(200, { ok: true });
    });
    const wrap = createAutoRefresh({ baseUrl: "http://api", fetcher });

    const res = await wrap(() => fetcher("http://api/me"));
    expect(res.status).toBe(200);
    // 3 total: original 401 + refresh + retry.
    expect(fetcher).toHaveBeenCalledTimes(3);
    // Refresh was hit exactly once.
    const refreshCalls = fetcher.mock.calls.filter((c) => (c[0] as string).endsWith("/auth/refresh"));
    expect(refreshCalls.length).toBe(1);
  });

  it("refresh itself 401s → returns original 401 + fires onUnauthorized once", async () => {
    const onUnauth = vi.fn();
    const fetcher = vi.fn<Fetcher>(async (url: string) => {
      if (url.endsWith("/auth/refresh")) return mkResponse(401, { status: 401 });
      return mkResponse(401, { status: 401 });
    });
    const wrap = createAutoRefresh({
      baseUrl: "http://api",
      fetcher,
      onUnauthorized: onUnauth,
    });

    const res = await wrap(() => fetcher("http://api/me"));
    expect(res.status).toBe(401);
    expect(onUnauth).toHaveBeenCalledTimes(1);
  });

  it("concurrent 401s share ONE refresh (single-flight)", async () => {
    let refreshCount = 0;
    let meCount = 0;
    // First /me call for each caller returns 401; subsequent returns 200.
    // Refresh always succeeds.
    const meStates = new Map<string, number>();
    const fetcher = vi.fn<Fetcher>(async (url: string) => {
      if (url.endsWith("/auth/refresh")) {
        refreshCount += 1;
        // Add small delay so a second caller can arrive during the refresh.
        await new Promise((r) => setTimeout(r, 20));
        return mkResponse(200, {});
      }
      meCount += 1;
      const prev = meStates.get(url) ?? 0;
      meStates.set(url, prev + 1);
      return prev === 0 ? mkResponse(401, { status: 401 }) : mkResponse(200, { ok: true });
    });
    const wrap = createAutoRefresh({ baseUrl: "http://api", fetcher });

    // Two concurrent calls that BOTH 401 → both should trigger refresh
    // handling but only ONE refresh call goes out.
    const [r1, r2] = await Promise.all([
      wrap(() => fetcher("http://api/me")),
      wrap(() => fetcher("http://api/notes")),
    ]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(refreshCount).toBe(1);
    expect(meCount).toBeGreaterThanOrEqual(4); // 2 originals + 2 retries
  });
});
