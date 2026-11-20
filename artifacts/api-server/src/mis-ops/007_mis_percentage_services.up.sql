CREATE TABLE IF NOT EXISTS mis_percentage_services (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id varchar NOT NULL REFERENCES mis_projects(id) ON DELETE CASCADE,
  kind varchar(16) NOT NULL,
  name varchar(160) NOT NULL,
  percentage numeric(9,6) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mis_percentage_services_project_idx ON mis_percentage_services(project_id);
