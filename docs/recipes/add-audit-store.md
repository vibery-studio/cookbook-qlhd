# Recipe: Add a D1 audit store (v2)

v1 blueprint ships audit as Logpush-only — every `logger.audit()`
call is a `console.log` line that Logpush ingests. This is the right
default: no storage cost, no in-app query surface, no PII lifecycle
to manage in D1.

Add a durable audit store only when you need one of:

1. **In-app admin UI** that surfaces "what happened on my account"
   without asking operations to query the log destination.
2. **Compliance retention** with SLA-guaranteed durability (Logpush
   destinations vary; R2 is durable but SIEMs often expire).
3. **Cross-event queries** ("show me all admin actions on user X"),
   which Logpush destinations often make expensive.

## Schema

```sql
CREATE TABLE audit_events (
  id           TEXT PRIMARY KEY,       -- ULID
  ts           INTEGER NOT NULL,       -- unix seconds
  actor        TEXT,                   -- ULID or system:<tag> or NULL
  action       TEXT NOT NULL,
  target       TEXT,
  metadata     TEXT,                   -- JSON string, already deep-scrubbed
  ip           TEXT
);
CREATE INDEX idx_audit_ts ON audit_events (ts DESC);
CREATE INDEX idx_audit_target ON audit_events (target, ts DESC);
CREATE INDEX idx_audit_actor ON audit_events (actor, ts DESC);
```

## DAO

```ts
// apps/api/src/dao/audit-log-dao.ts
import { and, desc, eq, lt } from "drizzle-orm";
import type { Db } from "../db/client";
import { auditEvents } from "../db/schema";

export interface AuditEventDto {
  id: string;
  ts: number;
  actor: string | null;
  action: string;
  target: string | null;
  metadata: Record<string, unknown> | null;
  ip: string | null;
}

export async function insertAuditEvent(
  db: Db,
  input: AuditEventDto,
): Promise<void> {
  await db.insert(auditEvents).values({
    ...input,
    metadata: input.metadata === null ? null : JSON.stringify(input.metadata),
  });
}

export async function listAuditEventsByTarget(
  db: Db,
  input: { target: string; cursor?: number; limit: number },
): Promise<AuditEventDto[]> {
  const rows = await db
    .select()
    .from(auditEvents)
    .where(
      input.cursor !== undefined
        ? and(eq(auditEvents.target, input.target), lt(auditEvents.ts, input.cursor))
        : eq(auditEvents.target, input.target),
    )
    .orderBy(desc(auditEvents.ts))
    .limit(input.limit);
  return rows.map((r) => ({
    ...r,
    metadata: r.metadata === null ? null : JSON.parse(r.metadata),
  }));
}
```

## Extending the audit logger

`observability/logger.ts` becomes dual-write: `console.log` for
Logpush + `insertAuditEvent` for D1. Wrap the D1 call in a try/catch
so an audit-store outage doesn't fail the audited operation:

```ts
export function createAuditLogger(deps: AuditDeps & { db?: Db }): AuditFn {
  return function audit(event, opts = {}) {
    const scrubbed = deepScrub(event) as AuditEvent;
    const line = JSON.stringify({ ts: Date.now(), kind: "audit", ...scrubbed });
    console.log(line);   // always emit for Logpush

    if (deps.db !== undefined) {
      const writeD1 = async () => {
        try {
          await insertAuditEvent(deps.db!, {
            id: generateUlid(),
            ts: Math.floor(Date.now() / 1000),
            actor: scrubbed.actor,
            action: scrubbed.action,
            target: scrubbed.target ?? null,
            metadata: scrubbed.metadata ?? null,
            ip: scrubbed.ip ?? null,
          });
        } catch (err) {
          console.error(JSON.stringify({
            ts: Date.now(),
            kind: "audit.d1.write_failed",
            error: err instanceof Error ? err.message : String(err),
          }));
        }
      };
      if (opts.sync === true || deps.ctx === undefined) {
        // Sync D1 writes make audit calls ~5-10ms slower. Accept
        // the cost for security-critical events.
        void writeD1();  // fire-and-forget; caller awaits nothing
      } else {
        deps.ctx.waitUntil(writeD1());
      }
    }
  };
}
```

## Admin routes

`GET /admin/audit?target=user:...&cursor=...&limit=50` under
`audit:read` permission. Add the permission to `packages/rbac/src/
catalog.ts` first (`"audit:read"`) and grant to `admin` in a seed
migration.

Never expose the raw `metadata` blob without server-side filtering —
even with `deepScrub`, PII-adjacent fields (`email`, `ip`) may leak
in metadata JSON.

## Retention

Add a cron to prune `audit_events WHERE ts < now - 90d` (or your
compliance-driven retention). Chunk deletes to avoid holding a
long D1 transaction:

```ts
export async function pruneOldAuditEvents(db: Db, olderThan: number): Promise<number> {
  let total = 0;
  while (true) {
    const rows = await db
      .delete(auditEvents)
      .where(lt(auditEvents.ts, olderThan))
      .limit(1000)     // hypothetical; drizzle may not expose delete-with-limit — use a subquery
      .returning({ id: auditEvents.id });
    if (rows.length === 0) break;
    total += rows.length;
  }
  return total;
}
```

## Migration path from log-only

You can start log-only (v1 default) and add D1 later without changing
callers — every `logger.audit()` call site stays identical, only
`createAuditLogger`'s implementation gains the D1 write. Same
guarantee for going the other way: remove `deps.db` and callers
don't notice.

## When NOT to add this

- **Low audit volume**: Logpush + a bucket / SIEM query is cheaper
  than D1 read units.
- **No admin UI needs**: if only operations queries audit, keep it
  in the destination they already query.
- **Strict PII sovereignty**: D1 is stored where CF stores it;
  destination choice may already satisfy your data-locality rules.
