import { generateUlid } from "../../utils/id";
import type { Db } from "../../db/client";
import type { ContractDto, CreateContractInput } from "../../dto/contracts";
import { WRITE_PERM } from "../../domain/contract/doc-types";
import { emitContractEvent } from "../../events/contract-events";
import { insertContract, templateTypeOf } from "../../dao/contract-write-dao";
import { loadAndBuild } from "./snapshot-builder";
import type { BuildFailure, CommandCtx, TypeForbidden } from "./types";

export type CreateResult =
  | { kind: "ok"; contract: ContractDto }
  | BuildFailure
  | TypeForbidden
  | { kind: "parent-required" }
  | { kind: "not-found"; what: "customer" | "template" };

/**
 * `POST /contracts` (SPEC-09 FR-1, FR-13, DEC-10 B): the document takes its template's type; the actor needs that type's
 * write code (the route gate is only `contract:read`). Order: unknown template 404 → 403 → DNTT `parent-required` → build.
 */
export async function createContract(db: Db, ctx: CommandCtx, input: CreateContractInput): Promise<CreateResult> {
  const type = await templateTypeOf(db, input.template_id);
  if (type === null) return { kind: "not-found", what: "template" };
  const permission = WRITE_PERM[type];
  if (!ctx.actor.permissions.includes(permission)) return { kind: "forbidden", permission };
  if (type === "payment_request") return { kind: "parent-required" };

  const built = await loadAndBuild(db, {
    templateId: input.template_id,
    customerId: input.customer_id,
    lines: input.lines,
    values: { ...input.values },
    now: ctx.now,
    manualStart: Object.prototype.hasOwnProperty.call(input.values, "ngay_bat_dau"),
    type,
    creatorId: ctx.actor.id,
  });
  if (built.kind !== "ok") return built;

  const snapshot = built.built.snapshot;
  const now = Math.floor(ctx.now.getTime() / 1000);
  const id = generateUlid();
  const contract = await insertContract(
    db,
    {
      id,
      type,
      validUntil: type === "quote" ? (snapshot.dates.valid_until ?? null) : null,
      parentId: null,
      templateId: snapshot.template.id,
      templateVersionId: snapshot.template.version_id,
      customerId: snapshot.customer.id,
      sourceContractId: null,
      createdBy: ctx.actor.id,
      docDate: snapshot.dates.doc_date,
      snapshot: built.built.snapshotJson,
      snapshotHash: built.built.snapshotHash,
      customerName: snapshot.customer.name,
      total: snapshot.total,
      now,
    },
    { actor: ctx.actor.id, ip: ctx.ip, ts: now, metadata: { to: "draft", type } },
  );
  emitContractEvent({ name: "contract.created", contract });
  return { kind: "ok", contract };
}
