import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool, auditContext } from "@workspace/db";
import { initializeSystemAudit } from "../lib/systemAudit";

await initializeSystemAudit();
const tracked = await pool.query(`SELECT tablename FROM pg_tables WHERE schemaname='public'
  AND tablename NOT IN ('system_audit_log','entry_audit_log','mis_audit_log','sessions','password_reset_tokens','__drizzle_migrations')`);
const triggers = await pool.query(`SELECT event_object_table FROM information_schema.triggers WHERE trigger_name='system_audit_capture'`);
for (const row of tracked.rows) assert.ok(triggers.rows.some(t => t.event_object_table === row.tablename), `Missing coverage: ${row.tablename}`);

async function verifyActor(actorId: string) {
  return auditContext.run({ actorId, actorName: actorId, requestId: randomUUID(), path: "TEST rollback-only" }, async () => {
    const client = await pool.connect();
    const id = randomUUID();
    try {
      await client.query("BEGIN");
      await client.query(`INSERT INTO users(id,email,password_hash) VALUES ($1,$2,'not-a-real-secret')`, [id, `${id}@audit.invalid`]);
      await client.query(`UPDATE users SET first_name='Audit test',password_hash='changed-test-value' WHERE id=$1`, [id]);
      await client.query(`DELETE FROM users WHERE id=$1`, [id]);
      const logs = await client.query(`SELECT * FROM system_audit_log WHERE entity_id=$1 ORDER BY occurred_at`, [id]);
      assert.deepEqual(logs.rows.map(r => r.action), ["INSERT", "UPDATE", "DELETE"]);
      for (const row of logs.rows) {
        assert.equal(row.actor_id, actorId);
        for (const data of [row.old_values, row.new_values]) {
          if (data) assert.equal(data.password_hash, "[REDACTED]");
        }
      }
      assert.equal(logs.rows[1].new_values.first_name, "Audit test");
      assert.ok(logs.rows[1].changed_fields.includes("password_hash"));
      // Rollback removes both the business operation and its audit rows.
      await client.query("ROLLBACK");
      assert.equal((await client.query(`SELECT count(*)::int n FROM system_audit_log WHERE entity_id=$1`, [id])).rows[0].n, 0);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
}
await Promise.all([verifyActor("test-actor-a"), verifyActor("test-actor-b")]);
const context = await pool.query("SELECT current_setting('app.audit_context') AS ctx");
assert.deepEqual(JSON.parse(context.rows[0].ctx), {}, "No attribution may leak to the next request");
for (const operation of ["UPDATE system_audit_log SET actor_name=actor_name WHERE false", "DELETE FROM system_audit_log WHERE false", "TRUNCATE system_audit_log"]) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await assert.rejects(client.query(operation), /append-only/);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}
console.log(`PASS: ${tracked.rows.length} tables tracked; concurrent attribution, create/update/delete, redaction, rollback and immutable history verified.`);
await pool.end();
