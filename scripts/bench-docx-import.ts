#!/usr/bin/env tsx
/**
 * PLAN-10 P-12 / R-6 — CPU bench of the pure converter on the 3 box files (Workers' performance.now() is frozen
 * during CPU work, so we measure the same pure function in Node). Target: median ≤ 5 ms per file (Free plan 10 ms).
 *
 *   pnpm tsx scripts/bench-docx-import.ts
 *
 * 10 warm-up rounds, then 50 timed rounds per file; prints median / p95 in ms. Exit 1 when a median is over budget.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { convertDocx } from "../apps/api/src/domain/docx/index";

const DIR = resolve(process.cwd(), "apps/api/test/fixtures/docx"); // run from the repo root
const FILES = ["Bao_Gia.docx", "Hop_Dong_Dich_Vu.docx", "De_Nghi_Thanh_Toan.docx"];
const WARMUP = 10;
const ROUNDS = 50;
const BUDGET_MS = 5;

const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;

let over = false;
for (const name of FILES) {
  const bytes = new Uint8Array(readFileSync(join(DIR, name)));
  for (let i = 0; i < WARMUP; i++) convertDocx(bytes);
  const times: number[] = [];
  for (let i = 0; i < ROUNDS; i++) {
    const t0 = performance.now();
    const r = convertDocx(bytes);
    times.push(performance.now() - t0);
    if ("error" in r) throw new Error(`${name}: ${r.error}`);
  }
  times.sort((a, b) => a - b);
  const med = pct(times, 50);
  if (med > BUDGET_MS) over = true;
  console.log(`${name.padEnd(26)} ${(bytes.length / 1024).toFixed(1).padStart(6)} KB  median ${med.toFixed(3)} ms  p95 ${pct(times, 95).toFixed(3)} ms`);
}
console.log(over ? `OVER BUDGET (median > ${BUDGET_MS} ms)` : `ok (every median ≤ ${BUDGET_MS} ms)`);
process.exit(over ? 1 : 0);
