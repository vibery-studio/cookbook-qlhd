/** SPEC-05 FR-5: the fields `GET /contracts/{id}/pdf` needs. Pure `(db, input) → DTO`. */
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { contracts } from "../db/schema";

export interface ContractPdfInfo {
  status: string;
  number: string | null;
  pdfKey: string | null;
  pdfHash: string | null;
  pdfFailedAt: number | null;
}

export async function getContractPdfInfo(db: Db, id: string): Promise<ContractPdfInfo | null> {
  const [row] = await db
    .select({
      status: contracts.status,
      number: contracts.number,
      pdfKey: contracts.pdfKey,
      pdfHash: contracts.pdfHash,
      pdfFailedAt: contracts.pdfFailedAt,
    })
    .from(contracts)
    .where(eq(contracts.id, id))
    .limit(1);
  return row ?? null;
}
