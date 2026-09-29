import type { Principal } from "../../openapi";

/** Everything a contract command needs from the request — no Hono `c` (routes build this). */
export interface CommandCtx {
  actor: Principal;
  ip: string | null;
  now: Date;
}

export type ValidationErrors = Array<{ path: string; message: string }>;

/** 422 kinds shared by create / update / copy. */
export type BuildFailure =
  | { kind: "invalid"; errors: ValidationErrors }
  | { kind: "missing-fields"; missing: Array<{ key: string; label: string }> }
  | { kind: "unresolved-placeholder"; placeholders: string[] };
