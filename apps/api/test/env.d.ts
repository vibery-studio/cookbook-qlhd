// Types for the `env` exported by `cloudflare:test`. Merges into
// `ProvidedEnv` from `@cloudflare/vitest-pool-workers`, using the same
// `Bindings` shape the runtime app sees plus test-only bindings.
import type { Bindings } from "../src/env";
import type { D1Migration } from "@cloudflare/vitest-pool-workers/config";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Bindings {
    TEST_MIGRATIONS: D1Migration[];
  }
}
