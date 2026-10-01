/** SPEC-05 §3.1: the PDF state a contract row implies (no stored status column). */
export type PdfStatus = "none" | "pending" | "ready";

/** none = not issued · pending = issued, made on the first "Tải PDF" · ready = stored in R2. */
export function pdfStatusOf(row: { status: string; pdfKey: string | null }): PdfStatus {
  if (row.status !== "issued" && row.status !== "voided") return "none";
  return row.pdfKey !== null ? "ready" : "pending";
}
