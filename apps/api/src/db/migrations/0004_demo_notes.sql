-- Phase 9 demo table. `notes` demonstrates idempotency + ownership
-- end-to-end without hard-coding a real product resource into the
-- blueprint. A production app would delete this migration + the
-- corresponding schema + routes, or extend the pattern with its own
-- table (see docs/idempotency.md for the recipe).
--
-- No FK to users (v1 uses application-level cascade — see
-- docs/dao-pattern.md). `user_id` is a ULID text ref only.
CREATE TABLE IF NOT EXISTS notes (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notes_user ON notes (user_id, created_at DESC);
