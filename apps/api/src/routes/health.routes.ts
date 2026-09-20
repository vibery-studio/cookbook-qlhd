/**
 * Health endpoints. Two distinct surfaces:
 *
 * `/healthz` (SHALLOW, public) — a constant-time load-balancer probe.
 * Zero external calls. Returns `{ok, build_sha}` in ~1ms. Safe to hit
 * from any client at any rate; not rate-limited so a broken probe
 * doesn't accidentally lock out real health-checks.
 *
 * `/readyz` (DEEP, token-gated, rate-limited) — probes D1 + KV to
 * verify the app can actually serve requests. Requires an
 * `X-Readyz-Token` header matching `env.READYZ_TOKEN` so the endpoint
 * can't be used as a probe-based side-channel to trigger DB reads
 * from any caller. Rate-limited via `RL_READYZ` (60/min per IP).
 */
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Bindings } from "../env";
import type { Variables } from "../openapi";
import { problem, ProblemType } from "../dto/error";
import { rateLimit, clientIp } from "../middleware/rate-limit";
import { getDb } from "../db/client";
import { sql } from "drizzle-orm";

type Env = { Bindings: Bindings; Variables: Variables };

const READYZ_TIMEOUT_MS = 200;

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T | "timeout"> {
  // Cleared in the finally so a fast-resolving underlying promise
  // doesn't leave a live setTimeout in the isolate's event queue
  // (60 probes/min at 200ms = 60 dangling timers per minute).
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Constant-time string compare, sufficient for the READYZ_TOKEN
 * gate. Native `!==` on strings short-circuits at the first
 * differing byte — over enough requests an attacker can measure
 * per-byte timing to guess prefix bytes. Hashing both sides via
 * SHA-256 and XOR-comparing bytes eliminates the leak.
 */
async function constantTimeStringEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const ah = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(a)));
  const bh = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(b)));
  let diff = ah.length ^ bh.length;
  for (let i = 0; i < ah.length; i++) {
    diff |= (ah[i] ?? 0) ^ (bh[i] ?? 0);
  }
  return diff === 0;
}

async function checkD1(env: Bindings): Promise<"ok" | "fail" | "timeout"> {
  try {
    const db = getDb(env);
    const result = await withTimeout(
      db.run(sql`SELECT 1 as ok`),
      READYZ_TIMEOUT_MS,
    );
    if (result === "timeout") return "timeout";
    return "ok";
  } catch {
    return "fail";
  }
}

async function checkKv(env: Bindings): Promise<"ok" | "fail" | "timeout"> {
  try {
    // A GET on a non-existent key is the cheapest liveness probe;
    // KV returns null quickly without a round trip to origin.
    const result = await withTimeout(
      env.SESSIONS.get("__readyz_probe__"),
      READYZ_TIMEOUT_MS,
    );
    if (result === "timeout") return "timeout";
    return "ok";
  } catch {
    return "fail";
  }
}

export function healthRoutes(app: OpenAPIHono<Env>): void {
  // Shallow probe — no auth, no rate limit, no DB.
  app.get("/healthz", (c) =>
    c.json({ ok: true, build_sha: c.env.BUILD_SHA }, 200),
  );

  // Deep probe — token gate + rate limit + real DB/KV round trips.
  app.on(
    "get",
    "/readyz",
    rateLimit({
      binding: "RL_READYZ",
      keyFn: (c) => `readyz:${clientIp(c)}`,
      // Probes must not lock themselves out if the binding
      // disappears — fail-open here is the safer default.
      failClosedOnMissingBinding: false,
    }),
  );

  app.get("/readyz", async (c) => {
    const token = c.req.header("x-readyz-token");
    const configured =
      typeof c.env.READYZ_TOKEN === "string" && c.env.READYZ_TOKEN !== "";
    const tokenOk =
      configured && token !== undefined
        ? await constantTimeStringEqual(token, c.env.READYZ_TOKEN)
        : false;
    if (!tokenOk) {
      return c.json(
        problem(401, "readyz requires token", ProblemType.Unauthorized, {
          instance: c.req.path,
          request_id: c.get("requestId"),
        }),
        401,
        { "content-type": "application/problem+json" },
      );
    }

    const started = Date.now();
    const [db, kv] = await Promise.all([checkD1(c.env), checkKv(c.env)]);
    const allOk = db === "ok" && kv === "ok";

    return c.json(
      {
        ok: allOk,
        build_sha: c.env.BUILD_SHA,
        checks: { db, kv },
        duration_ms: Date.now() - started,
      },
      allOk ? 200 : 503,
    );
  });
}
