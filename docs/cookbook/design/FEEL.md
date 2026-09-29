# FEEL — how the contract app looks (design law)

Status: Approved — extracted 2026-09-29 from the approved mockup (`docs/cookbook/mockup/index.html`), not invented.
Every screen uses these tokens by name. A screen never defines its own colour, font, size or spacing; a missing token is
added here first.

## Colour
| Token | Value | Use |
|---|---|---|
| `--bg-app` / `--bg-surface` / `--bg-sidebar` | #FBFBFC / #FFFFFF / #F4F5F7 | page / cards, tables, drawer / sidebar |
| `--bg-sunken` / `--bg-hover` / `--bg-active` | #F7F8FA / #EEF0F3 / #E8EAEF | inset areas / row+nav hover / pressed |
| `--text-strong` / `--text` / `--text-muted` / `--text-faint` | #16181D / #2E3138 / #5C6270 / #616875 | titles / body / labels / meta (all pass WCAG AA) |
| `--accent` / `--accent-soft` / `--accent-border` | #2C5FD6 / #E8EEFC / #B9CCF6 | primary action, active nav, focus |
| `--danger` · `--ok` (+ `-bg`, `-border`) | #B3261E · #1B6E4B | destructive / success messages |
| `--border` / `--border-strong` | #E3E5EA / #CDD1D9 | dividers / hovered cards, inputs |

**Contract status ramp** (text on its own background, always as a pill with a dot):
| Status | Text | Background |
|---|---|---|
| Nháp (draft) | `--st-draft` #4A5260 | `--st-draft-bg` #EDEFF2 |
| Chờ duyệt (pending) | `--st-pending` #8A5A12 | `--st-pending-bg` #FBF0DD |
| Đã duyệt (approved) | `--st-approved` #1B6E4B | `--st-approved-bg` #E3F3EB |
| Đã phát hành (issued) | `--st-issued` #1F5FA8 | `--st-issued-bg` #E5EFFA |
| Từ chối (rejected) | `--st-rejected` #A63A3A | `--st-rejected-bg` #FBE9E9 |

## Type
- UI font `--font`: **Be Vietnam Pro** (400/500/600/700), load the `vietnamese` subset. Numbers, codes, money: `--mono` JetBrains Mono.
- Sizes: micro/sm 12 · base 13 · md 14 · lg 16 · xl 20 · 2xl 26 (px). Headings `--lh-head` **1.28** (stacked Vietnamese diacritics
  clip below that), body `--lh-body` 1.55.
- Money: `8.510.000 ₫` (dot thousands, ₫ after a space), right-aligned, mono. Dates: `Hôm nay 19:12`, else `dd/mm/yyyy`.

## Space, shape, size
- Spacing scale `--s1…s7`: 4 · 8 · 12 · 16 · 24 · 32 · 48 px — nothing off-scale.
- Radius `--r1/r2/r3`: 4 / 6 / 10 px (pills and avatars: fully round).
- Layout: sidebar `--sidebar-w` 240px · table row `--row-h` 44px · drawer `--drawer-w` 560px · mobile breakpoint `--breakpoint-mobile` 768px.
