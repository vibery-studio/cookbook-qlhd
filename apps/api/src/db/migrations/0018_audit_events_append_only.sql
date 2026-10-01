-- SPEC-06 FR-13: audit_events is append-only. No product code updates/deletes it; these triggers are the lock.
-- Tests clear the table only via @runway/test-fixtures clearAuditEvents (drop → delete → recreate, one batch).
CREATE TRIGGER `trg_audit_events_no_update` BEFORE UPDATE ON `audit_events`
BEGIN
	SELECT RAISE(ABORT, 'audit_events is append-only: UPDATE refused');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_audit_events_no_delete` BEFORE DELETE ON `audit_events`
BEGIN
	SELECT RAISE(ABORT, 'audit_events is append-only: DELETE refused');
END;
