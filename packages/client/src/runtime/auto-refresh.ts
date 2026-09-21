/**
 * Single-flight auto-refresh wrapper. Any call that returns a 401
 * triggers exactly ONE `POST /auth/refresh`; concurrent 401s share
 * that in-flight refresh promise so we don't storm the server. After
 * refresh succeeds, the original call is retried EXACTLY ONCE. A
 * second 401 propagates as-is (and fires `onUnauthorized` if wired).
 *
 * The wrapper is stateless externally — the module-scoped
 * `inFlightRefresh` is scoped per client instance via a closure in
 * `createAutoRefresh()`.
 */

export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export interface AutoRefreshOptions {
  baseUrl: string;
  fetcher: Fetcher;
  /** Called after a refresh that itself 401'd. Consumer redirects to login etc. */
  onUnauthorized?: () => void;
}

export function createAutoRefresh(options: AutoRefreshOptions) {
  let inFlightRefresh: Promise<boolean> | null = null;

  async function refreshOnce(): Promise<boolean> {
    if (inFlightRefresh !== null) return inFlightRefresh;

    inFlightRefresh = (async () => {
      try {
        const res = await options.fetcher(`${options.baseUrl}/auth/refresh`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: options.baseUrl,
            "x-requested-with": "fetch",
          },
          credentials: "include",
        });
        return res.status === 200;
      } finally {
        // Clear so the NEXT 401 (potentially minutes later) gets a
        // fresh refresh attempt. Concurrent 401s within THIS attempt
        // still shared the same promise via the guard above.
        inFlightRefresh = null;
      }
    })();

    return inFlightRefresh;
  }

  /**
   * Wraps a request-producer so a first 401 triggers one refresh + one
   * retry. `send` is invoked lazily so the retry re-computes headers
   * (fresh cookies after refresh) instead of replaying stale ones.
   */
  return async function withAutoRefresh(
    send: () => Promise<Response>,
  ): Promise<Response> {
    const first = await send();
    if (first.status !== 401) return first;

    const refreshed = await refreshOnce();
    if (!refreshed) {
      options.onUnauthorized?.();
      return first;
    }

    const second = await send();
    if (second.status === 401) {
      options.onUnauthorized?.();
    }
    return second;
  };
}
