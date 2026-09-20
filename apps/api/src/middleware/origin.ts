import { HTTPException } from "hono/http-exception";
import type { MiddlewareHandler } from "hono";
import { verifyOrigin } from "@runway/auth";
import type { Bindings } from "../env";
import type { Variables } from "../openapi";
import { problem, ProblemType, PROBLEM_TYPE_BASE } from "../dto/error";

type Env = { Bindings: Bindings; Variables: Variables };

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * CSRF defense (leg 1 of 2): reject state-changing requests whose `Origin`
 * header doesn't case-sensitively match `env.APP_ORIGIN`. SameSite=Strict
 * cookies + this check together block same-origin CSRF AND login-CSRF
 * (attacker's page POSTing to /auth/login from a different origin can't
 * forge Origin — browsers always set it correctly for cross-origin POSTs).
 *
 * Skips GET/HEAD/OPTIONS — those don't mutate state, and preflight OPTIONS
 * requests carry an `Origin` we'd otherwise reject before CORS gets to
 * respond.
 */
export function requireOrigin(): MiddlewareHandler<Env> {
  return async (c, next) => {
    if (!STATE_CHANGING_METHODS.has(c.req.method)) return next();

    const origin = c.req.header("Origin");
    if (!verifyOrigin(origin, c.env.APP_ORIGIN)) {
      throw new HTTPException(403, {
        res: c.json(
          problem(403, "Forbidden", ProblemType.Forbidden, {
            type: `${PROBLEM_TYPE_BASE}/${ProblemType.Forbidden}`,
            detail: "Origin header missing or does not match APP_ORIGIN",
            instance: c.req.path,
            request_id: c.get("requestId"),
          }),
          403,
        ),
      });
    }

    return next();
  };
}
