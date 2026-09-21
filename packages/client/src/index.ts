/**
 * @runway/client — typed TypeScript client for the Runway API.
 *
 * Import path:
 *   import { createClient } from "@runway/client";
 *
 * Types are generated from `packages/contracts/dist/openapi.json`.
 * Regenerate with `pnpm --filter @runway/client generate`; CI runs
 * `pnpm --filter @runway/client check` to fail merges that would
 * ship a spec-drifted client.
 */
export { createClient, type CreateClientOptions, type RunwayClient } from "./runtime/client";
export { type Problem, type Result, ok, err } from "./runtime/result";
export { ClientError, NetworkError, ResponseParseError } from "./errors";
export type { paths, components } from "./generated/types";
