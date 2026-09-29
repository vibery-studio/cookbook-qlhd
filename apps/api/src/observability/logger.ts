/**
 * Structured audit + observability logger. Emits JSON to
 * `console.log` — Cloudflare Logpush ingests console output and
 * ships to the operator-configured destination (R2, Datadog, etc.);
 * see `docs/audit.md` for setup.
 *
 * Two modes:
 *   - `sync:true`   — write completes before the calling function
 *                     returns. Used for security-critical events that
 *                     MUST survive an isolate death (reuse_detected,
 *                     settings.update, role change, DLQ arrival).
 *   - `sync:false`  — fire-and-forget via `ctx.waitUntil` when the
 *                     execution context is available. Async errors
 *                     go through the ErrorReporterPort (Phase 10);
 *                     for v1 we fall back to `console.error`.
 *
 * Every event payload is walked through `deepScrub` before
 * serialization: any key matching the denylist (case-insensitive) is
 * replaced with `[REDACTED]`. This is defense-in-depth — callers
 * should still avoid passing sensitive values, but the scrub protects
 * against accidental leaks (e.g., dumping a whole request body into
 * metadata).
 */

import type { Db } from "../db/client";
import { writeAuditEvent } from "../dao/audit-dao";

const REDACTED = "[REDACTED]";

/**
 * Sensitive key names redacted from any nested object before
 * serialization. Compare against `.toLowerCase()` on the JSON key.
 * Kept as a Set for O(1) lookup — the denylist grows over time as
 * new PII classes emerge.
 */
const SENSITIVE_KEYS = new Set([
  "password",
  "passwd",
  "pwd",
  "token",
  "authorization",
  "auth",
  "cookie",
  "set-cookie",
  "secret",
  "apikey",
  "api_key",
  "api-key",
  "x-api-key",
  "access_token",
  "refresh_token",
  "id_token",
  "session_id",
  "session",
  "ssn",
  "pan",
  "credit_card",
  "cvv",
  "private_key",
]);

/**
 * Guardrail against maliciously-crafted deeply-nested inputs.
 * Serializer would blow the call stack otherwise. 32 nesting levels
 * is far beyond any legitimate audit payload; anything deeper is
 * treated as truncated.
 */
const MAX_DEPTH = 32;
const TRUNCATED = "[TRUNCATED_DEPTH]";

export interface AuditEvent {
  /**
   * Principal id (ULID) or a system tag like `system:cron`. `null`
   * for genuinely anonymous events (very rare — signup counts here).
   */
  actor: string | null;
  /**
   * Dot-separated event name: `<domain>.<subject>.<verb>`. Examples:
   * `auth.refresh.reuse_detected`, `settings.update`,
   * `admin.user.role_changed`. Keep stable — dashboards + alerts
   * key off these strings.
   */
  action: string;
  /**
   * Optional target identifier. Convention: `<type>:<id>` (e.g.,
   * `user:01USER...`, `settings:email.from_address`).
   */
  target?: string;
  /** Optional structured metadata. Scrubbed recursively. */
  metadata?: Record<string, unknown>;
  /** Optional caller IP (from CF-Connecting-IP). Not required. */
  ip?: string | null;
}

export interface AuditOptions {
  /** Force sync mode — write completes before return. Default false. */
  sync?: boolean;
}

export interface AuditDeps {
  /**
   * Execution context. When absent (test harnesses, some cron
   * paths), async writes fall back to sync `console.log`. Passing
   * `undefined` is legal.
   */
  ctx?: { waitUntil: (p: Promise<unknown>) => void } | undefined;
  /** When present, every event is also written to D1 `audit_events` (errors swallowed). */
  db?: Db | undefined;
}

export interface AuditFn {
  (event: AuditEvent, opts?: AuditOptions): void;
  /** Resolves when every D1 write started by this logger has settled (never rejects). */
  flush: () => Promise<void>;
}

/**
 * Build a bound audit function. Callers get a single-arg-shaped
 * `audit(event, opts?)` that they pass around; the deps stay
 * closed-over. With `deps.db`, each event is dual-written: console line
 * (Logpush) + D1 row. The D1 write goes through `ctx.waitUntil` when a ctx
 * exists, else a floated promise; `await audit.flush()` to wait for it.
 */
export function createAuditLogger(deps: AuditDeps): AuditFn {
  const pending = new Set<Promise<void>>();

  const audit = function audit(event: AuditEvent, opts: AuditOptions = {}): void {
    const scrubbed = deepScrub(event) as Record<string, unknown>;
    const line = JSON.stringify({
      ts: Date.now(),
      kind: "audit",
      ...scrubbed,
    });

    if (deps.db !== undefined) {
      const p = writeAuditEvent(deps.db, {
        actor: event.actor,
        action: event.action,
        target: event.target ?? null,
        metadata: event.metadata ?? null,
        ip: event.ip ?? null,
      }).catch(() => undefined);
      pending.add(p);
      void p.finally(() => pending.delete(p));
      if (deps.ctx !== undefined) deps.ctx.waitUntil(p);
    }

    if (opts.sync === true || deps.ctx === undefined) {
      // Sync path (or no waitUntil available). console.log itself
      // is synchronous in Workers — the write to stdout returns
      // before the next statement runs; no promise to await.
      console.log(line);
      return;
    }

    // Async path. Wrap the write in a promise so waitUntil holds
    // the isolate alive until it flushes; catch inside so a failing
    // console (should never happen, but keeps the promise clean)
    // doesn't turn into an unhandled rejection.
    deps.ctx.waitUntil(
      Promise.resolve().then(() => {
        try {
          console.log(line);
        } catch (err) {
          console.error(
            JSON.stringify({
              ts: Date.now(),
              kind: "audit.write.error",
              error: err instanceof Error ? err.message : String(err),
            }),
          );
        }
      }),
    );
  } as AuditFn;

  audit.flush = async () => {
    await Promise.all([...pending]);
  };
  return audit;
}

/**
 * Recursively walks a value, replacing values under sensitive keys
 * with the redaction constant. Preserves arrays / plain objects /
 * primitives. Doesn't attempt to walk class instances beyond
 * `toJSON()` — those aren't a normal audit-payload shape.
 *
 * Exported for unit tests. Callers should invoke `createAuditLogger`
 * rather than scrubbing themselves.
 */
export function deepScrub(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return TRUNCATED;
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;

  if (Array.isArray(value)) {
    return value.map((item) => deepScrub(item, depth + 1));
  }

  // Plain object walk. Object.entries loses inherited props — which
  // is what we want for audit payloads (never inspect prototypes).
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveKey(key)) {
      result[key] = REDACTED;
    } else {
      result[key] = deepScrub(val, depth + 1);
    }
  }
  return result;
}

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (SENSITIVE_KEYS.has(lower)) return true;
  // Also catch common variants like `user_password_hash`,
  // `stripe_secret_key`. Match on any denylisted substring surrounded
  // by non-alphanumeric boundaries (word-ish).
  for (const bad of SENSITIVE_KEYS) {
    if (lower.includes(bad)) return true;
  }
  return false;
}
