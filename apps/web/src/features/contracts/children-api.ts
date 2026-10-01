import type { components } from "@runway/client";
import { client } from "../../lib/client";
import { unwrap, type Contract, type Raw } from "./api";

export type CreateChildRequest = components["schemas"]["CreateChildRequest"];

/** POST /contracts/{id}/children — the server copies lines + prices from the issued parent; the client sends only hand-typed values. */
export function createChild(parentId: string, body: CreateChildRequest, idempotencyKey: string): Promise<Contract> {
  return unwrap(
    client.typed.POST("/contracts/{id}/children", {
      params: { path: { id: parentId }, header: { "Idempotency-Key": idempotencyKey } },
      body,
    }) as Raw<Contract>,
  );
}
