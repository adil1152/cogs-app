-- Additive MIS-only migration. Existing standalone entries intentionally remain
-- parentless and are not backfilled into inferred bulk groups.
CREATE SEQUENCE IF NOT EXISTS mis_bulk_number_seq MINVALUE 1 START WITH 1;

ALTER TABLE mis_projects
  ADD COLUMN IF NOT EXISTS allow_multiple_mis_entries boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS overlap_policy varchar(16) NOT NULL DEFAULT 'nonoverlap',
  ADD COLUMN IF NOT EXISTS max_entries_per_period integer;

ALTER TABLE mis_projects DROP CONSTRAINT IF EXISTS mis_projects_overlap_policy_check;
ALTER TABLE mis_projects ADD CONSTRAINT mis_projects_overlap_policy_check
  CHECK (overlap_policy IN ('nonoverlap', 'overlap', 'unlimited'));
ALTER TABLE mis_projects DROP CONSTRAINT IF EXISTS mis_projects_max_entries_check;
ALTER TABLE mis_projects ADD CONSTRAINT mis_projects_max_entries_check
  CHECK (max_entries_per_period IS NULL OR max_entries_per_period > 0);

ALTER TABLE mis_projects DROP CONSTRAINT IF EXISTS mis_projects_default_entry_status_check;
ALTER TABLE mis_projects ADD CONSTRAINT mis_projects_default_entry_status_check
  CHECK (default_entry_status IN ('draft','submitted','approved','rejected','returned','cancelled'));

CREATE TABLE IF NOT EXISTS mis_entry_parents (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  bulk_number varchar(32) NOT NULL UNIQUE DEFAULT ('MIS-BULK-' || lpad(nextval('mis_bulk_number_seq')::text, 6, '0')),
  project_id varchar NOT NULL REFERENCES mis_projects(id) ON DELETE RESTRICT,
  project_name varchar(160) NOT NULL,
  project_code varchar(32) NOT NULL,
  from_date date NOT NULL,
  to_date date NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','submitted','approved','rejected','returned','cancelled')),
  entry_type varchar(16) NOT NULL DEFAULT 'bulk' CHECK (entry_type = 'bulk'),
  created_by_id varchar NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by_id varchar REFERENCES users(id) ON DELETE SET NULL,
  deleted_at timestamptz,
  deleted_by_id varchar REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_date <= to_date)
);

ALTER TABLE mis_entries ADD COLUMN IF NOT EXISTS parent_id varchar;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mis_entries_parent_id_fkey'
  ) THEN
    ALTER TABLE mis_entries ADD CONSTRAINT mis_entries_parent_id_fkey
      FOREIGN KEY (parent_id) REFERENCES mis_entry_parents(id) ON DELETE RESTRICT;
  END IF;
END $$;

ALTER TABLE mis_entries DROP CONSTRAINT IF EXISTS mis_entries_status_check;
ALTER TABLE mis_entries ADD CONSTRAINT mis_entries_status_check
  CHECK (status IN ('draft','submitted','approved','rejected','returned','cancelled'));

CREATE INDEX IF NOT EXISTS IDX_mis_entry_parents_project_period
  ON mis_entry_parents(project_id, from_date, to_date);
CREATE INDEX IF NOT EXISTS IDX_mis_entry_parents_status
  ON mis_entry_parents(status, updated_at);
CREATE INDEX IF NOT EXISTS IDX_mis_entry_parents_deleted
  ON mis_entry_parents(deleted_at);
CREATE INDEX IF NOT EXISTS IDX_mis_entries_parent
  ON mis_entries(parent_id);

-- A child may be standalone (NULL parent_id), but children of a bulk parent
-- can never carry a different status. This protects direct SQL callers as well
-- as HTTP routes.
CREATE OR REPLACE FUNCTION mis_check_parent_entry_status()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM mis_entry_parents p
    WHERE p.id = NEW.parent_id AND p.status <> NEW.status
  ) THEN
    RAISE EXCEPTION 'MIS child status must match its parent';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS mis_entries_parent_status ON mis_entries;
CREATE CONSTRAINT TRIGGER mis_entries_parent_status
AFTER INSERT OR UPDATE OF parent_id, status ON mis_entries
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION mis_check_parent_entry_status();

CREATE OR REPLACE FUNCTION mis_sync_parent_entry_status()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    UPDATE mis_entries
    SET status = NEW.status, updated_at = NEW.updated_at, updated_by_id = NEW.updated_by_id
    WHERE parent_id = NEW.id AND deleted_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS mis_parent_status_sync ON mis_entry_parents;
CREATE TRIGGER mis_parent_status_sync
AFTER UPDATE OF status ON mis_entry_parents
FOR EACH ROW EXECUTE FUNCTION mis_sync_parent_entry_status();