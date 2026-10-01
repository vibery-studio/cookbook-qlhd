# Auth

## Threat model summary

Members-only API, no third-party embedding, SPA-only same-origin client. The
primary risks are credential stuffing/replay against password login, refresh
token theft/replay, CSRF from a malicious cross-origin page riding the
browser's cookie jar, and token-space probing against verify/reset endpoints.
Out of scope for v1: OAuth/social login, multi-tenant isolation, XSS (handled
by CSP + React's default escaping, not this doc).

## Password hashing

`@noble/hashes/scrypt` (audited, pure-TS, Workers-safe — WebCrypto has no
scrypt). OWASP 2024 params: `N=2^17, r=8, p=1, dkLen=64`, random 16-byte salt.
Encoded as `scrypt$N$r$p$salt_b64$hash_b64` (`packages/auth/src/password.ts`).

Never bcrypt (56-byte password truncation footgun, not memory-hard enough),
never argon2 (no mature audited pure-TS/WASM-free Workers build at pin time),
never a rolled scrypt implementation.

**Downgrade policy:** `verifyPassword` does NOT reject a hash encoded under
weaker-than-current-policy params — rejecting outright would lock out
legitimate users hashed under an older policy. Instead, `parseHashParams(hash)`
lets the caller detect `N < OWASP_2024_PARAMS.N` (or weaker `r`/`p`) after a
successful login and force a rehash with current params before storing.

## Session cookies

| Cookie | Contents | TTL | Path | SameSite | Flags |
|---|---|---|---|---|---|
| `runway_at` | access JWT | 120s | `/` | Strict | httpOnly, Secure |
| `runway_rt` | opaque refresh token | 7d | `/auth` | Strict | httpOnly, Secure |

No `runway_csrf` cookie — see CSRF stack below.

## Max time to revoke

`access_ttl (120s) + KV lag (up to 60s worst case cross-region)` = **~180s
worst case**.

The `jti` revocation list (`jwt_revocations` D1 table) is checked on every
auth-middleware pass, independent of the KV session cache — this is the hard
guarantee. Logout inserts the `jti` synchronously before the response returns,
so a revoked access token is rejected on its very next use regardless of KV
state. The KV session-cache TTL (60s, SPEC-06 DEC-4; was 5min) only affects how
fast role/permission *changes* propagate, not access-token revocation.

Role/permission change → every affected user's `session:<id>` key is deleted after
commit (user role change: that user; role permission change: every holder). Worst
case for the change to bite = `max(KV lag ≤ 60s, cache TTL 60s)` — the TTL covers a request
that missed the cache, read D1 just before the commit and re-cached the old principal
just after the purge → **~60s**, not 300s. Same KV location (tests, one colo): next request.

Middleware layers a per-isolate in-memory LRU (TTL 60s, key=`jti`) in front of
the D1 `jwt_revocations` lookup so repeat requests on the same JWT don't hit
D1 every time — this cache is a hot-path optimization only; it never widens
the revocation window because the JWT itself expires within 120s regardless.

## Refresh rotation

Atomic CAS: `UPDATE refresh_tokens SET revoked_at=?, replaced_by_hash=?
WHERE token_hash=? AND revoked_at IS NULL RETURNING user_id, expires_at`.
`rows.length === 1` → rotation succeeded, issue new refresh + access token.
`rows.length === 0` → distinguish via a follow-up SELECT (never a second
write): no row at all → `not-found` (401); row exists and already revoked →
`reuse-detected` — walk the `replaced_by_hash` chain and revoke every token
for that user (`revokeUserRefreshChain`), fire `auth.refresh.reuse_detected`
as a SYNC audit event before responding.

Concurrent-tabs edge case (two legitimate requests racing the same refresh
cookie) is handled by an honest-race guard inside the CAS: the loser's SELECT
sees the row revoked with `replaced_by_hash` set and `now - revoked_at`
within `SELF_RACE_WINDOW_SECONDS` (3s) → returns `not-found` (401), NOT
`reuse-detected`. Chain-nuke would otherwise wipe the winner's brand-new
tokens. Attacker-replay still classifies as `reuse-detected` because the
revocation is older than the race window OR `replaced_by_hash` is absent
(reused after logout-only revocation, no successor). Never a silently-
corrupted chain, never two rows minted from one token.

## CSRF stack

1. **`SameSite=Strict`** (primary) — blocks the cookie from being sent on any
   cross-site navigation or request.
2. **Custom header `X-Requested-With: fetch`** on state-changing methods
   (POST/PUT/PATCH/DELETE) — browsers block cross-origin custom headers via
   CORS preflight, so only same-origin JS can set this. Missing → 403.
3. **`Origin` equality check** on state-changing methods, including
   `POST /auth/login` (blocks login-CSRF, where an attacker forces a victim
   to authenticate as the attacker's account) — must equal `env.APP_ORIGIN`.
   Missing or mismatched → 403.

**No double-submit cookie.** Rationale: the app is same-origin only (no
third-party embedding), SPA-only client — the custom-header check alone
already proves same-origin JS execution, and a double-submit cookie adds
implementation surface (cookie-read-then-echo) without covering a threat the
header check doesn't already cover for this deployment shape.

## Secret rotation runbook

**`JWT_SECRET` rotation** → every existing access token fails signature
verification on its next auth-middleware pass — all users effectively logged
out immediately (refresh tokens are unaffected until they try to mint a new
access token, which also requires a valid session state, so re-login is the
practical outcome). No dual-key verification in v1.

```
wrangler secret put JWT_SECRET --env production
wrangler deploy --env production
```

**`TOKEN_PEPPER` rotation** → every stored refresh + verification token hash
(`HMAC-SHA256(raw, TOKEN_PEPPER)`) becomes unverifiable — all refresh tokens
and all outstanding verify/reset tokens are invalidated at once. Users must
log in again; unverified users must re-signup (their verify-email token is
dead). This is the more destructive of the two rotations.

```
wrangler secret put TOKEN_PEPPER --env production
wrangler deploy --env production
```

**Do NOT rotate both secrets in the same deploy** without an ops
post-mortem/announcement first — combined, every session and every
outstanding token dies simultaneously with no graceful degradation path.

Losing either secret (not rotating, but permanently losing it) is an
operational catastrophe equivalent to a forced rotation with no ability to
undo it. Back up both secrets via Cloudflare's secret store and the team
password manager.

## scrypt latency notes

`N=2^17, r=8, p=1` measures ~100-200ms/hash on Workers paid tier. Login is
rate-limited to 5/min per `(email, ip)` tuple, so this cost is acceptable at
expected traffic. If measured latency exceeds 300ms in production, the
documented fallback is tuning down to `N=2^16` (halves CPU/memory cost,
still well above OWASP's interactive-login floor) — requires a coordinated
password-hash-params change, not a secret rotation; existing hashes stay
valid and get upgraded via the downgrade-detection rehash path on next login.
