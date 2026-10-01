/**
 * SPEC-04a acceptance, API half (PLAN-04a §1): `GET /me` carries `display_name` (DEC-6) and every OpenAPI path
 * is routed to the Worker by `assets.run_worker_first` in all three wrangler env blocks (AC-1, DEC-1).
 * Browser ACs are the human checklist + the one smoke spec (apps/web/e2e/shell.smoke.spec.ts).
 * Written before the code: fails until C-04a-000 (/me) and C-04a-001 (wrangler assets).
 */
import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  CSRF_HEADERS,
  createAdmin,
  createSession,
  loginAs,
  readLastVerifyToken,
  truncateTables,
  type RunwaySession,
} from "@runway/test-fixtures";
import wranglerToml from "../../wrangler.toml?raw";
import { getDb } from "../../src/db/client";
import { jwtRevocations, refreshTokens, userRoles, users, verificationTokens } from "../../src/db/schema";
import { getNoopSentEmails, resetNoopEmailBuffer } from "../../src/adapters/email-noop";
import { _resetJtiCache } from "../../src/middleware/auth";
import { assignRoleByName } from "../../src/services/admin-service";

const ORIGIN = "http://localhost:8787";
const PASSWORD = "correct-horse-battery-staple";
const fetcher = (input: string, init?: RequestInit) => SELF.fetch(input, init);

async function seedAdmin(): Promise<RunwaySession> {
  const admin = await createAdmin({
    fetcher,
    readLastVerifyToken: () => readLastVerifyToken(getNoopSentEmails),
    assignAdminRole: async (userId) => {
      await assignRoleByName({ db: getDb(env), kv: env.SESSIONS, env }, { userId, roleName: "admin" });
    },
    origin: ORIGIN,
  });
  return admin.session;
}

/** Invite → activate → log in, with a display name. */
async function inviteAndLogin(by: RunwaySession, email: string, displayName: string): Promise<RunwaySession> {
  const res = await by.fetch("/admin/users", {
    method: "POST",
    body: JSON.stringify({ email, display_name: displayName, role: "giam_doc" }),
  });
  expect(res.status).toBe(201);
  const body: { user: { id: string }; activation_url: string } = await res.json();
  const token = new URL(body.activation_url).searchParams.get("token");
  const act = await fetcher(`${ORIGIN}/auth/activate`, {
    method: "POST",
    headers: CSRF_HEADERS,
    body: JSON.stringify({ token, password: PASSWORD }),
  });
  expect(act.status).toBe(204);
  const cookies = await loginAs(fetcher, { email, password: PASSWORD, origin: ORIGIN });
  return createSession({ userId: body.user.id, email, ...cookies, fetcher, origin: ORIGIN });
}

// ---- wrangler.toml `run_worker_first` (no TOML parser in the workers pool: read the arrays by section) ----
const BLOCKS = { default: "[assets]", preview: "[env.preview.assets]", production: "[env.production.assets]" } as const;

function section(toml: string, header: string): string | null {
  const start = toml.indexOf(`\n${header}`);
  if (start === -1) return null;
  const rest = toml.slice(start + header.length + 1);
  const next = rest.search(/\n\[/);
  return next === -1 ? rest : rest.slice(0, next);
}

function runWorkerFirst(toml: string, header: string): string[] | null {
  const body = section(toml, header);
  if (body === null) return null;
  const m = /run_worker_first\s*=\s*\[([\s\S]*?)\]/.exec(body);
  if (m === null) return null;
  return [...m[1]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]!);
}

/** Cloudflare pattern: `*` = any characters (incl. `/`); a leading `!` negates (none used yet, but honoured). */
function matches(patterns: string[], path: string): boolean {
  const test = (p: string): boolean =>
    new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`).test(path);
  const hit = patterns.filter((p) => !p.startsWith("!")).some(test);
  const denied = patterns.filter((p) => p.startsWith("!")).some((p) => test(p.slice(1)));
  return hit && !denied;
}

const SPA_URLS = ["/", "/login", "/activate", "/khach-hang", "/phan-quyen", "/nhat-ky", "/nguoi-dung", "/san-pham"];
const ALWAYS_WORKER = ["/docs", "/openapi.json", "/healthz", "/readyz"];

describe("SPEC-04a web shell (acceptance, API half)", () => {
  beforeEach(async () => {
    await truncateTables(getDb(env), [verificationTokens, refreshTokens, jwtRevocations, userRoles, users]);
    resetNoopEmailBuffer();
    _resetJtiCache();
  });

  it("DEC-6: GET /me returns display_name (invited user = the name given; technical admin = null)", async () => {
    const admin = await seedAdmin();
    const adminMe = await admin.fetch("/me");
    expect(adminMe.status).toBe(200);
    const adminBody: Record<string, unknown> = await adminMe.json();
    expect(adminBody).toHaveProperty("display_name");
    expect(adminBody["display_name"]).toBeNull();

    const gd = await inviteAndLogin(admin, "minh@nhatminh.vn", "Nguyễn Nhật Minh");
    const res = await gd.fetch("/me");
    expect(res.status).toBe(200);
    const body: { email: string; display_name: string | null; roles: string[]; permissions: string[] } = await res.json();
    expect(body.display_name).toBe("Nguyễn Nhật Minh");
    expect(body.email).toBe("minh@nhatminh.vn");
    expect(body.roles).toEqual(["giam_doc"]);
  });

  it("AC-1: every OpenAPI path matches run_worker_first in default, preview and production env blocks", async () => {
    const spec = await SELF.fetch("https://example.com/openapi.json");
    expect(spec.status).toBe(200);
    const doc: { paths: Record<string, unknown> } = await spec.json();
    const paths = Object.keys(doc.paths);
    expect(paths.length).toBeGreaterThan(10);

    for (const [env_, header] of Object.entries(BLOCKS)) {
      const patterns = runWorkerFirst(wranglerToml, header);
      expect(patterns, `${env_}: ${header} run_worker_first missing in wrangler.toml`).not.toBeNull();
      const missing = paths
        .map((p) => p.replace(/\{[^}]+\}/g, "x"))
        .filter((p) => !matches(patterns!, p));
      expect(missing, `${env_}: API paths that would fall through to index.html`).toEqual([]);
      const infra = ALWAYS_WORKER.filter((p) => !matches(patterns!, p));
      expect(infra, `${env_}: infra paths not routed to the Worker`).toEqual([]);
    }
  });

  it("AC-1: SPA screen URLs are NOT swallowed by run_worker_first; SPA fallback + directory are set in all 3 env blocks", () => {
    const lists = Object.values(BLOCKS).map((h) => runWorkerFirst(wranglerToml, h));
    for (const patterns of lists) {
      expect(patterns).not.toBeNull();
      expect(SPA_URLS.filter((u) => matches(patterns!, u))).toEqual([]);
    }
    // `assets` is not inheritable: identical list + settings in each block
    expect(lists[1]).toEqual(lists[0]);
    expect(lists[2]).toEqual(lists[0]);
    for (const header of Object.values(BLOCKS)) {
      const body = section(wranglerToml, header) ?? "";
      expect(body, header).toMatch(/directory\s*=\s*"\.\.\/web\/dist"/);
      expect(body, header).toMatch(/not_found_handling\s*=\s*"single-page-application"/);
    }
  });
});
