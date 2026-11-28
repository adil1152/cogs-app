-- Development rollback only. This migration is additive and never deletes
-- records; dropping these newly-added service fields is safe for pre-migration
-- data but should not be used in production.
DROP INDEX IF EXISTS IDX_mis_services_project_currency;
DROP INDEX IF EXISTS UQ_mis_services_project_code;
ALTER TABLE mis_services DROP CONSTRAINT IF EXISTS mis_services_currency_check;
ALTER TABLE mis_services DROP COLUMN IF EXISTS currency;
ALTER TABLE mis_services DROP COLUMN IF EXISTS code;
ALTER TABLE mis_authorities DROP CONSTRAINT IF EXISTS mis_authorities_role_check;
ALTER TABLE mis_authorities
  ADD CONSTRAINT mis_authorities_role_check
  CHECK(role IN ('mis_admin','mis_manager','project_manager','finance','data_entry','viewer'));