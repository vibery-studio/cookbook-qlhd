import { createRoute } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Context, MiddlewareHandler } from "hono";
import { notImplementedProblem, problemResponse } from "../dto/error";
import {
  AccessReviewIdParam,
  AccessReviewItemParam,
  AccessReviewItemSchema,
  AccessReviewSchema,
  CurrentAccessReviewResponse,
  DecideReviewItemBody,
} from "../dto/access-review";
import type { Bindings } from "../env";
import type { Variables } from "../openapi";
import { requireAuth } from "../middleware/auth";
import { requirePerm } from "../middleware/require-permission";

/**
 * SPEC-07 §3.2 / PLAN-07 §2b — quarterly access reviews (FR-7/8, DEC-10..12). Contract only (C-07-002): handlers
 * answer 501 after the real middleware; C-07-006 fills them.
 */

type Env = { Bindings: Bindings; Variables: Variables };

const security = [{ cookieAuth: [] }];
const PROBLEM_HEADERS = { "content-type": "application/problem+json" } as const;
const tags = ["access-reviews"];

const notImplemented = (c: Context<Env>) =>
  c.json(notImplementedProblem(c.req.path, c.get("requestId")), 501, PROBLEM_HEADERS);

/** `reviews:write` OR `roles:write`; neither → the `roles:write` denial (403 + one permission.denied row). */
const reviewsOrRolesWrite: MiddlewareHandler<Env> = async (c, next) => {
  if (c.get("principal")?.permissions.includes("reviews:write")) return next();
  return requirePerm("roles:write")(c, next);
};

const currentRoute = createRoute({
  method: "get",
  path: "/access-reviews/current",
  tags,
  summary: "The open review (else this quarter's), its rows for the caller, progress and overdue",
  security,
  responses: {
    200: { description: "Current review (review:null when none)", content: { "application/json": { schema: CurrentAccessReviewResponse } } },
    401: problemResponse("Not authenticated"),
    403: problemResponse("Needs reviews:write or roles:write"),
    501: problemResponse("Not implemented"),
  },
});

const openRoute = createRoute({
  method: "post",
  path: "/access-reviews",
  tags,
  summary: "Open the review of the current quarter (Asia/Ho_Chi_Minh) if none exists",
  security,
  responses: {
    201: { description: "Review opened", content: { "application/json": { schema: AccessReviewSchema } } },
    401: problemResponse("Not authenticated"),
    403: problemResponse("Missing reviews:write"),
    409: problemResponse("duplicate (this quarter already has a review)"),
    501: problemResponse("Not implemented"),
  },
});

const decideRoute = createRoute({
  method: "post",
  path: "/access-reviews/{id}/items/{userId}",
  tags,
  summary: "Keep or remove (= disable the account) one row",
  security,
  request: {
    params: AccessReviewItemParam,
    body: { content: { "application/json": { schema: DecideReviewItemBody } } },
  },
  responses: {
    200: { description: "Row decided", content: { "application/json": { schema: AccessReviewItemSchema } } },
    401: problemResponse("Not authenticated"),
    403: problemResponse(
      "`forbidden` with rule jit_actor | self_review | admin_only, or not a reviewer of this row (reviews:write; the director's row: a permanent roles:write holder). One permission.denied row each.",
    ),
    404: problemResponse("Review or row not found"),
    409: problemResponse("review-closed | item-changed (role or status changed since the snapshot) | last-admin"),
    422: problemResponse("Validation failed"),
    501: problemResponse("Not implemented"),
  },
});

const closeRoute = createRoute({
  method: "post",
  path: "/access-reviews/{id}/close",
  tags,
  summary: "Close the review once every row is decided or changed",
  security,
  request: { params: AccessReviewIdParam },
  responses: {
    200: { description: "Closed", content: { "application/json": { schema: AccessReviewSchema } } },
    401: problemResponse("Not authenticated"),
    403: problemResponse("Missing reviews:write"),
    404: problemResponse("Review not found"),
    409: problemResponse("review-incomplete | review-closed"),
    501: problemResponse("Not implemented"),
  },
});

export function accessReviewsRoutes(app: OpenAPIHono<Env>): void {
  app.on("get", "/access-reviews/current", requireAuth(), reviewsOrRolesWrite);
  app.on("post", "/access-reviews", requireAuth(), requirePerm("reviews:write"));
  // row decisions: who may decide which row is decided in the service from D1 (C-07-006, R-11)
  app.on("post", "/access-reviews/:id/items/:userId", requireAuth());
  app.on("post", "/access-reviews/:id/close", requireAuth(), requirePerm("reviews:write"));

  app.openapi(currentRoute, (c) => notImplemented(c));
  app.openapi(openRoute, (c) => notImplemented(c));
  app.openapi(decideRoute, (c) => notImplemented(c));
  app.openapi(closeRoute, (c) => notImplemented(c));
}
