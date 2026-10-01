/**
 * Download the stored PDF (SPEC-05 FR-5). Never renders: the file is made once by the contract-pdf job.
 * A voided contract still serves its original file (INTENT-05 Q-2).
 */
import { getContractPdfInfo } from "../../dao/contract-pdf-read-dao";
import type { Db } from "../../db/client";
import { pdfStatusOf } from "../../domain/contract/pdf";

export type PdfDownloadResult =
  | { kind: "ok"; body: ReadableStream; filename: string; etag: string; size: number }
  | { kind: "not-found" }
  | { kind: "state-conflict"; current: string }
  | { kind: "not-ready"; pdfStatus: "pending" | "failed" };

export async function downloadContractPdf(db: Db, files: R2Bucket, id: string): Promise<PdfDownloadResult> {
  const info = await getContractPdfInfo(db, id);
  if (info === null) return { kind: "not-found" };
  const status = pdfStatusOf(info);
  if (status === "none") return { kind: "state-conflict", current: info.status };
  if (status !== "ready") return { kind: "not-ready", pdfStatus: status };

  const object = await files.get(info.pdfKey!);
  // The row says ready but the object is gone: corrupted storage, must be seen (500), never silently re-queued.
  if (object === null) throw new Error(`contract pdf object missing in R2: ${id}`);
  return { kind: "ok", body: object.body, filename: `${info.number}.pdf`, etag: info.pdfHash!, size: object.size };
}
