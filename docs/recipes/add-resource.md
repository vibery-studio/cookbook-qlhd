# Recipe: Add a resource in 10 steps

Add a new authenticated + RBAC-gated + idempotent resource to the
API. Uses the existing `demo/notes` resource as the reference
implementation — every step below has a working example already in
the repo. Copy the pattern; adjust names.

**Target time**: under 30 minutes for a straightforward CRUD resource
against an experienced-with-the-blueprint engineer. First time
through will be slower — that's expected.

## Assumptions

- Resource is user-owned (has a `user_id` column).
- Two operations: `POST /<resource>` (create, needs idempotency) and
  `GET /<resource>` (list, cursor-paginated).
- Two permissions: `<resource>:read` and `<resource>:write`.

If your resource is admin-only or non-user-owned, tweak the pattern
(drop the ownership check, put both permissions on admin only).

## The 10 steps

### 1. Add DTOs

`apps/api/src/dto/<resource>.ts` (or reuse `common.ts` schemas).
Reference: `apps/api/src/dto/common.ts` for `UlidSchema`,
`TimestampSchema`.

```ts
import { z } from "@hono/zod-openapi";
import { UlidSchema, TimestampSchema } from "./common";

export const OrderItem = z.object({
  id: UlidSchema,
  total: z.number().int().nonnegative(),
  status: z.enum(["pending", "paid", "shipped"]),
  createdAt: TimestampSchema,
}).openapi("Order");
```

### 2. Add the table to `db/schema.ts`

Reference: the `notes` block at the bottom of `apps/api/src/db/schema.ts`.

```ts
export const orders = sqliteTable(
  "orders",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    total: integer("total").notNull(),
    status: text("status").notNull().default("pending"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("idx_orders_user").on(table.userId, table.createdAt)],
);
```

Add `orders` to the `schema` export at the bottom of the file.

### 3. Write the SQL migration

`apps/api/src/db/migrations/0005_add_orders.sql`:

```sql
CREATE TABLE IF NOT EXISTS orders (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  total      INTEGER NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_user ON orders (user_id, created_at DESC);
```

Update `apps/api/src/db/migrations/meta/_journal.json` (add the new
entry) and copy the previous snapshot to `0005_snapshot.json` with a
fresh UUID + `prevId` chain. Reference the `0004_demo_notes` pattern.

### 4. Extend the permission catalog

`packages/rbac/src/catalog.ts` — append to the alphabetized
`PERMISSIONS` array:

```ts
export const PERMISSIONS = [
  "notes:read",
  "notes:write",
  "orders:read",         // ← new
  "orders:write",        // ← new
  "settings:read",
  "settings:write",
  "users:read",
  "users:write",
] as const;
```

### 5. Seed the role_permissions grants

Add a new SQL migration `0006_seed_orders_permissions.sql`:

```sql
INSERT OR IGNORE INTO permissions (id, key) VALUES
  ('01PERM000000000ORDERSREAD', 'orders:read'),
  ('01PERM00000000ORDERSWRITE', 'orders:write');

INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES
  ('01ROLE0000000000000ADMIN00', '01PERM000000000ORDERSREAD'),
  ('01ROLE0000000000000ADMIN00', '01PERM00000000ORDERSWRITE'),
  ('01ROLE000000000000MEMBER00', '01PERM000000000ORDERSREAD'),
  ('01ROLE000000000000MEMBER00', '01PERM00000000ORDERSWRITE');
```

Update the journal + snapshot chain. Apply to remote:

```bash
pnpm db:migrate:dev
pnpm db:migrate:prod
```

### 6. Write the DAO

`apps/api/src/dao/orders-dao.ts` — pure functions returning DTOs.
Reference: `apps/api/src/dao/notes-dao.ts`.

```ts
import { asc, eq, gt } from "drizzle-orm";
import type { Db } from "../db/client";
import { orders } from "../db/schema";

export interface OrderDto {
  id: string;
  userId: string;
  total: number;
  status: "pending" | "paid" | "shipped";
  createdAt: number;
}

export async function createOrder(db: Db, input: OrderDto): Promise<OrderDto> {
  const rows = await db.insert(orders).values(input).returning();
  return rows[0]!;
}

export async function listOrdersForUser(
  db: Db,
  input: { userId: string; cursor?: string; limit: number },
): Promise<{ items: OrderDto[]; next_cursor: string | null }> {
  const rows = await db
    .select()
    .from(orders)
    .where(input.cursor !== undefined ? gt(orders.id, input.cursor) : undefined)
    .orderBy(asc(orders.id))
    .limit(input.limit + 1);
  const hasMore = rows.length > input.limit;
  const page = hasMore ? rows.slice(0, input.limit) : rows;
  const nextCursor = hasMore ? (page[page.length - 1]?.id ?? null) : null;
  return {
    items: page.map((r) => ({ ...r, status: r.status as OrderDto["status"] })),
    next_cursor: nextCursor,
  };
}
```

### 7. (Optional) Write a service

For a trivial CRUD, the DAO is enough — the route handler can call it
directly. For anything with orchestration (side effects, external calls,
audit events), write `apps/api/src/services/orders-service.ts`. Reference:
`admin-service.ts`.

### 8. Write the route file

`apps/api/src/routes/orders.routes.ts`:

```ts
import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { bodyLimit } from "hono/body-limit";
import { OrderItem } from "../dto/order";
import { CursorQuery, paginatedResponse } from "../dto/pagination";
import { ProblemDto } from "../dto/error";
import type { Bindings } from "../env";
import type { Variables } from "../openapi";
import { getDb } from "../db/client";
import { createOrder, listOrdersForUser } from "../dao/orders-dao";
import { requireAuth } from "../middleware/auth";
import { requirePerm } from "../middleware/require-permission";
import { withIdempotency } from "../middleware/idempotency";
import { generateUlid } from "../utils/id";

type Env = { Bindings: Bindings; Variables: Variables };

const CreateOrderBody = z.object({
  total: z.number().int().nonnegative(),
}).openapi("CreateOrderRequest");

const createRoute_ = createRoute({
  method: "post",
  path: "/orders",
  tags: ["orders"],
  security: [{ cookieAuth: [] }],
  request: { body: { content: { "application/json": { schema: CreateOrderBody } } } },
  responses: {
    201: { description: "Created", content: { "application/json": { schema: OrderItem } } },
    401: { description: "Not authenticated", content: { "application/problem+json": { schema: ProblemDto } } },
    403: { description: "Forbidden", content: { "application/problem+json": { schema: ProblemDto } } },
  },
});

export function ordersRoutes(app: OpenAPIHono<Env>): void {
  app.on(
    "post",
    "/orders",
    bodyLimit({ maxSize: 128 * 1024 }),
    requireAuth(),
    requirePerm("orders:write"),
    withIdempotency(),
  );

  app.openapi(createRoute_, async (c) => {
    const body = c.req.valid("json");
    const principal = c.get("principal")!;
    const now = Math.floor(Date.now() / 1000);
    const order = await createOrder(getDb(c.env), {
      id: generateUlid(),
      userId: principal.id,
      total: body.total,
      status: "pending",
      createdAt: now,
    });
    return c.json(order, 201);
  });
}
```

### 9. Mount the routes

`apps/api/src/routes/index.ts`:

```ts
import { ordersRoutes } from "./orders.routes";
// ...
export function mountRoutes(app: OpenAPIHono<Env>): void {
  authRoutes(app);
  meRoutes(app);
  adminRoutes(app);
  adminSettingsRoutes(app);
  demoRoutes(app);
  healthRoutes(app);
  ordersRoutes(app);      // ← new
}
```

### 10. Write the integration test

`apps/api/test/integration/orders-flow.test.ts`. Reference:
`apps/api/test/integration/idempotency-flow.test.ts` for the signup
+ role-assign helper pattern.

Then:

```bash
pnpm typecheck
pnpm lint
pnpm test
```

Commit + PR.

## Sanity checks

Before opening the PR:

- `pnpm check:bundle-size` — verify still under 900KB gzip
- `pnpm openapi:export` — new endpoints appear in
  `packages/contracts/dist/openapi.json`
- New rows exist in remote D1: `wrangler d1 execute runway_dev
  --remote --command "SELECT COUNT(*) FROM orders"`
- Bruno collection: add one request under `docs/bruno/collection/`
  proving the RBAC gate works (member with `orders:write` → 201;
  anonymous → 401)

## What NOT to do

- Don't add a `BaseDao` class. Pure functions returning DTOs is
  the pattern; ESLint enforces it.
- Don't leak drizzle row types past the DAO file. If a caller
  needs a field, add it to the DTO.
- Don't add ownership logic in the service. Use
  `requirePerm(perm, { resource: (c) => ({ ownerId }) })` so
  `can()` centralizes the admin-bypass rule.
- Don't rate-limit user-scoped resource endpoints without a
  reason. Cloudflare's per-request billing already caps runaway
  callers; rate limits are for attack surfaces (login/signup/verify).
