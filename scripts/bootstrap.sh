#!/usr/bin/env bash
# Bootstraps the Runway monorepo on a clean clone.
# Usage: chmod +x scripts/bootstrap.sh && ./scripts/bootstrap.sh
# (or: bash scripts/bootstrap.sh)
set -euo pipefail

REQUIRED_NODE_MAJOR=22
REQUIRED_PNPM_MAJOR=10

echo "==> Checking Node version..."
if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node not found. Install Node ${REQUIRED_NODE_MAJOR}+ (see .nvmrc)." >&2
  exit 1
fi
NODE_VERSION="$(node -v)"
NODE_MAJOR="$(echo "$NODE_VERSION" | sed -E 's/^v([0-9]+).*/\1/')"
if [ "$NODE_MAJOR" -lt "$REQUIRED_NODE_MAJOR" ]; then
  echo "ERROR: Node ${NODE_VERSION} found, but >= ${REQUIRED_NODE_MAJOR} is required." >&2
  exit 1
fi
echo "    Node ${NODE_VERSION} OK"

echo "==> Checking pnpm version..."
if ! command -v pnpm >/dev/null 2>&1; then
  echo "ERROR: pnpm not found. Install pnpm ${REQUIRED_PNPM_MAJOR} (see https://pnpm.io/installation)." >&2
  exit 1
fi
PNPM_VERSION="$(pnpm -v)"
PNPM_MAJOR="$(echo "$PNPM_VERSION" | cut -d. -f1)"
if [ "$PNPM_MAJOR" -lt "$REQUIRED_PNPM_MAJOR" ]; then
  echo "ERROR: pnpm ${PNPM_VERSION} found, but >= ${REQUIRED_PNPM_MAJOR} is required." >&2
  exit 1
fi
echo "    pnpm ${PNPM_VERSION} OK"

echo "==> Installing dependencies..."
START_TIME=$(date +%s)
pnpm install
END_TIME=$(date +%s)
ELAPSED=$((END_TIME - START_TIME))

echo ""
echo "==> Bootstrap complete in ${ELAPSED}s."
echo ""
echo "Next step:"
echo "  pnpm dev     # starts wrangler dev for apps/api with local D1/KV bindings"
echo ""
echo "(If you have not yet run 'wrangler login', do that first — it is not part of bootstrap timing.)"
