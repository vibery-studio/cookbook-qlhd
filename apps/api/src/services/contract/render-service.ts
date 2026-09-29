/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unused-vars -- stub: body lands in its wave-2 card */
import type { Db } from "../../db/client";
import { NotImplementedYet } from "./not-implemented";

export type RenderResult = { kind: "ok"; html: string; etag: string | null } | { kind: "not-found" };

export async function renderContract(_db: Db, _id: string): Promise<RenderResult> {
  throw new NotImplementedYet("renderContract");
}
