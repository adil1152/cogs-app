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
import {
  defaultChain,
  getProjectChain,
  getProjectChainsMap,
  seedDefaultChain,
} from "../lib/approvalChain";

const router: IRouter = Router();

router.get(
  "/projects",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const visible = await listVisibleProjects(req.user!.id, req.user!.role);
    const chains = await getProjectChainsMap(visible.map((v) => v.project.id));
    res.json(
      visible.map((v) => serializeProject(v, chains.get(v.project.id) ?? defaultChain())),
    );
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
    const { name, code, location, contractStart, contractEnd, notes, pdfRequired } =
      parsed.data;
    try {
      const [created] = await db
        .insert(projectsTable)
        .values({
          name,
          code: code && code.length > 0 ? code : null,
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
          pdfRequired: pdfRequired ?? false,
          createdById: req.user!.id,
        })
        .returning();

      const chain = await seedDefaultChain(created.id);

      res.status(201).json(
        serializeProject(
          {
            project: created,
            canViewSummary: true,
            canEditEntries: true,
            canResetApproval: true,
            isAdminOwned: true,
          },
          chain,
        ),
      );
    } catch (e) {
      if ((e as { code?: string }).code === "23505") {
        res
          .status(409)
          .json({ error: "Project code already in use — pick another" });
        return;
      }
      throw e;
    }
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

    const [services, chain] = await Promise.all([
      db
        .select()
        .from(projectServicesTable)
        .where(eq(projectServicesTable.projectId, v.project.id))
        .orderBy(projectServicesTable.sortOrder),
      getProjectChain(v.project.id),
    ]);

    res.json({
      ...serializeProject(
        {
          project: v.project,
          canViewSummary: v.canViewSummary,
          canEditEntries: v.canEditEntries,
          canResetApproval: v.canResetApproval,
          isAdminOwned: v.isAdminOwned,
        },
        chain,
      ),
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
    if (parsed.data.code !== undefined) {
      data.code =
        parsed.data.code == null || parsed.data.code === ""
          ? null
          : parsed.data.code;
    }
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
    if (parsed.data.pdfRequired !== undefined)
      data.pdfRequired = parsed.data.pdfRequired;
    data.updatedAt = new Date();

    let updated;
    try {
      [updated] = await db
        .update(projectsTable)
        .set(data)
        .where(eq(projectsTable.id, (req.params.id as string)))
        .returning();
    } catch (e) {
      if ((e as { code?: string }).code === "23505") {
        res
          .status(409)
          .json({ error: "Project code already in use — pick another" });
        return;
      }
      throw e;
    }
    if (!updated) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    const chain = await getProjectChain(updated.id);
    res.json(
      serializeProject(
        {
          project: updated,
          canViewSummary: true,
          canEditEntries: true,
          canResetApproval: true,
          isAdminOwned: true,
        },
        chain,
      ),
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
