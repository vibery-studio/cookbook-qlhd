/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unused-vars -- stub: body lands in its wave-2 card */
import type { Db } from "../../db/client";
import type { ContractDto } from "../../dto/contracts";
import { NotImplementedYet } from "./not-implemented";
import type { CommandCtx } from "./types";

export type DecideResult =
  | { kind: "ok"; contract: ContractDto }
  | { kind: "not-found" }
  | { kind: "forbidden-permission"; permission: string; label?: string } // missing step permission / role
  | { kind: "sod"; rule: "creator_cannot_approve" | "one_person_one_step" }
  | { kind: "would-block-later-step"; step: { step_no: number; label: string } }
  | { kind: "state-conflict"; current: string };

export async function decideContract(
  _db: Db,
  _ctx: CommandCtx,
  _id: string,
  _decision: { action: "approve" | "reject"; note?: string },
): Promise<DecideResult> {
  throw new NotImplementedYet("decideContract");
}
