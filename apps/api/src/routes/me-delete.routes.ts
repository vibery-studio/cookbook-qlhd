import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Bindings } from "../env";
import type { Variables } from "../openapi";
import { getDb } from "../db/client";
import { problem, ProblemDto, ProblemType } from "../dto/error";
import { requireAuth } from "../middleware/auth";
import { requestDeletion, cancelDeletion } from "../privacy/deletion-service";
import { findUserById } from "../dao/user-dao";
import { SettingsService } from "../settings/settings-service";

/**
 * `POST /me/delete` — GDPR account-deletion request.
 * `POST /me/delete/cancel` — undo before the grace window elapses.
 *
 * Both are authenticated. Deletion additionally reconfirms the user's
 * password (a stolen session must not be enough to schedule an
 * erasure). Cancellation only requires an active session because the
 * user's ORIGINAL password may already be locally overwritten in a
 * password-manager (the risk model here is accidental deletion, not
 * hostile takeover — hostile takeovers would have also stolen the
 * password reconfirm).
 */
type Env = { Bindings: Bindings; Variables: Variables };

const DeleteBody = z
  .object({ password: z.string().min(1).max(256) })
  .openapi("MeDeleteRequest");

const DeleteResponse = z
  .object({ scheduled_completion_at: z.number() })
  .openapi("MeDeleteResponse");

const deleteRoute = createRoute({
  method: "post",
  path: "/me/delete",
  tags: ["me"],
  summary: "Request permanent deletion of the authenticated account",
  security: [{ cookieAuth: [] }],
  request: { body: { content: { "application/json": { schema: DeleteBody } } } },
  responses: {
    202: {
      description: "Deletion scheduled; sessions revoked immediately",
      content: { "application/json": { schema: DeleteResponse } },
    },
    401: {
      description: "Invalid password or not authenticated",
      content: { "application/problem+json": { schema: ProblemDto } },
    },
    422: {
      description: "Body validation failed",
      content: { "application/problem+json": { schema: ProblemDto } },
    },
  },
});

const cancelRoute = createRoute({
  method: "post",
  path: "/me/delete/cancel",
  tags: ["me"],
  summary: "Cancel a pending account deletion before the grace window elapses",
  security: [{ cookieAuth: [] }],
  responses: {
    200: {
      description: "Deletion cancelled",
      content: { "application/json": { schema: z.object({ cancelled: z.literal(true) }) } },
    },
    401: {
      description: "Not authenticated",
      content: { "application/problem+json": { schema: ProblemDto } },
    },
    409: {
      description: "No pending deletion, or grace window already elapsed",
      content: { "application/problem+json": { schema: ProblemDto } },
    },
  },
});

export function meDeleteRoutes(app: OpenAPIHono<Env>): void {
  app.use("/me/delete", requireAuth());
  app.use("/me/delete/*", requireAuth());

  app.openapi(deleteRoute, async (c) => {
    const principal = c.get("principal");
    if (principal === undefined) {
      return c.json(
        problem(401, "Not authenticated", ProblemType.Unauthorized, {
          instance: c.req.path,
          request_id: c.get("requestId"),
        }),
        401,
        { "content-type": "application/problem+json" },
      );
    }

    const { password } = c.req.valid("json");
    const db = getDb(c.env);

    const user = await findUserById(db, principal.id);
    if (user === null) {
      return c.json(
        problem(401, "Invalid credentials", ProblemType.Unauthorized, {
          instance: c.req.path,
          request_id: c.get("requestId"),
        }),
        401,
        { "content-type": "application/problem+json" },
      );
    }

    const settings = new SettingsService({ db, kv: c.env.SETTINGS });
    const graceSeconds = await settings.get("privacy.deletion_grace_seconds");

    const result = await requestDeletion(
      { db, env: c.env, kv: c.env.SESSIONS },
      { userId: principal.id, email: user.email, password, graceSeconds },
    );

    if (result.kind !== "ok") {
      return c.json(
        problem(401, "Invalid credentials", ProblemType.Unauthorized, {
          instance: c.req.path,
          request_id: c.get("requestId"),
        }),
        401,
        { "content-type": "application/problem+json" },
      );
    }

    return c.json({ scheduled_completion_at: result.scheduledCompletionAt }, 202);
  });

  app.openapi(cancelRoute, async (c) => {
    const principal = c.get("principal");
    if (principal === undefined) {
      return c.json(
        problem(401, "Not authenticated", ProblemType.Unauthorized, {
          instance: c.req.path,
          request_id: c.get("requestId"),
        }),
        401,
        { "content-type": "application/problem+json" },
      );
    }

    const db = getDb(c.env);
    const result = await cancelDeletion(
      { db, env: c.env, kv: c.env.SESSIONS },
      principal.id,
    );

    if (result.kind === "ok") {
      return c.json({ cancelled: true as const }, 200);
    }

    return c.json(
      problem(
        409,
        result.kind === "grace-elapsed"
          ? "Deletion already completed"
          : "No pending deletion",
        ProblemType.Conflict,
        {
          instance: c.req.path,
          request_id: c.get("requestId"),
        },
      ),
      409,
      { "content-type": "application/problem+json" },
    );
  });
}
