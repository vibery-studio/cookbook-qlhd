/**
 * Result<Success, Problem> — a discriminated union every operation
 * returns instead of throwing on well-formed server responses.
 *
 * Callers pattern-match on `result.ok`:
 *
 *   const r = await runway.signup({ email, password });
 *   if (!r.ok) {
 *     // r.problem: typed Problem+JSON envelope
 *     return; // TS narrows to error branch
 *   }
 *   r.data; // TS narrows to success branch
 *
 * Throws are reserved for infrastructure failures (network unreachable,
 * timeout, non-JSON body when JSON was declared) — those map to
 * ClientError subclasses in `errors.ts`.
 */

/** RFC 7807 Problem+JSON envelope. Mirrors `apps/api/src/dto/error.ts`. */
export interface Problem {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  request_id?: string;
  errors?: Array<{ path: string; message: string }>;
}

export type Result<Success> =
  | { ok: true; status: number; data: Success }
  | { ok: false; status: number; problem: Problem };

export function ok<Success>(status: number, data: Success): Result<Success> {
  return { ok: true, status, data };
}

export function err<Success>(status: number, problem: Problem): Result<Success> {
  return { ok: false, status, problem };
}
