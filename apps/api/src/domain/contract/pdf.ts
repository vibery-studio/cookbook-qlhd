/** SPEC-05 §3.1: the PDF state a contract row implies (no stored status column). */
export type PdfStatus = "none" | "pending" | "ready" | "failed";

export function pdfStatusOf(row: { status: string; pdfKey: string | null; pdfFailedAt: number | null }): PdfStatus {
  if (row.status !== "issued" && row.status !== "voided") return "none";
  if (row.pdfKey !== null) return "ready";
  return row.pdfFailedAt !== null ? "failed" : "pending";
}
