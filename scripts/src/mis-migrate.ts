import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const pg: { Client: new (options: { connectionString: string }) => {
  connect(): Promise<void>; query(query: string, values?: unknown[]): Promise<{ rowCount: number | null }>; end(): Promise<void>;
} } = (() => {
  try { return require("pg"); } catch { return require("../../lib/db/node_modules/pg"); }
})();

const migrations = [
  { id: "001_mis_schema", file: "001_mis_schema.up.sql" },
  { id: "002_mis_audit_append_only", file: "002_mis_audit_append_only.up.sql" },
  { id: "003_mis_security_service_fields", file: "003_mis_security_service_fields.up.sql" },
  { id: "004_mis_parents_and_period_policy", file: "004_mis_parents_and_period_policy.up.sql" },
  { id: "005_mis_calculation_and_service_order", file: "005_mis_calculation_and_service_order.up.sql" },
];
if (process.env.NODE_ENV !== "development") throw new Error("MIS migrations are development-only and cannot run in production.");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query("BEGIN");
  await client.query("CREATE TABLE IF NOT EXISTS mis_schema_migrations (id varchar(128) PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  for (const migration of migrations) {
    const existing = await client.query("SELECT 1 FROM mis_schema_migrations WHERE id = $1", [migration.id]);
    if (existing.rowCount !== 0) continue;
    const sqlFile = path.resolve(import.meta.dirname, `../../artifacts/api-server/src/mis-ops/${migration.file}`);
    await client.query(await readFile(sqlFile, "utf8"));
    await client.query("INSERT INTO mis_schema_migrations(id) VALUES ($1)", [migration.id]);
  }
  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}