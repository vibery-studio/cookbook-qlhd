/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unused-vars -- stub: body lands in its wave-2 card */
import type { Db } from "../../db/client";
import type { ContractDto } from "../../dto/contracts";
import { NotImplementedYet } from "./not-implemented";
import type { BuildFailure, CommandCtx } from "./types";

export type CopyResult =
  | { kind: "ok"; contract: ContractDto }
  | { kind: "not-found" }
  | { kind: "state-conflict"; current: string } // source not rejected/voided, or voided already replaced
  | BuildFailure;

export async function copyContract(_db: Db, _ctx: CommandCtx, _id: string): Promise<CopyResult> {
  throw new NotImplementedYet("copyContract");
}
