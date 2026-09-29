/** Read and one-time persistence helpers for the printable contract paper. */
import { and, eq, isNull, or } from "drizzle-orm";
import type { Db } from "../db/client";
import { contracts } from "../db/schema";
import type { ContractStatus, Snapshot } from "../domain/contract/types";

export interface ContractRenderDto {
  status: ContractStatus;
  snapshot: Snapshot;
  template_version_id: string;
  number: string | null;
  rendered_html: string | null;
  rendered_hash: string | null;
}

interface ContractRenderRow {
  status: string;
  snapshot: string;
  templateVersionId: string;
  number: string | null;
  renderedHtml: string | null;
  renderedHash: string | null;
}

function toDto(row: ContractRenderRow): ContractRenderDto {
  return {
    status: row.status as ContractStatus,
    snapshot: JSON.parse(row.snapshot) as Snapshot,
    template_version_id: row.templateVersionId,
    number: row.number,
    rendered_html: row.renderedHtml,
    rendered_hash: row.renderedHash,
  };
}

function renderColumns() {
  return {
    status: contracts.status,
    snapshot: contracts.snapshot,
    templateVersionId: contracts.templateVersionId,
    number: contracts.number,
    renderedHtml: contracts.renderedHtml,
    renderedHash: contracts.renderedHash,
  };
}

/** Return the immutable snapshot and the stored paper fields needed by rendering. */
export async function getContractForRender(db: Db, id: string): Promise<ContractRenderDto | null> {
  const [row] = await db.select(renderColumns()).from(contracts).where(eq(contracts.id, id)).limit(1);
  return row === undefined ? null : toDto(row);
}

/**
 * Store the paper exactly once after issue. A lost conditional update means another request already stored
 * the bytes; callers re-read the contract and use that winner.
 */
export async function saveRenderedOnce(
  db: Db,
  input: { id: string; html: string; hash: string },
): Promise<ContractRenderDto | null> {
  const [row] = await db
    .update(contracts)
    .set({ renderedHtml: input.html, renderedHash: input.hash })
    .where(
      and(
        eq(contracts.id, input.id),
        or(eq(contracts.status, "issued"), eq(contracts.status, "voided")),
        isNull(contracts.renderedHtml),
      ),
    )
    .returning(renderColumns());
  return row === undefined ? null : toDto(row);
}
