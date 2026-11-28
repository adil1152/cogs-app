import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pg: { Client: new (options: { connectionString: string }) => {
  connect(): Promise<void>; query(query: string, values?: unknown[]): Promise<{ rowCount: number | null; rows: { id: string; role?: string }[] }>; end(): Promise<void>;
} } = (() => {
  try { return require("pg"); } catch { return require("../../lib/db/node_modules/pg"); }
})();

const email = process.argv[2]?.trim().toLowerCase();
if (!email) throw new Error("Usage: pnpm mis:bootstrap-admin <existing-user-email>");
const productionOverride = process.env.NODE_ENV === "production" && process.env.MIS_ALLOW_PRODUCTION_BOOTSTRAP === "true";
if (process.env.NODE_ENV !== "development" && !productionOverride) {
  throw new Error("Bootstrap requires NODE_ENV=development. Production requires explicit MIS_ALLOW_PRODUCTION_BOOTSTRAP=true.");
}
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query("BEGIN");
  const user = await client.query("SELECT id FROM users WHERE lower(email) = $1", [email]);
  if (user.rowCount !== 1) throw new Error("Existing user was not found");
  await client.query("SELECT pg_advisory_xact_lock(90217531)");
  const existing = await client.query("SELECT id, role FROM mis_authorities WHERE user_id = $1 AND project_id IS NULL FOR UPDATE", [user.rows[0].id]);
  if (existing.rowCount === 1 && existing.rows[0].role === "mis_admin") {
    // Safe repeat: the exact target is already the global MIS administrator.
  } else {
    const admins = await client.query("SELECT id FROM mis_authorities WHERE role = 'mis_admin' AND project_id IS NULL FOR UPDATE");
    if (admins.rowCount !== 0) throw new Error("A global MIS administrator already exists; bootstrap refuses to change another account");
    if (existing.rowCount === 1) {
      await client.query("UPDATE mis_authorities SET role = 'mis_admin', updated_at = now() WHERE id = $1", [existing.rows[0].id]);
      await client.query(
        `INSERT INTO mis_audit_log(entry_id, project_id, entity_type, entity_id, action, actor_id, old_values, new_values)
         VALUES (NULL, NULL, 'authority', $1, 'BOOTSTRAP_ADMIN', $2, jsonb_build_object('role', $3::text), '{"role":"mis_admin","scope":"global"}'::jsonb)`,
        [existing.rows[0].id, user.rows[0].id, existing.rows[0].role],
      );
    } else {
      const inserted = await client.query(
        "INSERT INTO mis_authorities(user_id, project_id, role, extra_permissions) VALUES ($1, NULL, 'mis_admin', '[]'::jsonb) RETURNING id",
        [user.rows[0].id],
      );
      await client.query(
        `INSERT INTO mis_audit_log(entry_id, project_id, entity_type, entity_id, action, actor_id, new_values)
         VALUES (NULL, NULL, 'authority', $1, 'BOOTSTRAP_ADMIN', $2, '{"role":"mis_admin","scope":"global"}'::jsonb)`,
        [inserted.rows[0].id, user.rows[0].id],
      );
    }
  }
  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}