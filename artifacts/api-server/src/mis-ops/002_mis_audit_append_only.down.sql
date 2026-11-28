DROP TRIGGER IF EXISTS mis_audit_log_no_update ON mis_audit_log;
DROP TRIGGER IF EXISTS mis_audit_log_no_delete ON mis_audit_log;
DROP FUNCTION IF EXISTS mis_reject_audit_mutation();
DELETE FROM mis_schema_migrations WHERE id = '002_mis_audit_append_only';