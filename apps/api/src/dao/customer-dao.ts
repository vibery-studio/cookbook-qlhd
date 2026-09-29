/**
 * Customers DAO (SPEC-01 FR-5). Pure `(db, input) → DTO`. The change and its audit row travel in ONE
 * `db.batch` (D1 batches are atomic): a UNIQUE violation rolls both back, a lost CAS writes no audit row.
 */
import { and, asc, eq, gt, inArray, ne, or, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { auditEvents, contracts, customers } from "../db/schema";
import { generateUlid } from "../utils/id";
import { auditInsert } from "./audit-dao";

export interface CustomerDto {
  id: string;
  name: string;
  contact_person: string | null;
  tax_code: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  created_by: string | null;
  created_at: number;
  updated_at: number;
  version: number;
  /** contracts with status='issued' only (voided/draft/pending never count) */
  issued_count: number;
  issued_total: number;
}

export interface CustomerFields {
  name: string;
  contactPerson: string | null;
  taxCode: string | null;
  phone: string | null;
  phoneNorm: string | null;
  email: string | null;
  address: string | null;
}

type Row = typeof customers.$inferSelect;

interface IssuedAgg {
  count: number;
  total: number;
}

/** One grouped query for a page of ids (no N+1). Missing customers → 0/0 at the call site. */
async function issuedAggregates(db: Db, ids: string[]): Promise<Map<string, IssuedAgg>> {
  const out = new Map<string, IssuedAgg>();
  if (ids.length === 0) return out;
  const rows = await db
    .select({
      customerId: contracts.customerId,
      n: sql<number>`count(*)`,
      total: sql<number>`coalesce(sum(${contracts.total}), 0)`,
    })
    .from(contracts)
    .where(and(inArray(contracts.customerId, ids), eq(contracts.status, "issued")))
    .groupBy(contracts.customerId);
  for (const r of rows) out.set(r.customerId, { count: Number(r.n), total: Number(r.total) });
  return out;
}

async function withIssued(db: Db, rows: Row[]): Promise<CustomerDto[]> {
  const agg = await issuedAggregates(
    db,
    rows.map((r) => r.id),
  );
  return rows.map((r) => toDto(r, agg.get(r.id)));
}

function toDto(r: Row, issued?: IssuedAgg): CustomerDto {
  return {
    id: r.id,
    name: r.name,
    contact_person: r.contactPerson,
    tax_code: r.taxCode,
    phone: r.phone,
    email: r.email,
    address: r.address,
    created_by: r.createdBy,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
    version: r.version,
    issued_count: issued?.count ?? 0,
    issued_total: issued?.total ?? 0,
  };
}

/** True when a D1/drizzle error (or any error in its cause chain) is a UNIQUE constraint violation. */
export function isUniqueViolation(err: unknown): boolean {
  for (let e: unknown = err, i = 0; e != null && i < 5; i++) {
    const msg = e instanceof Error ? e.message : typeof e === "string" ? e : "";
    if (msg.includes("UNIQUE constraint failed")) return true;
    e = e instanceof Error ? e.cause : undefined;
  }
  return false;
}

export async function getCustomer(db: Db, id: string): Promise<CustomerDto | null> {
  const rows = await db.select().from(customers).where(eq(customers.id, id)).limit(1);
  return rows[0] ? (await withIssued(db, [rows[0]]))[0]! : null;
}

/** Existing customer holding this phone_norm or tax_code (other than `excludeId`), for the 409 `existing_id`. */
export async function findDuplicate(
  db: Db,
  input: { phoneNorm: string | null; taxCode: string | null; excludeId?: string },
): Promise<CustomerDto | null> {
  const keys = [
    input.phoneNorm !== null ? eq(customers.phoneNorm, input.phoneNorm) : undefined,
    input.taxCode !== null ? eq(customers.taxCode, input.taxCode) : undefined,
  ].filter((x) => x !== undefined);
  if (keys.length === 0) return null;
  const rows = await db
    .select()
    .from(customers)
    .where(
      and(or(...keys), input.excludeId !== undefined ? ne(customers.id, input.excludeId) : undefined),
    )
    .limit(1);
  return rows[0] ? (await withIssued(db, [rows[0]]))[0]! : null;
}

/** Insert + `customer.created` audit row in one batch. Throws on UNIQUE violation (nothing is written). */
export async function insertCustomer(
  db: Db,
  input: CustomerFields & { createdBy: string; fieldNames: string[]; ip?: string | null },
): Promise<CustomerDto> {
  const id = generateUlid();
  const now = Math.floor(Date.now() / 1000);
  const [rows] = await db.batch([
    db
      .insert(customers)
      .values({
        id,
        name: input.name,
        contactPerson: input.contactPerson,
        taxCode: input.taxCode,
        phone: input.phone,
        phoneNorm: input.phoneNorm,
        email: input.email,
        address: input.address,
        createdBy: input.createdBy,
        createdAt: now,
        updatedAt: now,
        version: 1,
      })
      .returning(),
    auditInsert(db, {
      actor: input.createdBy,
      action: "customer.created",
      target: `customer:${id}`,
      metadata: { fields: input.fieldNames },
      ip: input.ip,
      ts: now,
    }),
  ]);
  const row = rows[0];
  if (row === undefined) throw new Error("insertCustomer: insert returned no rows");
  return toDto(row);
}

/**
 * CAS update + `customer.updated` audit row in one batch. Returns null when 0 rows matched (missing id or
 * stale version — the caller tells them apart). The audit row is guarded by SQLite `changes()`, which after
 * the UPDATE is 1 only if THIS update won; so a lost CAS never leaves an audit row. Throws on UNIQUE violation.
 * `patch` holds only the columns being changed; `fieldNames` are API field names (never values).
 */
export async function updateCustomerCas(
  db: Db,
  input: {
    id: string;
    expectedVersion: number;
    patch: Partial<CustomerFields>;
    fieldNames: string[];
    actor: string;
    ip?: string | null;
  },
): Promise<CustomerDto | null> {
  const now = Math.floor(Date.now() / 1000);
  const auditId = generateUlid();
  const metadata = JSON.stringify({ fields: input.fieldNames });
  const [rows] = await db.batch([
    db
      .update(customers)
      .set({ ...input.patch, updatedAt: now, version: sql`${customers.version} + 1` })
      .where(and(eq(customers.id, input.id), eq(customers.version, input.expectedVersion)))
      .returning(),
    // drizzle's batch takes query builders only (a raw `db.run` breaks it), hence INSERT … SELECT.
    db.insert(auditEvents).select(
      db
        .select({
          id: sql<string>`${auditId}`.as("id"),
          ts: sql<number>`${now}`.as("ts"),
          actor: sql<string>`${input.actor}`.as("actor"),
          action: sql<string>`${"customer.updated"}`.as("action"),
          target: sql<string>`${`customer:${input.id}`}`.as("target"),
          metadata: sql<string>`${metadata}`.as("metadata"),
          ip: sql<string | null>`${input.ip ?? null}`.as("ip"),
        })
        .from(customers)
        .where(and(eq(customers.id, input.id), sql`changes() > 0`)),
    ),
  ]);
  const row = rows[0];
  return row ? (await withIssued(db, [row]))[0]! : null;
}

interface CursorPos {
  name: string;
  id: string;
}

function encodeCursor(pos: CursorPos): string {
  const bytes = new TextEncoder().encode(JSON.stringify([pos.name, pos.id]));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Returns null for a malformed cursor. */
export function decodeCursor(cursor: string): CursorPos | null {
  try {
    const b64 = cursor.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    const arr = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)))) as unknown;
    if (Array.isArray(arr) && typeof arr[0] === "string" && typeof arr[1] === "string") {
      return { name: arr[0], id: arr[1] };
    }
  } catch {
    // fall through
  }
  return null;
}

/**
 * One query per page, ordered by name then id. `q` matches name (SQLite LIKE: ASCII case-insensitive only,
 * Vietnamese diacritics compare exactly), or phone_norm / tax_code exactly.
 */
export async function listCustomers(
  db: Db,
  input: { q?: string; phoneNorm?: string | null; after?: CursorPos; limit: number },
): Promise<{ items: CustomerDto[]; next_cursor: string | null }> {
  const q = input.q?.trim() ?? "";
  const nameLike = sql`${customers.name} LIKE ${`%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`} ESCAPE '\\'`;
  const filter =
    q === ""
      ? undefined
      : or(
          nameLike,
          input.phoneNorm != null ? eq(customers.phoneNorm, input.phoneNorm) : undefined,
          eq(customers.taxCode, q),
        );
  const after = input.after;
  const keyset =
    after === undefined
      ? undefined
      : or(
          gt(customers.name, after.name),
          and(eq(customers.name, after.name), gt(customers.id, after.id)),
        );
  const rows = await db
    .select()
    .from(customers)
    .where(and(filter, keyset))
    .orderBy(asc(customers.name), asc(customers.id))
    .limit(input.limit + 1);
  const hasMore = rows.length > input.limit;
  const page = hasMore ? rows.slice(0, input.limit) : rows;
  const last = page[page.length - 1];
  return {
    items: await withIssued(db, page),
    next_cursor: hasMore && last ? encodeCursor({ name: last.name, id: last.id }) : null,
  };
}
