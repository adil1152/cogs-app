-- Follow-up only: 001 may already be recorded in deployed environments.
-- Application mutations never enable mis.maintenance. Operators performing
-- controlled repair/fixture cleanup must SET LOCAL mis.maintenance = 'on'.
CREATE OR REPLACE FUNCTION mis_reject_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('mis.maintenance', true) = 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  RAISE EXCEPTION 'mis_audit_log is append-only';
END;
$$;

DROP TRIGGER IF EXISTS mis_audit_log_no_update ON mis_audit_log;
DROP TRIGGER IF EXISTS mis_audit_log_no_delete ON mis_audit_log;
CREATE TRIGGER mis_audit_log_no_update BEFORE UPDATE ON mis_audit_log
FOR EACH ROW EXECUTE FUNCTION mis_reject_audit_mutation();
CREATE TRIGGER mis_audit_log_no_delete BEFORE DELETE ON mis_audit_log
FOR EACH ROW EXECUTE FUNCTION mis_reject_audit_mutation();