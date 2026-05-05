import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  dailyEntriesTable,
  serviceCostEntriesTable,
  projectServicesTable,
  projectsTable,
} from "@workspace/db";
import { and, eq, gte, lte, desc } from "drizzle-orm";
import {
  CreateDailyEntryBody,
  UpdateDailyEntryBody,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { getProjectVisibility } from "../lib/projectAccess";
import { calcFoodMandays, safeDivide } from "../lib/cogsCalc";

const router: IRouter = Router();

interface ServiceCostInputItem {
  projectServiceId: string;
  kind: "food" | "standard";
  cost?: number;
  breakfastQty?: number;
  lunchQty?: number;
  dinnerQty?: number;
  midnightQty?: number;
  mealBoxQty?: number;
}

function asDateString(d: Date | string): string {
  return d instanceof Date ? d.toISOString().slice(0, 10) : d;
}

async function buildEntryDetail(entryId: string) {
  const [entry] = await db
    .select()
    .from(dailyEntriesTable)
    .where(eq(dailyEntriesTable.id, entryId));
  if (!entry) return null;

  const [project] = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, entry.projectId));

  const costs = await db
    .select({
      cost: serviceCostEntriesTable,
      service: projectServicesTable,
    })
    .from(serviceCostEntriesTable)
    .leftJoin(
      projectServicesTable,
      eq(projectServicesTable.id, serviceCostEntriesTable.projectServiceId),
    )
    .where(eq(serviceCostEntriesTable.dailyEntryId, entryId));

  const totalMandays = Number(entry.totalMandays);
  let totalCost = 0;
  const serviceCosts = costs.map(({ cost: c, service }) => {
    const cVal = Number(c.cost ?? 0);
    totalCost += cVal;
    const mandayContribution =
      c.kind === "food"
        ? calcFoodMandays({
            breakfastQty: c.breakfastQty,
            lunchQty: c.lunchQty,
            dinnerQty: c.dinnerQty,
            midnightQty: c.midnightQty,
            mealBoxQty: c.mealBoxQty,
          })
        : 0;
    return {
      id: c.id,
      projectServiceId: c.projectServiceId,
      serviceName: service?.name ?? "Unknown",
      kind: c.kind as "food" | "standard",
      cost: cVal,
      mandayContribution,
      costPerManday: safeDivide(cVal, totalMandays),
      breakfastQty: c.breakfastQty,
      lunchQty: c.lunchQty,
      dinnerQty: c.dinnerQty,
      midnightQty: c.midnightQty,
      mealBoxQty: c.mealBoxQty,
    };
  });

  return {
    id: entry.id,
    projectId: entry.projectId,
    projectName: project?.name ?? "",
    entryDate: entry.entryDate,
    location: entry.location,
    totalMandays,
    totalCost,
    costPerManday: safeDivide(totalCost, totalMandays),
    notes: entry.notes,
    serviceCosts,
  };
}

async function buildEntrySummary(entry: typeof dailyEntriesTable.$inferSelect) {
  const [project] = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, entry.projectId));

  const costs = await db
    .select({ cost: serviceCostEntriesTable.cost })
    .from(serviceCostEntriesTable)
    .where(eq(serviceCostEntriesTable.dailyEntryId, entry.id));

  const totalMandays = Number(entry.totalMandays);
  const totalCost = costs.reduce((s, r) => s + Number(r.cost ?? 0), 0);

  return {
    id: entry.id,
    projectId: entry.projectId,
    projectName: project?.name ?? "",
    entryDate: entry.entryDate,
    location: entry.location,
    totalMandays,
    totalCost,
    costPerManday: safeDivide(totalCost, totalMandays),
    notes: entry.notes,
  };
}

router.get(
  "/projects/:id/entries",
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
    if (req.user!.role !== "admin" && !v.canViewSummary && !v.canEditEntries) {
      res.status(403).json({ error: "No access" });
      return;
    }

    const conds = [eq(dailyEntriesTable.projectId, (req.params.id as string))];
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
      (req.params.id as string),
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
      res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
      return;
    }

    // Server is the source of truth for totalMandays. Sum the food-formula
    // mandays from every service line; standard services contribute 0.
    const computedMandays = parsed.data.serviceCosts.reduce(
      (sum: number, sc: ServiceCostInputItem) =>
        sum +
        (sc.kind === "food"
          ? calcFoodMandays({
              breakfastQty: sc.breakfastQty,
              lunchQty: sc.lunchQty,
              dinnerQty: sc.dinnerQty,
              midnightQty: sc.midnightQty,
              mealBoxQty: sc.mealBoxQty,
            })
          : 0),
      0,
    );

    const created = await db.transaction(async (tx) => {
      const [entry] = await tx
        .insert(dailyEntriesTable)
        .values({
          projectId: (req.params.id as string),
          entryDate: asDateString(parsed.data.entryDate),
          location: parsed.data.location,
          totalMandays: String(computedMandays),
          notes: parsed.data.notes ?? null,
          createdById: req.user!.id,
        })
        .returning();

      if (parsed.data.serviceCosts.length > 0) {
        await tx.insert(serviceCostEntriesTable).values(
          parsed.data.serviceCosts.map((sc: ServiceCostInputItem) => ({
            dailyEntryId: entry.id,
            projectServiceId: sc.projectServiceId,
            kind: sc.kind,
            cost: String(sc.cost ?? 0),
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
      .where(eq(dailyEntriesTable.id, (req.params.id as string)));
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
    const [entry] = await db
      .select()
      .from(dailyEntriesTable)
      .where(eq(dailyEntriesTable.id, (req.params.id as string)));
    if (!entry) {
      res.status(404).json({ error: "Entry not found" });
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

    await db.transaction(async (tx) => {
      const data: Record<string, unknown> = {};
      if (parsed.data.entryDate !== undefined)
        data.entryDate = asDateString(parsed.data.entryDate);
      if (parsed.data.location !== undefined) data.location = parsed.data.location;
      if (parsed.data.notes !== undefined) data.notes = parsed.data.notes;

      // Recompute totalMandays from serviceCosts whenever they're provided.
      if (parsed.data.serviceCosts !== undefined) {
        const computedMandays = parsed.data.serviceCosts.reduce(
          (sum: number, sc: ServiceCostInputItem) =>
            sum +
            (sc.kind === "food"
              ? calcFoodMandays({
                  breakfastQty: sc.breakfastQty,
                  lunchQty: sc.lunchQty,
                  dinnerQty: sc.dinnerQty,
                  midnightQty: sc.midnightQty,
                  mealBoxQty: sc.mealBoxQty,
                })
              : 0),
          0,
        );
        data.totalMandays = String(computedMandays);
      }
      data.updatedAt = new Date();

      if (Object.keys(data).length > 0) {
        await tx
          .update(dailyEntriesTable)
          .set(data)
          .where(eq(dailyEntriesTable.id, (req.params.id as string)));
      }

      if (parsed.data.serviceCosts !== undefined) {
        await tx
          .delete(serviceCostEntriesTable)
          .where(eq(serviceCostEntriesTable.dailyEntryId, (req.params.id as string)));
        if (parsed.data.serviceCosts.length > 0) {
          await tx.insert(serviceCostEntriesTable).values(
            parsed.data.serviceCosts.map((sc: ServiceCostInputItem) => ({
              dailyEntryId: (req.params.id as string),
              projectServiceId: sc.projectServiceId,
              kind: sc.kind,
              cost: String(sc.cost ?? 0),
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

    res.json(await buildEntryDetail((req.params.id as string)));
  },
);

router.delete(
  "/entries/:id",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const [entry] = await db
      .select()
      .from(dailyEntriesTable)
      .where(eq(dailyEntriesTable.id, (req.params.id as string)));
    if (!entry) {
      res.status(204).end();
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
    await db.delete(dailyEntriesTable).where(eq(dailyEntriesTable.id, (req.params.id as string)));
    res.status(204).end();
  },
);

export default router;
