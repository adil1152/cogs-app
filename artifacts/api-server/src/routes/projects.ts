import { Router, type IRouter, type Request, type Response } from "express";
import { db, projectsTable, projectServicesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { CreateProjectBody, UpdateProjectBody } from "@workspace/api-zod";
import { requireAuth, requireAdmin } from "../middlewares/requireAuth";
import {
  listVisibleProjects,
  getProjectVisibility,
  serializeProject,
} from "../lib/projectAccess";

const router: IRouter = Router();

router.get(
  "/projects",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const visible = await listVisibleProjects(req.user!.id, req.user!.role);
    res.json(visible.map(serializeProject));
  },
);

router.post(
  "/projects",
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = CreateProjectBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body" });
      return;
    }
    const { name, location, contractStart, contractEnd, notes } = parsed.data;
    const [created] = await db
      .insert(projectsTable)
      .values({
        name,
        location,
        contractStart:
          contractStart instanceof Date
            ? contractStart.toISOString().slice(0, 10)
            : contractStart,
        contractEnd:
          contractEnd instanceof Date
            ? contractEnd.toISOString().slice(0, 10)
            : contractEnd,
        notes: notes ?? null,
        createdById: req.user!.id,
      })
      .returning();

    res.status(201).json(
      serializeProject({
        project: created,
        canViewSummary: true,
        canEditEntries: true,
        isAdminOwned: true,
      }),
    );
  },
);

router.get(
  "/projects/:id",
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

    const services = await db
      .select()
      .from(projectServicesTable)
      .where(eq(projectServicesTable.projectId, v.project.id))
      .orderBy(projectServicesTable.sortOrder);

    res.json({
      ...serializeProject({
        project: v.project,
        canViewSummary: v.canViewSummary,
        canEditEntries: v.canEditEntries,
        isAdminOwned: v.isAdminOwned,
      }),
      services: services.map((s) => ({
        id: s.id,
        projectId: s.projectId,
        name: s.name,
        kind: s.kind as "food" | "standard",
        sortOrder: s.sortOrder,
      })),
    });
  },
);

router.patch(
  "/projects/:id",
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = UpdateProjectBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body" });
      return;
    }
    const data: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) data.name = parsed.data.name;
    if (parsed.data.location !== undefined) data.location = parsed.data.location;
    if (parsed.data.contractStart !== undefined) {
      data.contractStart =
        parsed.data.contractStart instanceof Date
          ? parsed.data.contractStart.toISOString().slice(0, 10)
          : parsed.data.contractStart;
    }
    if (parsed.data.contractEnd !== undefined) {
      data.contractEnd =
        parsed.data.contractEnd instanceof Date
          ? parsed.data.contractEnd.toISOString().slice(0, 10)
          : parsed.data.contractEnd;
    }
    if (parsed.data.notes !== undefined) data.notes = parsed.data.notes;
    data.updatedAt = new Date();

    const [updated] = await db
      .update(projectsTable)
      .set(data)
      .where(eq(projectsTable.id, (req.params.id as string)))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    res.json(
      serializeProject({
        project: updated,
        canViewSummary: true,
        canEditEntries: true,
        isAdminOwned: true,
      }),
    );
  },
);

router.delete(
  "/projects/:id",
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    await db.delete(projectsTable).where(eq(projectsTable.id, (req.params.id as string)));
    res.status(204).end();
  },
);

export default router;
