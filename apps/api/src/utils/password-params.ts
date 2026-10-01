import { OWASP_2024_PARAMS, type PasswordHashParams } from "@runway/auth";

/** Test-only scrypt cost (N=2^10 ≈ 5 ms vs 2^17 ≈ 330 ms). Stored hashes carry their own N, so verify is unaffected. */
const TEST_FAST_PARAMS: PasswordHashParams = { N: 2 ** 10, r: 8, p: 1 };

/**
 * scrypt params for NEW hashes. `PASSWORD_HASH_PROFILE=test-fast` is set only by vitest.config.ts and honoured only
 * when `APP_ENV=development`; anything else (preview/production, unset, typo) gets OWASP 2024 — fail safe.
 */
export function passwordHashParams(env: { APP_ENV?: string; PASSWORD_HASH_PROFILE?: string }): PasswordHashParams {
  return env.PASSWORD_HASH_PROFILE === "test-fast" && env.APP_ENV === "development" ? TEST_FAST_PARAMS : OWASP_2024_PARAMS;
}
