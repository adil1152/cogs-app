-- Development-only rollback for migration 005. Historical rows are not
-- modified by the forward migration; dropping snapshots is therefore explicit.
DROP INDEX IF EXISTS IDX_mis_services_project_sequence;
ALTER TABLE mis_entries DROP CONSTRAINT IF EXISTS mis_entries_calculation_mode_check;
ALTER TABLE mis_entries
  DROP COLUMN IF EXISTS calculate_percent_against_income,
  DROP COLUMN IF EXISTS rate_enabled,
  DROP COLUMN IF EXISTS calculation_mode;
ALTER TABLE mis_project_tabs DROP COLUMN IF EXISTS calculate_percent_against_income;
ALTER TABLE mis_tabs
  DROP COLUMN IF EXISTS calculate_percent_against_income,
  DROP COLUMN IF EXISTS rate_enabled;