-- Additive MIS-only migration. Never alter COGS tables or remove MIS records.
-- This migration is intentionally development-only; the explicit MIS runner
-- refuses production execution.
ALTER TABLE mis_authorities DROP CONSTRAINT IF EXISTS mis_authorities_role_check;
ALTER TABLE mis_authorities
  ADD CONSTRAINT mis_authorities_role_check
  CHECK(role IN ('mis_admin','mis_manager','project_manager','finance','data_entry','viewer','custom'));

ALTER TABLE mis_services ADD COLUMN IF NOT EXISTS code varchar(32);
ALTER TABLE mis_services ADD COLUMN IF NOT EXISTS currency varchar(3);

-- Existing services receive stable, collision-resistant codes and inherit the
-- project currency. No rate or entry snapshot is changed.
UPDATE mis_services
SET code = 'SVC-' || substr(md5(id), 1, 28)
WHERE code IS NULL OR btrim(code) = '';
UPDATE mis_services AS service
SET currency = project.currency
FROM mis_projects AS project
WHERE service.project_id = project.id
  AND (service.currency IS NULL OR btrim(service.currency) = '');

ALTER TABLE mis_services ALTER COLUMN code SET NOT NULL;
ALTER TABLE mis_services ALTER COLUMN currency SET NOT NULL;
ALTER TABLE mis_services
  ADD CONSTRAINT mis_services_currency_check CHECK(currency ~ '^[A-Z]{3}$');
CREATE UNIQUE INDEX IF NOT EXISTS UQ_mis_services_project_code
  ON mis_services(project_id, code);
CREATE INDEX IF NOT EXISTS IDX_mis_services_project_currency
  ON mis_services(project_id, currency);