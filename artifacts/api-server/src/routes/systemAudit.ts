import { Router } from "express";
import { pool } from "@workspace/db";
import { requireAdmin } from "../middlewares/requireAuth";

const router = Router();
function validDate(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
router.get("/admin/audit-log", requireAdmin, async (req, res) => {
  const { page = "1", search = "", module, action, from, to } = req.query;
  if (typeof page !== "string" || !/^[1-9]\d{0,6}$/.test(page) ||
      typeof search !== "string" || search.length > 200 ||
      (module !== undefined && (typeof module !== "string" || !["COGS", "MIS", "System"].includes(module))) ||
      (action !== undefined && (typeof action !== "string" || !["INSERT", "UPDATE", "DELETE"].includes(action))) ||
      [from, to].some(d => d !== undefined && !validDate(d)) ||
      (from && to && String(from) > String(to))) {
    res.status(400).json({ error: "Invalid audit filters" }); return;
  }
  const values: unknown[] = [];
  const filters: string[] = [];
  const bind = (value: unknown) => { values.push(value); return `$${values.length}`; };
  if (module) filters.push(`a.module = ${bind(module)}`);
  if (action) filters.push(`a.action = ${bind(action)}`);
  if (from) filters.push(`a.occurred_at >= ${bind(from)}::date`);
  if (to) filters.push(`a.occurred_at < ${bind(to)}::date + interval '1 day'`);
  if (search.trim()) {
    const p = bind(`%${search.trim().replace(/[\\%_]/g, "\\$&")}%`);
    filters.push(`concat_ws(' ',a.actor_name,a.actor_id,a.entity_type,a.entity_id,a.entity_name,a.project_id,a.project_name,p.name,m.name,a.changed_fields::text) ILIKE ${p}`);
  }
  const joins = `FROM system_audit_log a
    LEFT JOIN projects p ON a.module='COGS' AND p.id=a.project_id
    LEFT JOIN mis_projects m ON a.module='MIS' AND m.id=a.project_id`;
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const count = await pool.query(`SELECT count(*)::int AS total ${joins} ${where}`, values);
  const offset = bind((Number(page) - 1) * 50);
  const result = await pool.query(`SELECT a.id, a.occurred_at AS "occurredAt", a.module,
    a.actor_id AS "actorId", a.actor_name AS "actorName", a.action,
    a.entity_type AS "entityType", a.entity_id AS "entityId", a.entity_name AS "entityName",
    a.project_id AS "projectId", coalesce(a.project_name,p.name,m.name) AS "projectName",
    a.request_id AS "requestId", a.path, a.old_values AS "oldValues",
    a.new_values AS "newValues", a.changed_fields AS "changedFields"
    ${joins} ${where} ORDER BY a.occurred_at DESC,a.id DESC LIMIT 50 OFFSET ${offset}`, values);
  res.json({ items: result.rows, total: count.rows[0].total, page: Number(page), pageSize: 50 });
});
export default router;
