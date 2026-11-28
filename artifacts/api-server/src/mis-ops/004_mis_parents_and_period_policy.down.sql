DROP TRIGGER IF EXISTS mis_parent_status_sync ON mis_entry_parents;
DROP TRIGGER IF EXISTS mis_entries_parent_status ON mis_entries;
DROP FUNCTION IF EXISTS mis_sync_parent_entry_status();
DROP FUNCTION IF EXISTS mis_check_parent_entry_status();
ALTER TABLE mis_entries DROP CONSTRAINT IF EXISTS mis_entries_parent_id_fkey;
ALTER TABLE mis_entries DROP COLUMN IF EXISTS parent_id;
DROP TABLE IF EXISTS mis_entry_parents;
ALTER TABLE mis_entries DROP CONSTRAINT IF EXISTS mis_entries_status_check;
ALTER TABLE mis_entries ADD CONSTRAINT mis_entries_status_check
  CHECK (status IN ('draft','submitted','approved','rejected','cancelled'));
ALTER TABLE mis_projects DROP CONSTRAINT IF EXISTS mis_projects_default_entry_status_check;
ALTER TABLE mis_projects ADD CONSTRAINT mis_projects_default_entry_status_check
  CHECK (default_entry_status IN ('draft','submitted','approved','rejected','cancelled'));
ALTER TABLE mis_projects DROP CONSTRAINT IF EXISTS mis_projects_overlap_policy_check;
ALTER TABLE mis_projects DROP CONSTRAINT IF EXISTS mis_projects_max_entries_check;
ALTER TABLE mis_projects DROP COLUMN IF EXISTS max_entries_per_period;
ALTER TABLE mis_projects DROP COLUMN IF EXISTS overlap_policy;
ALTER TABLE mis_projects DROP COLUMN IF EXISTS allow_multiple_mis_entries;
DROP SEQUENCE IF EXISTS mis_bulk_number_seq;