/**
 * User factories — `createMember` and `createAdmin` — replace 90% of
 * the setup boilerplate in integration tests. Each helper walks the
 * real HTTP surface (signup → verify → login) so tests exercise the
 * production auth pipeline, not a shortcut.
 *
 * The factory is generic in two dependencies to avoid a back-reference
 * to `apps/api`:
 *   - `fetcher`: the SELF.fetch from `cloudflare:test`.
 *   - `readLastVerifyToken`: a callback that inspects wherever the
 *     test harness captured the verify email (typically the noop
 *     adapter's ring buffer) and returns the raw token string.
 *   - `assignRole?`: optional callback invoked after verify+login when
 *     the caller asked for a role. Only `createAdmin` uses this.
 */
import { CSRF_HEADERS, TEST_ORIGIN } from "./csrf";
import type { Fetcher, RunwaySession } from "./session";
import { createSession, loginAs } from "./session";

const DEFAULT_PASSWORD = "correct-horse-battery-staple";

export interface CreateMemberDeps {
  fetcher: Fetcher;
  readLastVerifyToken: () => string;
  origin?: string;
}

export interface CreateMemberInput {
  email?: string;
  password?: string;
}

export interface CreatedMember {
  userId: string;
  email: string;
  /**
   * Plaintext password. Returned so tests can re-login (e.g. after a
   * logout scenario) but MUST NOT be logged. The RunwaySession itself
   * does not retain it.
   */
  readonly password: string;
  session: RunwaySession;
}

/**
 * Signup + verify + login. Returns a live `RunwaySession` you can
 * immediately `.fetch("/me")` against.
 */
export async function createMember(
  deps: CreateMemberDeps,
  input: CreateMemberInput = {},
): Promise<CreatedMember> {
  const origin = deps.origin ?? TEST_ORIGIN;
  const email = input.email ?? `user-${Math.random().toString(36).slice(2, 10)}@example.com`;
  const password = input.password ?? DEFAULT_PASSWORD;

  const signup = await deps.fetcher(`${origin}/auth/signup`, {
    method: "POST",
    headers: CSRF_HEADERS,
    body: JSON.stringify({ email, password }),
  });
  if (signup.status !== 201) {
    throw new Error(`createMember: signup returned ${signup.status} for ${email}`);
  }
  const signupBody: { user_id: string } = await signup.json();

  const token = deps.readLastVerifyToken();
  const verify = await deps.fetcher(`${origin}/auth/verify`, {
    method: "POST",
    headers: CSRF_HEADERS,
    body: JSON.stringify({ token }),
  });
  if (verify.status !== 200) {
    throw new Error(`createMember: verify returned ${verify.status}`);
  }

  const { accessCookie, refreshCookie } = await loginAs(deps.fetcher, {
    email,
    password,
    origin,
  });

  const session = createSession({
    userId: signupBody.user_id,
    email,
    accessCookie,
    refreshCookie,
    fetcher: deps.fetcher,
    origin,
  });

  return { userId: signupBody.user_id, email, password, session };
}

export interface CreateAdminDeps extends CreateMemberDeps {
  /**
   * Invoked after signup+verify, before login, to grant the admin role.
   * Callers wire this to `assignRoleByName({ userId, roleName: 'admin' })`
   * from the app's admin-service, keeping the fixture package free of
   * app-side imports.
   */
  assignAdminRole: (userId: string) => Promise<void>;
}

/**
 * createMember + assignAdminRole. Result is a fully-authenticated admin
 * session — useful for admin-routes tests that otherwise re-implement
 * the same 20-line bootstrap.
 */
export async function createAdmin(
  deps: CreateAdminDeps,
  input: CreateMemberInput = {},
): Promise<CreatedMember> {
  const origin = deps.origin ?? TEST_ORIGIN;
  const email = input.email ?? `admin-${Math.random().toString(36).slice(2, 10)}@example.com`;
  const password = input.password ?? DEFAULT_PASSWORD;

  // Signup + verify + role assignment happen BEFORE login so the
  // access-token issued at login already carries the admin permissions.
  const signup = await deps.fetcher(`${origin}/auth/signup`, {
    method: "POST",
    headers: CSRF_HEADERS,
    body: JSON.stringify({ email, password }),
  });
  if (signup.status !== 201) {
    throw new Error(`createAdmin: signup returned ${signup.status} for ${email}`);
  }
  const signupBody: { user_id: string } = await signup.json();

  const token = deps.readLastVerifyToken();
  const verify = await deps.fetcher(`${origin}/auth/verify`, {
    method: "POST",
    headers: CSRF_HEADERS,
    body: JSON.stringify({ token }),
  });
  if (verify.status !== 200) {
    throw new Error(`createAdmin: verify returned ${verify.status}`);
  }

  await deps.assignAdminRole(signupBody.user_id);

  const { accessCookie, refreshCookie } = await loginAs(deps.fetcher, {
    email,
    password,
    origin,
  });

  const session = createSession({
    userId: signupBody.user_id,
    email,
    accessCookie,
    refreshCookie,
    fetcher: deps.fetcher,
    origin,
  });

  return { userId: signupBody.user_id, email, password, session };
}
