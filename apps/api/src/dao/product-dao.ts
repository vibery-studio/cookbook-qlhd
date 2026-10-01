/**
 * Products + dated price levels DAO (SPEC-08 FR-1/2/3/8, PLAN-08 §2b). Pure `(db, input)` functions: readers return
 * plain DTOs; writers either execute ONE `db.batch` (change + audit) or return unexecuted statements for it.
 *
 * Races never use check-then-write: product create = `INSERT … SELECT … WHERE (count) < limit` + UNIQUE `code_norm`;
 * edit = CAS on `version` (audit rows first, guarded by the same predicate, CAS last — the `role-write-dao` pattern);
 * new level = plain INSERT (UNIQUE `(product_id, effective_from)` + the backdate trigger); cancel = guarded
 * `DELETE … RETURNING` (+ the in-effect trigger). The caller maps D1 errors via `isUniqueViolation` / `d1ErrorHas`.
 */
import { and, eq, gt, sql, type SQL } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { Db } from "../db/client";
import { productPrices, products, users } from "../db/schema";
import { generateUlid } from "../utils/id";
import { auditInsert } from "./audit-dao";
import { auditWhenStmt } from "./role-write-dao";

export interface ProductRowDto {
  id: string;
  kind: "service" | "goods";
  code: string;
  name: string;
  unit: string;
  duration_value: number | null;
  duration_unit: "day" | "month" | null;
  active: boolean;
  version: number;
}

export interface LevelRowDto {
  id: string;
  product_id: string;
  effective_from: string;
  unit_price_ex_vat: number;
  vat_rate_bps: number | null;
  created_by_name: string | null;
}

const productCols = {
  id: products.id,
  kind: products.kind,
  code: products.code,
  name: products.name,
  unit: products.unit,
  durationValue: products.durationValue,
  durationUnit: products.durationUnit,
  active: products.active,
  version: products.version,
};

type ProductSel = {
  id: string;
  kind: string;
  code: string;
  name: string;
  unit: string;
  durationValue: number | null;
  durationUnit: string | null;
  active: number;
  version: number;
};

function toProduct(r: ProductSel): ProductRowDto {
  return {
    id: r.id,
    kind: r.kind as ProductRowDto["kind"],
    code: r.code,
    name: r.name,
    unit: r.unit,
    duration_value: r.durationValue,
    duration_unit: r.durationUnit as ProductRowDto["duration_unit"],
    active: r.active === 1,
    version: r.version,
  };
}

const levelCols = {
  id: productPrices.id,
  productId: productPrices.productId,
  effectiveFrom: productPrices.effectiveFrom,
  unitPriceExVat: productPrices.unitPriceExVat,
  vatRateBps: productPrices.vatRateBps,
  createdByName: users.displayName,
};

function toLevel(r: {
  id: string;
  productId: string;
  effectiveFrom: string;
  unitPriceExVat: number;
  vatRateBps: number | null;
  createdByName: string | null;
}): LevelRowDto {
  return {
    id: r.id,
    product_id: r.productId,
    effective_from: r.effectiveFrom,
    unit_price_ex_vat: r.unitPriceExVat,
    vat_rate_bps: r.vatRateBps,
    created_by_name: r.createdByName,
  };
}

/** `%`, `_`, `\` taken literally in LIKE (codes contain `_`). */
const likeArg = (s: string) => `%${s.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;

/**
 * Products (services first, then by code) + every level of those products — two queries. `q` matches the
 * normalised code (upper-cased) or `lower(name)` (SQLite lowers ASCII only, so diacritics are kept as typed).
 */
export async function listProductsWithLevels(
  db: Db,
  input: { kind?: "service" | "goods"; active?: boolean; q?: string; limit: number },
): Promise<{ products: ProductRowDto[]; levels: LevelRowDto[] }> {
  const where: SQL[] = [];
  if (input.kind !== undefined) where.push(eq(products.kind, input.kind));
  if (input.active !== undefined) where.push(eq(products.active, input.active ? 1 : 0));
  if (input.q !== undefined && input.q !== "") {
    where.push(
      sql`(${products.codeNorm} LIKE ${likeArg(input.q.toUpperCase())} ESCAPE '\\' OR lower(${products.name}) LIKE ${likeArg(input.q.toLowerCase())} ESCAPE '\\')`,
    );
  }
  const rows = await db
    .select(productCols)
    .from(products)
    .where(where.length > 0 ? and(...where) : undefined)
    .orderBy(sql`CASE ${products.kind} WHEN 'service' THEN 0 ELSE 1 END`, products.codeNorm)
    .limit(input.limit);
  if (rows.length === 0) return { products: [], levels: [] };
  const ids = JSON.stringify(rows.map((r) => r.id));
  const levels = await db
    .select(levelCols)
    .from(productPrices)
    .leftJoin(users, eq(users.id, productPrices.createdBy))
    .where(sql`${productPrices.productId} IN (SELECT value FROM json_each(${ids}))`);
  return { products: rows.map(toProduct), levels: levels.map(toLevel) };
}

export async function getProduct(db: Db, id: string): Promise<ProductRowDto | null> {
  const rows = await db.select(productCols).from(products).where(eq(products.id, id)).limit(1);
  return rows[0] ? toProduct(rows[0]) : null;
}

export async function listLevels(db: Db, productId: string): Promise<LevelRowDto[]> {
  const rows = await db
    .select(levelCols)
    .from(productPrices)
    .leftJoin(users, eq(users.id, productPrices.createdBy))
    .where(eq(productPrices.productId, productId));
  return rows.map(toLevel);
}

/** One level with its product's code (for the cancel audit row), or null. */
export async function getLevel(
  db: Db,
  input: { productId: string; priceId: string },
): Promise<(LevelRowDto & { code: string }) | null> {
  const rows = await db
    .select({ ...levelCols, code: products.code })
    .from(productPrices)
    .innerJoin(products, eq(products.id, productPrices.productId))
    .leftJoin(users, eq(users.id, productPrices.createdBy))
    .where(and(eq(productPrices.id, input.priceId), eq(productPrices.productId, input.productId)))
    .limit(1);
  return rows[0] ? { ...toLevel(rows[0]), code: rows[0].code } : null;
}

export async function codeExists(db: Db, codeNorm: string): Promise<boolean> {
  const rows = await db.select({ id: products.id }).from(products).where(eq(products.codeNorm, codeNorm)).limit(1);
  return rows.length > 0;
}

/** True when the D1 error (or one of its causes) carries `text` — trigger RAISE messages. */
export function d1ErrorHas(err: unknown, text: string): boolean {
  for (let e: unknown = err, i = 0; e != null && i < 5; i++) {
    const msg = e instanceof Error ? e.message : typeof e === "string" ? e : "";
    if (msg.includes(text)) return true;
    e = e instanceof Error ? e.cause : undefined;
  }
  return false;
}

export const RAISE_BACKDATED = "backdated price refused";
export const RAISE_IN_EFFECT = "a price in effect cannot be deleted";

type Batch = [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]];

export interface PriceInput {
  unit_price_ex_vat: number;
  vat_rate_bps: number | null;
  effective_from: string;
}

/**
 * New product (+ optional first level) + `product.created` (+ `price.added`) in ONE batch. The product row is
 * inserted only while there are fewer than `limit` products; the level and both audit rows only when that row now
 * exists (fresh id → true only for this batch). UNIQUE `code_norm` throws (whole batch rolls back).
 * Returns the inserted id, or null when the limit refused it.
 */
export async function insertProduct(
  db: Db,
  input: {
    id: string;
    kind: "service" | "goods";
    code: string;
    name: string;
    unit: string;
    durationValue: number | null;
    durationUnit: "day" | "month" | null;
    firstPrice: PriceInput | null;
    actorId: string;
    ip: string | null;
    now: number;
    limit: number;
  },
): Promise<string | null> {
  const exists = sql`EXISTS (SELECT 1 FROM products xp WHERE xp.id = ${input.id})`;
  // Column order = table order: id, kind, code, code_norm, name, unit, duration_value, duration_unit, active, version,
  // created_by, created_at, updated_at.
  const stmts: Batch = [
    db
      .insert(products)
      .select(
        sql`SELECT ${input.id}, ${input.kind}, ${input.code}, ${input.code}, ${input.name}, ${input.unit}, ${input.durationValue}, ${input.durationUnit}, 1, 1, ${input.actorId}, ${input.now}, ${input.now} WHERE (SELECT COUNT(*) FROM products lp) < ${input.limit}`,
      )
      .returning({ id: products.id }),
  ];
  const fp = input.firstPrice;
  if (fp !== null) {
    // Column order: id, product_id, effective_from, unit_price_ex_vat, vat_rate_bps, created_by, created_at.
    stmts.push(
      db
        .insert(productPrices)
        .select(
          sql`SELECT ${generateUlid()}, ${input.id}, ${fp.effective_from}, ${fp.unit_price_ex_vat}, ${fp.vat_rate_bps}, ${input.actorId}, ${input.now} WHERE ${exists}`,
        ),
    );
  }
  const target = `product:${input.id}`;
  stmts.push(
    auditWhenStmt(db, {
      actor: input.actorId,
      action: "product.created",
      target,
      metadata: { code: input.code, kind: input.kind },
      ip: input.ip,
      ts: input.now,
      when: exists,
    }),
  );
  if (fp !== null) {
    stmts.push(
      auditWhenStmt(db, {
        actor: input.actorId,
        action: "price.added",
        target,
        metadata: { code: input.code, ...priceMeta(fp) },
        ip: input.ip,
        ts: input.now,
        when: exists,
      }),
    );
  }
  const results: unknown[] = await db.batch(stmts);
  const inserted = results[0];
  return Array.isArray(inserted) && inserted.length > 0 ? input.id : null;
}

const priceMeta = (p: PriceInput) => ({
  effective_from: p.effective_from,
  unit_price_ex_vat: p.unit_price_ex_vat,
  vat_rate_bps: p.vat_rate_bps,
});

export interface ProductPatch {
  name?: string;
  unit?: string;
  durationValue?: number;
  durationUnit?: "day" | "month";
  active?: boolean;
}

/**
 * CAS edit: audit rows first (each guarded by "still at expectedVersion"), the `version + 1` UPDATE last.
 * Returns the new version, or null when the CAS matched nothing (unknown id or stale).
 */
export async function updateProductCas(
  db: Db,
  input: {
    id: string;
    code: string;
    expectedVersion: number;
    patch: ProductPatch;
    /** API names of the changed non-`active` fields (→ `product.updated`). */
    fields: string[];
    /** `active` flipped → `product.deactivated` | `product.reactivated`. */
    activeAction: "product.deactivated" | "product.reactivated" | null;
    actorId: string;
    ip: string | null;
    now: number;
  },
): Promise<number | null> {
  const guard = sql`EXISTS (SELECT 1 FROM products gp WHERE gp.id = ${input.id} AND gp.version = ${input.expectedVersion})`;
  const target = `product:${input.id}`;
  const audits: BatchItem<"sqlite">[] = [];
  if (input.fields.length > 0) {
    audits.push(
      auditWhenStmt(db, {
        actor: input.actorId,
        action: "product.updated",
        target,
        metadata: { code: input.code, fields: input.fields },
        ip: input.ip,
        ts: input.now,
        when: guard,
      }),
    );
  }
  if (input.activeAction !== null) {
    audits.push(
      auditWhenStmt(db, {
        actor: input.actorId,
        action: input.activeAction,
        target,
        metadata: { code: input.code },
        ip: input.ip,
        ts: input.now,
        when: guard,
      }),
    );
  }
  const p = input.patch;
  const cas = db
    .update(products)
    .set({
      ...(p.name !== undefined && { name: p.name }),
      ...(p.unit !== undefined && { unit: p.unit }),
      ...(p.durationValue !== undefined && { durationValue: p.durationValue }),
      ...(p.durationUnit !== undefined && { durationUnit: p.durationUnit }),
      ...(p.active !== undefined && { active: p.active ? 1 : 0 }),
      version: sql`${products.version} + 1`,
      updatedAt: input.now,
    })
    .where(and(eq(products.id, input.id), eq(products.version, input.expectedVersion)))
    .returning({ version: products.version });
  const results: unknown[] = await db.batch([...audits, cas] as unknown as Batch);
  const last = results[results.length - 1];
  return Array.isArray(last) && last.length > 0 ? (last[0] as { version: number }).version : null;
}

/**
 * New level + `price.added` in ONE batch. Plain INSERT: UNIQUE `(product_id, effective_from)` and the backdate
 * trigger throw (whole batch rolls back, no audit row). Returns the new level id.
 */
export async function insertLevel(
  db: Db,
  input: { productId: string; code: string; price: PriceInput; actorId: string; ip: string | null; now: number },
): Promise<string> {
  const id = generateUlid();
  await db.batch([
    db.insert(productPrices).values({
      id,
      productId: input.productId,
      effectiveFrom: input.price.effective_from,
      unitPriceExVat: input.price.unit_price_ex_vat,
      vatRateBps: input.price.vat_rate_bps,
      createdBy: input.actorId,
      createdAt: input.now,
    }),
    auditInsert(db, {
      actor: input.actorId,
      action: "price.added",
      target: `product:${input.productId}`,
      metadata: { code: input.code, ...priceMeta(input.price) },
      ip: input.ip,
      ts: input.now,
    }),
  ]);
  return id;
}

/**
 * Cancel a scheduled level: `price.cancelled` (guarded) then `DELETE … WHERE effective_from > today RETURNING`.
 * The in-effect trigger is the second lock (throws). Returns true when a row was deleted.
 */
export async function deleteScheduledLevel(
  db: Db,
  input: {
    productId: string;
    priceId: string;
    today: string;
    code: string;
    price: PriceInput;
    actorId: string;
    ip: string | null;
    now: number;
  },
): Promise<boolean> {
  const where = and(
    eq(productPrices.id, input.priceId),
    eq(productPrices.productId, input.productId),
    gt(productPrices.effectiveFrom, input.today),
  );
  const guard = sql`EXISTS (SELECT 1 FROM product_prices dp WHERE dp.id = ${input.priceId} AND dp.product_id = ${input.productId} AND dp.effective_from > ${input.today})`;
  const results: unknown[] = await db.batch([
    auditWhenStmt(db, {
      actor: input.actorId,
      action: "price.cancelled",
      target: `product:${input.productId}`,
      metadata: { code: input.code, ...priceMeta(input.price) },
      ip: input.ip,
      ts: input.now,
      when: guard,
    }),
    db.delete(productPrices).where(where).returning({ id: productPrices.id }),
  ]);
  const deleted = results[1];
  return Array.isArray(deleted) && deleted.length > 0;
}

/** Does the level exist under the product (any date)? — classifies a refused cancel. */
export async function levelExists(db: Db, input: { productId: string; priceId: string }): Promise<boolean> {
  const rows = await db
    .select({ id: productPrices.id })
    .from(productPrices)
    .where(and(eq(productPrices.id, input.priceId), eq(productPrices.productId, input.productId)))
    .limit(1);
  return rows.length > 0;
}
