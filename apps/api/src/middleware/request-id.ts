import type { MiddlewareHandler } from "hono";
import { generateUlid } from "../utils/id";

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/**
 * Reads `X-Request-Id` from the incoming request. If missing or not a valid
 * ULID, generates a fresh one. Stores it on context as `requestId` (see
 * `Variables` in `openapi.ts`) and echoes it back on the response so
 * clients/log correlation always see the value the server actually used.
 */
export function requestId(): MiddlewareHandler<{ Variables: { requestId: string } }> {
  return async (c, next) => {
    const incoming = c.req.header("X-Request-Id");
    const id = incoming && ULID_RE.test(incoming) ? incoming : generateUlid();

    c.set("requestId", id);
    c.header("X-Request-Id", id);

    await next();
  };
}
