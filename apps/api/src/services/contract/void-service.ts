/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unused-vars -- stub: body lands in its wave-2 card */
import type { Db } from "../../db/client";
import type { ContractDto } from "../../dto/contracts";
import { NotImplementedYet } from "./not-implemented";
import type { CommandCtx } from "./types";

export type VoidResult =
  | { kind: "ok"; contract: ContractDto }
  | { kind: "not-found" }
  | { kind: "state-conflict"; current: string };

export async function voidContract(_db: Db, _ctx: CommandCtx, _id: string, _reason: string): Promise<VoidResult> {
  throw new NotImplementedYet("voidContract");
}
