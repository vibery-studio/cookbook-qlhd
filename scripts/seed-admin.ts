#!/usr/bin/env tsx
/**
 * Seed / promote an admin user by email against a remote D1 database.
 *
 * Usage:
 *   pnpm db:seed:admin --email x@y.com --db runway_dev
 *   pnpm db:seed:admin --email x@y.com --db runway_prod --env production
 *
 * Idempotent: `INSERT OR IGNORE` on `user_roles` means repeat runs are
 * a no-op. Uses the fixed admin role id from migrations/0001_seed_rbac.sql
 * so we don't need to look it up first. Fails loudly if the user doesn't
 * exist — this script only grants roles, it does not create users.
 *
 * Runs `wrangler d1 execute` under the hood, so the operator's local
 * wrangler OAuth session is what authenticates. No CF API token needed
 * in env.
 */
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";

const ADMIN_ROLE_ID = "01ROLE0000000000000ADMIN00";

interface Args {
  email: string;
  db: string;
  env?: string | undefined;
}

function parseCliArgs(): Args {
  const { values } = parseArgs({
    options: {
      email: { type: "string" },
      db: { type: "string" },
      env: { type: "string" },
    },
  });
  if (values.email === undefined || values.email === "") {
    throw new Error("--email is required");
  }
  if (values.db === undefined || values.db === "") {
    throw new Error("--db is required (e.g., runway_dev, runway_prod)");
  }
  return { email: values.email, db: values.db, env: values.env };
}

function execD1(db: string, sql: string, envName?: string): string {
  const args = [
    "--config",
    "apps/api/wrangler.toml",
    "d1",
    "execute",
    db,
    "--remote",
    "--command",
    sql,
    "--json",
  ];
  if (envName !== undefined) args.push("--env", envName);

  const result = spawnSync("wrangler", args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`wrangler d1 execute failed:\n${result.stderr}`);
  }
  return result.stdout;
}

function main(): void {
  const { email, db, env } = parseCliArgs();
  // Escape single quotes in the email — parameterized queries aren't
  // supported via `wrangler d1 execute --command`, so we sanitize
  // manually. Emails RFC-5321 do not contain single quotes in the
  // local-part when normalized, but defense in depth.
  const safeEmail = email.replace(/'/g, "''");

  // Step 1: look up user id
  const lookupSql = `SELECT id FROM users WHERE email = '${safeEmail}' LIMIT 1;`;
  const lookupOut = execD1(db, lookupSql, env);
  const rows = extractRows<{ id: string }>(lookupOut);
  if (rows.length === 0) {
    console.error(`No user with email ${email}. Sign them up first, then re-run.`);
    process.exit(2);
  }
  const userId = rows[0]!.id;

  // Step 2: idempotent grant
  const grantSql =
    `INSERT OR IGNORE INTO user_roles (user_id, role_id) ` +
    `VALUES ('${userId}', '${ADMIN_ROLE_ID}');`;
  execD1(db, grantSql, env);

  console.log(
    JSON.stringify({
      ok: true,
      user_id: userId,
      email,
      db,
      env: env ?? "default",
      role: "admin",
      message: "admin role granted (or already present)",
    }),
  );
}

/**
 * `wrangler d1 execute --json` returns a shape like
 * `[{ results: [...], success: true, meta: {...} }, ...]`. Pull the
 * first block's `results` and cast to the expected row shape.
 */
function extractRows<T>(rawJson: string): T[] {
  try {
    const parsed = JSON.parse(rawJson) as Array<{ results: T[] }>;
    return parsed[0]?.results ?? [];
  } catch (err) {
    throw new Error(
      `Could not parse wrangler d1 execute --json output: ${(err as Error).message}\n${rawJson}`,
    );
  }
}

main();
