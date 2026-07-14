import { Router, type IRouter, type Request, type Response } from "express";
import { db, securityGroupsTable, projectAccessTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import {
  CreateSecurityGroupBody,
  UpdateSecurityGroupBody,
} from "@workspace/api-zod";
import { requireAuth, requireAdmin } from "../middlewares/requireAuth";

const router: IRouter = Router();

async function serializeGroup(g: typeof securityGroupsTable.$inferSelect) {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(projectAccessTable)
    .where(eq(projectAccessTable.securityGroupId, g.id));
  return {
    id: g.id,
    name: g.name,
    description: g.description,
    canViewSummary: g.canViewSummary,
    canEditEntries: g.canEditEntries,
    canResetApproval: g.canResetApproval,
    assignmentCount: Number(count ?? 0),
    createdAt: g.createdAt.toISOString(),
  };
}

router.get(
  "/security-groups",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    if (req.user!.role !== "admin") {
      res.status(403).json({ error: "Admin access required" });
      return;
    }
    const rows = await db
      .select()
      .from(securityGroupsTable)
      .orderBy(securityGroupsTable.name);
    res.json(await Promise.all(rows.map(serializeGroup)));
  },
);

router.post(
  "/security-groups",
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = CreateSecurityGroupBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body" });
      return;
    }
    try {
      const [created] = await db
        .insert(securityGroupsTable)
        .values({
          name: parsed.data.name.trim(),
          description: parsed.data.description ?? null,
          canViewSummary: parsed.data.canViewSummary ?? false,
          canEditEntries: parsed.data.canEditEntries ?? false,
          canResetApproval: parsed.data.canResetApproval ?? false,
          createdById: req.user!.id,
        })
        .returning();
      res.status(201).json(await serializeGroup(created));
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === "23505") {
        res.status(409).json({ error: "A group with that name already exists" });
        return;
      }
      throw err;
    }
  },
);

router.patch(
  "/security-groups/:id",
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = UpdateSecurityGroupBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body" });
      return;
    }
    const data: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) data.name = parsed.data.name.trim();
    if (parsed.data.description !== undefined)
      data.description = parsed.data.description;
    if (parsed.data.canViewSummary !== undefined)
      data.canViewSummary = parsed.data.canViewSummary;
    if (parsed.data.canEditEntries !== undefined)
      data.canEditEntries = parsed.data.canEditEntries;
    if (parsed.data.canResetApproval !== undefined)
      data.canResetApproval = parsed.data.canResetApproval;
    try {
      const [updated] = await db
        .update(securityGroupsTable)
        .set(data)
        .where(eq(securityGroupsTable.id, req.params.id as string))
        .returning();
      if (!updated) {
        res.status(404).json({ error: "Security group not found" });
        return;
      }
      res.json(await serializeGroup(updated));
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === "23505") {
        res.status(409).json({ error: "A group with that name already exists" });
        return;
      }
      throw err;
    }
  },
);

router.delete(
  "/security-groups/:id",
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const groupId = req.params.id as string;
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(projectAccessTable)
      .where(eq(projectAccessTable.securityGroupId, groupId));
    if (Number(count ?? 0) > 0) {
      res.status(409).json({
        error: `Cannot delete: ${count} access row(s) still reference this group. Reassign them first.`,
      });
      return;
    }
    await db
      .delete(securityGroupsTable)
      .where(eq(securityGroupsTable.id, groupId));
    res.status(204).end();
  },
);

export default router;
