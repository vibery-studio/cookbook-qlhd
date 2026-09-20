import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { problem, ProblemDto, ProblemType } from "../dto/error";
import { TimestampSchema, UlidSchema } from "../dto/common";
import { CursorQuery, paginatedResponse } from "../dto/pagination";
import type { Bindings } from "../env";
import type { Variables } from "../openapi";
import { bodyLimit } from "hono/body-limit";
import { getDb } from "../db/client";
import { createNote } from "../dao/notes-dao";
import { requireAuth } from "../middleware/auth";
import { requirePerm } from "../middleware/require-permission";
import { withIdempotency } from "../middleware/idempotency";
import { generateUlid } from "../utils/id";

/** 2MB body cap for POST /demo/notes — protects the isolate memory
 * against attackers spamming multi-megabyte bodies through the
 * idempotency middleware (which buffers the whole body for hashing). */
const NOTES_MAX_BODY_BYTES = 2 * 1024 * 1024;

/**
 * Demo `notes` resource (Phase 4 stub; Phase 9 wires idempotency). Exists to
 * prove the "add a new resource" recipe end-to-end (plan.md Goal 8) and to
 * exercise the idempotency middleware once implemented. `Idempotency-Key`
 * is ULID/UUID only (Zod-enforced) and namespaced
 * `${principalId}:${method}:${path}:${header}` per plan.md Locked Decisions.
 */

type Env = { Bindings: Bindings; Variables: Variables };

const IdempotencyKeyHeader = z.object({
  "Idempotency-Key": z
    .string()
    .regex(
      /^([0-9A-HJKMNP-TV-Z]{26}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/,
      "must be a ULID or UUID",
    )
    .optional(),
});

const CreateNoteBody = z
  .object({
    title: z.string().min(1).max(200),
    body: z.string().min(1).max(10_000),
  })
  .openapi("CreateNoteRequest");

const NoteItem = z
  .object({
    id: UlidSchema,
    title: z.string(),
    body: z.string(),
    createdAt: TimestampSchema,
  })
  .openapi("Note");

// The list route is still a stub — Phase 11 wires it as part of the
// golden-path e2e recipe. Keeping the shape so OpenAPI stays stable.
function notImplemented(c: Context<Env>) {
  return c.json(
    problem(501, "Not Implemented", ProblemType.NotImplemented, {
      instance: c.req.path,
      request_id: c.get("requestId"),
    }),
    501,
  );
}

const createNoteRoute = createRoute({
  method: "post",
  path: "/demo/notes",
  tags: ["demo"],
  summary: "Create a note (idempotency demo)",
  security: [{ cookieAuth: [] }],
  request: {
    headers: IdempotencyKeyHeader,
    body: { content: { "application/json": { schema: CreateNoteBody } } },
  },
  responses: {
    201: {
      description: "Note created",
      content: { "application/json": { schema: NoteItem } },
    },
    400: {
      description: "Idempotency-Key present without authentication",
      content: { "application/json": { schema: ProblemDto } },
    },
    401: {
      description: "Not authenticated",
      content: { "application/json": { schema: ProblemDto } },
    },
    403: {
      description: "Missing notes:write permission",
      content: { "application/json": { schema: ProblemDto } },
    },
    409: {
      description: "Idempotency key reused with a different request body",
      content: { "application/json": { schema: ProblemDto } },
    },
    422: {
      description: "Validation failed",
      content: { "application/json": { schema: ProblemDto } },
    },
    425: {
      description: "Idempotency key request already in flight",
      content: { "application/json": { schema: ProblemDto } },
    },
    501: {
      description: "Not implemented",
      content: { "application/json": { schema: ProblemDto } },
    },
  },
});

const listNotesRoute = createRoute({
  method: "get",
  path: "/demo/notes",
  tags: ["demo"],
  summary: "List notes (cursor-paginated)",
  security: [{ cookieAuth: [] }],
  request: { query: CursorQuery },
  responses: {
    200: {
      description: "Paginated note list",
      content: { "application/json": { schema: paginatedResponse(NoteItem) } },
    },
    401: {
      description: "Not authenticated",
      content: { "application/json": { schema: ProblemDto } },
    },
    403: {
      description: "Missing notes:read permission",
      content: { "application/json": { schema: ProblemDto } },
    },
    501: {
      description: "Not implemented",
      content: { "application/json": { schema: ProblemDto } },
    },
  },
});

export function demoRoutes(app: OpenAPIHono<Env>): void {
  // Order matters: requireAuth populates principal → requirePerm checks
  // it → withIdempotency guards against duplicate side effects.
  // Method-scoped via `app.on('post', ...)` so GET /demo/notes (still
  // a 501 stub) doesn't demand auth or idempotency.
  app.on(
    "post",
    "/demo/notes",
    bodyLimit({ maxSize: NOTES_MAX_BODY_BYTES }),
    requireAuth(),
    requirePerm("notes:write"),
    withIdempotency(),
  );

  app.openapi(createNoteRoute, async (c) => {
    const body = c.req.valid("json");
    const principal = c.get("principal");
    if (principal === undefined) {
      // requireAuth would have thrown; belt+braces.
      return c.json(
        problem(401, "Not authenticated", ProblemType.Unauthorized, {
          instance: c.req.path,
          request_id: c.get("requestId"),
        }),
        401,
      );
    }
    const db = getDb(c.env);
    const nowSeconds = Math.floor(Date.now() / 1000);
    const note = await createNote(db, {
      id: generateUlid(),
      userId: principal.id,
      title: body.title,
      body: body.body,
      createdAt: nowSeconds,
    });
    return c.json(
      {
        id: note.id,
        title: note.title,
        body: note.body,
        createdAt: note.createdAt,
      },
      201,
    );
  });

  // GET list still stubbed (Phase 11).
  app.openapi(listNotesRoute, notImplemented);
}
