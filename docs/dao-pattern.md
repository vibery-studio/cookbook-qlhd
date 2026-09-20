# DAO Pattern

## Why function-based DAOs

No `BaseDao` abstract class, no inheritance ceremony. Each DAO module
(`apps/api/src/dao/*.ts`) exports plain async functions that take a `Db` and
return a DTO. Pure functions are easier to test (call it, assert the DTO),
easier to refactor (no shared base class to ripple changes through), and
easier to reason about (no hidden state, no override surface). See plan.md
Red Team F14 — a base class was explicitly rejected as YAGNI for a
single-aggregate-per-file DAO layer.

## DTO discipline

Every exported function returns a DTO — a plain interface — never a drizzle
row type (`InferSelectModel`, `typeof table.$inferSelect`, or the table
object itself). Convert the drizzle row to the DTO inside the module via a
private `toDto(row)` helper that is **not exported**.

This is enforced by the `no-drizzle-typed-exports` ESLint rule
(`packages/config/eslint-rules/no-drizzle-typed-exports.js`), scoped to
`apps/*/src/dao/**/*.ts`. It flags:

- exporting a symbol whose declared type references a `drizzle-orm` import
- exporting a symbol whose declared type uses `InferSelectModel` /
  `InferInsertModel`
- re-exporting a schema table (`export { users }`)

If you hit this rule: stop, define a DTO interface, and map the row inside
your function. Don't widen the DTO to match the row — narrow the row to
match the DTO's actual contract (e.g. never put `passwordHash` on `UserDto`).

## Application-level cascade

D1's `PRAGMA foreign_keys=ON` is not reliably persistent per-statement across
HTTP-fronted connections, so we don't rely on SQLite FK enforcement for
parent-child cleanup. Instead, cascade is implemented explicitly in the DAO
and executed atomically via `db.batch([...])`: delete every dependent row
**before** the parent row, all in one batch call.

Example — `deleteUser` in `apps/api/src/dao/user-dao.ts`:

```ts
await db.batch([
  db.delete(userRoles).where(eq(userRoles.userId, id)),
  db.delete(verificationTokens).where(eq(verificationTokens.userId, id)),
  db.delete(refreshTokens).where(eq(refreshTokens.userId, id)),
  db.delete(jwtRevocations).where(eq(jwtRevocations.userId, id)),
  db.delete(users).where(eq(users.id, id)),
]);
```

Schema files still declare the logical relationships (for documentation and
drizzle-orm relations), but nothing in the DDL enforces them — the DAO is
the enforcement point.

## Adding a new DAO

1. Add the table to `apps/api/src/db/schema.ts`.
2. Define a DTO interface for what callers should see (and a `Create*Input`
   shape if the table supports inserts).
3. Write functions accepting `Db` as the first argument, returning
   `Promise<Dto>` / `Promise<Dto | null>` / `Promise<void>`.
4. Write a private (non-exported) `toDto(row)` mapper.
5. Add an integration test proving cascade behavior and/or uniqueness
   constraints against a real D1 instance — not just local unit assertions.

## ID generation

DAOs accept caller-generated IDs (typically ULIDs) rather than defaulting
them inside the DAO — makes the DAO trivially deterministic for tests.
The blueprint's ULID helper is `apps/api/src/utils/id.ts:generateUlid()`.

`generateUlid()` throws synchronously on random-component overflow — a
practically unreachable path requiring >32^16 IDs within the same
millisecond. Callers do not need to catch it: the exception propagates as
a 500 from the request handler (which is the correct behavior for an
invariant-violation this improbable). Treat it the same way you'd treat
running out of memory: don't handle it, don't test for it, just let it
crash.

## Testing

Integration tests run under `vitest-pool-workers` (workerd + miniflare D1),
which honors SQLite FK constraints by default. Production D1 does not
reliably honor them across HTTP-fronted statements. This means a cascade
test that only relies on miniflare's built-in FK enforcement can pass in CI
while cascade silently fails in production.

Always write cascade proofs that assert dependent rows are gone by calling
the delete function and querying for the children directly — test the DAO's
application-level `db.batch([...])` cascade, not miniflare's FK behavior.
Where possible, run the proof against a real preview D1, not just local
vitest-pool-workers, per plan.md Success Criteria.
