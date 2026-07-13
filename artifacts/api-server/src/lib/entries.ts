import {
  db,
  dailyEntriesTable,
  serviceCostEntriesTable,
  projectServicesTable,
  projectsTable,
  serviceSubItemsTable,
  subServiceCostEntriesTable,
  mealCostEntriesTable,
  entryAttachmentsTable,
} from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";
import { calcMealRowsMandays, safeDivide } from "./cogsCalc";

export type ServiceKind = "food" | "standard" | "group";

export interface SubServiceCostInputItem {
  subItemId: string;
  cost?: number;
  mandays?: number;
}

export interface MealQuantityInputItem {
  mealItemId?: string | null;
  name?: string;
  qty: number;
}

/**
 * A meal row after the writer resolved its snapshot name + weight. The
 * resolution happens server-side (never trusting client name/weight):
 * either from the service's current meal item, or — when editing — from the
 * entry's previously saved snapshot so historical weights are preserved.
 */
export interface ResolvedMealRow {
  mealItemId: string | null;
  name: string;
  weight: number;
  qty: number;
  sortOrder: number;
}

export interface ServiceCostInputItem {
  projectServiceId: string;
  kind: ServiceKind;
  cost?: number;
  mandays?: number;
  manualMandays?: number;
  mealQuantities?: MealQuantityInputItem[];
  /** Populated by the writer (routes) before totals are computed. */
  resolvedMealRows?: ResolvedMealRow[];
  subCosts?: SubServiceCostInputItem[];
}

/**
 * For a "group" service line, the parent row's cost is the sum of its
 * sub-item costs and its mandays is the sum of sub-item mandays plus the
 * service-level manualMandays. Writers must persist these on the parent
 * row so all read paths (reports, dashboards) can keep using the parent
 * row totals without joining sub_service_cost_entries.
 */
export function computeGroupCost(sc: ServiceCostInputItem): number {
  if (!sc.subCosts || sc.subCosts.length === 0) return 0;
  return sc.subCosts.reduce((s, r) => s + Number(r.cost ?? 0), 0);
}

export function computeGroupMandays(sc: ServiceCostInputItem): number {
  const sub = (sc.subCosts ?? []).reduce(
    (s, r) => s + Number(r.mandays ?? 0),
    0,
  );
  const manual =
    sc.manualMandays != null && !Number.isNaN(sc.manualMandays)
      ? sc.manualMandays
      : 0;
  return sub + manual;
}

/**
 * Per-service mandays for read paths. Every writer persists the computed
 * total (auto + manual) on the row, and the migration backfilled legacy
 * rows, so the stored value is authoritative.
 */
export function serviceMandays(sc: {
  mandays?: number | string | null;
  manualMandays?: number | string | null;
  kind?: string | null;
}): number {
  if (sc.mandays != null && sc.mandays !== "") {
    const n = Number(sc.mandays);
    // Stored `mandays` already reflects the manual addition for food/group rows
    // (computed and persisted by the writer), so do not double-add.
    if (!Number.isNaN(n)) return n;
  }
  if (sc.manualMandays != null && sc.manualMandays !== "") {
    const n = Number(sc.manualMandays);
    if (!Number.isNaN(n)) return n;
  }
  return 0;
}

/**
 * Per-input mandays during write: use the kind-specific formula. For "group"
 * the writer has not yet persisted `mandays`, so we compute it from subCosts.
 * For "food" the writer must have resolved meal rows first; the computed
 * value (sum of qty x snapshot weight + manual) is authoritative and any
 * client-provided mandays is ignored.
 */
function inputMandays(sc: ServiceCostInputItem): number {
  if (sc.kind === "group") return computeGroupMandays(sc);
  const manual =
    sc.manualMandays != null && !Number.isNaN(sc.manualMandays)
      ? sc.manualMandays
      : 0;
  if (sc.kind === "food") {
    if (sc.resolvedMealRows) {
      return calcMealRowsMandays(sc.resolvedMealRows) + manual;
    }
    // No resolution happened (e.g. recomputing from already-stored rows):
    // the stored mandays already includes the manual addition.
    if (sc.mandays != null && !Number.isNaN(sc.mandays)) {
      return Number(sc.mandays);
    }
    return manual;
  }
  if (sc.mandays != null && !Number.isNaN(sc.mandays)) return Number(sc.mandays);
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
    (sum, sc) => sum + inputMandays(sc),
    0,
  );
  const manual =
    manualMandays != null && !Number.isNaN(manualMandays) ? manualMandays : 0;
  return sumFromServices + manual;
}

/**
 * For writers: derive the parent service_cost_entries row's stored cost +
 * mandays values from the input. Group services derive both from subCosts
 * regardless of any incoming cost/mandays fields.
 */
export function deriveParentRow(sc: ServiceCostInputItem): {
  cost: number;
  mandays: number | null;
} {
  if (sc.kind === "group") {
    return { cost: computeGroupCost(sc), mandays: computeGroupMandays(sc) };
  }
  if (sc.kind === "food") {
    // Authoritative: computed from resolved snapshot meal rows + manual.
    return { cost: Number(sc.cost ?? 0), mandays: inputMandays(sc) };
  }
  return {
    cost: Number(sc.cost ?? 0),
    mandays: sc.mandays != null ? Number(sc.mandays) : null,
  };
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

  // Fetch sub-item rows for any group cost entries on this entry.
  const costIds = costs.map((c) => c.cost.id);
  const subRows = costIds.length
    ? await db
        .select({
          row: subServiceCostEntriesTable,
          item: serviceSubItemsTable,
        })
        .from(subServiceCostEntriesTable)
        .leftJoin(
          serviceSubItemsTable,
          eq(serviceSubItemsTable.id, subServiceCostEntriesTable.subItemId),
        )
        .where(inArray(subServiceCostEntriesTable.serviceCostEntryId, costIds))
    : [];
  const subsByParent = new Map<
    string,
    Array<{
      subItemId: string;
      subItemName: string;
      cost: number;
      mandays: number;
      sortOrder: number;
    }>
  >();
  for (const { row, item } of subRows) {
    const list = subsByParent.get(row.serviceCostEntryId) ?? [];
    list.push({
      subItemId: row.subItemId,
      subItemName: item?.name ?? "Unknown",
      cost: Number(row.cost ?? 0),
      mandays: Number(row.mandays ?? 0),
      sortOrder: item?.sortOrder ?? 0,
    });
    subsByParent.set(row.serviceCostEntryId, list);
  }

  // Fetch snapshot meal rows for any food cost entries on this entry.
  const mealRows = costIds.length
    ? await db
        .select()
        .from(mealCostEntriesTable)
        .where(inArray(mealCostEntriesTable.serviceCostEntryId, costIds))
    : [];
  const mealsByParent = new Map<
    string,
    Array<{
      mealItemId: string | null;
      name: string;
      weight: number;
      qty: number;
      sortOrder: number;
    }>
  >();
  for (const m of mealRows) {
    const list = mealsByParent.get(m.serviceCostEntryId) ?? [];
    list.push({
      mealItemId: m.mealItemId,
      name: m.name,
      weight: Number(m.weight),
      qty: m.qty,
      sortOrder: m.sortOrder,
    });
    mealsByParent.set(m.serviceCostEntryId, list);
  }

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
    });
    const subs = (subsByParent.get(c.id) ?? [])
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(({ sortOrder: _s, ...rest }) => rest);
    const meals = (mealsByParent.get(c.id) ?? [])
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(({ sortOrder: _s, ...rest }) => rest);
    return {
      id: c.id,
      projectServiceId: c.projectServiceId,
      serviceName: service?.name ?? "Unknown",
      kind: c.kind as ServiceKind,
      cost: cVal,
      mandays: c.mandays != null ? Number(c.mandays) : null,
      manualMandays: Number(c.manualMandays ?? 0),
      mandayContribution,
      costPerManday: safeDivide(cVal, mandayContribution),
      mealQuantities: meals,
      subCosts: subs,
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
