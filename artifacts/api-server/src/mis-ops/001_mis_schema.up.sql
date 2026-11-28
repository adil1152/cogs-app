-- Additive MIS-only migration. Never alter COGS tables.
CREATE TABLE IF NOT EXISTS mis_schema_migrations (id varchar(128) PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS mis_projects (
 id varchar PRIMARY KEY DEFAULT gen_random_uuid(), name varchar(160) NOT NULL, code varchar(32) NOT NULL UNIQUE,
 manager_id varchar REFERENCES users(id) ON DELETE SET NULL, status varchar(16) NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
 start_date date, end_date date, currency varchar(3) NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 default_entry_status varchar(16) NOT NULL DEFAULT 'approved' CHECK(default_entry_status IN ('draft','submitted','approved','rejected','cancelled')),
 prevent_duplicate_periods boolean NOT NULL DEFAULT true, created_by_id varchar REFERENCES users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(start_date IS NULL OR end_date IS NULL OR start_date <= end_date)
);
CREATE TABLE IF NOT EXISTS mis_tabs (
 id varchar PRIMARY KEY DEFAULT gen_random_uuid(), name varchar(120) NOT NULL, code varchar(32) NOT NULL UNIQUE, description text,
 type varchar(16) NOT NULL CHECK(type IN ('income','cost','expense','salary','other')),
 financial_class varchar(16) NOT NULL CHECK(financial_class IN ('income','cost','expense','salary','excluded')),
 sequence integer NOT NULL DEFAULT 0 CHECK(sequence >= 0), active boolean NOT NULL DEFAULT true, allow_entry boolean NOT NULL DEFAULT true,
 allow_reporting boolean NOT NULL DEFAULT true, created_by_id varchar REFERENCES users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mis_project_tabs (
 project_id varchar NOT NULL REFERENCES mis_projects(id) ON DELETE CASCADE, tab_id varchar NOT NULL REFERENCES mis_tabs(id) ON DELETE RESTRICT,
 enabled boolean NOT NULL DEFAULT true, sequence integer NOT NULL DEFAULT 0 CHECK(sequence >= 0), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(project_id, tab_id)
);
CREATE TABLE IF NOT EXISTS mis_services (
 id varchar PRIMARY KEY DEFAULT gen_random_uuid(), project_id varchar NOT NULL REFERENCES mis_projects(id) ON DELETE RESTRICT,
 tab_id varchar NOT NULL REFERENCES mis_tabs(id) ON DELETE RESTRICT, name varchar(160) NOT NULL, description text, unit varchar(40) NOT NULL,
 default_rate numeric(20,6) NOT NULL CHECK(default_rate >= 0), active boolean NOT NULL DEFAULT true, sequence integer NOT NULL DEFAULT 0 CHECK(sequence >= 0),
 effective_from date, effective_to date, created_by_id varchar REFERENCES users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(effective_from IS NULL OR effective_to IS NULL OR effective_from <= effective_to)
);
CREATE TABLE IF NOT EXISTS mis_authorities (
 id varchar PRIMARY KEY DEFAULT gen_random_uuid(), user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id varchar REFERENCES mis_projects(id) ON DELETE CASCADE, role varchar(32) NOT NULL CHECK(role IN ('mis_admin','mis_manager','project_manager','finance','data_entry','viewer')),
 extra_permissions jsonb NOT NULL DEFAULT '[]'::jsonb, created_by_id varchar REFERENCES users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(jsonb_typeof(extra_permissions) = 'array')
);
CREATE UNIQUE INDEX IF NOT EXISTS UQ_mis_authorities_scope ON mis_authorities(user_id, COALESCE(project_id, ''));
CREATE TABLE IF NOT EXISTS mis_entries (
 id varchar PRIMARY KEY DEFAULT gen_random_uuid(), project_id varchar NOT NULL REFERENCES mis_projects(id) ON DELETE RESTRICT,
 tab_id varchar NOT NULL REFERENCES mis_tabs(id) ON DELETE RESTRICT, service_id varchar NOT NULL REFERENCES mis_services(id) ON DELETE RESTRICT,
 from_date date NOT NULL, to_date date NOT NULL, quantity numeric(20,6) NOT NULL CHECK(quantity >= 0), rate numeric(20,6) NOT NULL CHECK(rate >= 0),
 amount numeric(24,6) NOT NULL CHECK(amount >= 0), remarks text,
 project_name varchar(160) NOT NULL, tab_name varchar(120) NOT NULL, service_name varchar(160) NOT NULL, type varchar(16) NOT NULL,
 financial_class varchar(16) NOT NULL, unit varchar(40) NOT NULL, currency varchar(3) NOT NULL,
 status varchar(16) NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','approved','rejected','cancelled')),
 created_by_id varchar NOT NULL REFERENCES users(id) ON DELETE RESTRICT, updated_by_id varchar REFERENCES users(id) ON DELETE SET NULL,
 deleted_at timestamptz, deleted_by_id varchar REFERENCES users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), CHECK(from_date <= to_date)
);
CREATE TABLE IF NOT EXISTS mis_audit_log (
 id varchar PRIMARY KEY DEFAULT gen_random_uuid(), entry_id varchar, project_id varchar REFERENCES mis_projects(id) ON DELETE SET NULL,
 entity_type varchar(32) NOT NULL, entity_id varchar(64) NOT NULL, action varchar(32) NOT NULL, actor_id varchar REFERENCES users(id) ON DELETE SET NULL,
 remarks text, old_values jsonb, new_values jsonb, occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS IDX_mis_projects_status ON mis_projects(status);
CREATE INDEX IF NOT EXISTS IDX_mis_tabs_active_sequence ON mis_tabs(active, sequence);
CREATE INDEX IF NOT EXISTS IDX_mis_project_tabs_project ON mis_project_tabs(project_id, enabled, sequence);
CREATE INDEX IF NOT EXISTS IDX_mis_services_project_tab ON mis_services(project_id, tab_id, active, sequence);
CREATE INDEX IF NOT EXISTS IDX_mis_authorities_user ON mis_authorities(user_id);
CREATE INDEX IF NOT EXISTS IDX_mis_authorities_project ON mis_authorities(project_id);
CREATE INDEX IF NOT EXISTS IDX_mis_entries_scope_period ON mis_entries(project_id, tab_id, service_id, from_date, to_date);
CREATE INDEX IF NOT EXISTS IDX_mis_entries_report ON mis_entries(status, currency, from_date, to_date);
CREATE INDEX IF NOT EXISTS IDX_mis_entries_deleted ON mis_entries(deleted_at);
CREATE INDEX IF NOT EXISTS IDX_mis_audit_entry ON mis_audit_log(entry_id, occurred_at);
CREATE INDEX IF NOT EXISTS IDX_mis_audit_entity ON mis_audit_log(entity_type, entity_id);