/**
 * @runway/test-fixtures — shared helpers for integration tests + local
 * dev harness. Zero production dependencies; every helper is
 * dependency-injected so this package never back-references `apps/api`.
 *
 * Typical wiring inside `apps/api/test/integration/*.test.ts`:
 *
 *   import { env, SELF } from "cloudflare:test";
 *   import {
 *     createAdmin, createMember, extractCookie, CSRF_HEADERS,
 *     readLastVerifyToken, truncateTables,
 *   } from "@runway/test-fixtures";
 *   import { getNoopSentEmails, resetNoopEmailBuffer } from "../../src/adapters/email-noop";
 *   import { assignRoleByName } from "../../src/services/admin-service";
 *   import { getDb } from "../../src/db/client";
 *   import { users, refreshTokens, ... } from "../../src/db/schema";
 *
 *   const admin = await createAdmin({
 *     fetcher: (input, init) => SELF.fetch(input, init),
 *     readLastVerifyToken: () => readLastVerifyToken(getNoopSentEmails),
 *     assignAdminRole: async (userId) =>
 *       assignRoleByName({ db: getDb(env), kv: env.SESSIONS, env }, { userId, roleName: "admin" }),
 *   });
 *   const res = await admin.session.fetch("/admin/settings");
 */
export { extractCookie } from "./cookies";
export { CSRF_HEADERS, TEST_ORIGIN, csrfHeadersFor } from "./csrf";
export {
  createSession,
  loginAs,
  type Fetcher,
  type RunwaySession,
  type CreateSessionInput,
} from "./session";
export {
  createAdmin,
  createMember,
  type CreateAdminDeps,
  type CreateMemberDeps,
  type CreateMemberInput,
  type CreatedMember,
} from "./users";
export {
  readLastSentEmail,
  readLastVerifyToken,
  readSentEmails,
  type CapturedEmail,
} from "./email";
export { truncateTables, type DrizzleDb } from "./db";
