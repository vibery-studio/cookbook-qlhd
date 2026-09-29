/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unused-vars -- stub: body lands in its wave-2 card */
import type { AuditEventDto } from "../../dao/audit-dao";
import type { Db } from "../../db/client";
import type { ApprovalQueueDto, ContractDto, ContractListDto } from "../../dto/contracts";
import type { Principal } from "../../openapi";
import { NotImplementedYet } from "./not-implemented";
import type { ValidationErrors } from "./types";

export type ListResult = ({ kind: "ok" } & ContractListDto) | { kind: "invalid"; errors: ValidationErrors };
export type QueueResult = ({ kind: "ok" } & ApprovalQueueDto) | { kind: "invalid"; errors: ValidationErrors };
export type AuditPage =
  | { kind: "ok"; items: AuditEventDto[]; next_cursor: string | null }
  | { kind: "invalid"; errors: ValidationErrors };

export async function listContracts(
  _db: Db,
  _actor: Principal,
  _q: { status?: ContractDto["status"]; customer_id?: string; created_by?: string; cursor?: string; limit: number },
): Promise<ListResult> {
  throw new NotImplementedYet("listContracts");
}

/** `null` → 404. `can` is computed for `actor`. */
export async function contractDetail(_db: Db, _actor: Principal, _id: string): Promise<ContractDto | null> {
  throw new NotImplementedYet("contractDetail");
}

export async function approvalQueue(
  _db: Db,
  _actor: Principal,
  _q: { cursor?: string; limit: number },
): Promise<QueueResult> {
  throw new NotImplementedYet("approvalQueue");
}

/** `null` → 404 (contract does not exist). */
export async function contractAudit(
  _db: Db,
  _id: string,
  _q: { cursor?: string; limit: number },
): Promise<AuditPage | null> {
  throw new NotImplementedYet("contractAudit");
}
