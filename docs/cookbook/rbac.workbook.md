---
workbook: rbac
version: "0.1"
kind: feature
risk: high
requires: [auth-roles]
pairs_with: [documents, audit-trail]
provides:
  - "permission catalog + roles as data, one enforce gate (rung 1)"
  - "governed role/user admin: grant ⊆ held, owner-only privileged roles, same rule on every path (rung 2)"
  - "optional controls: SoD pairs, 2-person permission change, JIT admin, access review, Root switch (rung 3)"
  - "API-computed UI locks (can / locked_reason)"
  - "events: role.created, role.updated, role.permissions_changed, role.deleted, user.role-changed, permission.denied"
status: draft
proven: "extracted 2026-10-02 from tw-hopdong-live, where rungs 1–3 are built (api 446 / web 365 / e2e 8 green) and 8 FIX docs record what broke. The LIGHT default profile in §3 (rung 1 + 2, rung 3 off) was not rehearsed from scratch — treat as v0.1."
---

<!-- WORKBOOK in the Workbook System format. Everything below §1 is Claude's contract. Grounded in: tw-hopdong-live docs/rbac.md, docs/fix/FIX-03..08, docs/spec/SPEC-06/07, the security-audit run (~/security-audit-skill/tw-hopdong-live/run-1/REPORT.md). -->

# RBAC · Workbook (light by default)

## §1 START HERE (for you, the human)

**What you get:** a team where everyone has a role, each role is a list of things it may do, and the app enforces it on the server — not just by hiding buttons. You can change roles and who holds them from a screen, and you cannot accidentally (or maliciously) hand yourself more power than you have.

**What to say:** "Build this workbook: @rbac.workbook.md". Claude asks ONE question first: *how big is your team and does anyone audit you?* Small team → it builds rung 1 + 2 and stops. It builds rung 3 only if you say so.

**What you'll see:** a Stack Report, the few decisions in §2b with defaults, a ≤12-line plan, then your OK. Then the build, then the attack probes from §7 run against your real app, with output.

## §2 THE CONTRACT

**Job:** decide, on the server, what each person may do; let the right people change that safely; leave a trace of every refusal.

**Three rungs — a rung is a bundle you may stop at.** Do not build a higher rung "because it is more secure": every control adds screens, states, and ways to get stuck (see §2c-G3).

| Rung | For | Bundle | Default |
|---|---|---|---|
| **1 Basic** | any app with logins | closed permission catalog · roles as data · one gate · fail closed · denial audit rows · cache purge · no self-role-change · last-admin guard · UI locks from the API | ON |
| **2 Governed** | more than one person can edit users or roles | grant ⊆ held · privileged roles owner-only · same rule on EVERY path · first-owner bootstrap · role edits with version CAS | ON when ≥2 admins/editors, else ask |
| **3 Controlled** | audited / regulated / many admins | SoD permission pairs · permission change needs a second approver · JIT time-boxed admin · periodic access review · Root switch for the 2-person rule | OFF — only when the human asks |

**Invariants (each needs a named test):**
- **R1.1** Every protected route checks a permission on the server; an unknown permission, a missing role, or a guard error DENIES.
- **R1.2** Every refusal writes one `permission.denied` audit row (who, what, which rule). Audit rows cannot be updated or deleted.
- **R1.3** Nobody changes their own role or locks themselves (403 `self_role` / `self_disable`).
- **R1.4** The last admin/owner cannot be demoted, locked or deleted (409 `last-admin`).
- **R1.5** After a role or role-membership change, the affected people lose/gain the power within the cache TTL (purge + short TTL), not "after 5 minutes".
- **R1.6** Every disabled/hidden control and its reason comes from the API (`can`, `locked_reason`), computed with the SAME function the write guard uses.
- **R2.1** You can grant, add to a role, or assign only what you yourself hold (⊆), checked on the server AND repeated in the write SQL.
- **R2.2** A role that can manage roles/users (carries `roles:write` / `users:write`) is assigned, invited and re-invited ONLY by the Owner.
- **R2.3** For every security effect, ALL paths that produce it call the same domain function (invite, assign, change role, re-invite, JIT, import, API key…).
- **R2.4** Role identity is an immutable `name`; the editable `label` is for people. Custom role names are server-made, nobody can create a role named `admin`.
- **R3.x** (only if rung 3) no role holds both codes of an SoD pair · a permission change is applied only after a different `roles:write` holder approves · JIT admin ≤ 8 h with a reason, stored apart from normal roles · the Root switch is the only way to turn the 2-person rule off and is audited.

**Out of scope:** authentication itself (see `auth-roles`), per-record sharing/ACLs, multi-tenant isolation, SSO/SCIM, attribute-based rules.

**Slots a human may set:** the role list and labels · which role is the Owner · permission list for the domain · cache TTL (default 60 s) · whether rung 3 is on.

## §2a THE DOMAIN MODEL

| Entity | Fields that matter | Rules |
|---|---|---|
| Permission | `key` `resource:verb`, from a CLOSED catalog in code | adding one = catalog + seed migration (`INSERT OR IGNORE`); a permission only in the DB is unreachable |
| Role | `id`, immutable `name`, `label`, `is_system`, `version` | system roles never renamed/deleted; delete only with 0 holders; ≤ N roles |
| RolePermission | role × permission | changed in one batch with its audit row |
| UserRole | user × role | **one role per person** unless you have a reason (simplifies SoD and the "who is owner" question) |
| Principal | `{id, roles, permissions}` cached in KV by session | purge on change; never trust the cache for a write guard |
| AuditEvent | actor, action, target, rule, metadata | append-only by DB trigger |
| (rung 3) SodPair · ChangeRequest · JitGrant · AccessReview | see docs/rbac.md in tw-hopdong-live | each has expiry; a pending request locks its role |

**Owner vs admin (the model that stopped the arguing):** *Owner* = the business head (Giám đốc): the only one who hands out powers that manage powers. *Admin* = IT operations: users, settings, flags — can propose, cannot self-promote, cannot mint another admin.

## §2b DECISIONS & TRADE-OFFS (surface at the gate; default in bold)

| Decision | Options | Pick when |
|---|---|---|
| How many rungs | **1+2** / 1 only / 1+2+3 | 1 only: single admin, throwaway app. 3 only on a stated compliance need |
| Roles per person | **one** / many | many only if the domain really needs combined hats; then SoD must work on permission pairs |
| Who is Owner | **a business role, not IT** / admin | if there is no business head in the app, the first admin is Owner and you accept that |
| Edit permissions of a role | **direct edit by Owner/admin with ⊆ rule** / request + second approver | request flow = rung 3 |
| Role-name rule | **server-made `r_<ulid>` for custom** / free text | free text invites a role called `admin` |
| Cache | **TTL 60 s + purge by role/user** / TTL only | TTL-only is fine if power changes are rare AND you accept the window |
| Pre-existing implicit powers | **list them in the SPEC and decide** / ignore | see §6 "soft spots" |

## §2c GOTCHAS / HOW IT GOES WRONG (domain-level)

- **G1 Self-promotion** — the person who can edit users edits themselves to admin. Fixed by R1.3 + R2.2.
- **G2 The decoy admin** — an admin creates a second admin and uses that account to approve their own change. Any rule "approved by someone else" is void if one person can mint "someone else".
- **G3 Over-strict deadlock** — "you may not approve changes to a role you hold" + "only these two people can approve" = no eligible approver; the admin's request sits forever and the error is hidden in a scrolled drawer. Strictness needs a named owner who can break ties (R2.2).
- **G4 The matching sibling** — you close "assign role" and forget "re-invite", "JIT", "import", "API key". Same effect, other door.
- **G5 Buttons are not security** — and rules re-implemented in the web app drift from the server (cells tick-able, then 403).
- **G6 Stale power** — a demoted or departed person keeps acting until the cache expires.
- **G7 Lock-out** — deleting/demoting the last admin leaves nobody able to fix anything; so does a bootstrap that needs an existing owner.

## §3 DETECT (before touching any file)

1. Inspect: manifests, `wrangler.toml`/config, schema + migrations, the existing auth/session code, how routes are guarded today, the test runner, the audit mechanism.
2. Print the Stack Report: language · runtime · framework · DB · migrations · auth · hosting · tests · **build mode NEW / INTEGRATE** · what already exists (roles table? permission checks? audit?).
3. Ask the §2b decisions with their defaults. First question: team size + audit need → picks the rung.
4. Capability ladder: DB has atomic batch/transactions? → write the guard condition INTO the write SQL (CAS) · only single statements? → one statement with a sub-select guard + warn · neither? → serialize in code and WARN this is racy.
5. **The gate:** print Stack Report + decisions + rung + plan (≤ 12 lines). Wait for OK. Then INTENT → SPEC (with `INV-n` lines, see §6) → PLAN → cards → PROOF.

## §4 THE LAYERS

route (declares the permission) → validation → **gate** `requirePerm(key)` → command (the domain rule functions: `selfRole`, `ownerOnly`, `grantNotHeld`, `lastAdmin`) → persistence (CAS write + audit row in ONE batch) → event/audit → cache purge → DTO with `can` / `locked_reason`. The domain rule functions are pure and are the ONLY place a rule is written; the route, the batch SQL guard and the DTO all call them.

## §5 HOLD THE LOAD

Paginate user and audit lists · index `user_roles(user_id)` and `user_roles(role_id)` · cache purge by role is bounded (one KV op per holder — split above ~900 holders) · no N+1 when computing `can` for a list (compute from the principal once) · `version` CAS on role edits.

## §6 THE GUARDS (security) — and what the real audit found

**Rules that outrank casual instructions:** fail closed · never relax R1.3/R2.2 "just for the demo" · a credential column never leaves the server (exports, DTOs, logs) · secrets from env only.

**Findings from tw-hopdong-live (each was real, each has a red→green test):**

| # | What happened | Root cause | Guard (rung) | Where recorded |
|---|---|---|---|---|
| F1 | Giám đốc `PATCH`ed their own role to `admin` → 200 | no actor-vs-target check | R1.3 `self_role` + R2.2 (1) | FIX-03 |
| F2 | admin invited another admin → decoy approver beat the 2-person rule | "someone else" is meaningless if you can mint someone else | R2.2 `owner_only` (2) | FIX-05 |
| F3 | admin's request to ADD a permission to Giám đốc → 409 no-eligible-approver; the error rendered off-screen | own-role rule + too few holders | name the Owner, let the Owner approve for own role; sticky error footer (2) | FIX-05, FIX-04 |
| F4 | admin saw tick-able cells that returned 403 `grant_not_held`; same drift in Users, JIT, document menus | rules copied into the web app | R1.6: API returns `can`/`locked_reason` from the guard's own function; `self_disable` server-side (1) | FIX-06 |
| F5 | admin re-sent an invite to a PENDING Giám đốc, set their own password, logged in as Giám đốc | the re-invite path skipped the rule that invite/assign had | R2.3: one `user-assign` function behind invite, assign, change, re-invite (2) | FIX-07 (found by security-audit) |
| F6 | `POST /me/export` returned `users.password_hash` | `SELECT *` into the archive; table allow-list, no column allow-list | exclude credential columns by name + test scans every exportable table's columns | FIX-08 (found by security-audit) |

**Soft spots found and NOT fixed — decide each in your SPEC, do not leave implicit:**
- implied powers: a permission that reaches `updateUser` (e.g. a review permission) can lock users; `users:write` can lock the Owner.
- deleting an account does not check "last owner/admin" and then the bootstrap clause lets someone invite a new Owner.
- the creator who also holds `issue`/`approve` can approve their own work unless an explicit SoD rule exists (a product decision — write it down).
- a broad read permission (`contract:read`) is the only control on all records; fine for a small team if stated.
- `admin` bypass inside `can()` lets admin skip ownership checks; keep admin out of domains where "never the creator" matters.

**Audit honesty:** the run was a quick profile, source-only, 15 agents, and covered the RBAC core only partially (`packages/rbac`, `require-permission`, SoD/JIT DAOs were deferred). It confirmed nothing by running code; F5/F6 were then confirmed by writing the failing test first. **Run a standard/deep `security-audit` on the rung you built before you rely on it.**

**How to write the security tests (cheap, strong):** put the invariant at the strongest boundary — a *route × role* table test (every protected route, every role: expected 200/403) and a *schema scan* test (no credential-named column in any export). One `INV-n` line per invariant in the SPEC, and in each card say which `INV-n` it must hold and which paths reach the same effect.

## §7 THE PROOF

**Machine checks (each named, each run, output shown):**
1. route × role table — every protected route against every role.
2. R1.2 — every 403 above leaves exactly one `permission.denied` row; audit rows reject UPDATE/DELETE.
3. R1.6 consistency — for every `can:false` the API returns, calling the action returns 403 with the same `rule`.
4. R1.5 — revoke a role, act immediately → 403 (no waiting for TTL).
5. schema scan — no `password|secret|token|salt|pepper|api_key` column in any export.

**Attack probes (run against your own app, paste real output):**
- P1 PATCH your own role to admin → 403 `self_role`.
- P2 as admin, invite/assign a role carrying `roles:write` → 403 `owner_only` (rung 2).
- P3 grant a permission you do not hold via role edit and via clone → 403 `grant_not_held`.
- P4 re-send an invite to a pending privileged user as a non-owner → 403.
- P5 demote/lock/delete the last admin → 409 `last-admin`.
- P6 two requests race on the same role edit → one 409 `stale`.
- P7 `POST /me/export` → no credential column.
- P8 (rung 3) a role with both codes of an SoD pair → 409; approve your own permission request → 403.

**Human world checklist:** log in as each role and try one thing it must NOT do; the control should already look disabled with a sentence saying why.

**Closing audit — print before claiming done:** (1) layer map → file paths · (2) invariants R1.x/R2.x/(R3.x) → the test that proves each · (3) the soft spots and the decision taken · (4) rung chosen and what was left off on purpose.

## §8 SNAP POINTS

Requires `auth-roles` (identity, sessions). Pairs with `documents` (permissions per document type, SoD "never the creator" belongs there), `audit-trail`. Ledger line in `WORKBOOKS.md`: `rbac · v0.1 · rung {1|2|3} · permissions: {n} · roles: {n} · events: …`. Shared conventions: 400/422 validation · 401/403 auth · 409 conflict · RFC 7807 Problem+JSON · soft-delete over hard-delete.

## §9 KNOWN TRAPS (code level)

- Ownership guard used for separation of duties: `can(p, perm, {ownerId})` ALLOWS when actor == owner — the opposite of "never the creator". Write SoD as an explicit domain check.
- Check-then-write for role edits: read version, then write → two editors both pass. CAS `WHERE id=? AND version=?`.
- Guard only in the route: a batch/cron/import that writes the same table skips it. Repeat the condition in the write SQL.
- `admin` name hard-coded in `can()`: fine, but then the name must be immutable and uncreatable.
- Cache TTL as the only revoke: purge by user/role on every change.
- Permission added to the DB but not the catalog (or reverse): unreachable or untyped. One source of truth.
- Denial without an audit row: the "who tried what" screen stays empty. Hook the audit write into the deny path.
- Test hashing cost: a real password hash in every test made the suite ~8× slower; use a fast hash under the test env only.

## DONE (Claude fills)

{3–5 lines: rung built and why, decisions taken, the route × role table result, the probe outputs, soft spots decided, anything the next workbook should know.}
