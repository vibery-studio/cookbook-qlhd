# Idempotency (Phase 9)

Guarantees that a retried mutating request produces the same
side effect exactly once. Opt-in per-request via the
`Idempotency-Key` header; enforced by `withIdempotency()`
middleware.

## Contract

- **Header**: `Idempotency-Key: <ulid | uuid>` — 26-char Crockford
  base32 ULID or 36-char UUID. Anything else → 422.
- **Auth required**: the middleware refuses `Idempotency-Key` on
  unauthenticated routes (`requireAuth` runs first — anonymous
  requests get 401 before idempotency logic fires). This prevents
  cross-user key poisoning.
- **Scope**: namespaced as `sha256(principal.id + method + path +
  header)`. Different users using the same key value do not collide;
  different endpoints don't either.
- **Body match**: `request_hash = sha256(method + path + content-type
  + content-length + body)`. Same key + different body → **409 Conflict**.
- **TTL**: 24h. Sweep the `idempotency_keys` table with
  `pruneExpiredKeys` on a cron if row growth becomes an issue (not
  wired in v1).

## Response codes

| Case | Status | Notes |
|------|--------|-------|
| First request, handler succeeds (2xx) | Passthrough status + body | Cached |
| Same key + same body, cached ready | Cached status + body | `Idempotency-Replay: true` header |
| Same key + same body, still running | 425 Too Early | `Retry-After: 1` after 5s poll |
| Same key + different body | 409 | `Problem+JSON`, `type=/errors/idempotency-conflict` |
| Handler returned non-2xx | Passthrough status | Sentinel deleted, retry attempts fresh |
| Unauth + header | 400 or 401 | Depending on middleware order |
| Malformed header | 422 | ULID or UUID only |

Only 2xx responses are cached. Errors are never memoized — clients
should retry.

## Concurrency

The write path is CAS on the PK (`INSERT OR IGNORE`). Two concurrent
same-key requests:

1. Winner inserts a sentinel row (`response_status=NULL`) and runs
   the handler.
2. Loser's insert is ignored; it sees the sentinel, polls the row
   (100ms → 500ms backoff, 5s cap) until `response_status` is set
   or the sentinel disappears.
3. If the winner completed → loser serves the cached body.
4. If the winner is still running past the poll cap → loser gets
   **425 Too Early** with `Retry-After: 1`.
5. If the winner returned non-2xx → sentinel is deleted; loser gets
   a fresh attempt (recurses via `next()`).

## Usage

```ts
import { withIdempotency } from "../middleware/idempotency";

app.on(
  "post",
  "/your/endpoint",
  requireAuth(),
  requirePerm("your:write"),
  withIdempotency(),  // 24h TTL default
);
```

Order matters: `requireAuth` before `withIdempotency` so the
principal is present when the middleware namespaces the key.

## Response header preservation

Cache-replay preserves the response headers the handler set (e.g.
`Location`, `ETag`, `Cache-Control`, custom rate-limit headers) —
the middleware stores them alongside the body as a JSON envelope in
`idempotency_keys.response_body`. Two headers are always managed by
the middleware itself on replay: `idempotency-replay: true` (marker)
and `x-request-id` (overwritten with the current request's id, since
the client cares about the current call's trace).

Hop-by-hop headers (`content-length`, `transfer-encoding`) are
stripped before caching — the runtime re-derives them.

## Body-size limit

Because the middleware buffers the entire request body to compute
the request hash, callers should mount `bodyLimit()` from
`hono/body-limit` before `withIdempotency()` on any endpoint that
uses it. Blueprint's `POST /demo/notes` caps at 2MB.

## Body re-injection

The middleware reads the request body once (for the request-hash
computation) then reconstructs `c.req.raw` with the buffered body
so downstream `.valid('json')` / `.text()` calls still work.
Handlers don't need to know about this.

## Never idempotency

`GET`, `HEAD`, and `OPTIONS` are already idempotent by RFC 9110;
don't wire the middleware on them. Only mutations (`POST`, `PUT`,
`PATCH`, `DELETE` with side effects) need it.

## Extension: DELETE endpoints

Same pattern. The response body of a 204 No Content is empty; the
middleware still caches the status. On retry the client gets 204
again — matches the DELETE semantics of "already deleted is fine".

## Anti-patterns

- Do NOT include the idempotency key in the request body. It belongs
  in the header where the middleware can find it before the handler
  runs.
- Do NOT rely on the key to enforce user-scoped ownership. Ownership
  is a separate check (`can(p, perm, { ownerId })` from RBAC); the
  key just prevents duplicate side effects for the SAME user.
- Do NOT re-use the same key across endpoints. The key is namespaced
  by path, so it technically works — but a leaked key on one endpoint
  could enable replay on another via a misconfigured client.

## Testing

`apps/api/test/integration/idempotency-flow.test.ts` (6 tests):
same-key replay, 409 mismatch, unauth rejection, invalid header,
missing header passthrough, different-key isolation.
