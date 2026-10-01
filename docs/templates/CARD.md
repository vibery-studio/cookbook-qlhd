---
id: C-NN-NNN
title: [short imperative]
status: todo            # todo | doing | done
serves: [AC-1, FR-1]    # real ids from SPEC-NN, listed one by one (no ranges, no prose); a foundation
                        # card lists the ACs it unblocks; the proof card lists the ACs it proves
depends_on: []          # [C-NN-001]
touches:                # the only files this card may change
  - src/...
---

<!-- Step 4 — one card from PLAN-NN §3. Copy to docs/plan/cards/C-NN-NNN.md. A contract for Claude to execute:
     the human decided at INTENT/SPEC; from here it is Claude's job. Small: one job, one responsibility. -->

# C-NN-NNN · [title]

## Goal
[1–3 sentences: what this card accomplishes. Not how.]

## Context
[Only what the code can't tell you — quote the SPEC lines this card implements, and the ENGINEERING.md rules that apply.]

## Scope
In: [concrete list] · Out: [what's tempting to over-reach into]

## Steps
1. [detailed enough not to guess, loose enough not to over-constrain]

## Tests
[none — <why> | test name → the break it catches]. The acceptance tests from PLAN §1 are not edited here.
Security card (first card to touch auth / access / money / personal data / delete, or a card adding a NEW path to an effect that already has a rule): list the SPEC `INV-n` it must hold and the rule each new path applies; one invariant test at the strongest boundary (a route × role table or a column check beats one test per route); it must fail before the rule exists. Not security-touching → omit.

## Done check
- Command: `[e.g. npm test -- deposit]` → expected: [ ]
- Real-world state: [a URL that works, a row that exists, a flow that runs through]
- [ ] no file changed outside `touches` · [ ] status set to done

## What was done
[Claude fills in: 3–5 lines + the real output of the done check]
