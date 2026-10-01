import { createRoute } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Context, MiddlewareHandler } from "hono";
import { problem, problemResponse, ProblemType } from "../dto/error";
import {
  AccessReviewIdParam,
  AccessReviewItemParam,
  AccessReviewItemSchema,
  AccessReviewSchema,
  CurrentAccessReviewResponse,
  DecideReviewItemBody,
} from "../dto/access-review";
import { getDb } from "../db/client";
import type { ReviewDto } from "../dao/access-review-dao";
import type { Bindings } from "../env";
import type { Variables } from "../openapi";
import { requireAuth } from "../middleware/auth";
import { requirePerm } from "../middleware/require-permission";
import {
  closeReview,
  currentReview,
  decideItem,
  openReview,
  type AccessReviewDeps,
  type DeniedRule,
  type ReviewItemView,
} from "../services/access-review-service";

/** SPEC-07 §3.2 / PLAN-07 §2b — quarterly access reviews (FR-7/8, DEC-10..12). Routes own `c`; the service does the work. */

type Env = { Bindings: Bindings; Variables: Variables };

const security = [{ cookieAuth: [] }];
const PROBLEM_HEADERS = { "content-type": "application/problem+json" } as const;
const tags = ["access-reviews"];

function deps(c: Context<Env>): AccessReviewDeps {
  return { db: getDb(c.env), kv: c.env.SESSIONS, env: c.env, now: () => Math.floor(Date.now() / 1000) };
}

const ip = (c: Context<Env>) => c.req.header("cf-connecting-ip") ?? null;

const reviewDto = (r: ReviewDto) => ({
  id: r.id,
  period: r.period,
  status: r.status,
  opened_by: r.openedBy,
  opened_at: r.openedAt,
  due_at: r.dueAt,
  closed_at: r.closedAt,
});

const itemDto = (i: ReviewItemView) => ({
  user: { id: i.userId, display_name: i.displayName },
  role: { name: i.roleName, label: i.roleLabel },
  decision: i.decision,
  decided_by_name: i.decidedByName,
  decided_at: i.decidedAt,
  state: i.state,
  can: i.can,
  locked_reason: i.lockedReason,
});

const RULE_DETAIL: Record<DeniedRule, string> = {
  jit_actor: "Quyền quản trị tạm thời không dùng để rà soát quyền.",
  self_review: "Không tự rà soát chính mình — người quản trị xác nhận.",
  admin_only: "Chỉ Quản trị hệ thống mới khóa được tài khoản quản trị.",
  not_reviewer: "Bạn chỉ xác nhận được dòng của người có quyền rà soát.",
};

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

  app.openapi(currentRoute, async (c) => {
    const actor = c.get("principal")!;
    const view = await currentReview(deps(c), { actorId: actor.id });
    return c.json(
      {
        review: view.review === null ? null : reviewDto(view.review),
        items: view.items.map(itemDto),
        progress: view.progress,
        overdue: view.overdue,
      },
      200,
    );
  });

  app.openapi(openRoute, async (c) => {
    const actor = c.get("principal")!;
    const res = await openReview(deps(c), { actorId: actor.id });
    if (res.kind === "duplicate") {
      return c.json(
        problem(409, "Quý này đã có đợt rà soát", ProblemType.Duplicate, { instance: c.req.path, request_id: c.get("requestId") }),
        409,
        PROBLEM_HEADERS,
      );
    }
    return c.json(reviewDto(res.review), 201);
  });

  app.openapi(decideRoute, async (c) => {
    const { id, userId } = c.req.valid("param");
    const body = c.req.valid("json");
    const actor = c.get("principal")!;
    const res = await decideItem(deps(c), { actorId: actor.id, reviewId: id, userId, decision: body.decision, ip: ip(c) });
    const opts = { instance: c.req.path, request_id: c.get("requestId") };
    switch (res.kind) {
      case "not-found":
        return c.json(problem(404, "Không tìm thấy dòng rà soát", ProblemType.NotFound, opts), 404, PROBLEM_HEADERS);
      case "forbidden":
        return c.json(
          problem(403, "Forbidden", ProblemType.Forbidden, { ...opts, detail: RULE_DETAIL[res.rule], rule: res.rule }),
          403,
          PROBLEM_HEADERS,
        );
      case "review-closed":
        return c.json(problem(409, "Đợt rà soát đã đóng", ProblemType.ReviewClosed, opts), 409, PROBLEM_HEADERS);
      case "item-changed":
        return c.json(
          problem(409, "Dòng đã thay đổi từ khi mở đợt", ProblemType.ItemChanged, opts),
          409,
          PROBLEM_HEADERS,
        );
      case "last-admin":
        return c.json(
          problem(409, "Không thể khóa quản trị cuối cùng", ProblemType.LastAdmin, opts),
          409,
          PROBLEM_HEADERS,
        );
      case "ok":
        return c.json(itemDto(res.item), 200);
    }
  });

  app.openapi(closeRoute, async (c) => {
    const { id } = c.req.valid("param");
    const actor = c.get("principal")!;
    const res = await closeReview(deps(c), { actorId: actor.id, reviewId: id });
    const opts = { instance: c.req.path, request_id: c.get("requestId") };
    switch (res.kind) {
      case "not-found":
        return c.json(problem(404, "Không tìm thấy đợt rà soát", ProblemType.NotFound, opts), 404, PROBLEM_HEADERS);
      case "review-closed":
        return c.json(problem(409, "Đợt rà soát đã đóng", ProblemType.ReviewClosed, opts), 409, PROBLEM_HEADERS);
      case "review-incomplete":
        return c.json(
          problem(409, "Còn dòng chưa quyết", ProblemType.ReviewIncomplete, opts),
          409,
          PROBLEM_HEADERS,
        );
      case "ok":
        return c.json(reviewDto(res.review), 200);
    }
  });
}
