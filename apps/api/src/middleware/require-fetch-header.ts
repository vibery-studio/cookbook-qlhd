import { HTTPException } from "hono/http-exception";
import type { MiddlewareHandler } from "hono";
import type { Bindings } from "../env";
import type { Variables } from "../openapi";
import { problem, ProblemType, PROBLEM_TYPE_BASE } from "../dto/error";

type Env = { Bindings: Bindings; Variables: Variables };

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * CSRF defense (leg 2 of 2): reject state-changing requests missing the
 * `X-Requested-With: fetch` custom header. Browsers block cross-origin
 * custom headers via the CORS preflight mechanism, so only same-origin
 * JS can set this — meaning a cross-origin `<form>` POST or plain
 * navigation-initiated POST from an attacker page can't include it.
 *
 * Combined with `requireOrigin`, this gives two independent CSRF gates
 * (Origin equality + custom-header preflight); either one alone would
 * block same-origin CSRF, and both together create defense in depth.
 */
export function requireFetchHeader(): MiddlewareHandler<Env> {
  return async (c, next) => {
    if (!STATE_CHANGING_METHODS.has(c.req.method)) return next();

    const header = c.req.header("X-Requested-With");
    if (header !== "fetch") {
      throw new HTTPException(403, {
        res: c.json(
          problem(403, "Forbidden", ProblemType.Forbidden, {
            type: `${PROBLEM_TYPE_BASE}/${ProblemType.Forbidden}`,
            detail: "X-Requested-With: fetch header required on state-changing requests",
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
