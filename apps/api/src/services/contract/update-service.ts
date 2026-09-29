/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unused-vars -- stub: body lands in its wave-2 card */
import type { Db } from "../../db/client";
import type { ContractDto, UpdateContractInput } from "../../dto/contracts";
import { NotImplementedYet } from "./not-implemented";
import type { BuildFailure, CommandCtx } from "./types";

export type UpdateResult =
  | { kind: "ok"; contract: ContractDto }
  | { kind: "not-found" }
  | { kind: "forbidden" } // caller is not the creator
  | { kind: "state-conflict"; current: string }
  | { kind: "stale" }
  | BuildFailure;

export async function updateContract(
  _db: Db,
  _ctx: CommandCtx,
  _id: string,
  _input: UpdateContractInput,
): Promise<UpdateResult> {
  throw new NotImplementedYet("updateContract");
}
