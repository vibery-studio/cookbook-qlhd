# How we work — one feature at a time

Anthropic's loop (explore → plan → implement → verify → commit) with a written record at each step.
Same number = one feature: `INTENT-01` → `SPEC-01` → `PLAN-01` → cards `C-01-001…`. Each record starts from its template in `docs/templates/` (copy it, fill it, drop what doesn't apply and say why);
the ids chain from one to the next — PRB → OUT → FR → AC → card. Every step ends with a STOP:
show a short summary (≤12 lines, the file holds the detail), wait for the human's OK, then commit.

## Start of a session

A SessionStart hook (`.claude/hooks/where-we-are.sh`) puts the latest INTENT / SPEC / PLAN and their Status in your
context. Tell the human in one line where we are before anything else.

## CLAUDE.md grows with the project

CLAUDE.md starts as a scaffold with no project facts. Add them the moment they are decided — short, facts only:
- `IDEA.md` + `MAP.md` approved → write 2–4 lines under `## What this is`: the app, who uses it, the one job it does.
- `ENGINEERING.md` approved → add `## Stack` (one line per choice) and fill `## Commands` with the real commands.
- A rule the human states twice, or a mistake that happens twice → one line under `## Rules`.
Show the CLAUDE.md change in the same STOP as the step that caused it.

## The roadmap — what gets built next (and nothing else)

- After `ENGINEERING.md` is approved and before the first feature: draft `docs/roadmap/ROADMAP-01.md` from
  `docs/templates/ROADMAP.md`. Order the rows by what must exist first (say which row needs which), and ask the human
  to reorder by what the business needs first. **STOP.** On OK it becomes `Status: Active`.
- Every feature and small feature names its roadmap row (in the INTENT or the card). A request with no row: say so,
  and offer two options — add it to the active roadmap (the human places it) or park it in *Parked*. Never build off-roadmap.
- A row is `done` when its feature's PROOF is approved. When every row is done: set the roadmap `Status: Done`, draft the
  next `ROADMAP-NN` from the MAP lines not served yet, the *Parked* list, and what the users asked for. **STOP** for approval.
- Small changes and bugs don't need a row.

## Size the request first

Say which path and why, in one line:
- **Small change** (copy, styling, a config value, docs): make it, show before/after, commit on OK. No test.
- **Small feature** (one clear outcome on one screen, reads data that already exists, stores nothing new): one card
  `docs/plan/cards/C-NN-001.md` from `docs/templates/CARD.md` with its why and done-check → STOP → build it → show it
  working. Commit on OK.
- **Bug** (the app does something other than what was agreed): `docs/fix/FIX-NN.md` from `docs/templates/FIX.md` — the steps to reproduce, add a test that fails
  on the current code, fix the cause, show the test passing. Commit on OK.
- **Feature** (anything else — always when it touches money, access, personal data, the data model, or deleting):
  the full loop below.

## 1. INTENT — why · `docs/intent/INTENT-NN.md` from `docs/templates/INTENT.md`   (explore)
- Read `IDEA.md`, `MAP.md`, and the box first; then interview the human only on what they don't answer —
  AskUserQuestion, one question per message.
- Capture: who it's for, the one main outcome, what "better" looks like, what's out. Keep the solution out of it —
  if they name a fix ("add a button"), ask what's wrong today.
- Name the `MAP.md` line it serves. **STOP.**

## 2. SPEC — what exactly · `docs/spec/SPEC-NN.md` from `docs/templates/SPEC.md`   (explore)
- Research current official docs for anything the feature uses.
- Requirements traced to the intent · the data · the flows · edge cases (input, duplicates, two people at once,
  failure and retry, permissions, money, time) — the human marks each *now*, *later*, or *n/a* · security ·
  acceptance checks someone can verify from outside. **STOP.**

## 3. PLAN — how, in small steps · `docs/plan/PLAN-NN.md` + `docs/plan/cards/C-NN-NNN.md` from `docs/templates/PLAN.md` + `CARD.md`   (plan mode)
- Use plan mode. First write the acceptance tests from the SPEC — when there is an API they call it exactly as the SPEC's
  API contract says — and watch them fail. No other code: the app's OpenAPI is updated by the first BUILD card, before
  any handler.
- Then: the files that change, the order, the risks, and cards — one small job each, with its own done-check.
- The plan follows `ENGINEERING.md`; if it can't, say so instead of breaking a rule. Tick the trace check. **STOP.** No product code before this.

## 4. BUILD — one card at a time   (implement)
- Build a card, run the checks, show the real output, say what's next. Only the tests the card's risk needs.
- The plan turns out wrong → stop, explain, propose the change, wait.

## 5. PROOF — does it really work?   (verify → commit)
- Run all checks and show real output · show each new endpoint working in `/docs` (Swagger UI) · open the app and use it
  as its real users would · give the human a short
  checklist of what to try and what they must see, including the *now* edge cases.
- Personal data or access → try to break it: call it without logging in, change an id, look for data a stranger
  shouldn't see. Write it all in the PLAN's PROOF log. **STOP.** On OK: commit, and set the PLAN's Status to Done.
