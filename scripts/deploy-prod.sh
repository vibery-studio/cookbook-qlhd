#!/usr/bin/env bash
# Local production deploy orchestrator. Runs under the operator's
# `wrangler login` OAuth session; no CLOUDFLARE_API_TOKEN required.
#
# Sequence:
#   1. preflight (binding parity, bundle size, secrets present, schema head)
#   2. recovery-point (D1 Time Travel bookmark, written to
#      .deploy-recovery.json — gitignored)
#   3. migrate (wrangler d1 migrations apply runway_prod --remote)
#   4. deploy   (wrangler deploy --env production --var BUILD_SHA:<sha> --var SCHEMA_HEAD:<head>)
#   5. verify   (post-deploy /healthz + /readyz + /me anon smoke, retry
#               loop up to 60s)
#   6. on any verify failure → auto-rollback (wrangler rollback), print
#      the recovery-point bookmark so a DB restore is a one-liner if
#      needed.
#
# Idempotent: re-running with the same SHA is a safe no-op (deploy
# re-runs; migrations are already applied; verify re-passes).
#
# Usage:
#   pnpm deploy:prod                        # env=production
#   DEPLOY_ENV=preview pnpm deploy:prod     # env=preview
#   DEPLOY_URL=https://... pnpm deploy:prod # override probe URL
#
# Env:
#   DEPLOY_ENV       production (default) or preview
#   DEPLOY_URL       Worker URL for /healthz + /readyz (auto-detected if unset)
#   READYZ_TOKEN     token for /readyz (required — read from local shell or 1Password)
#   SKIP_MIGRATE=1   skip step 3 (use only for re-deploy after a failed verify
#                    where migrations already succeeded)
#   SKIP_RECOVERY=1  skip step 2 (use only when the migration is a proven no-op)
#
# Exit non-zero on any failure; caller sees the failing step.
set -euo pipefail

DEPLOY_ENV="${DEPLOY_ENV:-production}"
SHA="$(git rev-parse HEAD)"
ACTOR="${USER:-$(whoami)}"
TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
MANIFEST=".deploy-recovery.json"
WRANGLER_CONFIG="apps/api/wrangler.toml"

case "$DEPLOY_ENV" in
  production) D1_NAME="runway_prod" ;;
  preview)    D1_NAME="runway_preview" ;;
  *) echo "deploy-prod: unknown DEPLOY_ENV=$DEPLOY_ENV" >&2; exit 2 ;;
esac

: "${READYZ_TOKEN:?deploy-prod: READYZ_TOKEN must be set in your shell (never committed)}"

# Resolve the probe URL. Prefer explicit override; fall back to the
# canonical *.workers.dev host derived from the wrangler name.
if [ -z "${DEPLOY_URL:-}" ]; then
  case "$DEPLOY_ENV" in
    production) DEPLOY_URL="https://runway-api-prod.$(whoami).workers.dev" ;;
    preview)    DEPLOY_URL="https://runway-api-preview.$(whoami).workers.dev" ;;
  esac
  echo "deploy-prod: DEPLOY_URL not set; defaulting to $DEPLOY_URL"
  echo "             (override with DEPLOY_URL=https://... to point at a custom domain)"
fi

echo ""
echo "==========================================="
echo " deploy-prod → env=$DEPLOY_ENV"
echo "   SHA:        $SHA"
echo "   Actor:      $ACTOR"
echo "   Timestamp:  $TIMESTAMP"
echo "   Probe URL:  $DEPLOY_URL"
echo "   D1 target:  $D1_NAME"
echo "==========================================="
echo ""

# ---- 1. preflight ----
echo "[1/5] preflight …"
pnpm exec tsx scripts/deploy-preflight.ts --env "$DEPLOY_ENV"

# ---- 2. recovery-point ----
if [ "${SKIP_RECOVERY:-}" = "1" ]; then
  echo ""
  echo "[2/5] recovery-point SKIPPED (SKIP_RECOVERY=1)"
  RECOVERY_JSON=""
else
  echo ""
  echo "[2/5] recovery-point (D1 Time Travel bookmark) …"
  BOOKMARK_NAME="deploy-${SHA:0:12}"
  # `wrangler d1 time-travel info <db>` returns the current bookmark id
  # for the LATEST state — capturing it BEFORE the migration is our
  # recovery point. `time-travel bookmark` doesn't exist as a subcommand
  # in wrangler v4; the `info` output is the primitive.
  set +e
  BOOKMARK_OUTPUT=$(npx wrangler d1 time-travel info "$D1_NAME" \
    --config "$WRANGLER_CONFIG" \
    $([ "$DEPLOY_ENV" != "production" ] && echo "--env $DEPLOY_ENV") \
    --json 2>&1)
  BOOKMARK_STATUS=$?
  set -e
  BOOKMARK_ID=""
  if [ $BOOKMARK_STATUS -eq 0 ]; then
    # Extract "bookmark" field from JSON. Tolerate schema variance.
    BOOKMARK_ID=$(printf '%s' "$BOOKMARK_OUTPUT" | node -e "
      let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
        try{const j=JSON.parse(s);
          const b=j.bookmark||j.result?.bookmark||'';
          process.stdout.write(b);
        }catch(_){process.stdout.write('');}
      });" 2>/dev/null || true)
  fi
  if [ -z "$BOOKMARK_ID" ]; then
    echo "  ⚠  could not capture D1 Time Travel bookmark; continuing without recovery-point"
    echo "     (wrangler output: $BOOKMARK_OUTPUT)"
    RECOVERY_JSON=""
  else
    echo "  ✓ D1 bookmark captured: $BOOKMARK_ID (name: $BOOKMARK_NAME)"
    RECOVERY_JSON=$(cat <<EOF
{
  "env": "$DEPLOY_ENV",
  "sha": "$SHA",
  "timestamp": "$TIMESTAMP",
  "actor": "$ACTOR",
  "bookmark_id": "$BOOKMARK_ID",
  "bookmark_name": "$BOOKMARK_NAME",
  "d1_database": "$D1_NAME"
}
EOF
)
    printf '%s\n' "$RECOVERY_JSON" > "$MANIFEST"
    echo "  ✓ wrote $MANIFEST"
  fi
fi

# ---- 3. migrate ----
if [ "${SKIP_MIGRATE:-}" = "1" ]; then
  echo ""
  echo "[3/5] migrate SKIPPED (SKIP_MIGRATE=1)"
else
  echo ""
  echo "[3/5] migrate ($D1_NAME) …"
  case "$DEPLOY_ENV" in
    production) pnpm db:migrate:prod ;;
    preview)    pnpm db:migrate:preview ;;
  esac
fi

# ---- 4. deploy ----
echo ""
echo "[4/5] deploy …"
SCHEMA_HEAD="$(pnpm --silent db:schema-head)"
echo "  BUILD_SHA=$SHA  SCHEMA_HEAD=$SCHEMA_HEAD"
(
  cd apps/api
  npx wrangler deploy --env "$DEPLOY_ENV" \
    --var "BUILD_SHA:$SHA" \
    --var "SCHEMA_HEAD:$SCHEMA_HEAD"
)

# ---- 5. verify + auto-rollback ----
echo ""
echo "[5/5] verify …"
set +e
pnpm exec tsx scripts/deploy-verify.ts \
  --url "$DEPLOY_URL" \
  --sha "$SHA" \
  --token "$READYZ_TOKEN"
VERIFY_STATUS=$?
set -e

if [ $VERIFY_STATUS -ne 0 ]; then
  echo ""
  echo "::error::deploy-verify FAILED — triggering auto-rollback"
  echo ""
  set +e
  pnpm exec tsx scripts/deploy-rollback.ts --env "$DEPLOY_ENV" --manifest "$MANIFEST"
  ROLLBACK_STATUS=$?
  set -e
  if [ $ROLLBACK_STATUS -ne 0 ]; then
    echo "::error::rollback ALSO failed (exit $ROLLBACK_STATUS). Manual intervention required — see docs/deploy.md."
    exit 3
  fi
  echo "::warning::rolled back to previous version. Verify /healthz manually."
  exit 1
fi

echo ""
echo "==========================================="
echo " deploy-prod: SUCCESS"
echo "   env:       $DEPLOY_ENV"
echo "   SHA:       $SHA"
echo "   probe:     $DEPLOY_URL"
echo "==========================================="
echo ""
