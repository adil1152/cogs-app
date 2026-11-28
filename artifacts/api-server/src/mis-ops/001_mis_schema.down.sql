-- Rollback is intentionally manual and must never be run automatically.
DROP TABLE IF EXISTS mis_audit_log;
DROP TABLE IF EXISTS mis_entries;
DROP TABLE IF EXISTS mis_authorities;
DROP TABLE IF EXISTS mis_services;
DROP TABLE IF EXISTS mis_project_tabs;
DROP TABLE IF EXISTS mis_tabs;
DROP TABLE IF EXISTS mis_projects;
-- Retain the shared MIS migration ledger; rollback removes only its own row.
DELETE FROM mis_schema_migrations WHERE id = '001_mis_schema';