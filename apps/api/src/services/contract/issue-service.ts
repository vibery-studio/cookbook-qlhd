/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unused-vars -- stub: body lands in its wave-2 card */
import type { Db } from "../../db/client";
import type { ContractDto } from "../../dto/contracts";
import { NotImplementedYet } from "./not-implemented";
import type { CommandCtx } from "./types";

export type IssueResult =
  | { kind: "ok"; contract: ContractDto }
  | { kind: "not-found" }
  | { kind: "state-conflict"; current: string }
  | { kind: "changed-after-approval" };

export async function issueContract(_db: Db, _ctx: CommandCtx, _id: string): Promise<IssueResult> {
  throw new NotImplementedYet("issueContract");
}
