/**
 * Typed drizzle client factory. DAOs (`apps/api/src/dao/**`) are the only
 * consumers of `getDb` — they use it for typed query building and always
 * return plain DTOs, never drizzle table types, to services/handlers
 * (enforced by the `no-drizzle-typed-exports` ESLint rule).
 */
import { drizzle } from "drizzle-orm/d1";
import type { Bindings } from "../env";
import { schema } from "./schema";

export function getDb(env: Bindings) {
  return drizzle(env.DB, { schema });
}

export type Db = ReturnType<typeof getDb>;
