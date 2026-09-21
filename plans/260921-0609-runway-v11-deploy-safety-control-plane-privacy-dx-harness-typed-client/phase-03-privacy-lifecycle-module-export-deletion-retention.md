---
phase: 3
title: "Privacy Lifecycle Module (export, deletion, retention)"
status: pending
priority: P1
effort: "2-3d"
dependencies: []
---

# Phase 3: Privacy Lifecycle Module

## Overview

GDPR-shaped user data lifecycle. Every consumer of the blueprint will
otherwise hand-roll this the first time a user asks for their data or
account deletion. Ship the three pillars: (1) declarative data
inventory + retention registry per DAO, (2) account export endpoint
returning a signed JSON archive of everything owned by a principal,
(3) account deletion pipeline that revokes sessions immediately,
honors a grace window, then asynchronously erases/anonymizes
product data and emits an immutable completion audit event.

## Requirements

- Functional
  - **Data inventory registry**: every DAO with user-owned data
    exports a `DATA_INVENTORY` metadata object declaring
    `{ personal: boolean, exportable: boolean, deletable: boolean,
    retentionSeconds?: number }`. Compile-time check via a workspace
    linter that new DAOs declare it.
  - **Export endpoint**: `POST /me/export` (authenticated, no idempotency
    key needed — one export per user per 24h enforced via rate limit
    binding + last-export timestamp on `users`). Returns 202 with an
    export id; the export is generated asynchronously via a queue
    consumer and emailed to the user with a signed R2 URL (or, if R2
    isn't wired, an inline JSON if size < 5MB).
  - **Deletion request**: `POST /me/delete` (authenticated). Requires
    the user's password to reconfirm. On success: revoke all sessions
    (all refresh tokens + all jti's), flag `users.deletion_requested_at`,
    return 202 with the scheduled completion timestamp
    (`grace_window_seconds` after request; default 7 days, configurable
    via a setting).
  - **Deletion cancellation**: `POST /me/delete/cancel` (authenticated
    with a fresh login). Clears `deletion_requested_at` before the
    grace window elapses.
  - **Async erasure**: A cron (extend the nightly pruner or add a new
    hourly) sweeps `users WHERE deletion_requested_at < now -
    grace_window_seconds AND deleted_at IS NULL`. For each: iterate the
    data inventory in reverse-dependency order, delete or anonymize
    per declared policy, mark `users.deleted_at`, emit
    `user.deletion_completed` SYNC audit event with an immutable
    hash of the pre-deletion identity.
  - **Retention enforcement**: DAOs that declare `retentionSeconds`
    (audit rows, session cache, verification tokens beyond expiry)
    get pruned by the same sweeper.
- Non-functional
  - Export archive is JSON, gzipped, includes a schema version, and is
    signed with `TOKEN_PEPPER`-derived HMAC so the recipient (or
    counsel) can verify it wasn't tampered with in transit.
  - Deletion is idempotent: a re-request during grace is a no-op that
    updates `updated_at` only.
  - Session revocation is immediate (no wait for grace window) — the
    grace window applies only to data erasure, not to login.
  - Audit events for both flows are SYNC (never lost on isolate death).
  - Log destination retention is documented: Logpush lines carrying
    email addresses on old audit events are outside D1's control;
    `docs/privacy.md` calls out the Logpush retention boundary and
    the operator's responsibility to configure destination expiry.

## Architecture

```
apps/api/src/
├── privacy/
│   ├── data-inventory.ts       # aggregated inventory across all DAOs
│   ├── export-service.ts       # collects → serializes → signs → stores
│   ├── deletion-service.ts     # revoke → schedule → sweep-erase
│   └── retention-service.ts    # per-DAO retention enforcement
├── crons/
│   └── privacy-sweeper.ts      # hourly: deletions past grace + retention
└── routes/
    ├── me-export.routes.ts     # POST /me/export
    └── me-delete.routes.ts     # POST /me/delete, POST /me/delete/cancel
```

Schema additions (`0007_add_privacy_columns.sql`):

```sql
ALTER TABLE users ADD COLUMN deletion_requested_at INTEGER;
ALTER TABLE users ADD COLUMN deleted_at INTEGER;
ALTER TABLE users ADD COLUMN last_export_at INTEGER;

CREATE TABLE IF NOT EXISTS user_exports (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending/completed/failed
  archive_url   TEXT,                             -- signed R2 URL when ready
  requested_at  INTEGER NOT NULL,
  completed_at  INTEGER
);
```

Data inventory shape (per DAO):

```ts
// apps/api/src/dao/notes-dao.ts
export const NOTES_INVENTORY = {
  table: "notes",
  ownerColumn: "user_id",
  personal: true,
  exportable: true,
  deletable: true,
} as const satisfies DataInventoryEntry;
```

Aggregate registry at `privacy/data-inventory.ts`:

```ts
export const DATA_INVENTORY: readonly DataInventoryEntry[] = [
  USERS_INVENTORY,
  NOTES_INVENTORY,
  REFRESH_TOKENS_INVENTORY,
  VERIFICATION_TOKENS_INVENTORY,
  JWT_REVOCATIONS_INVENTORY,
  USER_EXPORTS_INVENTORY,
  // NOT: settings (system), feature_flags (system), roles/permissions (system)
];
```

Export flow:

```
POST /me/export
  → rate limit (RL_EXPORT: 1/24h per user)
  → create user_exports row (status=pending)
  → enqueue { userId, exportId } to EMAIL_RETRY_QUEUE (reuse; new job type)
  → return 202 { export_id, estimated_ready_at }

Queue consumer sees export job
  → iterate DATA_INVENTORY (exportable=true), SELECT WHERE user_id=?
  → serialize to JSON archive with schema version + HMAC signature
  → upload to R2 (or inline for small)
  → update user_exports.status=completed + archive_url
  → send email with signed URL
```

Deletion flow:

```
POST /me/delete { password }
  → verify password (timing-safe via existing auth-service.login logic)
  → revoke every refresh_token for user (revokeUserRefreshChain)
  → insert jti revocations for every active access token (peek at what
    we can: only the current request's jti is known; others expire
    naturally within 120s)
  → set users.deletion_requested_at = now
  → emit user.deletion_requested (async audit)
  → return 202 { scheduled_completion_at }

privacy-sweeper (hourly cron)
  → SELECT users WHERE deletion_requested_at < now - grace_window
    AND deleted_at IS NULL LIMIT 100
  → for each: iterate DATA_INVENTORY in reverse; DELETE FROM <table>
    WHERE <ownerColumn> = ?
  → anonymize user row (email = 'deleted-<id>@runway.local', status=disabled,
    password_hash = <scrypt of random>)
  → set users.deleted_at = now
  → emit user.deletion_completed SYNC with identity_hash =
    sha256(email + user_id)  [immutable proof of what was deleted]
```

Grace window is a setting (new registry entry
`privacy.deletion_grace_seconds`, default 604800 = 7 days).

## Related Code Files

- Create: `apps/api/src/privacy/{data-inventory,export-service,deletion-service,retention-service}.ts`
- Create: `apps/api/src/crons/privacy-sweeper.ts`
- Create: `apps/api/src/routes/{me-export,me-delete}.routes.ts`
- Create: `apps/api/src/db/migrations/0007_add_privacy_columns.sql` (+ snapshot + journal)
- Modify: `apps/api/src/db/schema.ts` (add columns + user_exports table)
- Modify: every DAO with user data to export `<NAME>_INVENTORY`
- Modify: `apps/api/src/routes/index.ts` (mount privacy routes)
- Modify: `apps/api/src/index.ts` (dispatch privacy-sweeper cron)
- Modify: `apps/api/wrangler.toml` (add hourly cron `0 * * * *`)
- Modify: `apps/api/src/settings/registry.ts` (add
  `privacy.deletion_grace_seconds`)
- Modify: `packages/config/eslint-rules/*` (add lint rule that DAOs
  under `apps/api/src/dao/` must export a `*_INVENTORY` const)
- Create: `docs/privacy.md` (export + deletion + retention operator
  runbook; Logpush retention responsibility called out)

## Implementation Steps

1. Migration `0007_add_privacy_columns.sql` + snapshot + journal.
2. Extend schema.ts.
3. Add data-inventory metadata export to every DAO (users, notes,
   refresh_tokens, verification_tokens, jwt_revocations, user_exports).
   Skip system tables (settings, feature_flags, roles, permissions,
   role_permissions, user_roles, schema_versions).
4. Aggregate at `privacy/data-inventory.ts`. Compile-time
   exhaustiveness: unit test asserts DATA_INVENTORY covers every
   personal table.
5. Write `export-service.ts`: iterate inventory, SELECT WHERE user_id,
   JSON.stringify, gzip via Web Streams API, HMAC-sign, upload to R2
   (or return inline). New EmailPort message template
   `account-export` handles the delivery.
6. Write new email template `account-export.tsx` with the archive URL
   + retention notice ("this link expires in 7 days"). Wire into the
   discriminated union in `packages/email-templates`.
7. Write `deletion-service.ts`: password reconfirm → session revoke →
   flag column update → audit event.
8. Write `privacy-sweeper.ts` cron handler. Iterate inventory in
   reverse dependency order. Batch-limit 100 users per tick.
9. Add hourly cron to wrangler.toml default + preview + prod triggers.
   Extend `scheduled()` dispatch table in index.ts to route `0 * * * *`
   to `privacySweeper`.
10. Write `me-export.routes.ts` and `me-delete.routes.ts` — each
    behind rate limits (RL_EXPORT + RL_DELETE) and idempotency.
11. Add `privacy.deletion_grace_seconds` to settings registry with a
    default of 604800 (7 days). Update `0003_seed_settings.sql`
    equivalent — new migration `0008_seed_privacy_setting.sql` since
    0003 is applied to prod already.
12. Write the ESLint workspace rule enforcing `*_INVENTORY` export
    per DAO. Add unit test.
13. Integration tests:
    - Export happy path: signup → login → POST /me/export → 202 →
      poll user_exports → completed → verify archive signature.
    - Export rate limit: two POST /me/export in <24h → second 429.
    - Deletion happy path: signup → login → POST /me/delete → 202 →
      verify sessions revoked → wait grace (test-only override to
      1s) → sweeper runs → data gone; users row anonymized;
      user.deletion_completed emitted.
    - Deletion cancel: request → cancel before grace → sweeper no-op.
    - Password reconfirm: wrong password → 401; correct → 202.
    - Retention enforcement: seed an expired user_exports row →
      sweeper deletes.
14. `docs/privacy.md`: recipe for adding a new resource-with-user-data
    (declare inventory, prove exportable/deletable), the Logpush
    retention boundary, GDPR SLA (30 days from request to erasure
    completion — well within our 7-day grace + 1-hour sweep cadence).

## Success Criteria

- [ ] Every user-data DAO exports `<NAME>_INVENTORY`; lint fails on
      missing.
- [ ] POST /me/export end-to-end: archive is signed + verifiable +
      contains every user-owned row across all DAOs.
- [ ] POST /me/delete: sessions revoked immediately; grace-window
      countdown visible in response; sweeper erases + anonymizes on
      schedule.
- [ ] `user.deletion_completed` audit event contains identity_hash
      (proof of what was deleted, without preserving the raw identity
      in D1).
- [ ] Rate limits on export + delete proven (429 on abuse).
- [ ] docs/privacy.md includes: adding a resource, GDPR SLA, Logpush
      retention responsibility.
- [ ] Zero user data survives past 7 days of a valid deletion request
      (integration test asserts).

## Risk Assessment

- **Export archive size**: A prolific user could have many rows.
  Mitigation: streamed generation into R2; inline JSON only if <5MB.
  R2 upload requires an `R2Bucket` binding — recipe path documented
  in privacy.md; v1.1 optionally can bypass R2 and email a
  base64-inlined archive for small users.
- **HMAC signature key rotation**: If `TOKEN_PEPPER` rotates, old
  archive signatures become unverifiable. Documented; operator
  advises users to re-download after rotation. Alternative: dedicated
  `EXPORT_HMAC_KEY` with rotation-friendly key-id header —
  overengineering for v1.1.
- **Deletion incompleteness**: Every new DAO must remember to declare
  inventory or its data will be orphaned. Mitigation: workspace
  ESLint rule + a runtime test that asserts DATA_INVENTORY covers
  every table containing a `user_id` column (via schema
  introspection).
- **Legally-required retention** (financial records, tax): v1.1
  supports `deletable: false` on a DAO — the retention-service
  logs the skipped rows in the deletion completion audit, and the
  operator handles those out-of-band per jurisdiction. Not part of
  v1.1 automation.
- **Audit trail vs. deletion**: The `user.deletion_completed` audit
  event contains the immutable `identity_hash` — a SHA-256 of the
  original email+id. This is intentional (proof-of-erasure). The
  raw email is scrubbed. GDPR's "right to be forgotten" doesn't
  reach immutable audit records of the deletion itself (case law
  supports this), but consumers with stricter interpretations can
  set the audit destination's retention to <30 days.
- **Cron overlap on long deletions**: Batch limit of 100 users/tick;
  hourly cadence gives 2400/day headroom. Documented.
- **Grace-window shortening = attack**: A malicious admin could
  reduce `privacy.deletion_grace_seconds` to 0 to speed up
  deletion of a target user. Mitigation: settings.update on this
  key emits a SYNC audit event (already true via P8); operator
  policy is to alert on this specific key changing.
