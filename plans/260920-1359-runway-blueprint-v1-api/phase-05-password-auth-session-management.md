---
title: "Phase 5: Password Auth & Session Management"
status: completed
---

# Phase 5: Password Auth & Session Management

## Overview

Password auth end-to-end: signup, email verification, login, refresh (atomic CAS rotation with reuse detection), logout. **Password hashing via `@noble/hashes/scrypt`** (Red Team F1: WebCrypto has no scrypt) with OWASP 2024 params. JWT HS256 access token, **TTL 120s** (Red Team F10: short-lived access + revocation list gives max-time-to-revoke ≤ 120s + KV lag). Refresh token opaque random ≥32 bytes; stored as **HMAC-SHA256 with `TOKEN_PEPPER` secret** (Red Team F10, F11). Refresh rotation uses **atomic compare-and-swap** (Red Team F3): `UPDATE … WHERE revoked_at IS NULL RETURNING`, rowcount check — protects both attacker replay AND honest concurrent-tab races. Verify token consume uses same CAS pattern (Red Team F11). CSRF via **custom header (`X-Requested-With: fetch`) + `Origin` equality check**, not double-submit cookie (Red Team F4). `jti` revocation list checked on auth middleware with per-isolate LRU memo.

## Requirements

- Functional
  - [ ] `POST /auth/signup { email, password }` → 201, creates user (status=pending), stores verification token hash, calls emailPort (stub in P5; wired in P7). Rejects if `Origin` header missing/mismatched.
  - [ ] `POST /auth/verify { token }` → 200. Consume uses `UPDATE verification_tokens SET used_at=? WHERE token_hash=? AND used_at IS NULL RETURNING user_id, purpose`. Zero rows → 410 Gone. Concurrent double-click → exactly one succeeds, other returns 410.
  - [ ] `POST /auth/login { email, password }` → 200, sets access + refresh cookies. Requires `Origin` header matching `env.APP_ORIGIN`. Timing-safe email lookup.
  - [ ] `POST /auth/refresh` → 200, rotates via CAS. Rowcount = 0 on CAS → check whether the presented token exists at all: if yes AND revoked_at IS NOT NULL → replay detected → revoke chain via `replaced_by_hash` walk + audit `auth.refresh.reuse_detected` (SYNC — see P9). If it never existed → 401.
  - [ ] `POST /auth/logout` → 200, inserts row into `jwt_revocations` for current access token's `jti` (expires_at = original JWT exp), CAS-revokes the presented refresh token.
  - [ ] `GET /me` → 200 with `{id, email, roles[], permissions[]}` when authenticated; 401 else
- Non-functional
  - [ ] Password minimum: 12 chars, at least one letter and one digit (from env; ***not*** settings — was Red Team F14 sub-finding on Settings over-scope)
  - [ ] Timing-safe email lookup on login (constant-time regardless of user existence)
  - [ ] Password hash comparison via constant-time equals implemented in `packages/auth` (WebCrypto has no timingSafeEqual — hand-rolled XOR-accumulate, unit-tested with mismatched-length inputs)
  - [ ] Refresh + verification tokens: ≥32 bytes from `crypto.getRandomValues`, base64url encoded
  - [ ] Token hash-at-rest: `HMAC-SHA256(raw_token, env.TOKEN_PEPPER)` — pepper is a Worker secret; D1-only leak is useless without it
  - [ ] JWT: HS256, TTL 120s access + 7d refresh, `jti` claim (ULID), signing secret from `env.JWT_SECRET`
  - [ ] Verification token TTL 24h; entropy floor test asserts ≥256 bits (32 bytes)

## Architecture

```
packages/auth/
├── src/
│   ├── password.ts         # scrypt hash/verify via @noble/hashes/scrypt; constant-time compare
│   ├── jwt.ts              # sign(claims, secret), verify(token, secret) HS256 via `jose`
│   ├── tokens.ts           # generateOpaqueToken() ≥32 bytes; hashToken(token, pepper)
│   ├── origin.ts           # verifyOrigin(req, allowedOrigin) — same-origin equality
│   └── index.ts
└── test/
    ├── password.test.ts    # OWASP params, roundtrip, wrong-length compare, params-encoded-in-hash test
    ├── jwt.test.ts
    ├── tokens.test.ts      # ≥256-bit entropy floor test
    └── origin.test.ts

apps/api/src/
├── services/
│   ├── auth-service.ts     # signup, verify, login, refresh (CAS), logout
│   └── me-service.ts       # loadPrincipal(userId) → {roles, permissions}
├── middleware/
│   ├── auth.ts             # parse cookie → verify JWT → check jti revocation → attach principal
│   ├── origin.ts           # verifyOrigin on state-changing methods
│   └── require-fetch-header.ts # require X-Requested-With: fetch on state-changing methods
└── dao/
    ├── user-dao.ts
    ├── verification-token-dao.ts   # CAS consume helper
    ├── refresh-token-dao.ts        # CAS rotate helper
    ├── jwt-revocation-dao.ts       # `jti` blocklist
    └── session-cache.ts             # KV get/set principal by userId (5min TTL)
```

**Cookie strategy (no double-submit CSRF cookie):**

- `runway_at` — access JWT, httpOnly, Secure, SameSite=Strict, Path=/, Max-Age=120
- `runway_rt` — refresh token, httpOnly, Secure, SameSite=Strict, Path=/auth/refresh, Max-Age=604800

**CSRF defense stack:**

1. **SameSite=Strict** on both auth cookies (primary defense; blocks cross-site cookie inclusion)
2. **Custom header requirement:** state-changing methods (POST/PUT/PATCH/DELETE) require `X-Requested-With: fetch`. Browsers block cross-origin custom headers via CORS preflight; only same-origin JS can set this. Middleware returns 403 problem+json if missing.
3. **Origin equality:** state-changing methods require `Origin` header to equal `env.APP_ORIGIN`. Missing or mismatched → 403. Includes `POST /auth/login` — this blocks login-CSRF (Red Team F4).

**Refresh rotation (atomic CAS):**

```
POST /auth/refresh receives cookie value RT_raw
h = HMAC-SHA256(RT_raw, env.TOKEN_PEPPER)
new_raw = crypto.getRandomValues(32) → base64url
new_h = HMAC-SHA256(new_raw, env.TOKEN_PEPPER)
now = Date.now()/1000

// CAS: atomic revoke-if-not-yet-revoked returning user_id
result = db.prepare(
  'UPDATE refresh_tokens SET revoked_at = ?, replaced_by_hash = ? WHERE token_hash = ? AND revoked_at IS NULL RETURNING user_id, expires_at'
).bind(now, new_h, h).run()

if (result.meta.changes === 0):
   // Two possibilities:
   //   a) Token never existed → 401
   //   b) Token exists but was already revoked → REPLAY DETECTED
   existing = refreshTokenDao.findByHash(h)
   if (existing && existing.revoked_at):
       revokeChain(existing)                     // walks replaced_by_hash
       logger.audit({action:'auth.refresh.reuse_detected', target:'user:'+existing.user_id}, {sync: true})
   return 401

if (result.expires_at < now): return 401  // stale

// Insert new refresh row + new access JWT
refreshTokenDao.insert({token_hash: new_h, user_id, expires_at: now+7d, ...})
issue new access JWT with jti + user_id
Set-Cookie: runway_at=..., runway_rt=new_raw
```

**Verify consume (atomic CAS):**

```
POST /auth/verify receives {token: T_raw}
h = HMAC-SHA256(T_raw, env.TOKEN_PEPPER)
result = db.prepare(
  'UPDATE verification_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? RETURNING user_id, purpose'
).bind(now, h, now).run()
if result.meta.changes === 0: return 410 Gone
// Apply effect based on purpose
```

**JWT revocation check:**

- Auth middleware verifies JWT signature + exp; then checks `jwt_revocations` for `jti`
- Per-isolate in-memory LRU cache of recently-checked jtis (TTL 60s) reduces D1 hits
- Prune job (Cron trigger, Phase 10) deletes `jwt_revocations WHERE expires_at < now()` nightly

## Related Code Files

- Create: `packages/auth/src/{password,jwt,tokens,origin,index}.ts` + tests
- Create: `apps/api/src/services/{auth-service,me-service}.ts`
- Create: `apps/api/src/middleware/{auth,origin,require-fetch-header}.ts`
- Create: `apps/api/src/dao/{user-dao,verification-token-dao,refresh-token-dao,jwt-revocation-dao,session-cache}.ts`
- Fill: `apps/api/src/routes/auth.routes.ts` (from P4 stubs)
- Fill: `apps/api/src/routes/me.routes.ts`
- Modify: `apps/api/src/index.ts` — install origin + require-fetch-header middleware on state-changing routes; wire auth middleware
- Modify: `apps/api/src/openapi.ts` — declare security scheme (cookieAuth)
- Modify: `apps/api/wrangler.toml` / `.dev.vars.example` — add `JWT_SECRET`, `TOKEN_PEPPER`, `APP_ORIGIN` secret placeholders
- Install: `@noble/hashes`, `jose`

## Implementation Steps

1. **TDD packages/auth first (pure, Node-testable):**
   - Failing test: `password.test.ts` roundtrip + reject wrong pwd + reject downgrade (asserts encoded hash string parses back to N=2^17, r=8, p=1)
   - Implement `hash(pwd)` using `@noble/hashes/scrypt`: N=2^17, r=8, p=1, dkLen=64, random 16-byte salt; format `scrypt$N$r$p$salt_b64$hash_b64`
   - Implement `verify(pwd, encoded)` with hand-rolled constant-time compare (XOR-accumulate); reject mismatched lengths in constant time
   - JWT: HS256 sign/verify with `jose`; sign includes `jti`
   - Tokens: 32-byte random via `crypto.getRandomValues`, base64url; `hashToken(t, pepper)` = HMAC-SHA256 hex; entropy floor test
   - Origin: `verifyOrigin(req, allowedOrigin)` — case-sensitive equality on scheme+host+port
2. **Integration tests for auth-service (vitest-pool-workers with real D1):**
   - Failing test each: signup happy, signup duplicate → 409, signup without Origin → 403, verify happy, verify concurrent double → exactly one 200 + one 410, verify expired → 410, login happy, login wrong pwd → 401, login without Origin → 403, refresh happy CAS rotation, refresh concurrent → exactly one succeeds no chain-nuke, refresh reuse → chain revoked + sync audit event, logout → `jti` inserted into revocations
3. **Implement DAOs** (userDao, verificationTokenDao with CAS consume helper, refreshTokenDao with CAS rotate helper, jwtRevocationDao); return DTOs only
4. **Implement auth-service** wiring DAOs + auth package + emailPort (stubbed until P7)
5. **Implement middleware/auth.ts:**
   - Parse `runway_at` cookie → verify JWT → check `jti` in `jwt_revocations` (LRU-memo) → 401 if revoked
   - Load principal from KV cache (fallback D1) → attach to `c.set('principal', p)`
   - On failure: 401 problem+json
6. **Implement middleware/origin.ts** and **require-fetch-header.ts**; mount on all state-changing HTTP methods
7. **Fill route handlers** with proper Zod schemas, call services, return 201/200
8. **Update OpenAPI:** add `cookieAuth` security scheme + describe `X-Requested-With: fetch` + Origin requirement in `docs/auth.md`
9. **Session cache invalidation:** on user status change or role change (P6), delete `session:<userId>` from KV. Document max-time-to-revoke = `access_ttl (120s) + kv_lag (up to 60s)`.
10. **Run all tests** — unit (packages/auth) + integration (auth-service) → green

## Todo

- [ ] `packages/auth` pure functions with tests
- [ ] Password hashing via `@noble/hashes/scrypt` verified against OWASP 2024 params
- [ ] Downgrade-detection test: hash-string tampered to N=2^10 → rejected
- [ ] Tokens ≥32 bytes; entropy floor test green
- [ ] HMAC + `TOKEN_PEPPER` hashing implemented + tested
- [ ] Constant-time compare hand-rolled + tested with mismatched-length inputs
- [ ] All auth-service tests green including CONCURRENT refresh + verify races
- [ ] Refresh reuse detection revokes chain + fires SYNC audit event (test proven)
- [ ] Access token TTL 120s; `jti` revocation check with LRU memo
- [ ] Cookies set with all correct flags; NO CSRF cookie
- [ ] Custom-header + Origin check enforced on state-changing routes (including `/auth/login` + `/auth/signup`)
- [ ] `GET /me` returns roles + permissions (permissions[] empty until P6)
- [ ] Session cache in KV with 5min TTL; invalidated on relevant mutations
- [ ] OpenAPI declares cookieAuth security scheme
- [ ] `.dev.vars.example` includes `JWT_SECRET`, `TOKEN_PEPPER`, `APP_ORIGIN` placeholders
- [ ] `docs/auth.md` documents max-time-to-revoke, CSRF stack, and secret rotation runbook

## Success Criteria

- [ ] Golden path via Bruno: signup → capture email token from noop adapter → verify → login → /me → refresh → /me still works → logout → /me 401
- [ ] Login without matching `Origin` → 403
- [ ] Login without `X-Requested-With: fetch` header → 403
- [ ] Timing test: login with unknown vs known email both take ~same time (±10ms tolerance)
- [ ] Concurrent refresh test: fire 2 identical /auth/refresh in parallel → exactly one 200, one 401 or 425, no chain-nuke, no false `reuse_detected`
- [ ] Refresh reuse test: use rt1, then use rt1 again sequentially → all descendants revoked + SYNC audit event fires before response
- [ ] Concurrent verify test: fire 5 identical /auth/verify in parallel → exactly one 200, four 410 Gone
- [ ] Logout inserts `jti` into revocations; subsequent request with old access cookie → 401 (verified in test even though JWT is signature-valid)
- [ ] Password downgrade test: manually forge a hash string with weakened params → auth-service refuses to accept as valid

## Risk Assessment

- **`@noble/hashes` bundle size:** ~20KB tree-shaken with only scrypt + HMAC-SHA256 imported. Confirmed within 900KB budget.
- **scrypt latency on Workers paid tier:** N=2^17 ≈ 100-200ms per hash. Acceptable for login (rate-limited to 5/min). If measured >300ms in prod, tune N=2^16 as fallback documented in `docs/auth.md`.
- **jose Workers compat:** Requires `nodejs_compat` flag (already enabled in Phase 2 wrangler.toml). Pin exact version.
- **KV eventual consistency for session cache:** Cache invalidation lags ≤60s across regions. Combined with 120s access token TTL → max-time-to-revoke = ~180s worst case. Explicit `jti` revocation check on auth middleware means access-token immediate revocation is always enforced regardless of KV. Documented in `docs/auth.md`.
- **Same-origin `Origin` check:** Requires `env.APP_ORIGIN` set correctly per env (dev = `http://localhost:8787`, preview = the per-PR URL, prod = the real host). CI-substituted at deploy time.
- **JWT secret rotation:** Not implemented v1. `docs/auth.md` runbook: rotate `JWT_SECRET`, all users effectively logged out (existing tokens fail sig check). Consider dual-key verification in v2.
- **`TOKEN_PEPPER` loss:** Losing the pepper invalidates all existing refresh + verification tokens (users must log in again, unverified users must re-signup). Documented as an operational catastrophe; back up secrets via Cloudflare's secret store + team password manager.
