import { Router, type IRouter, type Request, type Response } from "express";
import { db, projectServicesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  CreateProjectServiceBody,
  UpdateProjectServiceBody,
} from "@workspace/api-zod";
import { requireAuth, requireAdmin } from "../middlewares/requireAuth";
import { getProjectVisibility } from "../lib/projectAccess";

const router: IRouter = Router();

function serialize(s: typeof projectServicesTable.$inferSelect) {
  return {
    id: s.id,
    projectId: s.projectId,
    name: s.name,
    kind: s.kind as "food" | "standard",
    sortOrder: s.sortOrder,
  };
}

router.get(
  "/projects/:id/services",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const v = await getProjectVisibility(
      req.user!.id,
      req.user!.role,
      (req.params.id as string),
    );
    if (!v.project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    if (
      req.user!.role !== "admin" &&
      !v.canViewSummary &&
      !v.canEditEntries
    ) {
      res.status(403).json({ error: "No access to this project" });
      return;
    }
    const rows = await db
      .select()
      .from(projectServicesTable)
      .where(eq(projectServicesTable.projectId, (req.params.id as string)))
      .orderBy(projectServicesTable.sortOrder);
    res.json(rows.map(serialize));
  },
);

router.post(
  "/projects/:id/services",
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = CreateProjectServiceBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body" });
      return;
    }
    const [created] = await db
      .insert(projectServicesTable)
      .values({
        projectId: (req.params.id as string),
        name: parsed.data.name,
        kind: parsed.data.kind,
        sortOrder: parsed.data.sortOrder ?? 0,
      })
      .returning();
    res.status(201).json(serialize(created));
  },
);

router.patch(
  "/services/:id",
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = UpdateProjectServiceBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body" });
      return;
    }
    const data: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) data.name = parsed.data.name;
    if (parsed.data.kind !== undefined) data.kind = parsed.data.kind;
    if (parsed.data.sortOrder !== undefined) data.sortOrder = parsed.data.sortOrder;
    const [updated] = await db
      .update(projectServicesTable)
      .set(data)
      .where(eq(projectServicesTable.id, (req.params.id as string)))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Service not found" });
      return;
    }
    res.json(serialize(updated));
  },
);

router.delete(
  "/services/:id",
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    await db
      .delete(projectServicesTable)
      .where(eq(projectServicesTable.id, (req.params.id as string)));
    res.status(204).end();
  },
);

export default router;
