/**
 * Products + dated price levels (SPEC-08 FR-1/2/3/7/8, DEC-1/5/6/11; PLAN-08 §2b, P-3, P-6). No Hono: typed outcomes.
 *
 * Dates are the business day in Vietnam (`todayInVN(now)`), the same rule as the D1 triggers. The date rules are
 * checked here FIRST so the caller gets a clear 422; the triggers are the second lock (their RAISE is mapped too).
 * Prices on read come only from the pure functions of C-08-002 (`levelAt` / `withEffectiveTo` / `levelStatus` /
 * `unitPriceIncVat`).
 */
import type { Db } from "../db/client";
import type {
  AddPriceInput,
  CreateProductInput,
  LevelDto,
  PatchProductInput,
  ProductDetailDto,
  ProductDto,
} from "../dto/products";
import { DURATION_MAX } from "../dto/products";
import { writeAuditEvent } from "../dao/audit-dao";
import { isUniqueViolation } from "../dao/customer-dao";
import {
  codeExists,
  d1ErrorHas,
  deleteScheduledLevel,
  getLevel,
  getProduct,
  insertLevel,
  insertProduct,
  levelExists,
  listLevels,
  listProductsWithLevels,
  RAISE_BACKDATED,
  RAISE_IN_EFFECT,
  updateProductCas,
  type LevelRowDto,
  type ProductPatch,
  type ProductRowDto,
} from "../dao/product-dao";
import { unitPriceIncVat } from "../domain/money/line-pricing";
import { levelAt, levelStatus, withEffectiveTo } from "../domain/money/price-at";
import { generateUlid } from "../utils/id";
import { todayInVN } from "../utils/vn-date";

/** PLAN-08 P-6: at most 500 products. */
export const PRODUCT_LIMIT = 500;

export interface ProductDeps {
  db: Db;
}

/** The caller, as the route sees it (permissions = the principal's, for `can` hints and the first_price check). */
export interface ProductActor {
  id: string;
  permissions: readonly string[];
  ip: string | null;
}

export type ValidationErrors = Array<{ path: string; message: string }>;
type Invalid = { kind: "invalid"; errors: ValidationErrors };

const unixSeconds = (d: Date) => Math.floor(d.getTime() / 1000);

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------- read

function toLevelDto(l: LevelRowDto & { effective_to: string | null }): LevelDto {
  return {
    id: l.id,
    effective_from: l.effective_from,
    effective_to: l.effective_to,
    unit_price_ex_vat: l.unit_price_ex_vat,
    vat_rate_bps: l.vat_rate_bps as LevelDto["vat_rate_bps"],
    unit_price_inc_vat: unitPriceIncVat(l.unit_price_ex_vat, l.vat_rate_bps),
  };
}

/** `Product` at `date`: the level in force (greatest effective_from ≤ date) and the first one after it. */
function productView(p: ProductRowDto, levels: readonly LevelRowDto[], date: string, actor: ProductActor): ProductDto {
  const dated = withEffectiveTo(levels); // newest first
  const current = levelAt(dated, date);
  let next: (typeof dated)[number] | null = null;
  for (const l of dated) if (l.effective_from > date) next = l; // newest-first scan → ends at the earliest future one
  return {
    ...p,
    price: current === null ? null : toLevelDto(current),
    next_price: next === null ? null : toLevelDto(next),
    can: { edit: actor.permissions.includes("product:write"), price: actor.permissions.includes("price:write") },
  };
}

export async function listProducts(
  deps: ProductDeps,
  actor: ProductActor,
  input: { date?: string; kind?: "service" | "goods"; active?: "true" | "false"; q?: string; limit: number },
  now: Date,
): Promise<{ date: string; items: ProductDto[] }> {
  const date = input.date ?? todayInVN(now);
  const res = await listProductsWithLevels(deps.db, {
    kind: input.kind,
    active: input.active === undefined ? undefined : input.active === "true",
    q: input.q,
    limit: input.limit,
  });
  const byProduct = new Map<string, LevelRowDto[]>();
  for (const l of res.levels) {
    const list = byProduct.get(l.product_id);
    if (list === undefined) byProduct.set(l.product_id, [l]);
    else list.push(l);
  }
  return { date, items: res.products.map((p) => productView(p, byProduct.get(p.id) ?? [], date, actor)) };
}

async function loadView(db: Db, actor: ProductActor, id: string, today: string): Promise<ProductDto | null> {
  const p = await getProduct(db, id);
  return p === null ? null : productView(p, await listLevels(db, id), today, actor);
}

export async function getProductDetail(
  deps: ProductDeps,
  actor: ProductActor,
  id: string,
  now: Date,
): Promise<ProductDetailDto | null> {
  const p = await getProduct(deps.db, id);
  if (p === null) return null;
  const today = todayInVN(now);
  const levels = await listLevels(deps.db, id);
  return {
    ...productView(p, levels, today, actor),
    prices: withEffectiveTo(levels).map((l) => ({
      ...toLevelDto(l),
      status: levelStatus(l, levels, today),
      created_by_name: l.created_by_name,
    })),
  };
}

// ---------------------------------------------------------------- create

export type CreateResult =
  | { kind: "ok"; product: ProductDto }
  | { kind: "forbidden" }
  | { kind: "price-backdated" }
  | { kind: "duplicate" }
  | { kind: "product-limit" };

/** Error order (PLAN-08 §2b): [schema 422 in the route] → 403 first_price without price:write → 422 price-backdated → 409 duplicate → 409 product-limit. */
export async function createProduct(
  deps: ProductDeps,
  actor: ProductActor,
  input: CreateProductInput & { path: string },
  now: Date,
): Promise<CreateResult> {
  const { db } = deps;
  const fp = input.first_price ?? null;
  if (fp !== null && !actor.permissions.includes("price:write")) {
    await writeAuditEvent(db, {
      actor: actor.id,
      action: "permission.denied",
      target: input.path,
      metadata: { permission: "price:write", method: "POST", path: input.path },
      ip: actor.ip,
    });
    return { kind: "forbidden" };
  }
  const today = todayInVN(now);
  // DEC-5 B: the first level of a new product starts today at the earliest.
  if (fp !== null && fp.effective_from < today) return { kind: "price-backdated" };

  const code = input.code.trim().toUpperCase(); // already normalised by the schema; kept explicit (DEC: code_norm = trim + upper)
  const id = generateUlid();
  let inserted: string | null;
  try {
    inserted = await insertProduct(db, {
      id,
      kind: input.kind,
      code,
      name: input.name,
      unit: input.unit,
      durationValue: input.kind === "service" ? (input.duration_value ?? null) : null,
      durationUnit: input.kind === "service" ? (input.duration_unit ?? null) : null,
      firstPrice: fp,
      actorId: actor.id,
      ip: actor.ip,
      now: unixSeconds(now),
      limit: PRODUCT_LIMIT,
    });
  } catch (err) {
    if (isUniqueViolation(err)) return { kind: "duplicate" };
    throw err;
  }
  if (inserted === null) {
    // The limit refused the row before UNIQUE could fire: a taken code still answers `duplicate` (error order).
    return (await codeExists(db, code)) ? { kind: "duplicate" } : { kind: "product-limit" };
  }
  const product = await loadView(db, actor, id, today);
  if (product === null) throw new Error("product vanished right after create");
  return { kind: "ok", product };
}

// ---------------------------------------------------------------- edit

export type PatchResult = { kind: "ok"; product: ProductDto } | { kind: "not-found" } | { kind: "stale" } | Invalid;

export async function patchProduct(
  deps: ProductDeps,
  actor: ProductActor,
  input: PatchProductInput & { id: string },
  now: Date,
): Promise<PatchResult> {
  const { db } = deps;
  const today = todayInVN(now);
  const current = await getProduct(db, input.id);
  if (current === null) return { kind: "not-found" };
  if (current.version !== input.expected_version) return { kind: "stale" };

  // duration vs kind (kind never changes, so reading it is not a race; the CAS + D1 CHECK hold the rest)
  const sendsDuration = input.duration_value !== undefined || input.duration_unit !== undefined;
  if (current.kind === "goods" && sendsDuration) {
    return { kind: "invalid", errors: [{ path: "duration_value", message: "goods have no duration" }] };
  }
  if (current.kind === "service" && sendsDuration) {
    const unit = input.duration_unit ?? current.duration_unit ?? "month";
    const value = input.duration_value ?? current.duration_value ?? 0;
    if (value < 1 || value > DURATION_MAX[unit]) {
      return { kind: "invalid", errors: [{ path: "duration_value", message: `at most ${DURATION_MAX[unit]} ${unit}s` }] };
    }
  }

  const patch: ProductPatch = {};
  const fields: string[] = [];
  if (input.name !== undefined && input.name !== current.name) {
    patch.name = input.name;
    fields.push("name");
  }
  if (input.unit !== undefined && input.unit !== current.unit) {
    patch.unit = input.unit;
    fields.push("unit");
  }
  if (input.duration_value !== undefined && input.duration_value !== current.duration_value) {
    patch.durationValue = input.duration_value;
    fields.push("duration_value");
  }
  if (input.duration_unit !== undefined && input.duration_unit !== current.duration_unit) {
    patch.durationUnit = input.duration_unit;
    fields.push("duration_unit");
  }
  let activeAction: "product.deactivated" | "product.reactivated" | null = null;
  if (input.active !== undefined && input.active !== current.active) {
    patch.active = input.active;
    activeAction = input.active ? "product.reactivated" : "product.deactivated";
  }
  if (fields.length === 0 && activeAction === null) {
    // Nothing differs: no write, no audit row, no version bump.
    return { kind: "ok", product: productView(current, await listLevels(db, input.id), today, actor) };
  }

  const version = await updateProductCas(db, {
    id: input.id,
    code: current.code,
    expectedVersion: input.expected_version,
    patch,
    fields,
    activeAction,
    actorId: actor.id,
    ip: actor.ip,
    now: unixSeconds(now),
  });
  if (version === null) return (await getProduct(db, input.id)) === null ? { kind: "not-found" } : { kind: "stale" };
  const product = await loadView(db, actor, input.id, today);
  if (product === null) return { kind: "not-found" };
  return { kind: "ok", product };
}

// ---------------------------------------------------------------- levels

export type AddPriceResult =
  | { kind: "ok"; level: LevelDto }
  | { kind: "not-found" }
  | { kind: "price-backdated" }
  | { kind: "duplicate" };

/** DEC-5 B: ≥ tomorrow when the product already has a level; ≥ today for its first one. */
export async function addPrice(
  deps: ProductDeps,
  actor: ProductActor,
  input: AddPriceInput & { productId: string },
  now: Date,
): Promise<AddPriceResult> {
  const { db } = deps;
  const product = await getProduct(db, input.productId);
  if (product === null) return { kind: "not-found" };
  const today = todayInVN(now);
  const existing = await listLevels(db, input.productId);
  const earliest = existing.length > 0 ? addDays(today, 1) : today;
  if (input.effective_from < earliest) return { kind: "price-backdated" };

  let id: string;
  try {
    id = await insertLevel(db, {
      productId: input.productId,
      code: product.code,
      price: { unit_price_ex_vat: input.unit_price_ex_vat, vat_rate_bps: input.vat_rate_bps, effective_from: input.effective_from },
      actorId: actor.id,
      ip: actor.ip,
      now: unixSeconds(now),
    });
  } catch (err) {
    if (isUniqueViolation(err)) return { kind: "duplicate" };
    if (d1ErrorHas(err, RAISE_BACKDATED)) return { kind: "price-backdated" };
    throw err;
  }
  const level = withEffectiveTo(await listLevels(db, input.productId)).find((l) => l.id === id);
  if (level === undefined) throw new Error("price level vanished right after insert");
  return { kind: "ok", level: toLevelDto(level) };
}

export type CancelPriceResult = { kind: "ok" } | { kind: "not-found" } | { kind: "price-in-effect" };

/** DEC-6: only a level that has not started yet (effective_from > today) can be cancelled. */
export async function cancelPrice(
  deps: ProductDeps,
  actor: ProductActor,
  input: { productId: string; priceId: string },
  now: Date,
): Promise<CancelPriceResult> {
  const { db } = deps;
  const level = await getLevel(db, input);
  if (level === null) return { kind: "not-found" };
  const today = todayInVN(now);
  if (level.effective_from <= today) return { kind: "price-in-effect" };
  let deleted: boolean;
  try {
    deleted = await deleteScheduledLevel(db, {
      productId: input.productId,
      priceId: input.priceId,
      today,
      code: level.code,
      price: {
        unit_price_ex_vat: level.unit_price_ex_vat,
        vat_rate_bps: level.vat_rate_bps,
        effective_from: level.effective_from,
      },
      actorId: actor.id,
      ip: actor.ip,
      now: unixSeconds(now),
    });
  } catch (err) {
    if (d1ErrorHas(err, RAISE_IN_EFFECT)) return { kind: "price-in-effect" };
    throw err;
  }
  if (deleted) return { kind: "ok" };
  return (await levelExists(db, input)) ? { kind: "price-in-effect" } : { kind: "not-found" };
}
