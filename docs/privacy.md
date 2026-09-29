# Privacy Lifecycle

GDPR-shaped account lifecycle for the Runway blueprint. Every consumer
hits their first "export my data" / "delete my account" request soon
after launch; ship this in v1.1 so no product hand-rolls it later.

Three primitives:

1. **Data inventory registry** — declarative list of every user-owned
   table + its export/delete policy.
2. **Account export** — `POST /me/export` returns a signed JSON archive
   of every exportable row belonging to the caller.
3. **Account deletion** — `POST /me/delete` reconfirms password,
   revokes sessions immediately, flags the user; the nightly pruner
   erases + anonymizes after a grace window.

## Data inventory

`apps/api/src/privacy/data-inventory.ts` is the single source of truth.
Each entry declares:

```ts
{
  table: "notes",           // SQL name matching schema.ts
  ownerColumn: "user_id",   // FK column ('null' for the users row itself)
  personal: true,           // contains PII (hint; not enforced)
  exportable: true,         // included in /me/export archives
  onDelete: "delete"        // erase policy: 'delete' | 'anonymize' | 'skip'
}
```

**Adding a new table with user data.** Two-line change:

1. Append a `DataInventoryEntry` in `data-inventory.ts` — **before**
   `users` (children come first; deletion iterates top-to-bottom).
2. The `data inventory covers every user-owned table` test in
   `test/integration/privacy-flow.test.ts` will fail if you forget.
   Add the table's SQL name to `INVENTORY_EXEMPT_TABLES` when it
   genuinely carries no personal data (e.g. system tables).

`onDelete` policy variants:

- `"delete"` — row is removed by the sweeper.
- `"anonymize"` — row is retained with PII scrubbed. v1.1 uses this
  only for the `users` row itself, so the `user.deletion_completed`
  audit event can carry an immutable `identity_hash` (SHA-256 of the
  original email+id) as proof-of-erasure.
- `"skip"` — retained as-is (e.g., legally-required audit trails).
  Not used in v1.1 but the mechanism supports it.

## Export flow

```
POST /me/export
Cookie: runway_at=<access-token>
```

Response (v1.1: synchronous, inline archive):

```json
{
  "export_id": "01EXPORT...",
  "generated_at": 1789958900,
  "archive": {
    "schema_version": 1,
    "generated_at": 1789958900,
    "user_id": "01USER...",
    "tables": {
      "notes": [ ... ],
      "user_roles": [ ... ],
      "users": [ ... ]
    },
    "signature": "<hex hmac-sha256>"
  }
}
```

- **Signature** is HMAC-SHA256(`TOKEN_PEPPER`, JSON of the archive
  without the signature field). Verify with
  `verifyExportSignature(archive, TOKEN_PEPPER)`. **Rotating
  `TOKEN_PEPPER` invalidates every prior signature** — operator
  responsibility.
- **Rate limit** — the second export within the shorter of
  `privacy.export_retention_seconds` and 24h returns 429 with
  `Retry-After`. Implementation stamps `users.last_export_at`; clear
  it out-of-band to allow an early re-export.
- **Async / R2 path (v1.2 future)** — the `user_exports.archive_url`
  column is reserved for a signed-URL delivery flow. v1.1 keeps
  everything inline. Wire an `R2Bucket` binding + a queue consumer to
  add async delivery; the DAO and route are shaped for the change.

## Deletion flow

Step 1 (synchronous, inside `POST /me/delete`):

```
POST /me/delete
Cookie: runway_at=<access-token>
Content-Type: application/json

{ "password": "<user password>" }
```

- Password reconfirm — stolen sessions can't schedule an erasure.
- Every refresh token is revoked. The user's current access token
  survives its short TTL (120s); the KV principal cache is evicted so
  cross-region requests re-hit D1.
- `users.deletion_requested_at = now`.
- SYNC `user.deletion_requested` audit event.
- Returns 202 with `scheduled_completion_at = now +
  privacy.deletion_grace_seconds`.

Step 2 (async, inside the nightly pruner):

- `sweepPendingDeletions` picks up every user whose grace has elapsed.
- Child rows are deleted per `DATA_INVENTORY` order (`notes`,
  `user_exports`, and the cascade in `anonymizeUser` handles
  `user_roles`, `verification_tokens`, `refresh_tokens`, `jwt_revocations`).
- The `users` row is anonymized: `email = "deleted-<id>@runway.local"`,
  `password_hash` = scrypt of a random 32-byte token, `status =
  "disabled"`, `deleted_at = now`.
- SYNC `user.deletion_completed` audit event with `identity_hash =
  SHA-256(originalEmail + ":" + userId)` — proof-of-erasure that
  cannot be inverted.

Step 3 (optional): `POST /me/delete/cancel` clears the flag while
`deletion_requested_at !== null` and `deleted_at IS NULL`. After the
sweeper runs, cancellation is impossible.

## Settings

Runtime-mutable via `PUT /admin/settings/:key`:

| Key                                | Default        | Description                                        |
|-----------------------------------|---------------|----------------------------------------------------|
| `privacy.deletion_grace_seconds`   | 604800 (7d)   | Delay between deletion request and sweep erasure   |
| `privacy.export_retention_seconds` | 2592000 (30d) | How long export rows survive; doubles as rate window |

**Security note:** shortening `privacy.deletion_grace_seconds` speeds
up erasure of pending users. `settings.update` emits a SYNC audit
event on every change (Phase 8); alert on that specific key.

## GDPR SLA

- Requests → response: synchronous (export) or 202 within one HTTP
  round-trip (delete).
- Deletion completion: `grace + one pruner tick` (default 7 days + <24h
  = well inside the 30-day GDPR SLA).
- Cancellation window: for the duration of the grace.

## Logpush retention boundary

Every audit event emitted by this pipeline (`user.deletion_requested`,
`user.deletion_completed`, `settings.update` on privacy keys) ships via
Logpush. Old logs may still carry email addresses that were later
scrubbed from D1.

**Operator responsibility:** configure the Logpush destination's
retention to match your privacy policy. `docs/audit.md` covers Logpush
setup; the recommended retention for a GDPR-strict deployment is
≤30 days on the audit stream.

## Risks (residual)

- **Signature key rotation** invalidates prior archive signatures.
  Documented; users should re-download after rotation.
- **Cron cadence.** Sweep runs once per day; batch limit of 100 users
  per tick gives 2400/day headroom. Beyond that, either shorten the
  cron schedule (needs wrangler.toml change) or bump the batch limit.
- **Legally-required retention** (tax, financial records) is out of
  scope for v1.1. Set `onDelete: "skip"` on the relevant DAO entry and
  handle those rows out-of-band per jurisdiction.
- **Immutable audit vs. right to be forgotten.** The
  `user.deletion_completed` audit event carries only the identity
  hash — the raw email is scrubbed from D1. Case law generally
  supports retaining proof-of-erasure records; consumers with
  stricter interpretations should set their Logpush retention below
  30 days.

## References

- Code: `apps/api/src/privacy/`, `apps/api/src/dao/user-exports-dao.ts`, `apps/api/src/dao/user-dao.ts` (lifecycle mutations), `apps/api/src/crons/expired-rows-pruner.ts` (sweeper), `apps/api/src/routes/me-export.routes.ts`, `apps/api/src/routes/me-delete.routes.ts`
- Migrations: `0007_curly_human_torch.sql` (columns + user_exports), `0008_seed_privacy_settings.sql` (setting defaults)
- Tests: `apps/api/test/integration/privacy-flow.test.ts`

## Contracts (SPEC-04b §5)

- `contracts.snapshot` (JSON) copies the customer's name, phone, email, tax code and address at creation time; `customer_name` and `total` are also plain columns. This is personal data of customers, not of app users.
- Deleting a draft (`DELETE /contracts/{id}`, creator only) is a HARD delete: the `contracts` row and its `approval_steps` go, `replaced_by_id` references to it are cleared. Non-draft contracts are never deleted (issued numbers stay gap-free); they are voided instead.
- Audit: `contract.deleted` metadata is `{"id": …}` only, target `contract:<id>`; no name, phone, email, tax code or amount. Other contract audit rows carry ids, statuses and numbers, no customer PII.
- Tables referencing `contract_id`: `approval_steps` (`contract_id`) and `contracts.replaced_by_id` (verify: `grep contract_id apps/api/src/db/schema.ts`; `source_contract_id` sits on the copy itself and goes with it). Both are handled by the delete batch.
