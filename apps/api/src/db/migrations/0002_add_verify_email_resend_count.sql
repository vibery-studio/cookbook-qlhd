-- Phase 7: `verify_email_resend_count` — capped counter used by the
-- verify-email cron sweeper to enforce a per-user resend limit
-- (default 3). SQLite `ALTER TABLE ADD COLUMN` is safe on D1 and
-- backfills existing rows with 0 (the DEFAULT). No other table needs
-- to change for the sweeper to work.
ALTER TABLE users ADD COLUMN verify_email_resend_count INTEGER NOT NULL DEFAULT 0;
