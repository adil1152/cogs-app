import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  dailyEntriesTable,
  serviceCostEntriesTable,
} from "@workspace/db";
import { and, eq, gte, lte, desc, isNull } from "drizzle-orm";
import {
  CreateDailyEntryBody,
  UpdateDailyEntryBody,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { getProjectVisibility } from "../lib/projectAccess";
import {
  buildEntryDetail,
  buildEntrySummary,
  computeTotalMandays,
  type ServiceCostInputItem,
} from "../lib/entries";

const router: IRouter = Router();

function asDateString(d: Date | string): string {
  return d instanceof Date ? d.toISOString().slice(0, 10) : d;
}

router.get(
  "/projects/:id/entries",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const v = await getProjectVisibility(
      req.user!.id,
      req.user!.role,
      req.params.id as string,
    );
    if (!v.project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    if (req.user!.role !== "admin" && !v.canViewSummary && !v.canEditEntries) {
      res.status(403).json({ error: "No access" });
      return;
    }

    const conds = [eq(dailyEntriesTable.projectId, req.params.id as string)];
    if (typeof req.query.from === "string")
      conds.push(gte(dailyEntriesTable.entryDate, req.query.from));
    if (typeof req.query.to === "string")
      conds.push(lte(dailyEntriesTable.entryDate, req.query.to));

    const rows = await db
      .select()
      .from(dailyEntriesTable)
      .where(and(...conds))
      .orderBy(desc(dailyEntriesTable.entryDate));

    res.json(await Promise.all(rows.map(buildEntrySummary)));
  },
);

router.post(
  "/projects/:id/entries",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const v = await getProjectVisibility(
      req.user!.id,
      req.user!.role,
      req.params.id as string,
    );
    if (!v.project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    if (req.user!.role !== "admin" && !v.canEditEntries) {
      res.status(403).json({ error: "Edit access required" });
      return;
    }

    const parsed = CreateDailyEntryBody.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Invalid body", details: parsed.error.issues });
      return;
    }

    const override = !!parsed.data.totalMandaysOverride;
    const serviceCosts = parsed.data.serviceCosts as ServiceCostInputItem[];
    const totalMandays = computeTotalMandays(
      serviceCosts,
      override,
      parsed.data.totalMandays,
    );

    const created = await db.transaction(async (tx) => {
      const [entry] = await tx
        .insert(dailyEntriesTable)
        .values({
          projectId: req.params.id as string,
          entryDate: asDateString(parsed.data.entryDate),
          location: parsed.data.location,
          totalMandays: String(totalMandays),
          totalMandaysOverride: override,
          notes: parsed.data.notes ?? null,
          createdById: req.user!.id,
        })
        .returning();

      if (serviceCosts.length > 0) {
        await tx.insert(serviceCostEntriesTable).values(
          serviceCosts.map((sc) => ({
            dailyEntryId: entry.id,
            projectServiceId: sc.projectServiceId,
            kind: sc.kind,
            cost: String(sc.cost ?? 0),
            mandays: sc.mandays != null ? String(sc.mandays) : null,
            breakfastQty: sc.breakfastQty ?? null,
            lunchQty: sc.lunchQty ?? null,
            dinnerQty: sc.dinnerQty ?? null,
            midnightQty: sc.midnightQty ?? null,
            mealBoxQty: sc.mealBoxQty ?? null,
          })),
        );
      }
      return entry;
    });

    res.status(201).json(await buildEntryDetail(created.id));
  },
);

router.get(
  "/entries/:id",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const [entry] = await db
      .select()
      .from(dailyEntriesTable)
      .where(eq(dailyEntriesTable.id, req.params.id as string));
    if (!entry) {
      res.status(404).json({ error: "Entry not found" });
      return;
    }
    const v = await getProjectVisibility(
      req.user!.id,
      req.user!.role,
      entry.projectId,
    );
    if (req.user!.role !== "admin" && !v.canViewSummary && !v.canEditEntries) {
      res.status(403).json({ error: "No access" });
      return;
    }
    res.json(await buildEntryDetail(entry.id));
  },
);

router.patch(
  "/entries/:id",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const id = req.params.id as string;
    const [entry] = await db
      .select()
      .from(dailyEntriesTable)
      .where(eq(dailyEntriesTable.id, id));
    if (!entry) {
      res.status(404).json({ error: "Entry not found" });
      return;
    }
    if (entry.lockedAt) {
      res.status(403).json({ error: "Entry is locked and cannot be edited" });
      return;
    }
    const v = await getProjectVisibility(
      req.user!.id,
      req.user!.role,
      entry.projectId,
    );
    if (req.user!.role !== "admin" && !v.canEditEntries) {
      res.status(403).json({ error: "Edit access required" });
      return;
    }

    const parsed = UpdateDailyEntryBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body" });
      return;
    }

    try {
    await db.transaction(async (tx) => {
      const data: Record<string, unknown> = {};
      if (parsed.data.entryDate !== undefined)
        data.entryDate = asDateString(parsed.data.entryDate);
      if (parsed.data.location !== undefined)
        data.location = parsed.data.location;
      if (parsed.data.notes !== undefined) data.notes = parsed.data.notes;

      const overrideAfter =
        parsed.data.totalMandaysOverride ?? entry.totalMandaysOverride;
      if (parsed.data.totalMandaysOverride !== undefined) {
        data.totalMandaysOverride = overrideAfter;
      }

      if (parsed.data.serviceCosts !== undefined) {
        const tm = computeTotalMandays(
          parsed.data.serviceCosts as ServiceCostInputItem[],
          overrideAfter,
          parsed.data.totalMandays,
        );
        data.totalMandays = String(tm);
      } else if (overrideAfter && parsed.data.totalMandays !== undefined) {
        data.totalMandays = String(parsed.data.totalMandays);
      }

      data.updatedAt = new Date();

      // Lock-aware update: re-check lockedAt inside the transaction so a
      // concurrent approval that locks between our check and our write cannot
      // mutate a now-locked record.
      if (Object.keys(data).length > 0) {
        const updated = await tx
          .update(dailyEntriesTable)
          .set(data)
          .where(
            and(
              eq(dailyEntriesTable.id, id),
              isNull(dailyEntriesTable.lockedAt),
            ),
          )
          .returning({ id: dailyEntriesTable.id });
        if (updated.length === 0) {
          throw new LockedConflict("Entry was locked — refresh to see changes");
        }
      }

      if (parsed.data.serviceCosts !== undefined) {
        await tx
          .delete(serviceCostEntriesTable)
          .where(eq(serviceCostEntriesTable.dailyEntryId, id));
        if (parsed.data.serviceCosts.length > 0) {
          await tx.insert(serviceCostEntriesTable).values(
            (parsed.data.serviceCosts as ServiceCostInputItem[]).map((sc) => ({
              dailyEntryId: id,
              projectServiceId: sc.projectServiceId,
              kind: sc.kind,
              cost: String(sc.cost ?? 0),
              mandays: sc.mandays != null ? String(sc.mandays) : null,
              breakfastQty: sc.breakfastQty ?? null,
              lunchQty: sc.lunchQty ?? null,
              dinnerQty: sc.dinnerQty ?? null,
              midnightQty: sc.midnightQty ?? null,
              mealBoxQty: sc.mealBoxQty ?? null,
            })),
          );
        }
      }
    });
    } catch (e) {
      if (e instanceof LockedConflict) {
        res.status(409).json({ error: e.message });
        return;
      }
      throw e;
    }

    res.json(await buildEntryDetail(id));
  },
);

router.delete(
  "/entries/:id",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const id = req.params.id as string;
    const [entry] = await db
      .select()
      .from(dailyEntriesTable)
      .where(eq(dailyEntriesTable.id, id));
    if (!entry) {
      res.status(204).end();
      return;
    }
    if (entry.lockedAt) {
      res.status(403).json({ error: "Entry is locked and cannot be deleted" });
      return;
    }
    const v = await getProjectVisibility(
      req.user!.id,
      req.user!.role,
      entry.projectId,
    );
    if (req.user!.role !== "admin" && !v.canEditEntries) {
      res.status(403).json({ error: "Edit access required" });
      return;
    }
    // Lock-aware delete: refuses to remove a record locked between our pre-check
    // and the delete itself.
    const deleted = await db
      .delete(dailyEntriesTable)
      .where(
        and(
          eq(dailyEntriesTable.id, id),
          isNull(dailyEntriesTable.lockedAt),
        ),
      )
      .returning({ id: dailyEntriesTable.id });
    if (deleted.length === 0) {
      res
        .status(409)
        .json({ error: "Entry was locked concurrently — refresh and retry" });
      return;
    }
    res.status(204).end();
  },
);

class LockedConflict extends Error {}

export default router;
