import { describe, expect, it } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { onSessionLost } from "./client";

// The logged-out first visit: GET /me → 401 → refresh 401 → onUnauthorized fires INSIDE the /me fetch.
// The guard (an observer of ["me"]) must end in error (→ redirect to /login), not stay pending.
describe("onSessionLost", () => {
  it("lets the in-flight /me settle as an error for its observer", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const unauthorized = Object.assign(new Error("401"), { status: 401 });
    const observer = new QueryObserver(qc, {
      queryKey: ["me"],
      queryFn: () => {
        onSessionLost(qc);
        return Promise.reject(unauthorized);
      },
    });
    const unsubscribe = observer.subscribe(() => {});
    await new Promise((r) => setTimeout(r, 20));
    const result = observer.getCurrentResult();
    unsubscribe();
    expect(result.status).toBe("error");
    expect(result.error).toBe(unauthorized);
  });
});
