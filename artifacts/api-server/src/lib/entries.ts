import {
  db,
  dailyEntriesTable,
  serviceCostEntriesTable,
  projectServicesTable,
  projectsTable,
  entryAttachmentsTable,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { calcFoodMandays, safeDivide } from "./cogsCalc";

export interface ServiceCostInputItem {
  projectServiceId: string;
  kind: "food" | "standard";
  cost?: number;
  mandays?: number;
  manualMandays?: number;
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
  manualMandays?: number | string | null;
  kind?: string | null;
  breakfastQty?: number | null;
  lunchQty?: number | null;
  dinnerQty?: number | null;
  midnightQty?: number | null;
  mealBoxQty?: number | null;
}): number {
  let manual = 0;
  if (sc.manualMandays != null && sc.manualMandays !== "") {
    const n = Number(sc.manualMandays);
    if (!Number.isNaN(n)) manual = n;
  }
  if (sc.mandays != null && sc.mandays !== "") {
    const n = Number(sc.mandays);
    // Stored `mandays` already reflects the manual addition for food rows
    // (computed and persisted by the writer), so do not double-add.
    if (!Number.isNaN(n)) return n;
  }
  if (sc.kind === "food") {
    return (
      calcFoodMandays({
        breakfastQty: sc.breakfastQty ?? null,
        lunchQty: sc.lunchQty ?? null,
        dinnerQty: sc.dinnerQty ?? null,
        midnightQty: sc.midnightQty ?? null,
        mealBoxQty: sc.mealBoxQty ?? null,
      }) + manual
    );
  }
  return manual;
}

export function computeTotalMandays(
  serviceCosts: ServiceCostInputItem[],
  override: boolean,
  overrideValue: number | undefined,
  manualMandays: number | undefined,
): number {
  if (override && overrideValue != null && !Number.isNaN(overrideValue)) {
    return overrideValue;
  }
  const sumFromServices = serviceCosts.reduce(
    (sum, sc) => sum + serviceMandays(sc),
    0,
  );
  const manual =
    manualMandays != null && !Number.isNaN(manualMandays) ? manualMandays : 0;
  return sumFromServices + manual;
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

  const attachmentRows = await db
    .select()
    .from(entryAttachmentsTable)
    .where(eq(entryAttachmentsTable.dailyEntryId, entryId))
    .orderBy(entryAttachmentsTable.uploadedAt);

  const totalMandays = Number(entry.totalMandays);
  let totalCost = 0;
  const serviceCosts = costs.map(({ cost: c, service }) => {
    const cVal = Number(c.cost ?? 0);
    totalCost += cVal;
    const mandayContribution = serviceMandays({
      mandays: c.mandays,
      manualMandays: c.manualMandays,
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
      manualMandays: Number(c.manualMandays ?? 0),
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
    manualMandays: Number(entry.manualMandays ?? 0),
    attachmentCount: attachmentRows.length,
    status: (entry.status ?? "draft") as "draft" | "pending" | "approved",
    currentApprovalLevel: entry.currentApprovalLevel,
    isLocked: !!entry.lockedAt,
    lockedAt: entry.lockedAt ? entry.lockedAt.toISOString() : null,
    notes: entry.notes,
    sequenceNumber: entry.sequenceNumber,
    sequenceCode: entry.sequenceCode,
    serviceCosts,
    attachments: attachmentRows.map((a) => ({
      id: a.id,
      dailyEntryId: a.dailyEntryId,
      objectPath: a.objectPath,
      fileName: a.fileName,
      fileSize: a.fileSize ?? 0,
      mimeType: a.mimeType ?? "",
      uploadedById: a.uploadedById,
      uploadedAt: a.uploadedAt.toISOString(),
    })),
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

  const [attachmentCountRow] = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(entryAttachmentsTable)
    .where(eq(entryAttachmentsTable.dailyEntryId, entry.id));

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
    manualMandays: Number(entry.manualMandays ?? 0),
    attachmentCount: Number(attachmentCountRow?.n ?? 0),
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
