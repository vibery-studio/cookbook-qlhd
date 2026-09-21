/**
 * CSRF headers required by the API's `requireOrigin` + `requireFetchHeader`
 * middlewares. Mutating requests (POST/PUT/DELETE) MUST carry both
 * `Origin` and `X-Requested-With` — the middlewares reject anything
 * missing either. GET/HEAD/OPTIONS ignore these headers.
 *
 * Tests currently duplicate this literal 5+ times; import from here
 * instead.
 */

/** Default local test origin — mirrors `wrangler dev` default. */
export const TEST_ORIGIN = "http://localhost:8787";

export const CSRF_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "content-type": "application/json",
  origin: TEST_ORIGIN,
  "x-requested-with": "fetch",
});

/**
 * Build a CSRF header set against a custom origin. Useful when a test
 * needs to prove the origin check rejects a mismatched value.
 */
export function csrfHeadersFor(origin: string): Record<string, string> {
  return {
    "content-type": "application/json",
    origin,
    "x-requested-with": "fetch",
  };
}
