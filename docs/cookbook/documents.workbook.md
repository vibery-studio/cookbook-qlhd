---
workbook: documents
version: "1.2"
kind: feature
risk: high
requires: []
pairs_with: [auth-roles, crm, payments, email]
provides:
  - "template library, versioned (admin)"
  - "POST generate-document from a template (staff)"
  - "submit / approve / reject / issue / void (staff)"
  - "GET document list, detail, printable render (staff)"
  - "GET my-approvals queue (approvers)"
  - "GET audit trail per document (audit readers)"
  - "events: document.created, document.submitted"
  - "events: document.approved, document.rejected"
  - "events: document.issued, document.voided"
status: proven
proven: "2026-09-28 — built unchanged on a RUNWAY snapshot copy (ship-with-claude projects/tw-baogia-workshop/rehearsal): 196 API tests, all 8 §7 probes with real output · v1.1 adds the no-eligible-approver rule (I9) · v1.2 (2026-10-02) = §10 extensions built and proven AFTER the live on tw-hopdong-live (api 446 / web 365 / e2e 8 tests green, 86 commits), demo https://runway-api-prod.bnqtoan.workers.dev"
---

<!-- This is a WORKBOOK — one recipe of the AI App Cookbook, in the Workbook System format (see FRAMEWORK.md). The human attaches this file to Claude Code and says "build this workbook." Everything below §1 is Claude's contract, not learner reading. -->

<!-- Captured from (grounded, not invented): ship-with-claude modules/M5/BRIEF-v2.md (document entity) · M5/05-dap-an-doi-chieu/ANSWER-KEY.md §5.8 (computed rules + expected screens) · M5/01-tu-lieu-khach-gui/owner-box/07_Mau_Tai_Lieu/*.docx + 09_Bang_Gia.xlsx sheet "Quy định" (the owner's real templates + rules) · projects/tw-baogia-workshop/{BUILT.md,DESIGN.md,ui/index.html} (contract-management app mockup) · modules/00-chung/naive-build-demo/REPORT.md (a real naive build's failures) · RUNWAY docs/{recipes/add-resource.md,rbac.md,audit.md,idempotency.md,recipes/add-money.md,recipes/add-audit-store.md,dao-pattern.md,architecture.md} (one worked adaptation). -->

# Documents from Templates · Workbook

## §1 START HERE (for you, the human)

**What you get:** your team fills a form, picks a template, and the app produces the real paper — a quote, a contract, a payment request, an invoice, a certificate — with the right numbers, the right prices, and the right sign-off; once a document goes out, nothing (not a price change, not a customer edit, not a template edit) can quietly change it, and its number never skips or repeats.

**What to say:** "Build this workbook: @documents.workbook.md" — or just attach it and say "build this". (VN: "Xây workbook này.")

**What you'll see:** Claude first prints a short Stack Report (what it found in your project, whether it's building NEW or INTEGRATING into your existing app, the few decisions it needs you to confirm — when a number is given, who approves what, what happens when a document is wrong — and what it will build, ≤12 lines) and waits for your OK. Then it builds and tests itself — including issuing ten documents at the same instant to prove the numbers come out 001 to 010 with no gap, and trying to approve its own document to prove it gets refused. At the end it hands you a short checklist of things to click in your running app — when you've seen them all, it's done.

## §2 THE CONTRACT

**The job:** a staff member generates a {document} of a given {type} from a {template} for a {subject}; the server fills every merge field from real data, computes every amount, routes the document through the template's {approval policy}, and on issue gives it the next {number} in its series and freezes it forever — guaranteeing no gap or duplicate in any series, no blank or invented field, and no one approving their own work.

**Vocabulary mapping** (adapt these words to the human's business — detect from their app/brief; ask only if truly ambiguous):

| Word in this workbook | Means in the human's app |
|---|---|
| {document} | the generated paper — báo giá (quote), hợp đồng (contract), đề nghị thanh toán (payment request), invoice, certificate, delivery note; in the workshop app the only type is `contract` |
| {type} | the kind of document; it owns a number prefix (BG / HD / DNTT) and its own series |
| {template} | the business's own model document with `{{merge_field}}` placeholders, default line items, default clauses, and an approval policy — versioned |
| {subject} | who/what the document is about — a customer, a deal, a student, an order; comes from the host app (a snap point), never re-typed |
| {number} | the public reference printed on the paper, e.g. `HD-2026-001`; given only at issue |
| {approver} | a person holding the approve permission for this step — never the document's creator |
| {approval policy} | the rule deciding whether a document needs sign-off and by whom: none · a threshold rule (discount > 10% → Giám đốc) · fixed steps per template (Nhân viên tạo → Quản lý duyệt → Giám đốc duyệt → Phát hành) |

**Invariants — each one is testable and each one maps to a check in §7:**

- **I1 (no gaps, no duplicates — the promise):** a {number} is assigned only at the moment of ISSUE, inside the same atomic write that flips the status; within one series (type + year) issued numbers are consecutive and unique. Drafts, rejected documents and deleted drafts never consume a number.
- **I2 (frozen at generation, sealed at issue):** generating a document stores a SNAPSHOT of every merged value, every line item, every total, the clauses and the template version used. The document renders ONLY from its snapshot — never from live customer, price-list or template data. After issue the rendered output is stored and never re-rendered.
- **I3 (complete or refused):** if a REQUIRED merge field has no value, generation is refused with the missing field names listed. Never a blank, never a default the business didn't record.
- **I4 (server derives the money):** unit prices come from the business's price list effective on the document date; line amounts, discount, totals, amount-in-words and derived dates (validity end, contract end, payment due) are computed by the server. Any client-sent price, total or derived date is ignored.
- **I5 (separation of duties):** approving, rejecting and issuing are separate permissions; the creator of a document can NEVER approve or reject it; each document is approved on its own (an approved quote does not approve the contract made from it). Every refusal is a 403 AND a `permission.denied` audit row.
- **I6 (issued is immutable):** an issued document is never edited. A wrong document is VOIDED (it keeps its number, marked void, with a reason) and a replacement is generated, which gets a NEW number.
- **I7 (every move is signed for):** each status change writes exactly one audit row (actor, from → to, number if any, time) in the SAME atomic write as the change — a move without its row cannot exist.
- **I8 (a double-click is one document):** create and every status action accept an idempotency key; replaying the same request returns the original result, never a second document or a second number.
- **I9 (every step has someone who can take it):** a document is submitted only if EVERY step of its approval policy has at least one active approver who is NOT the creator (holds the step's permission, and its role if the step names one). Otherwise submit is refused BEFORE anything becomes pending, naming the step and why ("Bước 'Giám đốc duyệt' không có ai khác duyệt được — người tạo không tự duyệt"). A document never waits forever in Chờ duyệt for an approver who cannot exist.

**Out of scope (do not build, even if tempting):** e-signature · sending the document by email/Zalo (the `email` workbook listens for `document.issued`) · marking a payment request PAID / bank reconciliation (the `payments` workbook owns money confirmation — see §2c) · a WYSIWYG template designer (templates are edited as HTML/markdown with placeholders) · tax-authority e-invoice submission (this workbook's "invoice" is a commercial document) · the customer/deal model itself (the `crm` workbook, or the minimal subject stub in §8).

**Slots the human MAY customize before attaching** (edit these lines, nothing else): the document types and their prefixes (default: the business's own — e.g. BG / HD / DNTT) · the number format (default `{PREFIX}-{YYYY}-{NNN}`, reset every year) · the approval threshold (default: discount above **10%** needs the director) · the business time zone (default `Asia/Ho_Chi_Minh`) · whether "approve" and "issue" are one click or two (default two).

## §2a THE DOMAIN MODEL (the real entities + how they relate)

**Entities** (the nouns this feature really has):

| Entity | Key fields | What it is |
|---|---|---|
| template | id, type, name, current_version_id, active, created_by | a named model document the business uses ("Hợp đồng dịch vụ", "Hợp tác đại lý"); points at its CURRENT version |
| template_version | id, template_id, version_no, body (HTML/markdown with `{{field}}`), fields[], default_line_items[], default_clauses[], approval_policy, created_by, created_at | one immutable edition of a template; editing a template CREATES a new version, never mutates one a document already used |
| merge field (inside a version) | key, label, type (text · paragraph · money · number · percent · date · choice), required, source (subject · deal · price_list · derived · manual) | one placeholder; `source` says where its value comes from, `required` says whether its absence STOPS generation (I3) |
| approval_policy (inside a version) | mode (none · threshold · steps), rule (e.g. `discount_pct > 10 → steps: [director]`), steps[] (step_no, label, required permission) | the sign-off rule this template's documents follow — data, not code |
| document | id (ULID), type, template_version_id, subject_type, subject_id, source_document_id, status, created_by, doc_date, snapshot (JSON), snapshot_hash, series_year, seq, number, rendered_html, rendered_hash, issued_at, voided_at, void_reason, replaced_by_id | the generated paper; everything it prints lives in `snapshot`; `number`/`seq` stay NULL until issue |
| line item (inside the snapshot) | description, qty, unit_price, discount_bps, amount | a priced row, COPIED into the snapshot at generation — not a live foreign key to the price list |
| approval_step | id, document_id, step_no, label, required_permission, status (waiting · approved · rejected), decided_by, decided_at, note, snapshot_hash_at_decision | one sign-off on ONE document; bound to the exact snapshot the approver saw |
| number_series | type, prefix, pad (3), reset (yearly), last_seq (Rung A only) | the numbering rule per type; one logical series per (type, year) |
| audit_event | id (ULID), ts, actor, action, target (`document:<id>`), metadata {from, to, number, step, reason}, ip | append-only who-did-what, including refused attempts (`permission.denied`) |
| price list (host data, read-only here) | code, name, unit_price, effective_from, effective_to | the single source of prices, looked up by the document date — owned by the host app, read by this feature |

**Relationships:**

- template has-many template_versions; a document belongs-to exactly ONE template_version (pinned at generation, I2).
- document belongs-to one {subject} (customer / deal / contact) through `subject_type + subject_id` — the snap point to the host app; the subject's values are COPIED into the snapshot, never joined at render time.
- document may belong-to a source document (`source_document_id`): quote → contract → payment request. The child copies the parent's FROZEN amounts (the contract from BG-2026-001 carries 2.565.000, not today's price); the child is approved on its own (I5).
- document has-many approval_steps (created on submit from the pinned version's policy) and has-many audit_events.
- a voided document has-one replacement (`replaced_by_id`); the replacement is an ordinary new document with a new number.
- number_series has-many issued documents per year; `(type, series_year, seq)` is UNIQUE among issued documents.

**Lifecycle / state** (VN labels are the workshop app's status tabs):

- document.status: `draft` (Nháp) → `pending` (Chờ duyệt) → `approved` (Đã duyệt) → `issued` (Đã phát hành) → `voided` (Đã hủy) · `pending` → `rejected` (Từ chối).
- If the pinned policy says NO approval is needed for this document (mode none, or the threshold rule does not fire): `draft` → `issued` directly.
- Multi-step policy: the document stays `pending` until every step is approved in order; ANY rejection → `rejected`.
- Only `draft` is editable (by its creator). Editing a draft re-runs generation: re-merge, re-price, new snapshot. From `pending` on, the snapshot is LOCKED — approvers approve exactly what they saw (each decision stores `snapshot_hash_at_decision`; issue refuses if the hash changed).
- `rejected` and `voided` are terminal and keep their row, steps and audit rows forever (soft, never deleted). A rejected document never had a number; a voided one keeps its number.
- A draft may be deleted (soft) — it never had a number, so no gap is created.

## §2b DECISIONS & TRADE-OFFS (surfaced at the gate — never silently guessed)

| Decision | Options | When to pick which | Default |
|---|---|---|---|
| When a document gets its number | at create / at issue | at create only if the law or the business demands a number on drafts (rare) and accepts gaps from rejected drafts; at issue everywhere else | **at issue** — drafts show "Nháp · chưa có số"; the series has no gaps (I1) |
| Number series shape | per type + year / per type forever / one global series | per type + year matches how Vietnamese SMEs number (HD-2026-001, restarts each January); forever for tiny volume; global only if the accountant requires it | **per type + year**, `{PREFIX}-{YYYY}-{NNN}`, year = issue date in the business zone |
| Approval policy | none / threshold rule / fixed steps per template / threshold that selects steps | none for low-risk papers (certificates); threshold when sign-off depends on the numbers (discount > 10% → director); fixed steps when every document of that template needs the chain (the 4-step "Hợp tác đại lý"); combined for both | **stored per template version**; the threshold rule and the step list are data the admin edits, not code |
| Approve and issue | one action (final approval issues) / two actions (approve, then issue separately) | one when nothing happens between sign-off and sending; two when the paper waits for something after approval (the customer's signature, "chờ khách ký rồi phát hành") | **two** — `{type}:issue` is its own permission; the human may flip to one |
| Who may approve | permission holder who is NOT the creator (strict, admins included) / same, but the top admin may self-approve | strict for any team of 2+; the self-approve exception ONLY for a one-person business, and every self-approval is audited as `self_approved` | **strict** — no exception unless the human asks |
| Approval scope | each document on its own / inherit from its source document | each-on-its-own always, unless the owner explicitly says a quote's sign-off covers the contract | **each on its own** (an approved quote does not approve its contract) |
| Correcting an issued document | void + replacement / amendment document linked to the original | void + replacement for any wrong document; an amendment (phụ lục) when both parties keep the original and add terms — the amendment is itself a new document with its own number | **void + replacement** — the original keeps its number, marked void, with a reason |
| Template change effect | new version (issued untouched; drafts stay pinned) / new version and drafts re-generate on request | always a new version; drafts stay pinned unless the creator clicks "regenerate from latest" | **new version, drafts pinned**; issued documents NEVER re-render |
| Output format | printable HTML → browser Print/PDF / server-side PDF render / fill the owner's .docx | printable HTML works on any host incl. edge workers; server PDF when the file must be emailed automatically (needs a rendering service); .docx fill when the customer demands an editable Word file | **printable HTML stored at issue** (A4 print CSS); "Tải PDF" = browser print; the owner's .docx templates are converted once into template versions |
| Money + VAT representation | integer minor units / decimal / float; VAT-inclusive prices / VAT as a computed line | integer minor units always (for VND: whole đồng); VAT-inclusive when the price list is quoted incl. VAT (Nhật Minh: "đã gồm VAT"); a computed VAT line when prices are net | **integer đồng, discount in basis points; follow the price list's VAT convention; VAT is never a hand-typed line** — rounding of a non-whole result: round half-up to whole đồng (confirm at the gate) |
| Price source | price list by document date / typed by staff | price list whenever one exists ("Không tự gõ giá"); typed prices only for truly bespoke work (then it's a `manual` merge field, and the human decides whether it needs approval) | **price list effective on the document date** |
| Who sees which documents | team-wide read / own only | team-wide for a small sales team working one library (the workshop app lists everyone's contracts); own-only when documents carry data colleagues must not see | **team-wide read; drafts editable by their creator only** |
| After a rejection | terminal + "copy into a new draft" / reopen the same document to draft | terminal keeps the rejection note attached to exactly what was rejected; reopen is simpler but blurs the history | **terminal + copy** — *proposed default, no source rule; the human decides* |
| A step only the creator could take (e.g. Giám đốc creates a "Hợp tác đại lý" whose last step is Giám đốc, and there is one Giám đốc) | refuse at submit, naming the step / a second holder of that role / a named deputy per step / solo-owner self-approval (audited `self_approved`) | refuse at submit always (I9) — then the human picks the fix: another person creates it, a second person gets the role, or a deputy is named for that step; self-approval only for a one-person business (see "Who may approve") | **refuse at submit with a Vietnamese message naming the step + the ways out** — *proposed default; confirm at the gate* |

Claude states each of these at the §3 gate with its default and asks the human to confirm or change — none is guessed silently. For the workshop contract app, the confirmed set is: number at issue · per type + year · fixed steps per template (3 steps; 4 for "Hợp tác đại lý") · two actions · strict · each on its own · void + replacement · new version, drafts pinned · printable HTML · integer đồng · price entered per line (the workshop app has no price list; prices are `manual` fields and every contract goes through approval anyway) · team-wide read · terminal + copy.

## §2c GOTCHAS / HOW IT GOES WRONG (this domain's classic mistakes)

- **Numbering drafts** → every rejected or abandoned draft burns a number and the series gets holes the accountant must explain; the workshop mockup itself does this (drafts `HD-2026-013`, `HD-2026-014` carry numbers). A draft shows "Nháp · chưa có số"; the number is taken at issue, in the same write (I1). *(source: ANSWER-KEY §5.8 "the number is taken when the document is ISSUED, so a rejected/deleted draft leaves no gap"; tw-baogia-workshop ui/index.html demo data)*
- **Rendering from live data** → the owner raises the G6 price or fixes a customer's name, re-opens BG-2026-001, and the already-sent quote now says something the customer never received. Render only from the snapshot; store the issued render (I2). *(source: ANSWER-KEY §5.8 row "Sửa giá G6 thành 2.900.000 … Vẫn 2.565.000đ, vẫn tên cũ")*
- **Filling a missing field with a guess** → a real naive build, missing the signer's title, printed "Chủ cửa hàng" on the contract — a legal paper stating a fact nobody recorded. A required field with no value STOPS generation and names the field (`chuc_vu_nguoi_ky`); the human adds the data, then regenerates (I3). *(source: naive-build-demo/REPORT.md probe 9b; ANSWER-KEY §5.8 row "Dừng: thiếu chuc_vu_nguoi_ky")*
- **The creator confirms their own money** → in the same naive build, a salesperson called `POST /documents/3/paid` on their own payment request: customer flipped to Chốt, revenue +2.565.000, no role check. Any action that approves, issues, or confirms money is permission-gated AND refused for the document's creator (I5); marking paid belongs to the `payments` workbook under the same rule. *(source: naive-build-demo/REPORT.md probe 9a)*
- **Inheriting approval down the chain** → "the quote was approved, so the contract is too" lets a 15% discount reach a signed contract without the director seeing the contract. Each document is approved on its own (I5). *(source: ANSWER-KEY §5.8 "an approved quote does not approve the contract made from it")*
- **A step nobody can take** → the top person creates a document whose last step only they hold; separation of duties (I5) rightly refuses their approval, and the document sits in Chờ duyệt forever with no one able to move it. Check at submit that every step has an eligible approver other than the creator (I9) and say which step fails. *(source: 2026-09-28/29 rehearsals — a Giám-đốc-created "Hợp tác đại lý" could never be approved)*
- **Trusting the client's total** → a request carrying `total: 1000000` becomes the price. The server recomputes from the price list; the client's number is ignored (I4). *(source: ANSWER-KEY §5.8 critic row "Gửi tổng tiền 1.000.000 … Server vẫn tính 2.565.000đ")*
- **Typing prices by hand when a price list exists** → old prices survive (the box has 4 orders at the pre-July G6 price) and every quote is a negotiation. Look the price up by the document date (I4). *(source: 09_Bang_Gia.xlsx "Quy định" rule 3 "Giá lấy theo bảng giá đang áp dụng vào ngày lập chứng từ. Không tự gõ giá."; price rows G6 2.400.000 → 2.700.000 from 01/07/2026)*
- **Editing an issued document** → the paper the customer holds and the paper in the system disagree, silently. Issued = immutable; wrong = void + new document with a new number (I6). *(source: 09_Bang_Gia.xlsx "Quy định" rule 6 "Chứng từ đã gửi khách thì không sửa. Sai thì hủy và làm chứng từ mới, số mới.")*
- **Approval flow hard-coded in the code** → the owner adds a director step to one template ("cập nhật mẫu Hợp tác đại lý · thêm bước Giám đốc duyệt") and needs a developer. The policy is template-version DATA; documents already pending keep the policy they were submitted under. *(source: tw-baogia-workshop ui/index.html TEMPLATES[3].flow + AUDIT `template.updated`)*
- **VAT as a typed line item** → "VAT 10%" entered as a row with a hand-typed amount drifts from the subtotal the moment a line changes. VAT is either inside the price (price list says "đã gồm VAT") or a line the server computes. *(source: ui/index.html HD-2026-007 items; 09_Bang_Gia.xlsx header "đã gồm VAT")*
- **Importing the owner's template verbatim** → the real contract .docx opens with "Ghi chú nội bộ (xóa trước khi gửi khách): hợp đồng có giảm giá trên 10% cần Giám đốc duyệt…" — copied as-is it prints on the customer's contract. Internal notes become policy data (the threshold rule) and are removed from the body. *(source: 07_Mau_Tai_Lieu/Hop_Dong_Dich_Vu.docx first paragraph)*
- **A field the template needs but the app doesn't store** → the template is imported, the first generation "works" with an empty cell. At template import, list every merge field whose `source` has no column in the host app and show it to the human BEFORE the first generation. *(source: BRIEF-v2.md "one field the template needs that the CRM doesn't store yet (must surface as missing, not blank)")*

## §3 DETECT (do this before touching any file)

<!-- FIXED boilerplate — identical in every workbook. -->

1. **Inspect:** manifest files (`package.json`, `go.mod`, `requirements.txt`, `Gemfile`, `composer.json`…), lockfiles, platform config (`wrangler.toml`, `next.config.*`, `Dockerfile`…), existing migrations/schema, the existing auth pattern, the test runner, the folder layout — and `WORKBOOKS.md` at project root if it exists (workbooks already installed). For Mode INTEGRATE, ALSO read: the subject entities a document must link to (customer / contact / company / deal), any existing price list, the permission catalog and how guards are declared, the audit mechanism (log-only or a queryable store), the idempotency mechanism, how ids and money are stored, and whether the database offers interactive transactions or only atomic batches.
2. **Decide the build mode:** **NEW** (no document surface exists — scaffold templates, documents, approvals, series, audit fresh, plus the minimal subject stub from §8 if no subject entity exists) or **INTEGRATE** (the app already has customers/deals, roles, an audit trail — read them, state where documents attach, reuse the existing permission catalog, audit and idempotency machinery; never build a parallel one). Print which mode and what it means.
3. **Print the Stack Report** — one small table: language · runtime · framework · database · migration tool · auth · hosting · test runner · conventions observed · build mode (NEW / INTEGRATE). Name unknowns as unknown; never guess.
4. **Confirm the decisions** in §2b — state each with its default and ask the human to confirm or change. The numbering moment, the approval policy, who may approve, and the output format MUST be confirmed explicitly.
5. **Choose your rung** from the ladder below. The ladder is written against CAPABILITIES, never brand names — an unfamiliar stack still lands on a rung.
6. **Gate:** print the Stack Report (with build mode) + confirmed decisions + chosen rung + a plain-words build plan (≤12 lines total) and WAIT for the human's OK before writing any code.

**Iron rules:** extend, never replace (no new framework/DB/ORM into an existing app; in INTEGRATE mode, plug into the existing subject, role and audit models, don't duplicate them) · match the house style (naming, folders, error shapes) · missing capability = propose the smallest honest addition native to the detected hosting, and wait.

**Adaptation ladder — the gap-free number + the legal status move (I1, I7). The rung decides WHERE the guarantee lives. A "read the max, add one, write later" in application code narrows the race; only one atomic write closes it.**

- **Rung A — interactive transactions with row locks or `UPDATE … RETURNING` (most server SQL engines):** in ONE transaction: CAS the document (`UPDATE documents SET status='issued' … WHERE id=? AND status IN (<issuable>)` → 0 rows = 409) · increment the series counter (`UPDATE number_series SET last_seq = last_seq + 1 WHERE type=? AND year=? RETURNING last_seq`, row created on first use) · write `seq`/`number`/`rendered_html` onto the document · insert the audit row · commit. Any failure rolls back everything, so no number is consumed without a document. `UNIQUE(type, series_year, seq)` is the backstop.
- **Rung B — no interactive transactions, but atomic batches of statements (e.g. detected Cloudflare D1, whose DAO pattern already uses `db.batch([...])`):** no counter row needed — the number is derived from the issued documents themselves in the SAME statement that flips the status: `UPDATE documents SET status='issued', issue_token=:tok, series_year=:y, seq=(SELECT COALESCE(MAX(seq),0)+1 FROM documents WHERE type=:t AND series_year=:y AND seq IS NOT NULL), issued_at=:now WHERE id=:id AND status IN (<issuable>)`, then in the same batch `INSERT INTO audit_events … SELECT … FROM documents WHERE id=:id AND issue_token=:tok` (the audit row exists only if this request won), then read back. Single-statement atomicity + the batch make it gap-free; voided documents keep their `seq`, so MAX stays right; `UNIQUE(type, series_year, seq)` is the backstop. Render `number` from `seq` (`printf('%s-%d-%03d', prefix, year, seq)` or in code after read-back) and store `rendered_html` in a follow-up CAS guarded by `issue_token`.
- **Rung C — only single-key compare-and-swap (KV-style storage, no multi-statement atomicity):** CAS-increment a per-series counter key, then write the document; a crash between the two burns a number. Print this WARNING in plain words: "Your storage cannot give out a number and save the document in one step; if the app crashes at the wrong moment, the series will have a gap. I recommend {the lightest SQL database native to the detected hosting}." Proceed only if the human types "accept the risk".
- **Rung D — no atomic operation at all (spreadsheet-backed, flat files):** read-max-then-write with a re-check — print the same WARNING extended to duplicates ("two people issuing at the same second can get the SAME number"), and proceed only if the human types "accept the risk".

**Every other status move (submit, approve, reject, void) uses the same CAS shape on every rung:** `UPDATE … SET status=:to WHERE id=:id AND status=:from` (plus the step row for approvals) and its audit row in the same transaction/batch; 0 rows affected → 409 "this document has already moved". Never check status in code and write later.

**Worked adaptation — INTEGRATE on a RUNWAY snapshot (the workshop build; follow `docs/recipes/add-resource.md` for the mechanics):** detected Rung B (D1: atomic `db.batch`, CAS via `UPDATE … WHERE … RETURNING` per `docs/architecture.md` boundary invariant 4) · ids = `generateUlid()`, timestamps unix seconds, DAOs are pure functions returning DTOs (`docs/dao-pattern.md`) · the document row carries `user_id` = creator (the recipe's owner column) · permissions appended to `packages/rbac/src/catalog.ts` and seeded by a migration: `contract:read`, `contract:write`, `contract:submit`, `contract:approve`, `contract:issue`, `template:write`, `audit:read` (the workshop mockup's matrix — Giám đốc all · Quản lý all but `template:write`/`user:write` · Nhân viên read/write/submit only) · every route: `bodyLimit → requireAuth() → requirePerm(...) → withIdempotency()` on mutations (`docs/idempotency.md`: key in the `Idempotency-Key` header, same key + different body → 409) · edit-own-draft uses `requirePerm("contract:write", { resource: … ownerId })` · separation of duties is NOT expressible with `requirePerm`'s ownership option (that checks actor == owner and lets admins bypass — the opposite rule); it is a domain check in the approve/reject command (§9) · RUNWAY's audit is Logpush-only by default (`docs/audit.md`); the Nhật ký page and `audit:read` need `docs/recipes/add-audit-store.md` (the `audit_events` table) — and document status rows are written INSIDE the status batch, not through the recipe's fire-and-forget logger · denials: `requirePerm` returns the 403 via its `onDeny` hook without auditing — add the `permission.denied` audit call there · money: integer columns; for a single-currency VND app the add-money recipe's "hand-rolled integer minor units, fine for one currency" alternative applies (Dinero is optional).

## §4 THE LAYERS (build in this order; one responsibility per layer)

| Layer | This feature puts here |
|---|---|
| route | `GET /templates` · `GET /templates/{id}` · `POST /templates` · `POST /templates/{id}/versions` · `POST /documents` (generate) · `GET /documents?type&status&subject&cursor` · `GET /documents/{id}` · `PATCH /documents/{id}` (draft only) · `POST /documents/{id}/submit` · `POST /documents/{id}/approve` · `POST /documents/{id}/reject` · `POST /documents/{id}/issue` · `POST /documents/{id}/void` · `GET /documents/{id}/render` (printable HTML) · `GET /approvals/mine` (the "Chờ tôi duyệt" queue) · `GET /documents/{id}/audit` — thin handlers, zero logic; rename `documents` to the house word (`contracts` in the workshop app) |
| validation | edge schema checks: types per merge-field type (money = non-negative integer, percent = integer bps 0–10000, date = ISO date), required request fields, `template_version_id`/`subject_id` are well-formed ids; REJECT unknown fields and any client-sent `number`, `status`, `total`, `amount`, `unit_price` from the price list, derived dates; void requires a non-empty reason; NO business rules here |
| auth | per-endpoint guards per the §6 matrix; the creator-cannot-approve rule is NOT here (it needs the document) — it lives in the command, and its refusal is audited the same way |
| command | `generateDocument` (load pinned template version + subject + price list at doc date → merge → REFUSE on missing required fields (I3) → price + total (I4) → build snapshot + hash → persist draft → audit + emit `document.created`) · `updateDraft` (creator only, re-runs generate) · `submitDocument` (evaluate the pinned policy on the snapshot → create approval steps, or go straight to issuable if none required → CAS draft→pending) · `decideStep` (actor ≠ creator else 403 + `permission.denied`; actor holds the step's permission; snapshot hash unchanged; CAS the step and, when last, the document) · `issueDocument` (the §3 rung: number + status + audit atomically → store render → emit `document.issued`) · `voidDocument` (CAS issued→voided with reason; optional `replaced_by_id`) · `generateFrom(source)` (quote → contract → payment request copies the source's FROZEN amounts, never re-prices) |
| domain | PURE functions, no framework/DB imports: `mergeFields(template, values) → {filled, missing[]}` · `unresolvedPlaceholders(body)` · `priceAt(priceList, code, date)` · `lineAmount(qty, unitPrice, discountBps)` · `totals(lines, vatMode)` · `amountInWords(vnd)` ("Hai triệu năm trăm sáu mươi lăm nghìn đồng") · derived dates (`validUntil = doc_date + 15 days`; `contractEnd = start + N months − 1 day`; `paymentDue = doc_date + 7 days` — values from the template's rules, not hard-coded) · `requiresApproval(policy, snapshot) → steps[]` · `canTransition(from, to)` · `formatNumber(prefix, year, seq, pad)` · `renderHtml(versionBody, snapshot)` with HTML-escaping of every merged value — each unit-testable in isolation |
| persistence | repository functions — the ONLY place queries live: templates/versions (insert-only for versions), documents (insert draft, CAS update per transition), approval steps, the §3 numbering rung, audit insert in the same transaction/batch, `listDocuments` (cursor, filters), `approvalsFor(principal)` |
| event | `document.created`, `document.submitted`, `document.approved`, `document.rejected`, `document.issued`, `document.voided` (use the app's noun — `contract.issued` in the workshop app) through one small in-process dispatcher — the seam exists even if today's only listener is a log line |
| listener | best-effort subscribers: log line; on `document.submitted` notify the approvers of the next step (in-app queue is the source of truth, a notification is a courtesy) — never throws into the request; on an edge worker, real async work runs inside `ctx.waitUntil()` |
| adapter | n/a by default — printable HTML needs no outbound call. If the human chose server-side PDF, the renderer is ONE adapter module (credentials from env; a renderer outage leaves the document issued and its HTML downloadable — never un-issues it) |
| audit | append-only rows for: document created / submitted / step approved / step rejected / issued (with number) / voided (with reason) / template version created / `permission.denied` (who, which permission or rule, which document, ip) — written in the same atomic write as the change; readable per document and globally under `audit:read` |

**Rules:** domain functions stay pure · all queries behind persistence functions · a layer that truly doesn't apply is declared n/a with one line of why — never silently skipped, never faked · follow the project's existing layout for where these files live.

## §5 HOLD THE LOAD (implement silently; verified in §7)

- List endpoints paginated by default (cap 50, cursor or offset per house convention); the document list filters by type, status (the five tabs), subject and date range; the approvals queue and the audit list are paginated too.
- Indexes ship with the schema: `documents(type, status, created_at)` · `documents(subject_type, subject_id)` · UNIQUE `documents(type, series_year, seq)` (partial / nullable-aware so drafts with NULL `seq` don't collide) · `approval_steps(document_id, step_no)` + `approval_steps(status, required_permission)` for the queue · `audit_events(target, ts)` and `audit_events(ts)` · `template_versions(template_id, version_no)` UNIQUE.
- The list page is ONE query per page (status, number, subject name, total, updated) — the subject name shown in the list comes from the snapshot, never a per-row lookup (no N+1); the queue is one query joining steps to documents.
- `POST /documents` and every status action (`submit`, `approve`, `reject`, `issue`, `void`) accept an idempotency key (header, per house convention); a replay with the same key returns the ORIGINAL result — one document, one number; the same key with a different body is refused (409 on RUNWAY, else the house's conflict code). This stops a DOUBLE-SUBMIT; the §3 rung stops two DIFFERENT requests racing one series.
- Handlers stateless: the number and the status guarantee live in the §3 rung at the storage layer, NEVER in an in-memory counter, mutex or cache (they die at the second instance).
- Bounded everything: line items per document capped (default 200), snapshot size capped (default 256 KB), list ranges capped (default 366 days), template body capped; over-cap → 422.
- Issued documents are served from the stored `rendered_html` — rendering happens once, at issue, not on every view.

## §6 THE GUARDS (security — non-negotiable)

**Authz matrix — every endpoint this workbook creates gets a row** (permission names follow the host's `resource:verb` convention; `{t}` = the document type's resource name, `contract` in the workshop app):

| Endpoint | Who may call it |
|---|---|
| `GET /templates`, `GET /templates/{id}` | `{t}:read` |
| `POST /templates`, `POST /templates/{id}/versions` | `template:write` (Giám đốc only in the workshop app) |
| `POST /documents` (generate) | `{t}:write` |
| `GET /documents`, `GET /documents/{id}`, `GET /documents/{id}/render` | `{t}:read` (team-wide per §2b; own-only if the human chose it) |
| `PATCH /documents/{id}` | `{t}:write` AND creator AND status = draft |
| `POST /documents/{id}/submit` | `{t}:submit` AND creator |
| `POST /documents/{id}/approve`, `/reject` | the current step's permission (`{t}:approve`) AND NOT the creator (strict — admins included unless the human chose the solo-owner exception) |
| `POST /documents/{id}/issue` | `{t}:issue`; when the policy required no approval, `{t}:issue` or the creator-with-`{t}:submit` per the confirmed policy (the Nhật Minh rule lets sales issue an under-threshold quote themselves) |
| `POST /documents/{id}/void` | `{t}:issue` (the people who can release a document can withdraw it) — or a narrower `{t}:void` if the human asks |
| `GET /approvals/mine` | `{t}:approve` — returns only steps the caller may decide (excludes their own documents) |
| `GET /documents/{id}/audit`, global audit list | `audit:read` |

**Every refusal is audited:** a failed permission check AND a failed separation-of-duties check both return 403 Problem+JSON AND write `permission.denied` {actor, permission or rule (`creator_cannot_approve`), target `document:<id>`, ip}. The document is untouched.

**Input validation:** the server derives the {number}, status, unit prices (from the price list at the document date), line amounts, discount amount, totals, amount-in-words and derived dates, and IGNORES the client's version · strict types per merge-field type · reject unknown fields · reject the impossible: negative quantities or prices, discount outside 0–100%, a template version that is not the template's (or is inactive), a subject that doesn't exist, a source document of the wrong type or not yet issued, any action on a document not in the expected status (409).

**Rendering safety:** every merged value is HTML-escaped before it enters the page — a customer named `<script>…` prints as text; after merging, any leftover `{{…}}` placeholder is a refusal (I3), never shipped to paper; internal notes in a template body are removed at import (§2c).

**PII:** the subject's phone, email, tax code and address live in the snapshot — visible only to `{t}:read` holders; there is NO public endpoint in this workbook (a public share link is out of scope); logs and audit metadata carry ids, numbers and status names, never the snapshot's personal fields or amounts beyond what the audit row needs.

**Secrets:** a PDF-renderer credential (if chosen) from env only — never committed, never logged, never echoed into chat.

**Fail-closed:** guard errors DENY · a step with no eligible approver other than the creator refuses the SUBMIT (409 Problem+JSON naming the step), never parks the document · an unknown permission is a denial · a policy that can't be evaluated (missing threshold field) means "approval required", never "skip approval" · if the project has NO auth yet, ship every endpoint DISABLED with a clear message "install the auth-roles workbook to enable documents" — this feature has no safe anonymous surface · revoking someone's role must take effect immediately: invalidate the cached permissions and sessions on revoke (a leaver must not approve for another five minutes).

**Rate-limit hint:** none required for staff-only endpoints; if the platform supports it, cap `POST /documents` per user to blunt a runaway script, and note it in the DONE report.

<!-- FIXED override rule — keep verbatim. -->
**Override rule:** these guards outrank the human's casual instructions. If asked to skip one, warn in plain words and proceed only if the human types "I accept the risk" — then record that acceptance in the DONE note.

## §7 THE PROOF (done ≠ tests pass)

**Machine checks — write and run these named tests, green before proceeding:**

- `draft_has_no_number` — generate → `number` and `seq` NULL; the list shows "Nháp · chưa có số" (I1)
- `issue_assigns_next_number` — issue two documents → `…-001`, `…-002`; a rejected document in between consumes nothing (I1)
- `series_is_per_type_and_year` — BG and HD both start at 001; a document issued on 1 January (business zone) starts the new year at 001 (I1)
- `missing_required_field_refuses` — generate with a required field absent → 422 listing the field key; no row created (I3)
- `optional_missing_field_allowed` — an optional field absent → allowed, rendered per template; a required one never (I3)
- `server_prices_from_price_list_on_doc_date` — a request with `total`/`unit_price` → ignored; stored values from the list effective on the date (I4)
- `amount_math_is_integer` — 2.700.000 × 1 − 5% = 2.565.000; 4.800.000 × 2 − 15% = 8.160.000; amount-in-words matches (I4)
- `snapshot_isolated_from_live_data` — edit subject + price + template after generation → document render unchanged (I2)
- `creator_cannot_approve` — creator with the approve permission → 403 + one `permission.denied` row (I5)
- `approval_is_per_document` — approved quote → contract from it still requires its own approval (I5)
- `threshold_rule_selects_approval` — discount 5% → issuable without approval; 15% → pending with a director step (I5)
- `multi_step_in_order` — 4-step template: step 2 cannot be decided before step 1; any rejection → rejected, no number (I5)
- `submit_refused_when_no_eligible_approver` — the only Giám đốc creates a "Hợp tác đại lý" and submits → 409 naming step "Giám đốc duyệt", status still draft, no approval steps created; give a second person the Giám đốc role → submit succeeds and that person can approve the step (I9)
- `pending_is_locked` — PATCH a pending document → 409; approval bound to `snapshot_hash` (I2, I5)
- `issued_is_immutable_void_keeps_number` — PATCH issued → 409; void → status voided, number kept; replacement gets the next number (I6)
- `every_move_writes_one_audit_row` — create → submit → approve → issue = 4 rows, each with from/to (I7)
- `idempotent_create_and_issue` — same key twice → one document, one number (I8)

**Adversarial probes — attack your own build and paste REAL output:**

- **The numbering race:** approve 10 documents of one type, then fire **10 concurrent issue requests** (one per document) → expected: 10× 200, numbers `…-001` to `…-010`; `SELECT COUNT(*), COUNT(DISTINCT seq), MIN(seq), MAX(seq) FROM documents WHERE type=? AND series_year=?` → `10 | 10 | 1 | 10`. Then fire **5 concurrent issue requests at ONE approved document** → exactly 1 number consumed; the others 409 (or the idempotent replay of the winner); `MAX(seq)` rises by exactly 1. Paste both tallies. On Rung C/D show the tally anyway — that's what the warning is for.
- **The missing-field probe:** generate a contract from a template whose required field `chuc_vu_nguoi_ky` has no value → expected: `422` with body listing `missing_fields: ["chuc_vu_nguoi_ky"]` (label "Chức vụ người ký"), zero new document rows, series untouched. Then add the value and regenerate → the contract is created and the title prints as entered.
- **The self-approval probe:** as a user holding `{t}:approve`, create and submit a document, then approve it yourself → expected: `403` Problem+JSON, the document still `pending`, and a new audit row `permission.denied` with actor = you, rule `creator_cannot_approve`, target `document:<id>`. Repeat as an admin → same 403 (strict). Repeat as Nhân viên on someone else's document → `403` + `permission.denied` with permission `{t}:approve`.
- **The live-data probe:** issue a document, save its `rendered_hash`; rename the customer, change their phone, raise the price-list price → `GET /documents/{id}/render` → expected: hash IDENTICAL, old name, old phone, old amount.
- **The template-edit probe:** issue a document on template v1; create v2 with a changed clause → expected: the issued document's hash IDENTICAL; a new document uses v2; an existing draft still shows v1 until regenerated.
- **The replay probe:** `POST /documents` twice with the SAME `Idempotency-Key` and body → expected: same id both times, second response marked as a replay, `COUNT(*)` for that subject rises by 1; same key with a DIFFERENT body → refused (409 on RUNWAY).
- **The tamper probe:** generate with `total: 1000000` and a `unit_price` of 1 in the body → expected: rejected as an unknown/forbidden field (422), or ignored — the stored total is the server's (2.565.000 for the Nhật Minh fixture), never the client's.
- **The approve-then-edit probe:** approve step 1, then force a snapshot change (direct PATCH or DB edit in a test) → expected: issue refuses with 409 "document changed after approval".

**Reference fixture (Nhật Minh — use it when the host is the course CRM; doc date 28/09/2026, Asia/Ho_Chi_Minh):** quote A (G6, 1 shop, −5%) → `BG-2026-001` · 2.565.000đ · valid to 13/10/2026, no approval · quote B (G12, 2 shops, −15%) → Chờ duyệt, no number, 8.160.000đ, 1 audit row · director approves B → `BG-2026-002`, 3 audit rows total · G6 raised to 2.900.000 + A renamed → BG-2026-001 unchanged; a new quote for A = `BG-2026-003` · 2.755.000đ · contract from BG-2026-001 → STOP, missing `chuc_vu_nguoi_ky`; after adding it → `HD-2026-001` · 2.565.000đ · 28/09/2026 → 27/03/2027 · contract from BG-2026-002 → Chờ duyệt (its own approval) → `HD-2026-002` · 8.160.000đ · 28/09/2026 → 27/09/2027 · payment request for A → `DNTT-2026-001` · 2.565.000đ · due 05/10/2026 · transfer note "NM DNTT-2026-001".

**World checklist — hand the human this, copy-paste ready:**

1. Open Templates, open one → you see its fields (required ones marked), default line items, clauses and its approval steps.
2. Create a document from it for a real customer, leaving a required field empty → you see a clear "missing: …" message naming the field, and no document is created.
3. Fill the field and create it → it opens as paper, marked "Nháp · chưa có số"; submit it.
4. Try to approve it with the same account → you are refused; open the audit log → the refused attempt is there.
5. Switch to a manager/director account, approve and issue it → it now has the next number in the series.
6. Change the customer's name and the template's wording, then re-open the issued document → nothing on it changed.
7. Void it with a reason and generate a replacement → the old one keeps its number marked void; the new one has the next number.

<!-- FIXED closing audit — keep verbatim. -->
**Closing audit — print all four, countable, before claiming done:** (1) the Layer Map — all 10 layers → real file paths or explicit n/a; (2) the Guard audit — every §6 row → where it is enforced; (3) the rung chosen in §3 and why; (4) every invariant I1–I9 → the named test or probe that proves it.

## §8 SNAP POINTS (composition)

<!-- FIXED ledger rule — keep verbatim. -->
**The ledger:** on completion, append one line to `WORKBOOKS.md` at project root: `documents · v1.0 · rung {A-D} · endpoints: {…} · events: document.created, document.submitted, document.approved, document.rejected, document.issued, document.voided`. Create the file with a one-line header if absent.

**Requires:** none — the workbook stands alone. If the host app has no subject entity, create the minimal stub `customer(id, name, contact_person, tax_code, phone, email, address)` (the workshop app's Khách hàng page) and nothing more; if it has no auth, every endpoint ships disabled (§6 fail-closed).

**Pairs with:** `auth-roles` — flips the disabled endpoints on and maps `{t}:read/write/submit/approve/issue`, `template:write`, `audit:read` to roles · `crm` — the subject becomes the deal (and its contact/company); documents appear on the deal's timeline; the deal's package/value feed the merge fields · `payments` — subscribes to `document.issued` for payment-request/invoice types to open an expected payment keyed by the document number (the transfer note "NM DNTT-2026-001"); marking PAID lives there, permission-gated and never by the document's creator · `email` — subscribes to `document.issued` to send the stored render to the subject.

**Provides:** the endpoints in §6 · events `document.created` / `document.submitted` / `document.approved` / `document.rejected` / `document.issued` / `document.voided` with the full document record (snapshot included) as payload · `generateFrom(sourceDocument, targetType)` for chains (quote → contract → payment request) · `renderHtml(documentId)` as the one sanctioned way to get the paper.

<!-- FIXED shared conventions — keep verbatim. -->
**Shared conventions (all workbooks):** error taxonomy 400/422 validation · 401/403 auth · 409 conflict · 500 unexpected — event names `noun.verb-past` with the full record as payload — soft-delete over hard delete wherever history matters.

## §9 KNOWN TRAPS

- **Two-step numbering:** `SELECT MAX(seq)` in code, then `UPDATE … SET seq = max+1` in a second statement → two issuers read the same max → duplicate. The number is computed and written in ONE atomic statement/transaction (§3).
- **Counter and document in separate writes:** incrementing the counter in one request/statement group and writing the document in another → a failure between them burns a number (gap). Same transaction or same batch, always.
- **Status checked in code, written later:** `if (doc.status === "pending") update(...)` lets two approvers both pass, or approve-after-reject. CAS: `WHERE id=? AND status=?`, 0 rows → 409.
- **Using the ownership guard for separation of duties:** RUNWAY-style `can(principal, perm, { ownerId })` ALLOWS when actor == owner and lets admins bypass — the exact opposite of "never the creator". Write the SoD rule as an explicit domain check (`actor.id !== document.created_by`) in the approve/reject command, applied to admins too. *(RUNWAY docs/rbac.md "The gate")*
- **Denials that leave no trace:** a guard that returns 403 without writing an audit row makes the `permission.denied` screen empty. Hook the audit write into the guard's deny path (RUNWAY: `requirePerm`'s `onDeny`) AND into the SoD refusal.
- **Fire-and-forget audit for status moves:** the audit-store recipe swallows write failures so an outage doesn't fail the operation — right for login noise, wrong here: a status move without its row breaks I7. Status audit rows go in the same transaction/batch as the move. *(RUNWAY docs/recipes/add-audit-store.md)*
- **Copying the list example verbatim:** add-resource step 6's `listOrdersForUser` takes a `userId` but its WHERE clause only uses the cursor — it returns everyone's rows. Decide visibility explicitly (§2b) and write the filter you mean. *(RUNWAY docs/recipes/add-resource.md step 6)*
- **Rendering on read:** a `GET /render` that merges the template with live data every time is I2 broken with a delay. Merge from the snapshot; after issue serve the stored `rendered_html`.
- **String-replace merge:** `body.replaceAll("{{x}}", value)` leaves unknown `{{y}}` on the paper, and inserts raw HTML from customer data. Merge through `mergeFields` (returns `missing[]`), escape every value, scan for leftover placeholders before accepting.
- **Float money:** `2700000 * 0.95` in floating point, or discount as `0.05`, eventually prints a đồng off. Integers only: amounts in đồng, discounts in basis points, one explicit rounding step.
- **The year boundary in UTC:** a document issued at 00:30 on 1 January in Vietnam is still 31 December in UTC → last year's series. Compute `series_year` and `doc_date` in the business zone.
- **Stale permissions after a role change:** a cached principal keeps a demoted or departed approver's rights for minutes (RUNWAY: up to 300s). On revoke, invalidate the permission cache and the sessions — "nhân viên nghỉ việc còn duyệt được không?" must be "no" immediately. *(RUNWAY docs/rbac.md "Cache invalidation contract"; workshop DESIGN.md block 6)*
- **Idempotency key in the body:** the middleware can't see it before the handler runs. Header only. *(RUNWAY docs/idempotency.md "Anti-patterns")*
- **Hard-deleting a rejected or voided document:** destroys the history and, for voided ones, leaves a hole in the series. Soft only; only never-numbered drafts may be deleted, and softly.

## §10 AFTER THE LIVE — what the real build changed (v1.2, proven 2026-10-01/02 on tw-hopdong-live)

The base recipe (§1–§9) was built live and held. These are the decisions the real build REVERSED or EXTENDED, with the source doc per item (`docs/intent|spec|plan|fix/` in the app repo). Where this section and §2b disagree, this section wins.

| Topic | §2b/§2 said | Real build did | Source |
|---|---|---|---|
| PDF | printable HTML + browser print | `GET /contracts/{id}/pdf` renders ONLY on click (Cloudflare Browser Rendering → R2 → CAS + audit) from the frozen print HTML; `PdfRenderer` = browser/fake/off; 503 when unavailable, document stays issued; a voided doc still serves its original file. Budget rule: if the renderer is not working after one more round, fall back to the print dialog — a small item must not block the others | INTENT/SPEC/PLAN-05 |
| Document types | one type, `contract` | 4 types: HD · BG (valid_until = doc_date +15) · DNTT · PXK (warehouse note, form 02-VT, DEMO). One `contracts` table with `type`; own prefix + own gap-free series each (`UNIQUE(type, series_year, seq)`); per-type create permission (`quote:write`, `payment_request:write`, `delivery_note:write`) | SPEC-09 |
| Parent → child | n/a | BG → HD → DNTT: child copies the parent's FROZEN lines and prices (no re-price); parent must be `issued` (and BG unexpired); one live child per parent (UNIQUE); voiding a parent with live children is refused (`has-children`); issue re-checks the parent in the same CAS batch | SPEC-09 |
| Templates | owner's .docx converted once by hand into a template version | Giám đốc uploads `.docx` → pure reader (fflate + fast-xml-parser; zip-bomb, macro, DOCTYPE limits; 415/422 `docx-invalid`) → preview (no state) → per-field label/type/required → saved through the existing `/templates` path (new template or new version) | SPEC-10 |
| Prices | static price list sheet | products (service + goods) + dated prices ex-VAT with VAT rate on the price level; history append-only, no back-dating (triggers); per-line discount before tax; VAT rounded half-up PER RATE GROUP; BigInt; KCT lines supported; contract lines + live total preview | SPEC-08 |
| Roles | 3 fixed roles, read-only matrix | editable role × permission matrix (add/clone/delete, immutable name + label); assigning or granting needs ⊇ perms (FR-12); `audit_events` append-only by trigger; permission cache purged on role change, TTL 60s | SPEC-06 |
| RBAC controls | n/a | static SoD on PERMISSION pairs (a role may not hold both codes of a pair); permission changes go through a request approved by a second `roles:write` holder (the "cơ chế duyệt 2 lớp" — Tony's term, not "four-eyes"); JIT admin with reason and ≤ 8 h expiry (cron); quarterly access review | SPEC-07 |
| Who owns what | admin = top | Giám đốc = owner, admin = IT: only a `giam_doc` holder assigns/invites any role carrying `roles:write`; admin's role changes are approved by a `giam_doc` holder; first Giám đốc is bootstrapped by `users:write` when none exists | FIX-05 |
| Root | n/a | system role `root` (seeder only) owns ONE switch, the 2-layer approval on/off (Bảo mật screen, reason + audit). Off = admin and Giám đốc change permissions directly, but SoD pairs, `grant_not_held`, JIT, `owner_only`, `root_role` still hold | C-11-001 |
| UI locks | web computes which cells are disabled | every disabled/hidden control and its reason is computed by the API with the SAME function the write guard uses (`can`, `locked_reason`, `role_options`, `grantable`); web only renders the reason code as a Vietnamese sentence. The server also refuses locking yourself (403 `self_disable`) | FIX-06 |

### New invariants (add to §7 proof; each has a named test in the app repo)

- **I10** nobody changes their OWN role (403 `self_role`) or locks themselves (403 `self_disable`) — FIX-03/06.
- **I11** a role carrying `roles:write` is assigned, invited AND RE-INVITED only by a `giam_doc` holder (403 `owner_only`) — every path to the same effect applies the same rule: invite, assign, change role, re-invite (FIX-05/07).
- **I12** an export archive carries no credential column (`password_hash`, tokens, secrets); the test scans every exportable table's columns by name (FIX-08).
- **I13** a document type has its own series; the same year can hold HD-2026-001 and BG-2026-001 without a collision (SPEC-09).
- **I14** a child document's money equals its parent's frozen money (SPEC-09 FR-5).

### New traps found after the live (add to §9)

- **Guard on one path, not its siblings:** FIX-03/05 closed "assign role" but the re-invite route reached the same account takeover (a pending Giám đốc invitation could be activated by an admin with their own password). Rule: for every security effect list ALL paths that produce it and put the same domain function behind each. The SPEC/CARD templates now carry `INV-n` + "every path to the effect".
- **`SELECT *` into an export:** the privacy export dumped `users.password_hash`. Table-level allow-lists hide column-level leaks; exclude columns by name and test by scanning the schema.
- **UI rules re-implemented in the web app:** the admin saw tickable cells the API refused (403 `grant_not_held`). Compute locks and reasons server-side and ship them in the DTO.
- **Own-role rule deadlocks:** forbidding approving a change to the role you hold left admin's request with no eligible approver (409 `no-eligible-approver`) and the error was off-screen in a scrolled drawer. Decide who the owner is, and show errors in a sticky footer.
- **Print CSS vs template classes:** the seeded template used `.center`, `.b`, `.sig` that the print stylesheet did not define; the signature block and header looked plain (FIX-02). Test the stylesheet against the classes the migration's template body uses.
- **A global CSP breaks `/docs`:** one `default-src 'self'` blanked the Swagger page; give the one HTML docs route its own CSP (FIX-01).
- **Test cost:** a slow password hash (scrypt) in every test took the API suite from ~600 s to ~73 s; use a fast hash under the test env only, and keep a dummy hash with the same parameters so timing does not leak.
- **Public repo, demo data:** never default a demo password in a seeder (`demo:seed-remote` refuses without `DEMO_PASSWORD` ≥ 12 chars).

### Not built (still Parked in ROADMAP)

Email on issue · payments (mark DNTT paid) · CRM / customer import · inventory behind PXK · template editor in place of import.

## DONE

Built twice: rehearsed 2026-09-28 (196 API tests, 8 probes) and live 2026-09-29 (rows 01–02 on stage), then rows 03–5 + hardening on 2026-09-29→10-02 with the M5 method (INTENT → SPEC → PLAN → cards → PROOF). Mode NEW on RUNWAY, rung B. Final: api 446 · web 365 · e2e 8/8. Human decisions that shaped it: Giám đốc = owner / admin = IT, Root + 2-layer approval switch, rules computed by the backend, PDF time-box. Next workbook: read §10 first — the guard-per-path trap (I11) and the UI-locks-from-API rule cost the most rework.
