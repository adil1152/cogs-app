import { Router, type Response } from "express";
import { and, asc, eq } from "drizzle-orm";
import { db, misPercentageServicesTable, misProjectsTable, type MisPercentageServiceRow } from "@workspace/db";
import { MisCreatePercentageServiceBody, MisListPercentageServicesQueryParams, MisUpdatePercentageServiceBody } from "@workspace/api-zod";
import { requireAuth } from "../../middlewares/requireAuth";
import { can, canAccessProject, loadMisAccess } from "../../lib/mis/access";
import { auditMis } from "../../lib/mis/helpers";

const router = Router();
const serialize = (row: MisPercentageServiceRow) => ({
  id: row.id, projectId: row.projectId, kind: row.kind, name: row.name,
  percentage: Number(row.percentage), active: row.active,
});

async function authorize(userId: string, projectId: string, kind: "overhead" | "op_expense", write: boolean, res: Response) {
  const access = await loadMisAccess(userId);
  if (!canAccessProject(access, projectId) || !can(access, kind, projectId) ||
      (write && !can(access, "project_config", projectId) && !can(access, "services", projectId))) {
    res.status(403).json({ error: `${kind === "overhead" ? "Overhead" : "OP Expense"} permission${write ? " and project configuration/service permission" : ""} required` });
    return false;
  }
  const [project] = await db.select({ id: misProjectsTable.id }).from(misProjectsTable).where(eq(misProjectsTable.id, projectId));
  if (!project) { res.status(404).json({ error: "MIS project not found" }); return false; }
  return true;
}

router.get("/mis/projects/:id/percentage-services", requireAuth, async (req, res) => {
  const projectId = String(req.params.id);
  const query = MisListPercentageServicesQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: "Select Overhead or OP Expense" }); return; }
  if (!await authorize(req.user!.id, projectId, query.data.kind, false, res)) return;
  const rows = await db.select().from(misPercentageServicesTable).where(and(eq(misPercentageServicesTable.projectId, projectId), eq(misPercentageServicesTable.kind, query.data.kind))).orderBy(asc(misPercentageServicesTable.createdAt), asc(misPercentageServicesTable.id));
  res.json(rows.map(serialize));
});

router.post("/mis/projects/:id/percentage-services", requireAuth, async (req, res) => {
  const projectId = String(req.params.id);
  const body = MisCreatePercentageServiceBody.safeParse(req.body);
  if (!body.success || !body.data.name.trim() || !Number.isFinite(body.data.percentage)) { res.status(400).json({ error: "Provide a service name and a percentage from 0 to 100" }); return; }
  if (!await authorize(req.user!.id, projectId, body.data.kind, true, res)) return;
  const row = await db.transaction(async (tx) => {
    const [created] = await tx.insert(misPercentageServicesTable).values({ ...body.data, name: body.data.name.trim(), percentage: String(body.data.percentage), projectId }).returning();
    await auditMis({ projectId, entityType: "percentage_service", entityId: created.id, action: "CREATE", actorId: req.user!.id, newValues: created }, tx);
    return created;
  });
  res.status(201).json(serialize(row));
});

router.patch("/mis/projects/:id/percentage-services/:serviceId", requireAuth, async (req, res) => {
  const projectId = String(req.params.id), serviceId = String(req.params.serviceId);
  const body = MisUpdatePercentageServiceBody.safeParse(req.body);
  if (!body.success || !body.data.name.trim() || !Number.isFinite(body.data.percentage)) { res.status(400).json({ error: "Provide a service name and a percentage from 0 to 100" }); return; }
  if (!await authorize(req.user!.id, projectId, body.data.kind, true, res)) return;
  const updated = await db.transaction(async (tx) => {
    const [before] = await tx.select().from(misPercentageServicesTable).where(and(eq(misPercentageServicesTable.id, serviceId), eq(misPercentageServicesTable.projectId, projectId), eq(misPercentageServicesTable.kind, body.data.kind))).for("update");
    if (!before) return null;
    const [row] = await tx.update(misPercentageServicesTable).set({ name: body.data.name.trim(), percentage: String(body.data.percentage), active: body.data.active, updatedAt: new Date() }).where(eq(misPercentageServicesTable.id, serviceId)).returning();
    await auditMis({ projectId, entityType: "percentage_service", entityId: row.id, action: "UPDATE", actorId: req.user!.id, oldValues: before, newValues: row }, tx);
    return row;
  });
  if (!updated) { res.status(404).json({ error: "Percentage service not found in this project and section" }); return; }
  res.json(serialize(updated));
});

router.delete("/mis/projects/:id/percentage-services/:serviceId", requireAuth, async (req, res) => {
  const projectId = String(req.params.id), serviceId = String(req.params.serviceId);
  // Check project scope before looking up a row. Kind is immutable after creation.
  const access = await loadMisAccess(req.user!.id);
  if (!canAccessProject(access, projectId)) { res.status(403).json({ error: "MIS project permission required" }); return; }
  const [before] = await db.select().from(misPercentageServicesTable).where(and(eq(misPercentageServicesTable.id, serviceId), eq(misPercentageServicesTable.projectId, projectId)));
  if (!before || !["overhead", "op_expense"].includes(before.kind)) { res.status(404).json({ error: "Percentage service not found" }); return; }
  if (!await authorize(req.user!.id, projectId, before.kind as "overhead" | "op_expense", true, res)) return;
  await db.transaction(async (tx) => {
    const [deleted] = await tx.delete(misPercentageServicesTable).where(and(eq(misPercentageServicesTable.id, serviceId), eq(misPercentageServicesTable.projectId, projectId))).returning();
    if (deleted) await auditMis({ projectId, entityType: "percentage_service", entityId: deleted.id, action: "DELETE", actorId: req.user!.id, oldValues: deleted }, tx);
  });
  res.sendStatus(204);
});

export default router;
