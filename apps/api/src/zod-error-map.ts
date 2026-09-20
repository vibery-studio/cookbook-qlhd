import { z } from "zod";

/**
 * Global Zod error map (Red Team F9 fold-in). Zod's default error map
 * interpolates the raw submitted value into `message` for several issue
 * codes. If a password/token/secret field fails validation, that raw value
 * could reach the HTTP response body and — because `error-handler.ts`
 * forwards ZodError messages verbatim into the Problem `errors[]` array —
 * leak into logs/telemetry.
 *
 * This map returns ONLY a `message` string built from `issue.code`, schema
 * metadata (`expected`, `format`, `minimum`, `maximum`, `values`), and
 * `issue.path`. It NEVER reads `issue.input` or any field that echoes
 * caller-supplied input.
 *
 * Written against Zod 4.x's issue-code taxonomy — the set of codes was
 * simplified from v3 (fewer codes; validation shape moved into `format` for
 * string checks, `values` for enum checks, etc.).
 */
const runwayErrorMap: z.core.$ZodErrorMap = (issue) => {
  switch (issue.code) {
    case "invalid_type":
      return { message: `expected ${issue.expected}` };

    case "invalid_value":
      // Enum/literal miss. `issue.values` is the allowed set (schema-defined).
      return {
        message: `invalid value; expected one of: ${issue.values.map((v) => String(v)).join(", ")}`,
      };

    case "invalid_format": {
      // String format failures (email, url, regex, starts-with, etc.).
      // `issue.format` names the format; the payload is schema-defined.
      const format = issue.format ?? "format";
      return { message: `invalid ${format}` };
    }

    case "invalid_union":
      return { message: "invalid input for union" };

    case "invalid_key":
      // Record/object key validation failure.
      return { message: "invalid key" };

    case "invalid_element":
      // Set/array element validation failure.
      return { message: "invalid element" };

    case "unrecognized_keys":
      // Deliberately does NOT list the actual `issue.keys` — they may echo
      // attacker input for open-typed inputs. Just say "unrecognized".
      return { message: "unrecognized key(s) in object" };

    case "too_small": {
      const noun =
        issue.origin === "array"
          ? "items"
          : issue.origin === "string"
            ? "characters"
            : "";
      const bound = issue.inclusive ? "at least" : "more than";
      return {
        message: `too small: expected ${bound} ${String(issue.minimum)}${noun ? ` ${noun}` : ""}`,
      };
    }

    case "too_big": {
      const noun =
        issue.origin === "array"
          ? "items"
          : issue.origin === "string"
            ? "characters"
            : "";
      const bound = issue.inclusive ? "at most" : "less than";
      return {
        message: `too big: expected ${bound} ${String(issue.maximum)}${noun ? ` ${noun}` : ""}`,
      };
    }

    case "not_multiple_of":
      return { message: `not a multiple of ${String(issue.divisor)}` };

    case "custom":
      // `issue.message` is developer-authored on the schema, not user input.
      return { message: issue.message ?? "invalid input" };

    default:
      // Guard future codes. Deliberately does NOT fall back to
      // `ctx.defaultError` — Zod's built-in message can interpolate
      // `issue.input`, which is exactly the leakage this map exists to
      // prevent.
      return { message: "invalid input" };
  }
};

let installed = false;

/**
 * Installs `runwayErrorMap` as the global Zod error map. Idempotent — safe
 * to call from multiple module entry points (`openapi.ts`, `index.ts`,
 * tests) without double-registering.
 */
export function installZodErrorMap(): void {
  if (installed) return;
  z.config({ customError: runwayErrorMap });
  installed = true;
}
