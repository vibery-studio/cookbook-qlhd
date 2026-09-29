import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import {
  CreateCustomerBody,
  CustomerListQuery,
  CustomerListResponse,
  CustomerSchema,
  UpdateCustomerBody,
} from "../dto/customers";
import { UlidSchema } from "../dto/common";
import { problem, ProblemType, problemResponse } from "../dto/error";
import { IdempotencyKeyHeader } from "../dto/users";
import type { Bindings } from "../env";
import type { Variables } from "../openapi";
import { requireAuth } from "../middleware/auth";
import { withIdempotency } from "../middleware/idempotency";
import { requirePerm } from "../middleware/require-permission";
import { getDb } from "../db/client";
import {
  createCustomer,
  getCustomerById,
  searchCustomers,
  updateCustomer,
} from "../services/customer-service";

type Env = { Bindings: Bindings; Variables: Variables };

const IdParam = z.object({ id: UlidSchema });
const security = [{ cookieAuth: [] }];

const PROBLEM_HEADERS = { "content-type": "application/problem+json" } as const;

const listRoute = createRoute({
  method: "get",
  path: "/customers",
  tags: ["customers"],
  summary: "Search / list customers (cursor-paginated)",
  security,
  request: { query: CustomerListQuery },
  responses: {
    200: {
      description: "Customers",
      content: { "application/json": { schema: CustomerListResponse } },
    },
    401: problemResponse("Not authenticated"),
    403: problemResponse("Missing contract:read permission"),
    422: problemResponse("Validation failed"),
    501: problemResponse("Not implemented"),
  },
});

const getRoute = createRoute({
  method: "get",
  path: "/customers/{id}",
  tags: ["customers"],
  summary: "Get a customer",
  security,
  request: { params: IdParam },
  responses: {
    200: { description: "Customer", content: { "application/json": { schema: CustomerSchema } } },
    401: problemResponse("Not authenticated"),
    403: problemResponse("Missing contract:read permission"),
    404: problemResponse("Customer not found"),
    501: problemResponse("Not implemented"),
  },
});

const createCustomerRoute = createRoute({
  method: "post",
  path: "/customers",
  tags: ["customers"],
  summary: "Create a customer (blocks duplicate phone / tax code)",
  security,
  request: {
    headers: IdempotencyKeyHeader,
    body: { content: { "application/json": { schema: CreateCustomerBody } } },
  },
  responses: {
    201: {
      description: "Customer created",
      content: { "application/json": { schema: CustomerSchema } },
    },
    401: problemResponse("Not authenticated"),
    403: problemResponse("Missing contract:write permission"),
    409: problemResponse("duplicate phone or tax code; body carries existing_id"),
    422: problemResponse("Validation failed"),
    501: problemResponse("Not implemented"),
  },
});

const updateCustomerRoute = createRoute({
  method: "patch",
  path: "/customers/{id}",
  tags: ["customers"],
  summary: "Update a customer (optimistic lock by expected_version)",
  security,
  request: {
    params: IdParam,
    body: { content: { "application/json": { schema: UpdateCustomerBody } } },
  },
  responses: {
    200: {
      description: "Customer updated (version + 1)",
      content: { "application/json": { schema: CustomerSchema } },
    },
    401: problemResponse("Not authenticated"),
    403: problemResponse("Missing contract:write permission"),
    404: problemResponse("Customer not found"),
    409: problemResponse("stale (version mismatch) or duplicate (body carries existing_id)"),
    422: problemResponse("Validation failed"),
    501: problemResponse("Not implemented"),
  },
});

export function customersRoutes(app: OpenAPIHono<Env>): void {
  app.on("get", ["/customers", "/customers/:id"], requireAuth(), requirePerm("contract:read"));
  app.on(
    "post",
    "/customers",
    requireAuth(),
    requirePerm("contract:write"),
    withIdempotency(),
  );
  app.on("patch", "/customers/:id", requireAuth(), requirePerm("contract:write"));

  app.openapi(listRoute, async (c) => {
    const res = await searchCustomers(getDb(c.env), c.req.valid("query"));
    if (res.kind === "invalid") {
      return c.json(
        problem(422, "Validation failed", ProblemType.Validation, {
          errors: res.errors,
          instance: c.req.path,
          request_id: c.get("requestId"),
        }),
        422,
        PROBLEM_HEADERS,
      );
    }
    return c.json({ items: res.items, next_cursor: res.next_cursor }, 200);
  });

  app.openapi(getRoute, async (c) => {
    const customer = await getCustomerById(getDb(c.env), c.req.valid("param").id);
    if (customer === null) {
      return c.json(
        problem(404, "Customer not found", ProblemType.NotFound, {
          instance: c.req.path,
          request_id: c.get("requestId"),
        }),
        404,
        PROBLEM_HEADERS,
      );
    }
    return c.json(customer, 200);
  });

  app.openapi(createCustomerRoute, async (c) => {
    const principal = c.get("principal")!;
    const res = await createCustomer(getDb(c.env), principal.id, c.req.valid("json"));
    if (res.kind === "invalid") {
      return c.json(
        problem(422, "Validation failed", ProblemType.Validation, {
          errors: res.errors,
          instance: c.req.path,
          request_id: c.get("requestId"),
        }),
        422,
        PROBLEM_HEADERS,
      );
    }
    if (res.kind === "duplicate") {
      return c.json(
        problem(409, "Customer already exists", ProblemType.Duplicate, {
          detail: "A customer with this phone number or tax code already exists.",
          existing_id: res.existingId,
          instance: c.req.path,
          request_id: c.get("requestId"),
        }),
        409,
        PROBLEM_HEADERS,
      );
    }
    return c.json(res.customer, 201);
  });

  app.openapi(updateCustomerRoute, async (c) => {
    const principal = c.get("principal")!;
    const res = await updateCustomer(
      getDb(c.env),
      principal.id,
      c.req.valid("param").id,
      c.req.valid("json"),
    );
    const base = { instance: c.req.path, request_id: c.get("requestId") };
    switch (res.kind) {
      case "ok":
        return c.json(res.customer, 200);
      case "not_found":
        return c.json(problem(404, "Customer not found", ProblemType.NotFound, base), 404, PROBLEM_HEADERS);
      case "stale":
        return c.json(
          problem(409, "Customer was changed by someone else", ProblemType.Stale, {
            ...base,
            detail: "expected_version is out of date; reload the customer and retry.",
          }),
          409,
          PROBLEM_HEADERS,
        );
      case "duplicate":
        return c.json(
          problem(409, "Customer already exists", ProblemType.Duplicate, {
            ...base,
            detail: "A customer with this phone number or tax code already exists.",
            existing_id: res.existingId,
          }),
          409,
          PROBLEM_HEADERS,
        );
      case "invalid":
        return c.json(
          problem(422, "Validation failed", ProblemType.Validation, { ...base, errors: res.errors }),
          422,
          PROBLEM_HEADERS,
        );
    }
  });
}
