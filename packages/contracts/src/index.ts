/**
 * @runway/contracts — future home of shared Zod schemas + TypeScript types
 * for cross-workspace consumers (SPA client, ancillary Workers).
 *
 * v1 shape: this package is a stub. The load-bearing contract artifact is
 * the generated OpenAPI 3.1 document at `packages/contracts/dist/openapi.json`
 * (gitignored; regenerated on every `pnpm openapi:export`). SPA SDK
 * generation (Phase v2) reads that file directly.
 *
 * Do NOT re-export Zod schemas from `apps/api/src/dto/**` here yet — that
 * introduces a cross-workspace import boundary we don't need until a
 * second consumer exists. When Phase v2 (SPA) lands, either:
 *   (a) promote `dto/**` to this package and have `apps/api` import back,
 *       OR
 *   (b) leave `dto/**` in `apps/api` and rely on generated types from
 *       `openapi.json` + `openapi-typescript` in the SPA build.
 *
 * Decision deferred to Phase v2 when the real consumer + its build
 * constraints are known.
 */

export const PACKAGE_VERSION = "0.1.0";
