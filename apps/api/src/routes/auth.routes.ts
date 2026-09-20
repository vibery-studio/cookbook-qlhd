import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Context } from "hono";
import { EmailSchema } from "../dto/common";
import { problem, ProblemDto, ProblemType } from "../dto/error";
import type { Bindings } from "../env";
import type { Variables } from "../openapi";
import { getDb } from "../db/client";
import { createEmailPortWithRetry } from "../adapters/email-with-retry";
import { clientIp, normalizeEmailForRateLimit, rateLimit } from "../middleware/rate-limit";
import { createAuditLogger } from "../observability/logger";
import {
  ACCESS_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
  requireAuth,
} from "../middleware/auth";
import {
  AUTH_TTL,
  type AuthTokens,
  login as authLogin,
  logout as authLogout,
  refresh as authRefresh,
  signup as authSignup,
  verifyEmail,
} from "../services/auth-service";

/**
 * Auth routes (Phase 5). Handlers are thin — they call auth-service and
 * translate its typed outcomes into HTTP status + Problem+JSON. Cookies
 * are set here (not in auth-service) so the service stays framework-free.
 */

type Env = { Bindings: Bindings; Variables: Variables };

// -------------------------- Schemas ---------------------------------------

const SignupBody = z
  .object({
    email: EmailSchema,
    password: z.string().min(12).max(256),
  })
  .openapi("SignupRequest");

const SignupResponse = z.object({ user_id: z.string() }).openapi("SignupResponse");

const VerifyBody = z
  .object({
    token: z.string().min(16).max(128),
  })
  .openapi("VerifyRequest");

const LoginBody = z
  .object({
    email: EmailSchema,
    password: z.string().min(1).max(256),
  })
  .openapi("LoginRequest");

// -------------------------- Cookie helper ---------------------------------

const IS_SECURE_COOKIE_ENV: ReadonlySet<Bindings["APP_ENV"]> = new Set([
  "preview",
  "production",
]);

function setSessionCookies(c: Context<Env>, tokens: AuthTokens): void {
  const secure = IS_SECURE_COOKIE_ENV.has(c.env.APP_ENV);
  setCookie(c, ACCESS_COOKIE_NAME, tokens.accessToken, {
    httpOnly: true,
    secure,
    sameSite: "Strict",
    path: "/",
    maxAge: AUTH_TTL.ACCESS_SECONDS,
  });
  setCookie(c, REFRESH_COOKIE_NAME, tokens.refreshToken, {
    httpOnly: true,
    secure,
    sameSite: "Strict",
    // Path=/auth covers both /auth/refresh AND /auth/logout — a
    // narrower Path=/auth/refresh would prevent the browser from
    // sending the refresh cookie to /auth/logout, leaving the refresh
    // row un-revoked at logout. /auth is the smallest path that reaches
    // both handlers.
    path: "/auth",
    maxAge: AUTH_TTL.REFRESH_SECONDS,
  });
}

function clearSessionCookies(c: Context<Env>): void {
  deleteCookie(c, ACCESS_COOKIE_NAME, { path: "/" });
  deleteCookie(c, REFRESH_COOKIE_NAME, { path: "/auth" });
}

// -------------------------- Route definitions -----------------------------

const signupRoute = createRoute({
  method: "post",
  path: "/auth/signup",
  tags: ["auth"],
  summary: "Create a new user account",
  request: { body: { content: { "application/json": { schema: SignupBody } } } },
  responses: {
    201: {
      description: "User created; verification email queued",
      content: { "application/json": { schema: SignupResponse } },
    },
    409: {
      description: "Email already registered",
      content: { "application/problem+json": { schema: ProblemDto } },
    },
    422: {
      description: "Validation failed",
      content: { "application/problem+json": { schema: ProblemDto } },
    },
  },
});

const verifyRoute = createRoute({
  method: "post",
  path: "/auth/verify",
  tags: ["auth"],
  summary: "Consume an email verification token",
  request: { body: { content: { "application/json": { schema: VerifyBody } } } },
  responses: {
    200: {
      description: "Email verified",
      content: { "application/json": { schema: z.object({ verified: z.literal(true) }) } },
    },
    410: {
      description: "Token already used, expired, or unknown",
      content: { "application/problem+json": { schema: ProblemDto } },
    },
    422: {
      description: "Validation failed",
      content: { "application/problem+json": { schema: ProblemDto } },
    },
  },
});

const loginRoute = createRoute({
  method: "post",
  path: "/auth/login",
  tags: ["auth"],
  summary: "Authenticate with email + password",
  request: { body: { content: { "application/json": { schema: LoginBody } } } },
  responses: {
    200: {
      description: "Authenticated; session cookies set",
      content: { "application/json": { schema: z.object({ user_id: z.string() }) } },
    },
    401: {
      description: "Invalid credentials",
      content: { "application/problem+json": { schema: ProblemDto } },
    },
    403: {
      description: "Account not verified or disabled",
      content: { "application/problem+json": { schema: ProblemDto } },
    },
    429: {
      description: "Rate limited (Phase 10)",
      content: { "application/problem+json": { schema: ProblemDto } },
    },
  },
});

const logoutRoute = createRoute({
  method: "post",
  path: "/auth/logout",
  tags: ["auth"],
  summary: "Revoke the current session",
  security: [{ cookieAuth: [] }],
  responses: {
    200: {
      description: "Logged out",
      content: { "application/json": { schema: z.object({ ok: z.literal(true) }) } },
    },
    401: {
      description: "Not authenticated",
      content: { "application/problem+json": { schema: ProblemDto } },
    },
  },
});

const refreshRoute = createRoute({
  method: "post",
  path: "/auth/refresh",
  tags: ["auth"],
  summary: "Rotate the refresh token and mint a new access token",
  responses: {
    200: {
      description: "Rotated; new session cookies set",
      content: { "application/json": { schema: z.object({ ok: z.literal(true) }) } },
    },
    401: {
      description: "Missing or expired refresh cookie, or reuse detected",
      content: { "application/problem+json": { schema: ProblemDto } },
    },
  },
});

// -------------------------- Handlers --------------------------------------

const authRoutesModule = {
  register(app: OpenAPIHono<Env>): void {
    // Rate limits — one per verb/path. Keys chosen per phase-10 spec.
    app.on(
      "post",
      "/auth/signup",
      rateLimit({
        binding: "RL_AUTH_SIGNUP",
        keyFn: (c) => `signup:${clientIp(c)}`,
      }),
    );

    app.on(
      "post",
      "/auth/verify",
      rateLimit({
        binding: "RL_AUTH_VERIFY",
        keyFn: (c) => `verify:${clientIp(c)}`,
      }),
    );

    app.on(
      "post",
      "/auth/login",
      rateLimit({
        binding: "RL_AUTH_LOGIN",
        keyFn: async (c) => {
          // Peek the body to include normalized email in the key so
          // per-account throttling works. Clone the request so the
          // downstream handler still reads its own copy.
          const clone = c.req.raw.clone();
          let email = "unknown";
          try {
            const parsed: { email?: unknown } = await clone.json();
            if (typeof parsed.email === "string") {
              email = normalizeEmailForRateLimit(parsed.email);
            }
          } catch {
            // Body missing/malformed — fall back to ip-only bucket.
          }
          return `login:${email}:${clientIp(c)}`;
        },
        onBreach: (c) => {
          // SYNC audit — security-critical, must land in Logpush
          // before the 429 flushes. Include request_id so incident
          // triage can correlate the breach with the surrounding
          // request logs.
          createAuditLogger({ ctx: undefined })(
            {
              actor: null,
              action: "auth.login.rate_limited",
              target: `ip:${clientIp(c)}`,
              metadata: {
                request_id: c.get("requestId"),
              },
            },
            { sync: true },
          );
        },
      }),
    );

    app.on(
      "post",
      "/auth/refresh",
      rateLimit({
        binding: "RL_AUTH_REFRESH",
        // No principal available before refresh — fall back to IP
        // bucket which still throttles per-attacker.
        keyFn: (c) => `refresh:${clientIp(c)}`,
      }),
    );

    app.openapi(signupRoute, async (c) => {
      const body = c.req.valid("json");
      const db = getDb(c.env);
      const verifyUrlBase = `${c.env.APP_ORIGIN}/verify-email`;
      const result = await authSignup(
        {
          db,
          kv: c.env.SESSIONS,
          email: createEmailPortWithRetry(c.env),
          now: () => Math.floor(Date.now() / 1000),
          env: c.env,
        },
        { email: body.email, password: body.password, verifyUrlBase },
      );
      if (result.kind === "duplicate-email") {
        return c.json(
          problem(409, "Email already registered", ProblemType.Conflict, {
            instance: c.req.path,
            request_id: c.get("requestId"),
          }),
          409,
        );
      }
      if (result.kind === "weak-password") {
        return c.json(
          problem(422, "Password does not meet policy", ProblemType.Validation, {
            instance: c.req.path,
            request_id: c.get("requestId"),
          }),
          422,
        );
      }
      return c.json({ user_id: result.userId }, 201);
    });

    app.openapi(verifyRoute, async (c) => {
      const body = c.req.valid("json");
      const db = getDb(c.env);
      const result = await verifyEmail(
        {
          db,
          kv: c.env.SESSIONS,
          email: createEmailPortWithRetry(c.env),
          now: () => Math.floor(Date.now() / 1000),
          env: c.env,
        },
        { rawToken: body.token },
      );
      if (result.kind === "invalid-or-used") {
        return c.json(
          problem(410, "Token invalid, used, or expired", ProblemType.NotFound, {
            instance: c.req.path,
            request_id: c.get("requestId"),
          }),
          410,
        );
      }
      return c.json({ verified: true as const }, 200);
    });

    app.openapi(loginRoute, async (c) => {
      const body = c.req.valid("json");
      const db = getDb(c.env);
      const result = await authLogin(
        {
          db,
          kv: c.env.SESSIONS,
          email: createEmailPortWithRetry(c.env),
          now: () => Math.floor(Date.now() / 1000),
          env: c.env,
        },
        { email: body.email, password: body.password },
      );
      if (result.kind === "invalid-credentials") {
        return c.json(
          problem(401, "Invalid credentials", ProblemType.Unauthorized, {
            instance: c.req.path,
            request_id: c.get("requestId"),
          }),
          401,
        );
      }
      if (result.kind === "not-verified") {
        return c.json(
          problem(403, "Email not verified", ProblemType.Forbidden, {
            instance: c.req.path,
            request_id: c.get("requestId"),
          }),
          403,
        );
      }
      if (result.kind === "disabled") {
        return c.json(
          problem(403, "Account disabled", ProblemType.Forbidden, {
            instance: c.req.path,
            request_id: c.get("requestId"),
          }),
          403,
        );
      }
      setSessionCookies(c, result.tokens);
      return c.json({ user_id: result.userId }, 200);
    });

    app.use("/auth/logout", requireAuth());
    app.openapi(logoutRoute, async (c) => {
      const principal = c.get("principal");
      if (principal === undefined) {
        // requireAuth would already have thrown; belt+braces.
        return c.json(
          problem(401, "Not authenticated", ProblemType.Unauthorized, {
            instance: c.req.path,
            request_id: c.get("requestId"),
          }),
          401,
        );
      }
      const db = getDb(c.env);
      const rawRefreshToken = getCookie(c, REFRESH_COOKIE_NAME) ?? null;
      await authLogout(
        {
          db,
          kv: c.env.SESSIONS,
          email: createEmailPortWithRetry(c.env),
          now: () => Math.floor(Date.now() / 1000),
          env: c.env,
        },
        {
          accessJti: c.get("accessJti") ?? null,
          accessExpiresAt: c.get("accessExp") ?? null,
          userId: principal.id,
          rawRefreshToken,
        },
      );
      clearSessionCookies(c);
      return c.json({ ok: true as const }, 200);
    });

    app.openapi(refreshRoute, async (c) => {
      const rawRefreshToken = getCookie(c, REFRESH_COOKIE_NAME);
      if (rawRefreshToken === undefined) {
        return c.json(
          problem(401, "Missing refresh cookie", ProblemType.Unauthorized, {
            instance: c.req.path,
            request_id: c.get("requestId"),
          }),
          401,
        );
      }
      const db = getDb(c.env);
      const result = await authRefresh(
        {
          db,
          kv: c.env.SESSIONS,
          email: createEmailPortWithRetry(c.env),
          now: () => Math.floor(Date.now() / 1000),
          env: c.env,
        },
        { rawRefreshToken },
      );
      if (result.kind === "invalid") {
        clearSessionCookies(c);
        return c.json(
          problem(401, "Refresh token invalid", ProblemType.Unauthorized, {
            instance: c.req.path,
            request_id: c.get("requestId"),
          }),
          401,
        );
      }
      if (result.kind === "reuse-detected") {
        clearSessionCookies(c);
        return c.json(
          problem(401, "Refresh token reuse detected; session revoked", ProblemType.Unauthorized, {
            instance: c.req.path,
            request_id: c.get("requestId"),
          }),
          401,
        );
      }
      setSessionCookies(c, result.tokens);
      return c.json({ ok: true as const }, 200);
    });
  },
};

export function authRoutes(app: OpenAPIHono<Env>): void {
  authRoutesModule.register(app);
}
