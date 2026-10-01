/**
 * SPEC-05 API acceptance — AC-1 · AC-2 · AC-3 · AC-4 · AC-5 (PLAN-05 §1). Written before the code.
 * The PDF job runs through the real queue consumer with an injected renderer (no browser in vitest); the miniflare
 * consumer itself is switched off by PDF_RENDERER=off in vitest.config.ts so it never races these direct calls.
 * New modules are loaded with dynamic import so each test reports its own failure on the red run.
 * Helper pattern copied from contracts-4b-acceptance.test.ts (that file is not edited). Clock pin 28/09/2026.
 */
import { SELF, env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CSRF_HEADERS,
  createAdmin,
  createSession,
  loginAs,
  readLastVerifyToken,
  truncateTables,
  type RunwaySession,
} from "@runway/test-fixtures";
import { getDb } from "../../src/db/client";
import { jwtRevocations, refreshTokens, userRoles, users, verificationTokens } from "../../src/db/schema";
import { getNoopSentEmails, resetNoopEmailBuffer } from "../../src/adapters/email-noop";
import { _resetJtiCache } from "../../src/middleware/auth";
import { assignRoleByName } from "../../src/services/admin-service";

const ORIGIN = "http://localhost:8787";
const PASSWORD = "correct-horse-battery-staple";
const fetcher = (input: string, init?: RequestInit) => SELF.fetch(input, init);
const FIXTURE_DAY = "2026-09-28T03:00:00Z";
const UNKNOWN_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const FAKE_PDF = new TextEncoder().encode("%PDF-1.4\n% fake pdf for tests\n%%EOF\n");

type Role = "giam_doc" | "quan_ly" | "nhan_vien";
interface Staff {
  userId: string;
  email: string;
  session: RunwaySession;
}
interface Team {
  admin: RunwaySession;
  gd: Staff;
  ql: Staff;
  nv: Staff;
}
interface Contract {
  id: string;
  status: string;
  number: string | null;
  steps: unknown[];
  pdf_status?: "none" | "pending" | "ready" | "failed";
  pdf_size?: number | null;
}
interface ProblemBody {
  type: string;
  status: number;
  current_status?: string;
  pdf_status?: string;
}
interface PdfRenderer {
  render(html: string): Promise<Uint8Array>;
}
interface FakeMessage {
  id: string;
  timestamp: Date;
  body: { contract_id: string };
  attempts: number;
  ack: ReturnType<typeof vi.fn>;
  retry: ReturnType<typeof vi.fn>;
}

// ---------------------------------------------------------------- clock + db

async function resetDb(): Promise<void> {
  for (const table of ["approval_steps", "contracts", "audit_events", "customers", "idempotency_keys"]) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await truncateTables(getDb(env), [verificationTokens, refreshTokens, jwtRevocations, userRoles, users]);
  const listed = await env.FILES.list({ prefix: "contracts/" });
  if (listed.objects.length > 0) await env.FILES.delete(listed.objects.map((o) => o.key));
}

// ---------------------------------------------------------------- people

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

async function invite(by: RunwaySession, role: Role, email: string, displayName: string): Promise<Staff> {
  const res = await by.fetch("/admin/users", {
    method: "POST",
    body: JSON.stringify({ email, display_name: displayName, role }),
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
  const session = createSession({ userId: body.user.id, email, ...cookies, fetcher, origin: ORIGIN });
  return { userId: body.user.id, email, session };
}

async function team(): Promise<Team> {
  const admin = await seedAdmin();
  const gd = await invite(admin, "giam_doc", "minh@nhatminh.vn", "Nguyễn Nhật Minh");
  const ql = await invite(admin, "quan_ly", "vi@nhatminh.vn", "Tường Vi");
  const nv = await invite(admin, "nhan_vien", "khanh@nhatminh.vn", "Minh Khánh");
  return { admin, gd, ql, nv };
}

// ---------------------------------------------------------------- contracts

function post(by: Staff, path: string, body: unknown): Promise<Response> {
  return by.session.fetch(path, { method: "POST", body: JSON.stringify(body) });
}

async function act(by: Staff, id: string, action: "submit" | "approve" | "issue" | "void", body: Record<string, unknown> = {}): Promise<Contract> {
  const res = await post(by, `/contracts/${id}/${action}`, body);
  expect(res.status, `${action} ${id}`).toBe(200);
  return res.json();
}

async function draftFor(t: Team): Promise<Contract> {
  const tplRes = await t.nv.session.fetch("/templates");
  const tpls: { items: Array<{ id: string; name: string }> } = await tplRes.json();
  const tpl = tpls.items.find((x) => x.name === "Hợp đồng cung cấp dịch vụ phần mềm")!;
  const cRes = await post(t.nv, "/customers", {
    name: "Tạp hóa Cô Ba",
    contact_person: "Trần Thị Ba",
    phone: "0901 234 567",
    email: "coba@example.com",
    address: "12 Lê Lợi, Q.1, TP.HCM",
  });
  expect(cRes.status).toBe(201);
  const cust: { id: string } = await cRes.json();
  const res = await post(t.nv, "/contracts", {
    template_id: tpl.id,
    customer_id: cust.id,
    values: { ma_goi: "G6", so_cua_hang: 1, giam_gia: 500, chuc_vu_nguoi_ky: "Chủ hộ kinh doanh" },
  });
  expect(res.status).toBe(201);
  return res.json();
}

async function issued(t: Team): Promise<Contract> {
  const d = await draftFor(t);
  await act(t.nv, d.id, "submit");
  await act(t.ql, d.id, "approve");
  return act(t.ql, d.id, "issue");
}

async function get(by: Staff, id: string): Promise<Contract> {
  const res = await by.session.fetch(`/contracts/${id}`);
  expect(res.status).toBe(200);
  return res.json();
}

// ---------------------------------------------------------------- pdf job

const okRenderer: PdfRenderer = { render: async () => FAKE_PDF };
const failingRenderer: PdfRenderer = {
  render: async () => {
    throw new Error("browser unavailable (429)");
  },
};

function batchOf(contractId: string, attempts = 1): { batch: MessageBatch<{ contract_id: string }>; msg: FakeMessage } {
  const msg: FakeMessage = {
    id: `m-${attempts}`,
    timestamp: new Date(),
    body: { contract_id: contractId },
    attempts,
    ack: vi.fn(),
    retry: vi.fn(),
  };
  const batch = { queue: "contract-pdf", messages: [msg], ackAll: vi.fn(), retryAll: vi.fn() };
  return { batch: batch as unknown as MessageBatch<{ contract_id: string }>, msg };
}

async function runJob(contractId: string, renderer: PdfRenderer, attempts = 1): Promise<FakeMessage> {
  const { contractPdfConsumer } = await import("../../src/queues/contract-pdf-consumer");
  const { batch, msg } = batchOf(contractId, attempts);
  await contractPdfConsumer(batch, env, { renderer });
  return msg;
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function auditCount(action: string, target: string): Promise<number> {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action = ? AND target = ?")
    .bind(action, target)
    .first<{ n: number }>();
  return r?.n ?? -1;
}

// ================================================================ tests

describe("SPEC-05 PDF (acceptance)", () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
    vi.setSystemTime(new Date(FIXTURE_DAY));
    await resetDb();
    resetNoopEmailBuffer();
    _resetJtiCache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("AC-1: issue → job → pdf_status ready; GET /pdf = attachment HD-2026-001.pdf, %PDF-, ETag = sha256; voided keeps the same bytes", async () => {
    const t = await team();
    const c = await issued(t);
    expect(c.number).toBe("HD-2026-001");
    expect((await get(t.nv, c.id)).pdf_status).toBe("pending");

    const msg = await runJob(c.id, okRenderer);
    expect(msg.ack).toHaveBeenCalled();
    expect(msg.retry).not.toHaveBeenCalled();

    const after = await get(t.nv, c.id);
    expect(after.pdf_status).toBe("ready");
    expect(after.pdf_size).toBe(FAKE_PDF.byteLength);

    const res = await t.nv.session.fetch(`/contracts/${c.id}/pdf`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="HD-2026-001.pdf"');
    expect(res.headers.get("cache-control")).toBe("private, no-cache");
    const bytes = await res.arrayBuffer();
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(res.headers.get("etag")).toBe(`"${await sha256Hex(bytes)}"`);

    await act(t.gd, c.id, "void", { reason: "Khách hủy" });
    const voided = await t.ql.session.fetch(`/contracts/${c.id}/pdf`);
    expect(voided.status).toBe(200);
    expect(await sha256Hex(await voided.arrayBuffer())).toBe(await sha256Hex(bytes));
  }, 60_000);

  it("AC-2: renderer down → issue still 200 with a number; retries then failed → 409 pdf-not-ready; draft → 409 state-conflict", async () => {
    const t = await team();
    const c = await issued(t);
    expect(c.status).toBe("issued");
    expect(c.number).toBe("HD-2026-001");

    const first = await runJob(c.id, failingRenderer, 1);
    expect(first.retry).toHaveBeenCalledWith({ delaySeconds: 30 });
    expect(first.ack).not.toHaveBeenCalled();
    expect((await get(t.nv, c.id)).pdf_status).toBe("pending");

    const last = await runJob(c.id, failingRenderer, 3);
    expect(last.ack).toHaveBeenCalled();
    expect(last.retry).not.toHaveBeenCalled();
    const failed = await get(t.nv, c.id);
    expect(failed.status).toBe("issued");
    expect(failed.pdf_status).toBe("failed");

    const res = await t.nv.session.fetch(`/contracts/${c.id}/pdf`);
    expect(res.status).toBe(409);
    expect(res.headers.get("retry-after")).toBe("60");
    const body: ProblemBody = await res.json();
    expect(body.type).toContain("pdf-not-ready");
    expect(body.pdf_status).toBe("failed");

    const d = await draftFor(t);
    expect((await get(t.nv, d.id)).pdf_status).toBe("none");
    const dr = await t.nv.session.fetch(`/contracts/${d.id}/pdf`);
    expect(dr.status).toBe(409);
    const db: ProblemBody = await dr.json();
    expect(db.type).toContain("state-conflict");
    expect(db.current_status).toBe("draft");

    // a later success still lands (the cron re-sends failed jobs)
    await runJob(c.id, okRenderer, 1);
    expect((await get(t.nv, c.id)).pdf_status).toBe("ready");
  }, 60_000);

  it("AC-3: the job twice (and concurrently) → one pdf_key, one contract.pdf_generated row, one R2 object", async () => {
    const t = await team();
    const c = await issued(t);
    await Promise.all([runJob(c.id, okRenderer), runJob(c.id, okRenderer)]);
    await runJob(c.id, okRenderer);

    const row = await env.DB.prepare("SELECT pdf_key, pdf_hash FROM contracts WHERE id = ?")
      .bind(c.id)
      .first<{ pdf_key: string | null; pdf_hash: string | null }>();
    expect(row?.pdf_key).toMatch(new RegExp(`^contracts/${c.id}/[0-9A-HJKMNP-TV-Z]{26}\\.pdf$`));
    const listed = await env.FILES.list({ prefix: `contracts/${c.id}/` });
    expect(listed.objects.map((o) => o.key)).toEqual([row!.pdf_key]);
    expect(await auditCount("contract.pdf_generated", c.id)).toBe(1);

    const audit = await env.DB.prepare("SELECT actor, metadata FROM audit_events WHERE action = 'contract.pdf_generated' AND target = ?")
      .bind(c.id)
      .first<{ actor: string | null; metadata: string }>();
    expect(audit?.actor).toBeNull();
    expect(JSON.parse(audit!.metadata)).toEqual({ size: FAKE_PDF.byteLength });
  }, 60_000);

  it("AC-4: sweeper re-sends issued contracts without a PDF (older than 5 min) and failed ones after 1 hour only", async () => {
    const { contractPdfSweeper } = await import("../../src/crons/contract-pdf-sweeper");
    const t = await team();
    const fresh = await issued(t); // issued just now → not yet swept
    const sent: string[] = [];
    const queue = {
      sendBatch: vi.fn(async (msgs: Iterable<{ body: { contract_id: string } }>) => {
        for (const m of msgs) sent.push(m.body.contract_id);
      }),
    };
    const nowSec = Math.floor(Date.now() / 1000);

    await contractPdfSweeper({ db: getDb(env), queue: queue as unknown as Queue, now: nowSec });
    expect(sent).toEqual([]);

    // 6 minutes later the never-queued contract is picked up
    await contractPdfSweeper({ db: getDb(env), queue: queue as unknown as Queue, now: nowSec + 6 * 60 });
    expect(sent).toEqual([fresh.id]);

    // failed 10 minutes ago → skipped; failed 61 minutes ago → re-sent
    sent.length = 0;
    await runJob(fresh.id, failingRenderer, 3);
    const failedAt = (await env.DB.prepare("SELECT pdf_failed_at AS f FROM contracts WHERE id = ?").bind(fresh.id).first<{ f: number }>())!.f;
    await contractPdfSweeper({ db: getDb(env), queue: queue as unknown as Queue, now: failedAt + 10 * 60 });
    expect(sent).toEqual([]);
    await contractPdfSweeper({ db: getDb(env), queue: queue as unknown as Queue, now: failedAt + 61 * 60 });
    expect(sent).toEqual([fresh.id]);

    // ready contracts and drafts are never swept
    sent.length = 0;
    await runJob(fresh.id, okRenderer, 1);
    await draftFor(t);
    await contractPdfSweeper({ db: getDb(env), queue: queue as unknown as Queue, now: nowSec + 24 * 3600 });
    expect(sent).toEqual([]);
  }, 60_000);

  it("AC-5: GET /pdf — anonymous 401; no contract:read → 403 + permission.denied; unknown id → 404", async () => {
    const t = await team();
    const c = await issued(t);
    await runJob(c.id, okRenderer);

    const anon = await fetcher(`${ORIGIN}/contracts/${c.id}/pdf`);
    expect(anon.status).toBe(401);

    const adminRes = await t.admin.fetch(`/contracts/${c.id}/pdf`); // admin has no contract:*
    expect(adminRes.status).toBe(403);
    const denied = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'permission.denied'").first<{ n: number }>();
    expect(denied?.n).toBeGreaterThan(0);

    const missing = await t.nv.session.fetch(`/contracts/${UNKNOWN_ID}/pdf`);
    expect(missing.status).toBe(404);
  }, 60_000);
});
