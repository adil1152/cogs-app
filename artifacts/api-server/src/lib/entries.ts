import {
  db,
  dailyEntriesTable,
  serviceCostEntriesTable,
  projectServicesTable,
  projectsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { calcFoodMandays, safeDivide } from "./cogsCalc";

export const FINAL_APPROVAL_LEVEL = 5;

export interface ServiceCostInputItem {
  projectServiceId: string;
  kind: "food" | "standard";
  cost?: number;
  mandays?: number;
  breakfastQty?: number;
  lunchQty?: number;
  dinnerQty?: number;
  midnightQty?: number;
  mealBoxQty?: number;
}

/**
 * Per-service mandays: prefer explicit mandays input, otherwise fall back to
 * the legacy food formula for backward compatibility with rows that only have
 * meal quantities.
 */
export function serviceMandays(sc: {
  mandays?: number | string | null;
  kind?: string | null;
  breakfastQty?: number | null;
  lunchQty?: number | null;
  dinnerQty?: number | null;
  midnightQty?: number | null;
  mealBoxQty?: number | null;
}): number {
  if (sc.mandays != null && sc.mandays !== "") {
    const n = Number(sc.mandays);
    if (!Number.isNaN(n)) return n;
  }
  if (sc.kind === "food") {
    return calcFoodMandays({
      breakfastQty: sc.breakfastQty ?? null,
      lunchQty: sc.lunchQty ?? null,
      dinnerQty: sc.dinnerQty ?? null,
      midnightQty: sc.midnightQty ?? null,
      mealBoxQty: sc.mealBoxQty ?? null,
    });
  }
  return 0;
}

export function computeTotalMandays(
  serviceCosts: ServiceCostInputItem[],
  override: boolean,
  manualValue: number | undefined,
): number {
  if (override && manualValue != null && !Number.isNaN(manualValue)) {
    return manualValue;
  }
  return serviceCosts.reduce((sum, sc) => sum + serviceMandays(sc), 0);
}

export async function buildEntryDetail(entryId: string) {
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
    const mandayContribution = serviceMandays({
      mandays: c.mandays,
      kind: c.kind,
      breakfastQty: c.breakfastQty,
      lunchQty: c.lunchQty,
      dinnerQty: c.dinnerQty,
      midnightQty: c.midnightQty,
      mealBoxQty: c.mealBoxQty,
    });
    return {
      id: c.id,
      projectServiceId: c.projectServiceId,
      serviceName: service?.name ?? "Unknown",
      kind: c.kind as "food" | "standard",
      cost: cVal,
      mandays: c.mandays != null ? Number(c.mandays) : null,
      mandayContribution,
      costPerManday: safeDivide(cVal, mandayContribution),
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
    totalMandaysOverride: entry.totalMandaysOverride,
    status: (entry.status ?? "draft") as "draft" | "pending" | "approved",
    currentApprovalLevel: entry.currentApprovalLevel,
    isLocked: !!entry.lockedAt,
    lockedAt: entry.lockedAt ? entry.lockedAt.toISOString() : null,
    notes: entry.notes,
    sequenceNumber: entry.sequenceNumber,
    sequenceCode: entry.sequenceCode,
    serviceCosts,
  };
}

export async function buildEntrySummary(
  entry: typeof dailyEntriesTable.$inferSelect,
) {
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
    totalMandaysOverride: entry.totalMandaysOverride,
    status: (entry.status ?? "draft") as "draft" | "pending" | "approved",
    currentApprovalLevel: entry.currentApprovalLevel,
    isLocked: !!entry.lockedAt,
    lockedAt: entry.lockedAt ? entry.lockedAt.toISOString() : null,
    notes: entry.notes,
    sequenceNumber: entry.sequenceNumber,
    sequenceCode: entry.sequenceCode,
  };
}

/**
 * Slugify a project name to a max-12-char uppercase sequence prefix.
 * Used as a fallback when the admin hasn't set an explicit project code.
 */
export function slugifyForSequence(name: string): string {
  const slug = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "")
    .slice(0, 12);
  return slug || "PROJ";
}
