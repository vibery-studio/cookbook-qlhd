/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unused-vars -- stub: body lands in its wave-2 card */
import type { Db } from "../../db/client";
import type { ContractDto } from "../../dto/contracts";
import { NotImplementedYet } from "./not-implemented";
import type { CommandCtx } from "./types";

export type SubmitResult =
  | { kind: "ok"; contract: ContractDto }
  | { kind: "not-found" }
  | { kind: "forbidden" } // caller is not the creator
  | { kind: "state-conflict"; current: string }
  | { kind: "no-eligible-approver"; step: { step_no: number; label: string } };

export async function submitContract(_db: Db, _ctx: CommandCtx, _id: string): Promise<SubmitResult> {
  throw new NotImplementedYet("submitContract");
}
