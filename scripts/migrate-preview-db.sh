#!/usr/bin/env bash
# Placeholder: preview D1 database migration runner.
# Usage (future): ./scripts/migrate-preview-db.sh <pr-number>
#
# Phase 2 only scaffolds the CI/CD skeleton; there is no Drizzle schema or
# migration files yet (those land in Phase 3, see
# plans/260920-1359-runway-blueprint-v1-api/phase-03-database-drizzle-schema-migrations.md).
# preview.yml will call this script once Phase 3 lands to run
# `wrangler d1 migrations apply` against the per-PR preview database.
set -euo pipefail

echo "Migrations not yet implemented; see Phase 3."
exit 0
