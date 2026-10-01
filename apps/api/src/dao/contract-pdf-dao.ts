/**
 * Contract PDF DAO (SPEC-05 §3.1/§3.2). Pure `(db, input)` functions.
 *
 * `savePdfCas` = ONE batch of (1) `UPDATE … WHERE pdf_key IS NULL AND status IN ('issued','voided') RETURNING` and
 * (2) an `INSERT … SELECT` audit row guarded by `changes() > 0` (it directly follows the UPDATE, as in `voidCas`), so
 * the `contract.pdf_generated` row exists iff this attempt won the CAS — two concurrent jobs yield exactly one row.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { auditEvents, contracts } from "../db/schema";
import { generateUlid } from "../utils/id";

export interface PdfJobRow {
  status: string;
  number: string | null;
  pdfKey: string | null;
  pdfHash: string | null;
  renderedHtml: string | null;
}

export async function getPdfJobRow(db: Db, id: string): Promise<PdfJobRow | null> {
  const [row] = await db
    .select({
      status: contracts.status,
      number: contracts.number,
      pdfKey: contracts.pdfKey,
      pdfHash: contracts.pdfHash,
      renderedHtml: contracts.renderedHtml,
    })
    .from(contracts)
    .where(eq(contracts.id, id))
    .limit(1);
  return row ?? null;
}

export interface SavePdfInput {
  id: string;
  key: string;
  hash: string;
  size: number;
  /** unix seconds */
  now: number;
}

/** True = this attempt stored the PDF (and its audit row); false = lost (already has a PDF / wrong state). */
export async function savePdfCas(db: Db, input: SavePdfInput): Promise<boolean> {
  const [moved] = await db.batch([
    db
      .update(contracts)
      .set({ pdfKey: input.key, pdfHash: input.hash, pdfSize: input.size, pdfAt: input.now })
      .where(and(eq(contracts.id, input.id), isNull(contracts.pdfKey), inArray(contracts.status, ["issued", "voided"])))
      .returning({ id: contracts.id }),
    // must directly follow the UPDATE: changes() refers to the previous statement
    db.insert(auditEvents).select(
      db
        .select({
          id: sql<string>`${generateUlid()}`.as("id"),
          ts: sql<number>`${input.now}`.as("ts"),
          actor: sql<string | null>`NULL`.as("actor"),
          action: sql<string>`${"contract.pdf_generated"}`.as("action"),
          target: sql<string>`${input.id}`.as("target"),
          metadata: sql<string>`json_object('size', ${input.size})`.as("metadata"),
          ip: sql<string | null>`NULL`.as("ip"),
        })
        .from(contracts)
        .where(and(eq(contracts.id, input.id), sql`changes() > 0`)),
    ),
  ]);
  return moved.length > 0;
}
