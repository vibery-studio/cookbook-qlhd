import { z } from "zod";

/**
 * Reusable Zod primitives shared across DTOs. Keep these narrow and
 * dependency-free (no imports from other dto/* files) to avoid cycles.
 */

// Crockford base32 ULID — see src/utils/id.ts for the generator. Matches the
// spec's 26-char alphabet (excludes I, L, O, U to avoid ambiguity).
export const UlidSchema = z
  .string()
  .length(26)
  .regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, "invalid ULID");

// Unix seconds (not ms) — matches D1 storage convention for timestamps.
export const TimestampSchema = z.number().int().min(0);

export const EmailSchema = z.string().email().max(320);
