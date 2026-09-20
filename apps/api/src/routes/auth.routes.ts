import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { problem, ProblemDto, ProblemType } from "../dto/error";
import { EmailSchema } from "../dto/common";
import type { Bindings } from "../env";
import type { Variables } from "../openapi";

/**
 * Auth route stubs (Phase 4). Every handler returns 501 Problem+JSON — real
 * logic lands in Phase 5 (password auth, session management). Schemas here
 * are the locked contract: signup/login body shape, cookie-based sessions,
 * refresh rotation semantics (see plan.md Locked Decisions — Auth).
 */

type Env = { Bindings: Bindings; Variables: Variables };

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

function notImplemented(c: Context<Env>) {
  return c.json(
    problem(501, "Not Implemented", ProblemType.NotImplemented, {
      instance: c.req.path,
      request_id: c.get("requestId"),
    }),
    501,
  );
}

const signupRoute = createRoute({
  method: "post",
  path: "/auth/signup",
  tags: ["auth"],
  summary: "Create a new user account",
  request: {
    body: { content: { "application/json": { schema: SignupBody } } },
  },
  responses: {
    201: {
      description: "User created; verification email queued",
      content: { "application/json": { schema: SignupResponse } },
    },
    409: {
      description: "Email already registered",
      content: { "application/json": { schema: ProblemDto } },
    },
    422: {
      description: "Validation failed",
      content: { "application/json": { schema: ProblemDto } },
    },
    501: {
      description: "Not implemented",
      content: { "application/json": { schema: ProblemDto } },
    },
  },
});

const verifyRoute = createRoute({
  method: "post",
  path: "/auth/verify",
  tags: ["auth"],
  summary: "Consume an email verification token",
  request: {
    body: { content: { "application/json": { schema: VerifyBody } } },
  },
  responses: {
    200: {
      description: "Email verified",
      content: { "application/json": { schema: z.object({ verified: z.literal(true) }) } },
    },
    410: {
      description: "Token already used or expired",
      content: { "application/json": { schema: ProblemDto } },
    },
    422: {
      description: "Validation failed",
      content: { "application/json": { schema: ProblemDto } },
    },
    501: {
      description: "Not implemented",
      content: { "application/json": { schema: ProblemDto } },
    },
  },
});

const loginRoute = createRoute({
  method: "post",
  path: "/auth/login",
  tags: ["auth"],
  summary: "Authenticate with email + password",
  request: {
    body: { content: { "application/json": { schema: LoginBody } } },
  },
  responses: {
    200: {
      description: "Authenticated; session cookies set",
      headers: z.object({
        "Set-Cookie": z.string().openapi({
          description: "httpOnly, Secure, SameSite=Strict access + refresh cookies",
        }),
      }),
      content: { "application/json": { schema: z.object({ user_id: z.string() }) } },
    },
    401: {
      description: "Invalid credentials",
      content: { "application/json": { schema: ProblemDto } },
    },
    429: {
      description: "Rate limited",
      content: { "application/json": { schema: ProblemDto } },
    },
    501: {
      description: "Not implemented",
      content: { "application/json": { schema: ProblemDto } },
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
      content: { "application/json": { schema: ProblemDto } },
    },
    501: {
      description: "Not implemented",
      content: { "application/json": { schema: ProblemDto } },
    },
  },
});

const refreshRoute = createRoute({
  method: "post",
  path: "/auth/refresh",
  tags: ["auth"],
  summary: "Rotate the refresh token and mint a new access token",
  security: [{ cookieAuth: [] }],
  responses: {
    200: {
      description: "Rotated; new session cookies set",
      headers: z.object({
        "Set-Cookie": z.string().openapi({
          description: "httpOnly, Secure, SameSite=Strict access + refresh cookies",
        }),
      }),
      content: { "application/json": { schema: z.object({ ok: z.literal(true) }) } },
    },
    401: {
      description: "Missing or expired refresh cookie",
      content: { "application/json": { schema: ProblemDto } },
    },
    409: {
      description: "Refresh token reuse detected; chain revoked",
      content: { "application/json": { schema: ProblemDto } },
    },
    501: {
      description: "Not implemented",
      content: { "application/json": { schema: ProblemDto } },
    },
  },
});

export function authRoutes(app: OpenAPIHono<Env>): void {
  app.openapi(signupRoute, notImplemented);
  app.openapi(verifyRoute, notImplemented);
  app.openapi(loginRoute, notImplemented);
  app.openapi(logoutRoute, notImplemented);
  app.openapi(refreshRoute, notImplemented);
}
