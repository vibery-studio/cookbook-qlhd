import type { Principal } from "../../openapi";
import type { WRITE_PERM } from "../../domain/contract/doc-types";

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

/** The write code of a document type (DEC-10 B). */
export type WritePermission = (typeof WRITE_PERM)[keyof typeof WRITE_PERM];

/**
 * SPEC-09 (C-09-006) results shared by create / update / copy / delete:
 * - `forbidden`: the actor lacks `WRITE_PERM[type]` — the route records `permission.denied {permission, method, path}`, then 403;
 * - `parent-required`: a DNTT template on `POST /contracts` (a DNTT is only made from an issued HĐ);
 * - `lines-locked`: a child's lines / discount / customer come from its parent (DEC-6);
 * - `template-type`: the template is of another type than the document;
 * - `child-exists` (+ the live child's id), `quote-expired`, `parent-not-issued`: copying a child (DEC-4, DEC-5).
 */
export type TypeForbidden = { kind: "forbidden"; permission: WritePermission };
export type DocTypeFailure =
  | { kind: "parent-required" }
  | { kind: "lines-locked" }
  | { kind: "template-type" }
  | { kind: "nothing-to-pay" }
  | { kind: "child-type" };
export type ChildCopyFailure =
  | { kind: "child-exists"; existingId: string | null }
  | { kind: "quote-expired" }
  | { kind: "parent-not-issued" };
