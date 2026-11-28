-- Additive MIS-only migration. Never alter COGS tables or rewrite historical
-- amounts. The development-only MIS runner applies this migration atomically.

ALTER TABLE mis_tabs
  ADD COLUMN IF NOT EXISTS rate_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS calculate_percent_against_income boolean NOT NULL DEFAULT false;

-- Preserve the requested type defaults for existing type/category masters. A
-- project-tab nullable override can still inherit these values.
UPDATE mis_tabs
SET calculate_percent_against_income = (type IN ('income', 'other'))
WHERE calculate_percent_against_income IS DISTINCT FROM (type IN ('income', 'other'));

ALTER TABLE mis_project_tabs
  ADD COLUMN IF NOT EXISTS calculate_percent_against_income boolean;

ALTER TABLE mis_entries
  ADD COLUMN IF NOT EXISTS calculation_mode varchar(16) NOT NULL DEFAULT 'quantity_rate',
  ADD COLUMN IF NOT EXISTS rate_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS calculate_percent_against_income boolean NOT NULL DEFAULT false;

ALTER TABLE mis_entries DROP CONSTRAINT IF EXISTS mis_entries_calculation_mode_check;
ALTER TABLE mis_entries ADD CONSTRAINT mis_entries_calculation_mode_check
  CHECK (calculation_mode IN ('quantity_rate', 'amount'));

-- Existing rows intentionally remain quantity/rate entries. Do not recalculate
-- or normalize their stored quantity, rate, or amount.
UPDATE mis_entries
SET calculation_mode = 'quantity_rate'
WHERE calculation_mode IS NULL OR calculation_mode = '';

CREATE INDEX IF NOT EXISTS IDX_mis_services_project_sequence
  ON mis_services(project_id, sequence, id);