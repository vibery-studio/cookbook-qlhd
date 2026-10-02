# Cookbook — contract management (quản lý hợp đồng)

Everything Claude needs to build this app on the RUNWAY base. Give it the workbook; it reads the rest.

| File | What it is |
|---|---|
| `documents.workbook.md` | the recipe: domain model, decisions, guards, the 16 tests and 8 attack probes (proven 2026-09-28). **v1.2: read §10 first** — what the finished build changed vs the live recipe (PDF, 4 document types, .docx import, products & prices, editable RBAC, Root switch, security fixes + new traps) |
| `design/FEEL.md` · `design/MOTION.md` · `design/DESIGN.md` | the look as law: tokens, motion, the first screens, components, states; DESIGN.md ends with the screens added after the live |
| `mockup/index.html` | the approved clickable mockup — the picture the design law was taken from |
| `rbac.workbook.md` | DRAFT v0.1 — RBAC in 3 rungs (basic · governed · controlled; build 1+2 by default), the 6 real security findings (F1–F6) with their guards, soft spots, probes. Extracted from this app; the light profile is not rehearsed from scratch yet |
| `mcp-codemode.workbook.md` | DRAFT v0.2 — connect Claude to this app via MCP (Code Mode search+execute, OAuth + consent reusing the app login); not proven yet |
| `e2e-kit/` | the browser-test harness for the UI row + the UI proof budget (copy it, don't rebuild it) |
| `../recipes/add-resource.md` | RUNWAY's own recipe for adding a resource (the mechanics the workbook follows) |

## State (2026-10-02)

The finished app built from this cookbook: source https://github.com/vibery-studio/cookbook-qlhd · demo https://runway-api-prod.bnqtoan.workers.dev. `mockup/index.html` is the ORIGINAL picture (contracts only); the shipped screens are listed in DESIGN.md. Install guide: `../HUONG-DAN-CAI-DAT.md`.
