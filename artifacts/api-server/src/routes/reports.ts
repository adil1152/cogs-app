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
import { safeDivide } from "../lib/cogsCalc";
import { serviceMandays } from "../lib/entries";
import { getProjectChain } from "../lib/approvalChain";

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

function parseCsv(v: unknown): string[] | null {
  if (typeof v !== "string") return null;
  const parts = v.split(",").map((s) => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts : null;
}

function rowMandayContribution(row: JoinedRow): number {
  if (!row.cost) return 0;
  return serviceMandays({
    mandays: row.cost.mandays,
    kind: row.cost.kind,
    breakfastQty: row.cost.breakfastQty,
    lunchQty: row.cost.lunchQty,
    dinnerQty: row.cost.dinnerQty,
    midnightQty: row.cost.midnightQty,
    mealBoxQty: row.cost.mealBoxQty,
  });
}

interface KpiAccumulator {
  totalCost: number;
  /**
   * When `useEntryMandays` is true (no service filter), sum entry.totalMandays
   * once per entry. When false (service-filtered), sum the per-row contribution
   * from filtered cost rows so totals reflect the chosen services only.
   */
  entryMandays: Map<string, number>;
  contributedMandays: number;
  entryIds: Set<string>;
}

function newKpi(): KpiAccumulator {
  return {
    totalCost: 0,
    entryMandays: new Map(),
    contributedMandays: 0,
    entryIds: new Set(),
  };
}

function accumulate(k: KpiAccumulator, row: JoinedRow, useEntryMandays: boolean) {
  k.entryIds.add(row.entry.id);
  if (useEntryMandays) {
    k.entryMandays.set(row.entry.id, Number(row.entry.totalMandays));
  } else {
    k.contributedMandays += rowMandayContribution(row);
  }
  if (row.cost) k.totalCost += Number(row.cost.cost ?? 0);
}

function kpiOut(k: KpiAccumulator, useEntryMandays: boolean) {
  const totalMandays = useEntryMandays
    ? Array.from(k.entryMandays.values()).reduce((a, b) => a + b, 0)
    : k.contributedMandays;
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
      if (d === todayStr) accumulate(todayKpi, row, true);
      if (d >= weekStart) accumulate(weekKpi, row, true);
      accumulate(monthKpi, row, true);

      if (row.cost && row.service) {
        const key = `${row.service.id}`;
        const prev = serviceTotals.get(key) ?? {
          name: row.service.name,
          kind: row.service.kind as "food" | "standard",
          totalCost: 0,
          mandayContribution: 0,
        };
        prev.totalCost += Number(row.cost.cost ?? 0);
        prev.mandayContribution += rowMandayContribution(row);
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
      today: kpiOut(todayKpi, true),
      weekToDate: kpiOut(weekKpi, true),
      monthToDate: kpiOut(monthKpi, true),
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

    const serviceFilter = parseCsv(req.query.serviceIds);
    const serviceFilterSet = serviceFilter ? new Set(serviceFilter) : null;
    const useEntryMandays = serviceFilterSet === null;

    const [allRows, chain] = await Promise.all([
      fetchJoined([(req.params.id as string)], from, to),
      getProjectChain(v.project.id),
    ]);
    const rows = serviceFilterSet
      ? allRows.filter(
          (r) => !r.cost || (r.service && serviceFilterSet.has(r.service.id)),
        )
      : allRows;

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
        contributedMandays: number;
        hasUsableCost: boolean;
      }
    >();

    for (const row of rows) {
      const hasUsableCost =
        !!row.cost &&
        (!serviceFilterSet || (!!row.service && serviceFilterSet.has(row.service.id)));

      if (hasUsableCost || !serviceFilterSet) {
        accumulate(kpi, row, useEntryMandays);
      }

      if (hasUsableCost && row.service) {
        const key = row.service.id;
        const prev = serviceTotals.get(key) ?? {
          name: row.service.name,
          kind: row.service.kind as "food" | "standard",
          totalCost: 0,
          mandayContribution: 0,
        };
        prev.totalCost += Number(row.cost!.cost ?? 0);
        prev.mandayContribution += rowMandayContribution(row);
        serviceTotals.set(key, prev);
      }

      const eprev = entriesById.get(row.entry.id) ?? {
        entry: row.entry,
        totalCost: 0,
        contributedMandays: 0,
        hasUsableCost: false,
      };
      if (hasUsableCost) {
        eprev.totalCost += Number(row.cost!.cost ?? 0);
        eprev.contributedMandays += rowMandayContribution(row);
        eprev.hasUsableCost = true;
      }
      entriesById.set(row.entry.id, eprev);
    }

    res.json({
      project: serializeProject(
        {
          project: v.project,
          canViewSummary: v.canViewSummary,
          canEditEntries: v.canEditEntries,
          canResetApproval: v.canResetApproval,
          isAdminOwned: v.isAdminOwned,
        },
        chain,
      ),
      range: { from, to },
      kpi: kpiOut(kpi, useEntryMandays),
      serviceBreakdown: Array.from(serviceTotals.values()).map((s) => ({
        serviceName: s.name,
        kind: s.kind,
        totalCost: s.totalCost,
        totalMandayContribution: s.mandayContribution,
      })),
      dailyEntries: Array.from(entriesById.values())
        // When service-filtered, omit entries whose costs were all filtered out.
        .filter((e) => !serviceFilterSet || e.hasUsableCost)
        .sort((a, b) => (a.entry.entryDate < b.entry.entryDate ? 1 : -1))
        .map(({ entry, totalCost, contributedMandays }) => {
          const totalMandays = useEntryMandays
            ? Number(entry.totalMandays)
            : contributedMandays;
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

    const projectFilter = parseCsv(req.query.projectIds);
    if (projectFilter) {
      const wanted = new Set(projectFilter);
      ids = ids.filter((id) => wanted.has(id));
    }

    const serviceFilter = parseCsv(req.query.serviceIds);
    const serviceFilterSet = serviceFilter ? new Set(serviceFilter) : null;
    const useEntryMandays = serviceFilterSet === null;

    const from =
      typeof req.query.from === "string"
        ? req.query.from
        : dateOnly(startOfMonth(new Date()));
    const to =
      typeof req.query.to === "string"
        ? req.query.to
        : dateOnly(new Date());

    const allRows = await fetchJoined(ids, from, to);
    // Apply service filter at the row level (only count cost rows for the
    // chosen services). We still need entry rows for KPI entry counts even
    // when their costs are filtered out.
    const rows = serviceFilterSet
      ? allRows.filter(
          (r) => !r.cost || (r.service && serviceFilterSet.has(r.service.id)),
        )
      : allRows;

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
        entryMandays: Map<string, number>;
        contributedMandays: number;
      }
    >();

    for (const row of rows) {
      // Skip rows whose cost was filtered out for cost/manday accumulation,
      // but still count entries that had at least one matching service row.
      const hasUsableCost = row.cost && (!serviceFilterSet || (row.service && serviceFilterSet.has(row.service.id)));

      if (hasUsableCost || !serviceFilterSet) {
        accumulate(kpi, row, useEntryMandays);
      }

      if (hasUsableCost && row.service) {
        const key = row.service.id;
        const prev = serviceTotals.get(key) ?? {
          name: row.service.name,
          kind: row.service.kind as "food" | "standard",
          totalCost: 0,
          mandayContribution: 0,
        };
        prev.totalCost += Number(row.cost!.cost ?? 0);
        prev.mandayContribution += rowMandayContribution(row);
        serviceTotals.set(key, prev);
      }

      if (row.project) {
        const prev = projectTotals.get(row.project.id) ?? {
          projectId: row.project.id,
          projectName: row.project.name,
          location: row.project.location,
          totalCost: 0,
          entryMandays: new Map<string, number>(),
          contributedMandays: 0,
        };
        if (useEntryMandays) {
          prev.entryMandays.set(row.entry.id, Number(row.entry.totalMandays));
        } else if (hasUsableCost) {
          prev.contributedMandays += rowMandayContribution(row);
        }
        if (hasUsableCost) prev.totalCost += Number(row.cost!.cost ?? 0);
        projectTotals.set(row.project.id, prev);
      }
    }

    res.json({
      range: { from, to },
      kpi: kpiOut(kpi, useEntryMandays),
      serviceBreakdown: Array.from(serviceTotals.values()).map((s) => ({
        serviceName: s.name,
        kind: s.kind,
        totalCost: s.totalCost,
        totalMandayContribution: s.mandayContribution,
      })),
      projectBreakdown: Array.from(projectTotals.values())
        .filter((p) => p.totalCost > 0 || p.entryMandays.size > 0 || p.contributedMandays > 0)
        .map((p) => {
          const totalMandays = useEntryMandays
            ? Array.from(p.entryMandays.values()).reduce((a, b) => a + b, 0)
            : p.contributedMandays;
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

    const projectFilter = parseCsv(req.query.projectIds);
    if (projectFilter) {
      const wanted = new Set(projectFilter);
      ids = ids.filter((id) => wanted.has(id));
    }

    const serviceFilter = parseCsv(req.query.serviceIds);
    const serviceFilterSet = serviceFilter ? new Set(serviceFilter) : null;
    const useEntryMandays = serviceFilterSet === null;

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
      entryMandays: Map<string, number>;
      contributedMandays: number;
      totalCost: number;
    }

    const byDate = new Map<string, DayBucket>();
    for (const row of rows) {
      const hasUsableCost = row.cost && (!serviceFilterSet || (row.service && serviceFilterSet.has(row.service.id)));

      const d = row.entry.entryDate;
      const prev = byDate.get(d) ?? {
        entryMandays: new Map(),
        contributedMandays: 0,
        totalCost: 0,
      };
      if (useEntryMandays) {
        prev.entryMandays.set(row.entry.id, Number(row.entry.totalMandays));
      } else if (hasUsableCost) {
        prev.contributedMandays += rowMandayContribution(row);
      }
      if (hasUsableCost) prev.totalCost += Number(row.cost!.cost ?? 0);
      byDate.set(d, prev);
    }

    const points = Array.from(byDate.entries())
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([date, b]) => {
        const totalMandays = useEntryMandays
          ? Array.from(b.entryMandays.values()).reduce((a, x) => a + x, 0)
          : b.contributedMandays;
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
