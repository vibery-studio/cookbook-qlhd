/**
 * Email inspection helpers. The API's noop email adapter (used in tests
 * + local dev) exposes `getNoopSentEmails()` and `resetNoopEmailBuffer()`.
 * These callbacks are passed in so the fixture package doesn't have to
 * import from apps/api directly.
 *
 * Callers wire like:
 *
 *   import { getNoopSentEmails, resetNoopEmailBuffer } from "../../src/adapters/email-noop";
 *   const email = readLastSentEmail(getNoopSentEmails);
 */

/**
 * Structural type — matches the noop adapter's EmailMessage shape
 * without pulling the port types in.
 */
export interface CapturedEmail {
  template: string;
  to: string;
  props: Record<string, unknown>;
}

export function readLastSentEmail<T extends CapturedEmail>(
  getSent: () => readonly T[],
): T {
  const emails = getSent();
  const last = emails[emails.length - 1];
  if (last === undefined) {
    throw new Error("readLastSentEmail: buffer is empty");
  }
  return last;
}

export function readSentEmails<T extends CapturedEmail>(
  getSent: () => readonly T[],
  filter?: (msg: T) => boolean,
): T[] {
  const all = getSent();
  return filter === undefined ? all.slice() : all.filter(filter);
}

/**
 * Extract the verify-email token from the most recent `verify-email` in
 * the noop buffer. This is the single most-duplicated helper across
 * integration tests — every signup+verify flow re-implements it.
 */
export function readLastVerifyToken<T extends CapturedEmail>(
  getSent: () => readonly T[],
): string {
  const last = readLastSentEmail(getSent);
  if (last.template !== "verify-email") {
    throw new Error(`readLastVerifyToken: last email is '${last.template}', not 'verify-email'`);
  }
  const verifyUrl = last.props["verifyUrl"];
  if (typeof verifyUrl !== "string") {
    throw new Error("readLastVerifyToken: verifyUrl missing from props");
  }
  const url = new URL(verifyUrl);
  const token = url.searchParams.get("token");
  if (token === null) {
    throw new Error("readLastVerifyToken: verifyUrl missing 'token' query param");
  }
  return token;
}
