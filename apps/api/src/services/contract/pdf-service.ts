/**
 * PDF of an issued/voided contract, made on the first "Tải PDF" (SPEC-05 §3.2) and served from R2 afterwards.
 * Generation: Frozen `rendered_html` (never the void band) →
 * renderer → R2 put under a fresh ULID key → CAS + audit in one batch; a lost CAS deletes the object just put.
 */
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { getPdfJobRow, savePdfCas } from "../../dao/contract-pdf-dao";
import type { Db } from "../../db/client";
import type { PdfRenderer } from "../../ports/pdf-renderer-port";
import { generateUlid } from "../../utils/id";
import { renderContract } from "./render-service";

export type GeneratePdfResult =
  | { kind: "stored"; size: number }
  | { kind: "skipped"; reason: "not-found" | "wrong-state" | "has-pdf" | "lost-race" };

export async function generateContractPdf(
  deps: { db: Db; files: R2Bucket; renderer: PdfRenderer; now: () => number },
  id: string,
): Promise<GeneratePdfResult> {
  const { db, files, renderer } = deps;
  const row = await getPdfJobRow(db, id);
  if (row === null) return { kind: "skipped", reason: "not-found" };
  if (row.status !== "issued" && row.status !== "voided") return { kind: "skipped", reason: "wrong-state" };
  if (row.pdfKey !== null) return { kind: "skipped", reason: "has-pdf" };

  let html = row.renderedHtml;
  if (html === null) {
    // paper never stored (render failed at issue): build + store it once, then print the frozen copy
    const r = await renderContract(db, id);
    if (r.kind === "not-found") return { kind: "skipped", reason: "not-found" };
    html = (await getPdfJobRow(db, id))?.renderedHtml ?? r.html;
  }

  const bytes = await renderer.render(html);
  const key = `contracts/${id}/${generateUlid()}.pdf`;
  await files.put(key, bytes, { httpMetadata: { contentType: "application/pdf" } });

  let won = false;
  try {
    won = await savePdfCas(db, { id, key, hash: bytesToHex(sha256(bytes)), size: bytes.byteLength, now: deps.now() });
  } catch (err) {
    await files.delete(key).catch(() => undefined);
    throw err;
  }
  if (!won) {
    await files.delete(key);
    return { kind: "skipped", reason: "lost-race" };
  }
  return { kind: "stored", size: bytes.byteLength };
}

export type ContractPdfResult =
  | { kind: "ok"; body: ReadableStream; filename: string; etag: string; size: number }
  | { kind: "not-found" }
  | { kind: "state-conflict"; current: string };

/**
 * Download: stored file if any, else generate now (renderer errors propagate → the route answers 503; the
 * contract itself is never touched). Two clicks at once both render; the CAS keeps one file and both get it.
 * A voided contract serves its original file (INTENT-05 Q-2).
 */
export async function getContractPdf(
  deps: { db: Db; files: R2Bucket; renderer: PdfRenderer; now: () => number },
  id: string,
): Promise<ContractPdfResult> {
  let row = await getPdfJobRow(deps.db, id);
  if (row === null) return { kind: "not-found" };
  if (row.status !== "issued" && row.status !== "voided") return { kind: "state-conflict", current: row.status };

  if (row.pdfKey === null) {
    await generateContractPdf(deps, id);
    row = await getPdfJobRow(deps.db, id);
    if (row?.pdfKey == null) throw new Error(`contract pdf was not stored: ${id}`);
  }
  const object = await deps.files.get(row.pdfKey);
  // The row says stored but the object is gone: corrupted storage, must be seen (500).
  if (object === null) throw new Error(`contract pdf object missing in R2: ${id}`);
  return { kind: "ok", body: object.body, filename: `${row.number}.pdf`, etag: row.pdfHash!, size: object.size };
}
