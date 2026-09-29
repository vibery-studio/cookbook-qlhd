# MOTION — how the contract app moves (design law)

Status: Approved — extracted 2026-09-29 from the approved mockup. Quiet and fast: motion confirms, it never performs.

- One duration: `--dur` **150ms**. Nothing slower.
- Hover / press (rows, nav items, cards): `background` or `border-color` over `--dur`, no movement.
- Drawer (contract detail) and modal (create contract): fade `opacity` + slide `transform` over `--dur` with
  `cubic-bezier(.22,.68,.24,1)`; the modal card rises from `translateY(8px)` to 0.
- No keyframe animations, no bounce, no spinners longer than the request; loading shows a quiet skeleton row.
- Respect `prefers-reduced-motion`: drop transforms, keep the opacity change.
