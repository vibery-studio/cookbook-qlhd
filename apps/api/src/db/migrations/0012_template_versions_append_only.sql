-- SPEC-02 DEC-6: template_versions is append-only. The DAO has no update/delete; these triggers are the second lock.
CREATE TRIGGER `trg_template_versions_no_update` BEFORE UPDATE ON `template_versions`
BEGIN
	SELECT RAISE(ABORT, 'template_versions is append-only: UPDATE refused');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_template_versions_no_delete` BEFORE DELETE ON `template_versions`
BEGIN
	SELECT RAISE(ABORT, 'template_versions is append-only: DELETE refused');
END;
