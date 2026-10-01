#!/usr/bin/env tsx
/**
 * DEMO products + price levels on the LOCAL dev D1 from scripts/data/products.demo.json — no dev server needed.
 *   RUNWAY_LOCAL=1 pnpm dev:seed-products [--replace]
 * Default: upsert products by code_norm (file wins; version+1 only when something changed), add missing price levels.
 *   A level the no-backdate trigger would refuse (past date on a product that already has levels) is skipped + reported.
 * --replace: delete the file's products + their prices, re-insert from the file; the 3 product_prices triggers are
 *   dropped and recreated from the very SQL read from sqlite_master, in the same single command. Contracts untouched.
 * Seed is a system action (like a migration): no audit event.
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { execLocalD1, execLocalD1Json, readTriggerSql, refuse as refuseWith, requireLocal } from "./lib/dev-seed.ts";
import { generateUlid } from "../apps/api/src/utils/id.ts";

const S = "dev-seed-products";
const refuse = (reason: string): never => refuseWith(S, reason);
requireLocal(S);

const { values } = parseArgs({ options: { replace: { type: "boolean", default: false } } });
const replace = values.replace === true;

interface Price { effective_from: string; unit_price_ex_vat: number; vat_rate_bps: number | null }
interface Product {
  code: string; kind: "service" | "goods"; name: string; unit: string;
  duration_value?: number | null; duration_unit?: "month" | "day" | null; active: boolean; demo?: boolean; prices: Price[];
}

const q = (v: string): string => `'${v.replace(/'/g, "''")}'`;
const qn = (v: string | number | null | undefined): string => (v === null || v === undefined ? "NULL" : typeof v === "number" ? String(v) : q(v));
const isDate = (s: unknown): s is string =>
  typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;

function load(): Product[] {
  const file = new URL("./data/products.demo.json", import.meta.url);
  const data = JSON.parse(readFileSync(file, "utf8")) as Product[];
  if (!Array.isArray(data) || data.length === 0) refuse("products.demo.json must be a non-empty array");
  const seen = new Set<string>();
  for (const p of data) {
    const w = `product '${p.code}'`;
    if (!/^[A-Z0-9._-]{1,32}$/.test(p.code)) refuse(`${w}: code must match [A-Z0-9._-]{1,32}`);
    if (seen.has(p.code)) refuse(`${w}: duplicate code`);
    seen.add(p.code);
    if (p.kind !== "service" && p.kind !== "goods") refuse(`${w}: kind must be service|goods`);
    if (typeof p.name !== "string" || p.name.length < 1 || p.name.length > 120) refuse(`${w}: name 1-120 chars`);
    if (typeof p.unit !== "string" || p.unit.length < 1 || p.unit.length > 20) refuse(`${w}: unit 1-20 chars`);
    if (typeof p.active !== "boolean") refuse(`${w}: active must be boolean`);
    if (p.kind === "goods") {
      if (p.duration_value != null || p.duration_unit != null) refuse(`${w}: goods must not have a duration`);
    } else {
      const v = p.duration_value, u = p.duration_unit;
      const ok = Number.isInteger(v) && ((u === "month" && v! >= 1 && v! <= 120) || (u === "day" && v! >= 1 && v! <= 3650));
      if (!ok) refuse(`${w}: service needs duration_value + duration_unit (month 1-120 | day 1-3650)`);
    }
    if (!Array.isArray(p.prices)) refuse(`${w}: prices must be an array`);
    const dates = new Set<string>();
    for (const l of p.prices) {
      if (!isDate(l.effective_from)) refuse(`${w}: invalid effective_from '${String(l.effective_from)}'`);
      if (dates.has(l.effective_from)) refuse(`${w}: duplicate effective_from ${l.effective_from}`);
      dates.add(l.effective_from);
      if (!Number.isInteger(l.unit_price_ex_vat) || l.unit_price_ex_vat < 0 || l.unit_price_ex_vat > 1_000_000_000_000) refuse(`${w}: unit_price_ex_vat must be integer 0..1e12`);
      if (l.vat_rate_bps !== null && ![0, 500, 800, 1000].includes(l.vat_rate_bps)) refuse(`${w}: vat_rate_bps must be one of 0,500,800,1000,null`);
    }
    p.prices.sort((a, b) => a.effective_from.localeCompare(b.effective_from));
  }
  return data;
}

const now = "CAST(strftime('%s','now') AS INTEGER)";
const dur = (p: Product): [string, string] => [qn(p.kind === "goods" ? null : p.duration_value), qn(p.kind === "goods" ? null : p.duration_unit)];
const priceSql = (p: Product, l: Price): string =>
  `INSERT OR IGNORE INTO product_prices (id, product_id, effective_from, unit_price_ex_vat, vat_rate_bps, created_by, created_at) ` +
  `SELECT ${q(generateUlid())}, id, ${q(l.effective_from)}, ${l.unit_price_ex_vat}, ${qn(l.vat_rate_bps)}, NULL, ${now} FROM products WHERE code_norm = ${q(p.code)};`;

function main(): void {
  const products = load();
  const codes = products.map((p) => q(p.code)).join(",");
  const stmts: string[] = [];

  if (replace) {
    const triggers = readTriggerSql(S, "product_prices");
    if (triggers.length !== 3) refuse(`expected 3 product_prices triggers in sqlite_master, found ${triggers.length} — migrate first (pnpm db:migrate:local)`);
    for (const t of triggers) stmts.push(`DROP TRIGGER IF EXISTS "${t.name}";`);
    stmts.push(`DELETE FROM product_prices WHERE product_id IN (SELECT id FROM products WHERE code_norm IN (${codes}));`);
    stmts.push(`DELETE FROM products WHERE code_norm IN (${codes});`);
    for (const p of products) {
      const [dv, du] = dur(p);
      stmts.push(
        `INSERT INTO products (id, kind, code, code_norm, name, unit, duration_value, duration_unit, active, version, created_by, created_at, updated_at) ` +
          `VALUES (${q(generateUlid())}, ${q(p.kind)}, ${q(p.code)}, ${q(p.code)}, ${q(p.name)}, ${q(p.unit)}, ${dv}, ${du}, ${p.active ? 1 : 0}, 1, NULL, ${now}, ${now});`,
      );
      for (const l of p.prices) stmts.push(priceSql(p, l));
    }
    for (const t of triggers) stmts.push(t.sql.trim().replace(/;?$/, ";"));
    execLocalD1(S, stmts.join("\n"));
    console.log(`--replace: ${products.length} products reset from products.demo.json; ${triggers.length} triggers restored`);
    return;
  }

  const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10); // business zone UTC+7, same as the trigger
  const existing = execLocalD1Json<{ code_norm: string; id: string }>(S, `SELECT code_norm, id FROM products WHERE code_norm IN (${codes})`);
  const have = new Map(existing.map((r) => [r.code_norm, r.id]));
  const levels = execLocalD1Json<{ code_norm: string; effective_from: string }>(
    S,
    `SELECT p.code_norm, pp.effective_from FROM product_prices pp JOIN products p ON p.id = pp.product_id WHERE p.code_norm IN (${codes})`,
  );
  const priced = new Map<string, Set<string>>();
  for (const r of levels) (priced.get(r.code_norm) ?? priced.set(r.code_norm, new Set()).get(r.code_norm)!).add(r.effective_from);

  const skipped: string[] = [];
  let added = 0;
  for (const p of products) {
    const [dv, du] = dur(p);
    if (have.has(p.code)) {
      stmts.push(
        `UPDATE products SET name = ${q(p.name)}, unit = ${q(p.unit)}, duration_value = ${dv}, duration_unit = ${du}, active = ${p.active ? 1 : 0}, ` +
          `version = version + 1, updated_at = ${now} WHERE code_norm = ${q(p.code)} AND ` +
          `(name IS NOT ${q(p.name)} OR unit IS NOT ${q(p.unit)} OR duration_value IS NOT ${dv} OR duration_unit IS NOT ${du} OR active IS NOT ${p.active ? 1 : 0});`,
      );
    } else {
      stmts.push(
        `INSERT INTO products (id, kind, code, code_norm, name, unit, duration_value, duration_unit, active, version, created_by, created_at, updated_at) ` +
          `VALUES (${q(generateUlid())}, ${q(p.kind)}, ${q(p.code)}, ${q(p.code)}, ${q(p.name)}, ${q(p.unit)}, ${dv}, ${du}, ${p.active ? 1 : 0}, 1, NULL, ${now}, ${now});`,
      );
    }
    const dates = priced.get(p.code) ?? new Set<string>();
    for (const l of p.prices) {
      if (dates.has(l.effective_from)) continue; // already there
      if (l.effective_from < today && dates.size > 0) {
        skipped.push(`${p.code} ${l.effective_from} (backdated; use --replace)`);
        continue;
      }
      stmts.push(priceSql(p, l));
      dates.add(l.effective_from);
      added++;
    }
  }
  execLocalD1(S, stmts.join("\n"));
  console.log(`seeded ${products.length} products (${have.size} existing synced, ${products.length - have.size} new), ${added} price levels added`);
  for (const s of skipped) console.log(`skipped: ${s}`);
}

main();
