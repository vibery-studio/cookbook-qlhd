# SPEC-NN: [feature name]

<!-- Step 2. Copy to docs/spec/SPEC-NN.md (same NN as the intent). The WHAT — exact enough to test.
     Every FR points back to an OUT/PRB; every AC proves an FR or a "now" edge case. Next: PLAN-NN tests every AC. -->

Status: Draft | Approved [YYYY-MM-DD]
Intent: docs/intent/INTENT-NN.md

## 1. Research (sources + date)
- Domain: [how features like this usually fail] — [source]
- Stack: [library / platform facts this relies on, from current official docs] — [source, date]

## 2. Requirements
- [FR-1] [what the system does, observable] → OUT-1
- [FR-2] [ ] → OUT-2

## 3. Design
- Data: [entities, fields, identity key, what is never overwritten]
- Screens / flow: [the user's path, incl. empty / loading / error]
- API (contract-first): the OpenAPI paths this feature adds or changes — method + path → request → response → errors —
  written here before any code; the build updates the app's OpenAPI to match

## 4. Edge cases — the human marks each: now · later (why) · n/a
| Category | Case here | Decision |
|---|---|---|
| Input (empty, format, accents) | | |
| Duplicates & identity | | |
| Two people at once | | |
| Failure & retry | | |
| Permissions / not logged in | | |
| Lifecycle (delete, undo) | | |
| Money | | |
| Time / dates | | |

## 5. Security
- Who may do what: [ ] · Personal data: [where it lives, never logged] · Abuse: [what an attacker tries]
- Security invariants (only when the feature touches auth, access, money, personal data or delete; else write "n/a"): one named line each, e.g. `INV-1: a role carrying roles:write is assigned only by an owner` · `INV-2: an export archive carries no credential column`. For each: **every path to the same effect** (invite, re-invite, edit, activate, cron, copy, import…) and the control each path uses. A path with no control listed = a gap to close now.

## 6. Decisions (the human decides)
- [DEC-1] [choice] · options: [ ] · recommended: [ ] · decided: [ ]

## 7. Acceptance — checkable from outside, few, about outcomes (each proves an FR, a "now" edge case, or a DEC)
- [AC-1] [a real state: URL, row, flow] — proves FR-1
- [AC-2] [a "now" edge case and what the user sees] — proves §4 [row]
- [AC-3] [personal data / access: the attack and expected result, e.g. "not logged in → 401, no data"]

## 8. Trace check (before the STOP)
- [ ] every FR points to an OUT · every AC proves an FR, a "now" edge case, or a DEC · every "now" edge case has an AC
