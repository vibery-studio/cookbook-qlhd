import type { Principal } from "../../openapi";

/** Everything a contract command needs from the request — no Hono `c` (routes build this). */
export interface CommandCtx {
  actor: Principal;
  ip: string | null;
  now: Date;
}

export type ValidationErrors = Array<{ path: string; message: string }>;

/** 422 kinds shared by create / update / copy. `line-invalid`: a line rule (PLAN-08 P-2), `errors[].path` = `lines.<i>.product_id`. */
export type BuildFailure =
  | { kind: "invalid"; errors: ValidationErrors }
  | { kind: "line-invalid"; slug: "validation" | "product-inactive" | "no-price"; errors: ValidationErrors }
  | { kind: "missing-fields"; missing: Array<{ key: string; label: string }> }
  | { kind: "unresolved-placeholder"; placeholders: string[] };
