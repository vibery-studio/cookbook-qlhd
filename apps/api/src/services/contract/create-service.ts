/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unused-vars -- stub: body lands in its wave-2 card */
import type { Db } from "../../db/client";
import type { ContractDto, CreateContractInput } from "../../dto/contracts";
import { NotImplementedYet } from "./not-implemented";
import type { BuildFailure, CommandCtx } from "./types";

export type CreateResult =
  | { kind: "ok"; contract: ContractDto }
  | BuildFailure
  | { kind: "not-found"; what: "customer" | "template" };

export async function createContract(_db: Db, _ctx: CommandCtx, _input: CreateContractInput): Promise<CreateResult> {
  throw new NotImplementedYet("createContract");
}
