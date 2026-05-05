import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  dailyEntriesTable,
  serviceCostEntriesTable,
  projectServicesTable,
  projectsTable,
  usersTable,
} from "@workspace/db";
import { and, eq, gte, lte, inArray, desc } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import {
  listVisibleProjects,
  getProjectVisibility,
  serializeProject,
} from "../lib/projectAccess";
import { calcFoodMandays, safeDivide } from "../lib/cogsCalc";

const router: IRouter = Router();

function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function startOfWeek(now: Date): Date {
  const d = new Date(now);
  const day = d.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function startOfMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

interface JoinedRow {
  entry: typeof dailyEntriesTable.$inferSelect;
  cost: typeof serviceCostEntriesTable.$inferSelect | null;
  service: typeof projectServicesTable.$inferSelect | null;
  project: typeof projectsTable.$inferSelect | null;
}

async function fetchJoined(
  projectIds: string[],
  from?: string,
  to?: string,
): Promise<JoinedRow[]> {
  if (projectIds.length === 0) return [];
  const conds = [inArray(dailyEntriesTable.projectId, projectIds)];
  if (from) conds.push(gte(dailyEntriesTable.entryDate, from));
  if (to) conds.push(lte(dailyEntriesTable.entryDate, to));

  const rows = await db
    .select({
      entry: dailyEntriesTable,
      cost: serviceCostEntriesTable,
      service: projectServicesTable,
      project: projectsTable,
    })
    .from(dailyEntriesTable)
    .leftJoin(
      serviceCostEntriesTable,
      eq(serviceCostEntriesTable.dailyEntryId, dailyEntriesTable.id),
    )
    .leftJoin(
      projectServicesTable,
      eq(projectServicesTable.id, serviceCostEntriesTable.projectServiceId),
    )
    .leftJoin(projectsTable, eq(projectsTable.id, dailyEntriesTable.projectId))
    .where(and(...conds));
  return rows;
}

interface KpiAccumulator {
  totalCost: number;
  mandaysSet: Map<string, number>;
  entryIds: Set<string>;
}

function newKpi(): KpiAccumulator {
  return { totalCost: 0, mandaysSet: new Map(), entryIds: new Set() };
}

function accumulate(k: KpiAccumulator, row: JoinedRow) {
  k.entryIds.add(row.entry.id);
  k.mandaysSet.set(row.entry.id, Number(row.entry.totalMandays));
  if (row.cost) k.totalCost += Number(row.cost.cost ?? 0);
}

function kpiOut(k: KpiAccumulator) {
  const totalMandays = Array.from(k.mandaysSet.values()).reduce(
    (a, b) => a + b,
    0,
  );
  return {
    totalCost: k.totalCost,
    totalMandays,
    costPerManday: safeDivide(k.totalCost, totalMandays),
    entryCount: k.entryIds.size,
  };
}

router.get(
  "/reports/dashboard",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const visible = await listVisibleProjects(req.user!.id, req.user!.role);
    const summaryProjectIds = visible
      .filter((v) => v.canViewSummary)
      .map((v) => v.project.id);

    const now = new Date();
    const todayStr = dateOnly(now);
    const monthStart = dateOnly(startOfMonth(now));
    const weekStart = dateOnly(startOfWeek(now));

    const all = await fetchJoined(summaryProjectIds, monthStart, todayStr);

    const todayKpi = newKpi();
    const weekKpi = newKpi();
    const monthKpi = newKpi();
    const serviceTotals = new Map<
      string,
      { name: string; kind: "food" | "standard"; totalCost: number; mandayContribution: number }
    >();
    const projectTotals = new Map<
      string,
      {
        projectId: string;
        projectName: string;
        location: string;
        totalCost: number;
        mandays: Map<string, number>;
      }
    >();

    for (const row of all) {
      const d = row.entry.entryDate;
      if (d === todayStr) accumulate(todayKpi, row);
      if (d >= weekStart) accumulate(weekKpi, row);
      accumulate(monthKpi, row);

      if (row.cost && row.service) {
        const key = `${row.service.id}`;
        const prev = serviceTotals.get(key) ?? {
          name: row.service.name,
          kind: row.service.kind as "food" | "standard",
          totalCost: 0,
          mandayContribution: 0,
        };
        prev.totalCost += Number(row.cost.cost ?? 0);
        prev.mandayContribution +=
          row.cost.kind === "food"
            ? calcFoodMandays({
                breakfastQty: row.cost.breakfastQty,
                lunchQty: row.cost.lunchQty,
                dinnerQty: row.cost.dinnerQty,
                midnightQty: row.cost.midnightQty,
                mealBoxQty: row.cost.mealBoxQty,
              })
            : 0;
        serviceTotals.set(key, prev);
      }

      if (row.project) {
        const pkey = row.project.id;
        const prev = projectTotals.get(pkey) ?? {
          projectId: row.project.id,
          projectName: row.project.name,
          location: row.project.location,
          totalCost: 0,
          mandays: new Map<string, number>(),
        };
        prev.mandays.set(row.entry.id, Number(row.entry.totalMandays));
        if (row.cost) prev.totalCost += Number(row.cost.cost ?? 0);
        projectTotals.set(pkey, prev);
      }
    }

    res.json({
      today: kpiOut(todayKpi),
      weekToDate: kpiOut(weekKpi),
      monthToDate: kpiOut(monthKpi),
      serviceBreakdown: Array.from(serviceTotals.values()).map((s) => ({
        serviceName: s.name,
        kind: s.kind,
        totalCost: s.totalCost,
        totalMandayContribution: s.mandayContribution,
      })),
      projectBreakdown: Array.from(projectTotals.values()).map((p) => {
        const totalMandays = Array.from(p.mandays.values()).reduce(
          (a, b) => a + b,
          0,
        );
        return {
          projectId: p.projectId,
          projectName: p.projectName,
          location: p.location,
          totalCost: p.totalCost,
          totalMandays,
          costPerManday: safeDivide(p.totalCost, totalMandays),
        };
      }),
    });
  },
);

router.get(
  "/reports/recent-activity",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const visible = await listVisibleProjects(req.user!.id, req.user!.role);
    const ids = visible.map((v) => v.project.id);
    if (ids.length === 0) {
      res.json([]);
      return;
    }

    const rows = await db
      .select({ entry: dailyEntriesTable, project: projectsTable, user: usersTable })
      .from(dailyEntriesTable)
      .leftJoin(projectsTable, eq(projectsTable.id, dailyEntriesTable.projectId))
      .leftJoin(usersTable, eq(usersTable.id, dailyEntriesTable.createdById))
      .where(inArray(dailyEntriesTable.projectId, ids))
      .orderBy(desc(dailyEntriesTable.createdAt))
      .limit(15);

    const out = await Promise.all(
      rows.map(async ({ entry, project, user }) => {
        const costs = await db
          .select({ cost: serviceCostEntriesTable.cost })
          .from(serviceCostEntriesTable)
          .where(eq(serviceCostEntriesTable.dailyEntryId, entry.id));
        const totalCost = costs.reduce((s, r) => s + Number(r.cost ?? 0), 0);
        return {
          id: entry.id,
          projectId: entry.projectId,
          projectName: project?.name ?? "",
          entryDate: entry.entryDate,
          totalCost,
          totalMandays: Number(entry.totalMandays),
          createdAt: entry.createdAt.toISOString(),
          createdByName: user
            ? [user.firstName, user.lastName].filter(Boolean).join(" ") ||
              user.email ||
              null
            : null,
        };
      }),
    );
    res.json(out);
  },
);

router.get(
  "/reports/projects/:id/summary",
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
    if (req.user!.role !== "admin" && !v.canViewSummary) {
      res.status(403).json({ error: "Summary access not granted" });
      return;
    }

    const from =
      typeof req.query.from === "string"
        ? req.query.from
        : dateOnly(startOfMonth(new Date()));
    const to =
      typeof req.query.to === "string"
        ? req.query.to
        : dateOnly(new Date());

    const rows = await fetchJoined([(req.params.id as string)], from, to);
    const kpi = newKpi();
    const serviceTotals = new Map<
      string,
      { name: string; kind: "food" | "standard"; totalCost: number; mandayContribution: number }
    >();
    const entriesById = new Map<
      string,
      {
        entry: typeof dailyEntriesTable.$inferSelect;
        totalCost: number;
      }
    >();

    for (const row of rows) {
      accumulate(kpi, row);
      if (row.cost && row.service) {
        const key = row.service.id;
        const prev = serviceTotals.get(key) ?? {
          name: row.service.name,
          kind: row.service.kind as "food" | "standard",
          totalCost: 0,
          mandayContribution: 0,
        };
        prev.totalCost += Number(row.cost.cost ?? 0);
        prev.mandayContribution +=
          row.cost.kind === "food"
            ? calcFoodMandays({
                breakfastQty: row.cost.breakfastQty,
                lunchQty: row.cost.lunchQty,
                dinnerQty: row.cost.dinnerQty,
                midnightQty: row.cost.midnightQty,
                mealBoxQty: row.cost.mealBoxQty,
              })
            : 0;
        serviceTotals.set(key, prev);
      }
      const eprev = entriesById.get(row.entry.id) ?? {
        entry: row.entry,
        totalCost: 0,
      };
      if (row.cost) eprev.totalCost += Number(row.cost.cost ?? 0);
      entriesById.set(row.entry.id, eprev);
    }

    res.json({
      project: serializeProject({
        project: v.project,
        canViewSummary: v.canViewSummary,
        canEditEntries: v.canEditEntries,
        isAdminOwned: v.isAdminOwned,
      }),
      range: { from, to },
      kpi: kpiOut(kpi),
      serviceBreakdown: Array.from(serviceTotals.values()).map((s) => ({
        serviceName: s.name,
        kind: s.kind,
        totalCost: s.totalCost,
        totalMandayContribution: s.mandayContribution,
      })),
      dailyEntries: Array.from(entriesById.values())
        .sort((a, b) => (a.entry.entryDate < b.entry.entryDate ? 1 : -1))
        .map(({ entry, totalCost }) => {
          const totalMandays = Number(entry.totalMandays);
          return {
            id: entry.id,
            projectId: entry.projectId,
            projectName: v.project!.name,
            entryDate: entry.entryDate,
            location: entry.location,
            totalMandays,
            totalCost,
            costPerManday: safeDivide(totalCost, totalMandays),
            notes: entry.notes,
          };
        }),
    });
  },
);

router.get(
  "/reports/aggregate",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const visible = await listVisibleProjects(req.user!.id, req.user!.role);
    let ids = visible.filter((v) => v.canViewSummary).map((v) => v.project.id);
    if (typeof req.query.projectId === "string") {
      ids = ids.filter((id) => id === req.query.projectId);
    }

    const from =
      typeof req.query.from === "string"
        ? req.query.from
        : dateOnly(startOfMonth(new Date()));
    const to =
      typeof req.query.to === "string"
        ? req.query.to
        : dateOnly(new Date());

    const rows = await fetchJoined(ids, from, to);
    const kpi = newKpi();
    const serviceTotals = new Map<
      string,
      { name: string; kind: "food" | "standard"; totalCost: number; mandayContribution: number }
    >();
    const projectTotals = new Map<
      string,
      {
        projectId: string;
        projectName: string;
        location: string;
        totalCost: number;
        mandays: Map<string, number>;
      }
    >();

    for (const row of rows) {
      accumulate(kpi, row);
      if (row.cost && row.service) {
        const key = row.service.id;
        const prev = serviceTotals.get(key) ?? {
          name: row.service.name,
          kind: row.service.kind as "food" | "standard",
          totalCost: 0,
          mandayContribution: 0,
        };
        prev.totalCost += Number(row.cost.cost ?? 0);
        prev.mandayContribution +=
          row.cost.kind === "food"
            ? calcFoodMandays({
                breakfastQty: row.cost.breakfastQty,
                lunchQty: row.cost.lunchQty,
                dinnerQty: row.cost.dinnerQty,
                midnightQty: row.cost.midnightQty,
                mealBoxQty: row.cost.mealBoxQty,
              })
            : 0;
        serviceTotals.set(key, prev);
      }
      if (row.project) {
        const prev = projectTotals.get(row.project.id) ?? {
          projectId: row.project.id,
          projectName: row.project.name,
          location: row.project.location,
          totalCost: 0,
          mandays: new Map<string, number>(),
        };
        prev.mandays.set(row.entry.id, Number(row.entry.totalMandays));
        if (row.cost) prev.totalCost += Number(row.cost.cost ?? 0);
        projectTotals.set(row.project.id, prev);
      }
    }

    res.json({
      range: { from, to },
      kpi: kpiOut(kpi),
      serviceBreakdown: Array.from(serviceTotals.values()).map((s) => ({
        serviceName: s.name,
        kind: s.kind,
        totalCost: s.totalCost,
        totalMandayContribution: s.mandayContribution,
      })),
      projectBreakdown: Array.from(projectTotals.values()).map((p) => {
        const totalMandays = Array.from(p.mandays.values()).reduce(
          (a, b) => a + b,
          0,
        );
        return {
          projectId: p.projectId,
          projectName: p.projectName,
          location: p.location,
          totalCost: p.totalCost,
          totalMandays,
          costPerManday: safeDivide(p.totalCost, totalMandays),
        };
      }),
    });
  },
);

router.get(
  "/reports/trends",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const visible = await listVisibleProjects(req.user!.id, req.user!.role);
    let ids = visible.filter((v) => v.canViewSummary).map((v) => v.project.id);
    if (typeof req.query.projectId === "string") {
      ids = ids.filter((id) => id === req.query.projectId);
    }

    const from =
      typeof req.query.from === "string"
        ? req.query.from
        : dateOnly(new Date(Date.now() - 29 * 24 * 60 * 60 * 1000));
    const to =
      typeof req.query.to === "string"
        ? req.query.to
        : dateOnly(new Date());

    const rows = await fetchJoined(ids, from, to);

    interface DayBucket {
      mandays: Map<string, number>;
      totalCost: number;
    }
    const byDate = new Map<string, DayBucket>();
    for (const row of rows) {
      const d = row.entry.entryDate;
      const prev = byDate.get(d) ?? { mandays: new Map(), totalCost: 0 };
      prev.mandays.set(row.entry.id, Number(row.entry.totalMandays));
      if (row.cost) prev.totalCost += Number(row.cost.cost ?? 0);
      byDate.set(d, prev);
    }

    const points = Array.from(byDate.entries())
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([date, b]) => {
        const totalMandays = Array.from(b.mandays.values()).reduce(
          (a, x) => a + x,
          0,
        );
        return {
          date,
          totalCost: b.totalCost,
          totalMandays,
          costPerManday: safeDivide(b.totalCost, totalMandays),
        };
      });

    res.json({ range: { from, to }, points });
  },
);

export default router;
