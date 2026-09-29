# PLAN-NN: [feature name]

<!-- Step 3, in plan mode. Copy to docs/plan/PLAN-NN.md. The HOW: tests first, then small cards.
     Filled again at step 5 (PROOF log). The feature is done when Status says Done. -->

Status: Draft | Approved [YYYY-MM-DD] | Done [YYYY-MM-DD]
Spec: docs/spec/SPEC-NN.md

## 1. Acceptance tests — written first, seen failing
| AC | How it's proven (test file · human checklist · walkthrough) | Fails now? (real output) |
|---|---|---|
| AC-1 | [tests/…] | [ ] |

## 2. Files that change
| File | New / Modify | Why (FR) |
|---|---|---|

## 3. Cards — one small job each, in order (docs/plan/cards/C-NN-NNN.md)
- [C-NN-001] [job] → serves AC-1, FR-1
- [C-NN-002] [job] → serves AC-2 · depends on C-NN-001

## 4. Risks
- [what could go wrong that the spec didn't cover] · conflict with ENGINEERING.md: [none | rule + proposal]

## 5. Trace check (before the STOP)
- [ ] every FR has at least one AC · every AC has a row in §1 · every AC is served by a card · every "now" edge case has an AC

## 6. PROOF log (step 5)
- Checks: [command] → [real output]
- Human checklist: [do → must see], one line per AC, incl. "now" edge cases
- Attack (personal data / access): [what was tried → result]
- Result: [pass | what failed → back to the plan]
