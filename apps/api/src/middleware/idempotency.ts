/**
 * Idempotency middleware. Guards protected mutating routes so a
 * retried request never produces a duplicate side effect. The
 * `Idempotency-Key` header is OPTIONAL — routes still function
 * without it — but when present it MUST come from an authenticated
 * principal (RedTeam F7: unauthenticated header would let an attacker
 * poison the cache for the whole namespace).
 *
 * Wire this AFTER `requireAuth` on any route that should honor the
 * header. See `routes/demo.routes.ts` for the reference wiring.
 *
 * Concurrency: two same-key requests race on a CAS `INSERT OR IGNORE`
 * against `idempotency_keys`. Winner executes the handler + captures
 * the 2xx response. Loser polls the row for up to 5s; if the winner
 * completes, loser serves the cached body; if the winner is still
 * running past the timeout, loser gets a 425 Too Early with
 * `Retry-After: 1`.
 */
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import type { Context, MiddlewareHandler } from "hono";
import { z } from "zod";
import {
  deleteSentinel,
  findIdempotencyRow,
  pollUntilComplete,
  tryInsertSentinel,
  updateResponse,
} from "../dao/idempotency-dao";
import { getDb } from "../db/client";
import { problem, ProblemType } from "../dto/error";
import type { Bindings } from "../env";
import type { Variables } from "../openapi";

type Env = { Bindings: Bindings; Variables: Variables };

/** 24h TTL — matches typical payments-industry idempotency window. */
const DEFAULT_TTL_SECONDS = 24 * 60 * 60;
/** Max wait time for the losing side of a same-key race. */
const POLL_TIMEOUT_MS = 5_000;

/**
 * Header validator: accept ULID (26 chars, Crockford base32) or
 * UUID (36 chars incl. dashes). Rejecting arbitrary strings prevents
 * clients from creating unbounded rows via absurd-length keys.
 */
const IdempotencyKeyHeaderSchema = z
  .union([
    z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/i, "not a valid ULID"),
    z.string().uuid(),
  ])
  .describe("Idempotency-Key");

export interface WithIdempotencyOptions {
  ttlSeconds?: number;
}

export function withIdempotency(
  options: WithIdempotencyOptions = {},
): MiddlewareHandler<Env> {
  const ttl = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;

  return async (c, next) => {
    const header = c.req.header("Idempotency-Key");
    if (header === undefined || header === "") {
      // Opt-in header — no side effects; call downstream and go.
      await next();
      return;
    }

    const principal = c.get("principal");
    if (principal === undefined) {
      // Unauth request with a header would let an attacker poison
      // the shared namespace. Reject loudly.
      return c.json(
        problem(
          400,
          "Idempotency-Key requires authentication",
          ProblemType.IdempotencyRequiresAuth,
          {
            instance: c.req.path,
            request_id: c.get("requestId"),
          },
        ),
        400,
        { "content-type": "application/problem+json" },
      );
    }

    // Validate header format.
    const parsed = IdempotencyKeyHeaderSchema.safeParse(header);
    if (!parsed.success) {
      return c.json(
        problem(422, "Invalid Idempotency-Key header", ProblemType.Validation, {
          instance: c.req.path,
          request_id: c.get("requestId"),
          detail: parsed.error.message,
        }),
        422,
        { "content-type": "application/problem+json" },
      );
    }

    const db = getDb(c.env);
    const now = Math.floor(Date.now() / 1000);
    const path = new URL(c.req.url).pathname;

    // Normalize the header casing before hashing. Zod's regex accepts
    // ULID in either case; without normalization a client that retries
    // with the same logical id but different casing (`01ARZ...` vs
    // `01arz...`) computes a different cache key and bypasses
    // idempotency. UUID canonical form is lowercase, ULID is
    // uppercase — pick uppercase for both.
    const normalizedHeader = parsed.data.toUpperCase();

    // Namespace the key: principal + method + path + header. sha256
    // bounds PK length; also hides raw client tokens from operator
    // dumps.
    const keyRaw = `${principal.id}:${c.req.method}:${path}:${normalizedHeader}`;
    const cacheKey = hexHash(keyRaw);

    // Compute a request hash so a second call with the same header
    // but a different body → 409 Conflict. Body-read is one-shot
    // in Hono; use `req.text()` and hash the raw string.
    const body = await c.req.text();
    const contentType = c.req.header("content-type") ?? "";
    const contentLength = c.req.header("content-length") ?? "";
    const requestHash = hexHash(
      `${c.req.method}:${path}:${contentType}:${contentLength}:${body}`,
    );

    // Try to claim the sentinel row.
    const won = await tryInsertSentinel(db, {
      key: cacheKey,
      requestHash,
      createdAt: now,
      expiresAt: now + ttl,
    });

    if (!won) {
      // Someone else is executing or already finished.
      let row = await findIdempotencyRow(db, cacheKey);
      if (row === null) {
        // Sentinel disappeared mid-race (previous handler returned
        // non-2xx and deleted the row). Fall through to a fresh
        // attempt: reinject the consumed body first so the downstream
        // handler's `.valid('json')` still parses.
        reinjectBody(c, body);
        await next();
        return;
      }
      if (row.requestHash !== requestHash) {
        return c.json(
          problem(
            409,
            "Idempotency-Key reused with different request body",
            ProblemType.IdempotencyConflict,
            {
              instance: c.req.path,
              request_id: c.get("requestId"),
            },
          ),
          409,
          { "content-type": "application/problem+json" },
        );
      }
      if (row.responseStatus !== null && row.responseBody !== null) {
        return serveCached(c, row.responseStatus, row.responseBody);
      }

      // In-flight. Poll.
      row = await pollUntilComplete(db, cacheKey, POLL_TIMEOUT_MS);
      if (row !== null && row.responseStatus !== null && row.responseBody !== null) {
        return serveCached(c, row.responseStatus, row.responseBody);
      }

      // Still running past the timeout. Signal the client to retry.
      return c.json(
        problem(
          425,
          "Idempotent request still in flight; retry",
          ProblemType.IdempotencyInFlight,
          {
            instance: c.req.path,
            request_id: c.get("requestId"),
          },
        ),
        425,
        {
          "content-type": "application/problem+json",
          "retry-after": "1",
        },
      );
    }

    // We won the CAS — execute the handler. Refill the body so the
    // route can re-read it (we already consumed it via `req.text()`).
    reinjectBody(c, body);

    // Wrap `next()` in try/catch so a thrown handler (DB failure,
    // HTTPException, unexpected exception) doesn't orphan the
    // sentinel row. A leftover NULL-status sentinel would make
    // every retry within the 24h TTL wait 5s then 425, blocking
    // legitimate retries after a transient failure.
    let handlerError: unknown = undefined;
    try {
      await next();
    } catch (err) {
      handlerError = err;
    }

    if (handlerError !== undefined) {
      await deleteSentinel(db, cacheKey);
      // Re-throw the original error unchanged. The `only-throw-error`
      // rule wants an Error instance — we may have caught anything
      // (HTTPException, Error, or a bare value), so wrap non-Error
      // throws in a generic Error to satisfy the lint and preserve
      // stack information via the `cause` chain.
      if (handlerError instanceof Error) throw handlerError;
      throw new Error(
        typeof handlerError === "string"
          ? handlerError
          : JSON.stringify(handlerError),
      );
    }

    // Only cache 2xx responses.
    const res = c.res;
    if (res.status >= 200 && res.status < 300) {
      // Clone the response so we can read the body without consuming
      // the one the framework will ship. Persist response headers too
      // so cache-hit replays preserve `Location`, `ETag`, etc.
      const clone = res.clone();
      const responseBody = await clone.text();
      const headers: Record<string, string> = {};
      clone.headers.forEach((value, key) => {
        // Skip hop-by-hop / stream headers Hono manages itself.
        const lower = key.toLowerCase();
        if (lower === "content-length" || lower === "transfer-encoding") return;
        headers[key] = value;
      });
      const responseBodyEnvelope = JSON.stringify({ headers, body: responseBody });
      await updateResponse(db, {
        key: cacheKey,
        responseStatus: res.status,
        responseBody: responseBodyEnvelope,
      });
    } else {
      // Non-2xx: don't cache. Delete the sentinel so a retry can
      // re-attempt without hitting the 409/425 paths.
      await deleteSentinel(db, cacheKey);
    }
  };
}

interface CachedEnvelope {
  headers: Record<string, string>;
  body: string;
}

function serveCached(c: Context<Env>, status: number, envelopeJson: string): Response {
  let envelope: CachedEnvelope;
  try {
    envelope = JSON.parse(envelopeJson) as CachedEnvelope;
  } catch {
    // Legacy row (pre-envelope) or corrupt JSON — serve the raw
    // string as body with a safe default content-type.
    envelope = { headers: { "content-type": "application/json" }, body: envelopeJson };
  }
  const headers = new Headers(envelope.headers);
  headers.set("idempotency-replay", "true");
  const requestId = c.get("requestId");
  if (typeof requestId === "string" && requestId !== "") {
    headers.set("x-request-id", requestId);
  }
  return new Response(envelope.body, { status, headers });
}

function hexHash(raw: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(raw)));
}

/**
 * Re-inject a consumed body onto `c.req` so downstream handlers can
 * still call `c.req.text()` / `.json()`. Hono's Request wrapper reads
 * from `raw.body`, so we replace `raw` with a fresh Request built
 * from the buffered body string.
 */
function reinjectBody(c: Context<Env>, body: string): void {
  const rebuilt = new Request(c.req.raw.url, {
    method: c.req.raw.method,
    headers: c.req.raw.headers,
    body: body.length > 0 ? body : undefined,
  });
  // Hono exposes `c.req.raw` — assign the rebuilt Request so
  // subsequent body reads succeed.
  (c.req as { raw: Request }).raw = rebuilt;
}
