import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  projectServicesTable,
  serviceCostEntriesTable,
  dailyEntriesTable,
} from "@workspace/db";
import { and, eq, isNotNull, exists, sql } from "drizzle-orm";
import {
  CreateProjectServiceBody,
  UpdateProjectServiceBody,
  ReorderProjectServicesBody,
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
    const serviceId = req.params.id as string;
    // Atomic, race-safe: delete only if NO cost rows reference a locked entry.
    // A concurrent approval that locks an entry between check and delete cannot
    // sneak through, because the predicate is evaluated by the DB at delete time.
    const lockedRefSubquery = db
      .select({ x: sql<number>`1` })
      .from(serviceCostEntriesTable)
      .innerJoin(
        dailyEntriesTable,
        eq(dailyEntriesTable.id, serviceCostEntriesTable.dailyEntryId),
      )
      .where(
        and(
          eq(serviceCostEntriesTable.projectServiceId, serviceId),
          isNotNull(dailyEntriesTable.lockedAt),
        ),
      );
    const deleted = await db
      .delete(projectServicesTable)
      .where(
        and(
          eq(projectServicesTable.id, serviceId),
          sql`NOT EXISTS ${lockedRefSubquery}`,
        ),
      )
      .returning({ id: projectServicesTable.id });
    if (deleted.length === 0) {
      // Distinguish "not found" from "locked-blocked" with a follow-up read.
      const [stillExists] = await db
        .select({ id: projectServicesTable.id })
        .from(projectServicesTable)
        .where(eq(projectServicesTable.id, serviceId));
      if (stillExists) {
        res.status(409).json({
          error:
            "This service has cost entries on locked records and cannot be deleted",
        });
        return;
      }
    }
    res.status(204).end();
  },
);

router.patch(
  "/projects/:id/services/reorder",
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const projectId = req.params.id as string;
    const parsed = ReorderProjectServicesBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body" });
      return;
    }
    const items = parsed.data.services;
    if (items.length === 0) {
      const rows = await db
        .select()
        .from(projectServicesTable)
        .where(eq(projectServicesTable.projectId, projectId))
        .orderBy(projectServicesTable.sortOrder);
      res.json(rows.map(serialize));
      return;
    }
    await db.transaction(async (tx) => {
      for (const it of items) {
        await tx
          .update(projectServicesTable)
          .set({ sortOrder: it.sortOrder })
          .where(
            and(
              eq(projectServicesTable.id, it.id),
              eq(projectServicesTable.projectId, projectId),
            ),
          );
      }
    });
    const rows = await db
      .select()
      .from(projectServicesTable)
      .where(eq(projectServicesTable.projectId, projectId))
      .orderBy(projectServicesTable.sortOrder);
    res.json(rows.map(serialize));
  },
);

export default router;
