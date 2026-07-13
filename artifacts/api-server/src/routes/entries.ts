import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  dailyEntriesTable,
  entryApprovalsTable,
  entryAttachmentsTable,
  foodMealItemsTable,
  mealCostEntriesTable,
  projectsTable,
  projectServicesTable,
  serviceCostEntriesTable,
  serviceSubItemsTable,
  subServiceCostEntriesTable,
} from "@workspace/db";
import { and, eq, gte, lte, desc, isNull, inArray, sql } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
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
  deriveParentRow,
  slugifyForSequence,
  type ServiceCostInputItem,
} from "../lib/entries";
import { diffSnapshots, listEntryAudit, recordAudit } from "../lib/audit";

/** Thrown by `insertServiceCosts` when sub-item refs don't belong to the parent. */
class SubItemIntegrityError extends Error {}

/**
 * A previously saved snapshot meal row, keyed for reuse during entry edits.
 */
interface PriorMealRow {
  mealItemId: string | null;
  name: string;
  weight: number;
  sortOrder: number;
}

/**
 * Resolve each food line's `mealQuantities` into `resolvedMealRows` with a
 * server-side snapshot of name + weight. Client-provided name/weight are
 * never trusted for numbers:
 *
 * - A row with `mealItemId` reuses the entry's prior snapshot for that meal
 *   item when one exists (edits keep the weights the entry was saved with);
 *   otherwise it snapshots the service meal item's current name + weight.
 * - A row with a null `mealItemId` is only valid while editing, for a meal
 *   type that was deleted from the service after the entry was saved. It is
 *   matched by `name` against the entry's prior snapshot rows.
 *
 * Also clears client-sent `mandays` on food lines so the computed value
 * (sum of qty x weight + manualMandays) is authoritative.
 */
async function resolveMealRows(
  serviceCosts: ServiceCostInputItem[],
  priorByService?: Map<string, PriorMealRow[]>,
): Promise<void> {
  const foodLines = serviceCosts.filter((sc) => sc.kind === "food");
  if (foodLines.length === 0) return;

  const serviceIds = Array.from(
    new Set(foodLines.map((sc) => sc.projectServiceId)),
  );
  const items = await db
    .select()
    .from(foodMealItemsTable)
    .where(inArray(foodMealItemsTable.projectServiceId, serviceIds));
  const itemsById = new Map(items.map((i) => [i.id, i]));

  for (const sc of foodLines) {
    const prior = priorByService?.get(sc.projectServiceId) ?? [];
    const resolved: typeof sc.resolvedMealRows = [];
    const seen = new Set<string>();
    for (const mq of sc.mealQuantities ?? []) {
      const qty = Number(mq.qty);
      if (!Number.isFinite(qty) || qty < 0) {
        throw new SubItemIntegrityError("Invalid meal quantity");
      }
      if (mq.mealItemId != null) {
        const key = `id:${mq.mealItemId}`;
        if (seen.has(key)) {
          throw new SubItemIntegrityError(
            "Duplicate meal type in a food service",
          );
        }
        seen.add(key);
        const priorRow = prior.find((p) => p.mealItemId === mq.mealItemId);
        if (priorRow) {
          resolved.push({
            mealItemId: mq.mealItemId,
            name: priorRow.name,
            weight: priorRow.weight,
            qty,
            sortOrder: priorRow.sortOrder,
          });
          continue;
        }
        const item = itemsById.get(mq.mealItemId);
        if (!item || item.projectServiceId !== sc.projectServiceId) {
          throw new SubItemIntegrityError(
            "One or more meal types do not belong to their food service",
          );
        }
        resolved.push({
          mealItemId: item.id,
          name: item.name,
          weight: Number(item.weight),
          qty,
          sortOrder: item.sortOrder,
        });
      } else {
        // Snapshot-only row (meal type deleted from the service). Match by
        // name against the entry's previously saved rows.
        const name = (mq.name ?? "").trim();
        const key = `name:${name.toLowerCase()}`;
        if (!name || seen.has(key)) {
          throw new SubItemIntegrityError(
            "Invalid or duplicate snapshot meal row",
          );
        }
        seen.add(key);
        const priorRow = prior.find(
          (p) => p.mealItemId === null && p.name === name,
        );
        if (!priorRow) {
          throw new SubItemIntegrityError(
            `Meal type "${name}" is not part of this entry's saved data`,
          );
        }
        resolved.push({
          mealItemId: null,
          name: priorRow.name,
          weight: priorRow.weight,
          qty,
          sortOrder: priorRow.sortOrder,
        });
      }
    }
    resolved.sort((a, b) => a.sortOrder - b.sortOrder);
    sc.resolvedMealRows = resolved;
    // The computed food mandays (rows + manual) is authoritative.
    delete sc.mandays;
  }
}

/** Insert parent service_cost_entries rows + their sub_service_cost_entries. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function insertServiceCosts(
  tx: PgTransaction<any, any, any>,
  dailyEntryId: string,
  projectId: string,
  serviceCosts: ServiceCostInputItem[],
): Promise<void> {
  if (serviceCosts.length === 0) return;
  // Integrity: every projectServiceId must belong to this entry's project.
  // Without this, a known service id from a different project could be
  // attached to this entry, leaking data across project boundaries.
  const serviceIds = Array.from(
    new Set(serviceCosts.map((sc) => sc.projectServiceId)),
  );
  const owned = await tx
    .select({ id: projectServicesTable.id })
    .from(projectServicesTable)
    .where(
      and(
        eq(projectServicesTable.projectId, projectId),
        inArray(projectServicesTable.id, serviceIds),
      ),
    );
  if (owned.length !== serviceIds.length) {
    throw new SubItemIntegrityError(
      "One or more services do not belong to this project",
    );
  }
  // Integrity: every subItemId must belong to its parent projectServiceId.
  // Without this, a malicious or buggy client could attach historical sub-rows
  // to the wrong service (cross-service or cross-project linkage).
  const groupRows = serviceCosts.filter(
    (sc) => sc.kind === "group" && sc.subCosts && sc.subCosts.length > 0,
  );
  if (groupRows.length > 0) {
    for (const sc of groupRows) {
      const subIds = (sc.subCosts ?? []).map((s) => s.subItemId);
      if (new Set(subIds).size !== subIds.length) {
        throw new SubItemIntegrityError(
          "Duplicate subItemId in a group service",
        );
      }
      const valid = await tx
        .select({ id: serviceSubItemsTable.id })
        .from(serviceSubItemsTable)
        .where(
          and(
            eq(serviceSubItemsTable.projectServiceId, sc.projectServiceId),
            inArray(serviceSubItemsTable.id, subIds),
          ),
        );
      if (valid.length !== subIds.length) {
        throw new SubItemIntegrityError(
          "One or more sub-items do not belong to their parent service",
        );
      }
    }
  }
  const inserted = await tx
    .insert(serviceCostEntriesTable)
    .values(
      serviceCosts.map((sc) => {
        const { cost, mandays } = deriveParentRow(sc);
        return {
          dailyEntryId,
          projectServiceId: sc.projectServiceId,
          kind: sc.kind,
          cost: String(cost),
          mandays: mandays != null ? String(mandays) : null,
          manualMandays: String(sc.manualMandays ?? 0),
        };
      }),
    )
    .returning({
      id: serviceCostEntriesTable.id,
      projectServiceId: serviceCostEntriesTable.projectServiceId,
    });

  // Map parent input → its inserted row id (positional, since the same project
  // service can only appear once per daily entry — there is no unique constraint
  // here but the UI prevents duplicates and orderings line up positionally).
  const subValues: Array<{
    serviceCostEntryId: string;
    subItemId: string;
    cost: string;
    mandays: string;
  }> = [];
  for (let i = 0; i < serviceCosts.length; i++) {
    const sc = serviceCosts[i];
    if (sc.kind !== "group" || !sc.subCosts || sc.subCosts.length === 0) continue;
    const parentId = inserted[i].id;
    for (const sub of sc.subCosts) {
      subValues.push({
        serviceCostEntryId: parentId,
        subItemId: sub.subItemId,
        cost: String(sub.cost ?? 0),
        mandays: String(sub.mandays ?? 0),
      });
    }
  }
  if (subValues.length > 0) {
    await tx.insert(subServiceCostEntriesTable).values(subValues);
  }

  // Insert snapshot meal rows for food lines (resolved by `resolveMealRows`).
  const mealValues: Array<{
    serviceCostEntryId: string;
    mealItemId: string | null;
    name: string;
    weight: string;
    qty: number;
    sortOrder: number;
  }> = [];
  for (let i = 0; i < serviceCosts.length; i++) {
    const sc = serviceCosts[i];
    if (sc.kind !== "food" || !sc.resolvedMealRows?.length) continue;
    const parentId = inserted[i].id;
    for (const row of sc.resolvedMealRows) {
      mealValues.push({
        serviceCostEntryId: parentId,
        mealItemId: row.mealItemId,
        name: row.name,
        weight: String(row.weight),
        qty: row.qty,
        sortOrder: row.sortOrder,
      });
    }
  }
  if (mealValues.length > 0) {
    await tx.insert(mealCostEntriesTable).values(mealValues);
  }
}

const router: IRouter = Router();

function asDateString(d: Date | string): string {
  return d instanceof Date ? d.toISOString().slice(0, 10) : d;
}

function pad4(n: number): string {
  return n.toString().padStart(4, "0");
}

/**
 * Checks a non-admin's entry date against the project's backdated/future
 * window. Returns an error message when out of range, or null when allowed.
 * NULL limits mean "no restriction on that side"; 0 blocks that side fully.
 */
function entryDateWindowError(
  project: { backdatedDays?: number | null; futureDays?: number | null },
  entryDate: string,
): string | null {
  const backdatedDays = project.backdatedDays ?? null;
  const futureDays = project.futureDays ?? null;
  if (backdatedDays === null && futureDays === null) return null;

  // "Today" anchored to the business timezone (Saudi Arabia) so the window
  // matches what local users see on their calendar, not the UTC day.
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
  }).format(new Date());
  const diffDays = Math.round(
    (Date.parse(entryDate) - Date.parse(today)) / 86400000,
  );
  if (Number.isNaN(diffDays)) return "Invalid entry date";

  if (backdatedDays !== null && diffDays < -backdatedDays) {
    return backdatedDays === 0
      ? "Backdated entries are not allowed on this project"
      : `Entries can only be backdated up to ${backdatedDays} day${backdatedDays === 1 ? "" : "s"} on this project`;
  }
  if (futureDays !== null && diffDays > futureDays) {
    return futureDays === 0
      ? "Future-dated entries are not allowed on this project"
      : `Entries can only be dated up to ${futureDays} day${futureDays === 1 ? "" : "s"} ahead on this project`;
  }
  return null;
}

const VALID_STATUSES = new Set(["draft", "pending", "approved"]);

export function parseStatuses(v: unknown): string[] | null {
  if (typeof v !== "string") return null;
  const parts = v
    .split(",")
    .map((s) => s.trim())
    .filter((s) => VALID_STATUSES.has(s));
  return parts.length > 0 ? parts : null;
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
    const statuses = parseStatuses(req.query.statuses);
    if (statuses) conds.push(inArray(dailyEntriesTable.status, statuses));

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
    const projectId = req.params.id as string;
    const v = await getProjectVisibility(
      req.user!.id,
      req.user!.role,
      projectId,
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

    if (req.user!.role !== "admin") {
      const windowError = entryDateWindowError(
        v.project,
        asDateString(parsed.data.entryDate),
      );
      if (windowError) {
        res.status(403).json({ error: windowError });
        return;
      }
    }

    const override = !!parsed.data.totalMandaysOverride;
    const serviceCosts = parsed.data.serviceCosts as ServiceCostInputItem[];
    try {
      await resolveMealRows(serviceCosts);
    } catch (e) {
      if (e instanceof SubItemIntegrityError) {
        res.status(400).json({ error: e.message });
        return;
      }
      throw e;
    }
    const manualMandays = parsed.data.manualMandays ?? 0;
    const totalMandays = computeTotalMandays(
      serviceCosts,
      override,
      parsed.data.totalMandays,
      manualMandays,
    );

    const prefix = v.project.code ?? slugifyForSequence(v.project.name);

    // Race-safe sequence allocation: try MAX+1 inside the same transaction; if
    // a concurrent insert beat us to that number the unique index throws 23505
    // and we retry with a fresh MAX.
    const MAX_RETRIES = 5;
    let createdId: string | null = null;
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < MAX_RETRIES && !createdId; attempt++) {
      try {
        await db.transaction(async (tx) => {
          const [maxRow] = await tx
            .select({
              max: sql<number | null>`MAX(${dailyEntriesTable.sequenceNumber})`,
            })
            .from(dailyEntriesTable)
            .where(eq(dailyEntriesTable.projectId, projectId));
          const nextSeq = (maxRow?.max ?? 0) + 1;
          const sequenceCode = `${prefix}-${pad4(nextSeq)}`;

          const [entry] = await tx
            .insert(dailyEntriesTable)
            .values({
              projectId,
              entryDate: asDateString(parsed.data.entryDate),
              location: parsed.data.location,
              totalMandays: String(totalMandays),
              totalMandaysOverride: override,
              manualMandays: String(manualMandays),
              notes: parsed.data.notes ?? null,
              sequenceNumber: nextSeq,
              sequenceCode,
              createdById: req.user!.id,
            })
            .returning();

          await insertServiceCosts(tx, entry.id, projectId, serviceCosts);

          await recordAudit(
            {
              dailyEntryId: entry.id,
              projectId,
              action: "CREATE",
              actorId: req.user!.id,
              field: "sequenceCode",
              newValue: sequenceCode,
            },
            tx,
          );
          createdId = entry.id;
        });
      } catch (e) {
        lastErr = e;
        if (e instanceof SubItemIntegrityError) {
          res.status(400).json({ error: e.message });
          return;
        }
        if ((e as { code?: string }).code === "23505") continue; // sequence collision — retry
        throw e;
      }
    }
    if (!createdId) {
      req.log.error(
        { err: lastErr, projectId },
        "Failed to allocate entry sequence after retries",
      );
      res
        .status(503)
        .json({ error: "Could not allocate sequence — please retry" });
      return;
    }

    res.status(201).json(await buildEntryDetail(createdId));
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

    if (
      req.user!.role !== "admin" &&
      parsed.data.entryDate !== undefined &&
      asDateString(parsed.data.entryDate) !== entry.entryDate &&
      v.project
    ) {
      const windowError = entryDateWindowError(
        v.project,
        asDateString(parsed.data.entryDate),
      );
      if (windowError) {
        res.status(403).json({ error: windowError });
        return;
      }
    }

    // Snapshot of cost rows for audit diff (compared as JSON strings).
    const beforeCosts = await db
      .select()
      .from(serviceCostEntriesTable)
      .where(eq(serviceCostEntriesTable.dailyEntryId, id))
      .orderBy(serviceCostEntriesTable.projectServiceId);

    // The entry's saved snapshot meal rows, keyed by projectServiceId, so
    // edits can preserve the name + weight the entry was saved with even if
    // the service's meal items changed (or were deleted) since.
    const beforeCostIds = beforeCosts.map((c) => c.id);
    const priorMealRowsRaw = beforeCostIds.length
      ? await db
          .select()
          .from(mealCostEntriesTable)
          .where(inArray(mealCostEntriesTable.serviceCostEntryId, beforeCostIds))
      : [];
    const costRowToService = new Map(
      beforeCosts.map((c) => [c.id, c.projectServiceId]),
    );
    const priorByService = new Map<string, PriorMealRow[]>();
    const mealsByCostRow = new Map<
      string,
      Array<{ mealItemId: string | null; name: string; weight: number; qty: number }>
    >();
    for (const m of priorMealRowsRaw) {
      const serviceId = costRowToService.get(m.serviceCostEntryId);
      if (serviceId) {
        const list = priorByService.get(serviceId) ?? [];
        list.push({
          mealItemId: m.mealItemId,
          name: m.name,
          weight: Number(m.weight),
          sortOrder: m.sortOrder,
        });
        priorByService.set(serviceId, list);
      }
      const rows = mealsByCostRow.get(m.serviceCostEntryId) ?? [];
      rows.push({
        mealItemId: m.mealItemId,
        name: m.name,
        weight: Number(m.weight),
        qty: m.qty,
      });
      mealsByCostRow.set(m.serviceCostEntryId, rows);
    }

    if (parsed.data.serviceCosts !== undefined) {
      try {
        await resolveMealRows(
          parsed.data.serviceCosts as ServiceCostInputItem[],
          priorByService,
        );
      } catch (e) {
        if (e instanceof SubItemIntegrityError) {
          res.status(400).json({ error: e.message });
          return;
        }
        throw e;
      }
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

        const manualAfter =
          parsed.data.manualMandays ?? Number(entry.manualMandays ?? 0);
        if (parsed.data.manualMandays !== undefined) {
          data.manualMandays = String(parsed.data.manualMandays);
        }

        if (parsed.data.serviceCosts !== undefined) {
          const tm = computeTotalMandays(
            parsed.data.serviceCosts as ServiceCostInputItem[],
            overrideAfter,
            parsed.data.totalMandays,
            manualAfter,
          );
          data.totalMandays = String(tm);
        } else if (overrideAfter && parsed.data.totalMandays !== undefined) {
          data.totalMandays = String(parsed.data.totalMandays);
        } else if (
          parsed.data.manualMandays !== undefined &&
          !overrideAfter
        ) {
          // Recompute by re-reading existing service cost rows.
          const existing = await tx
            .select()
            .from(serviceCostEntriesTable)
            .where(eq(serviceCostEntriesTable.dailyEntryId, id));
          const tm = computeTotalMandays(
            existing.map((c) => ({
              projectServiceId: c.projectServiceId,
              kind: c.kind as "food" | "standard" | "group",
              cost: Number(c.cost ?? 0),
              mandays: c.mandays != null ? Number(c.mandays) : undefined,
              manualMandays: Number(c.manualMandays ?? 0),
            })),
            false,
            undefined,
            manualAfter,
          );
          data.totalMandays = String(tm);
        }

        data.updatedAt = new Date();

        // Editing a pending entry performs a full workflow reset so that any
        // prior approvals don't carry forward to the modified data. The user
        // must re-submit and approvals must restart from level 0. Approved
        // (locked) entries are blocked from edit above; drafts are untouched.
        const prevStatus = entry.status ?? "draft";
        const resetWorkflow = prevStatus === "pending";
        if (resetWorkflow) {
          data.status = "draft";
          data.currentApprovalLevel = 0;
          data.lockedAt = null;
        }

        const beforeSnap: Record<string, unknown> = {
          entryDate: entry.entryDate,
          location: entry.location,
          notes: entry.notes,
          totalMandaysOverride: entry.totalMandaysOverride,
          totalMandays: Number(entry.totalMandays),
          status: prevStatus,
        };
        const afterSnap: Record<string, unknown> = {
          ...beforeSnap,
          ...(data.entryDate !== undefined ? { entryDate: data.entryDate } : {}),
          ...(data.location !== undefined ? { location: data.location } : {}),
          ...(data.notes !== undefined ? { notes: data.notes } : {}),
          ...(data.totalMandaysOverride !== undefined
            ? { totalMandaysOverride: data.totalMandaysOverride }
            : {}),
          ...(data.totalMandays !== undefined
            ? { totalMandays: Number(data.totalMandays) }
            : {}),
          ...(data.status !== undefined ? { status: data.status } : {}),
        };

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
            throw new LockedConflict(
              "Entry was locked — refresh to see changes",
            );
          }
        }

        if (resetWorkflow) {
          await tx
            .delete(entryApprovalsTable)
            .where(eq(entryApprovalsTable.dailyEntryId, id));
        }

        if (parsed.data.serviceCosts !== undefined) {
          await tx
            .delete(serviceCostEntriesTable)
            .where(eq(serviceCostEntriesTable.dailyEntryId, id));
          await insertServiceCosts(
            tx,
            id,
            entry.projectId,
            parsed.data.serviceCosts as ServiceCostInputItem[],
          );
        }

        const events = diffSnapshots(beforeSnap, afterSnap, {
          dailyEntryId: id,
          projectId: entry.projectId,
          actorId: req.user!.id,
        });

        if (parsed.data.serviceCosts !== undefined) {
          const beforeJson = JSON.stringify(
            beforeCosts.map((c) => ({
              projectServiceId: c.projectServiceId,
              kind: c.kind,
              cost: Number(c.cost ?? 0),
              mandays: c.mandays != null ? Number(c.mandays) : null,
              manualMandays: Number(c.manualMandays ?? 0),
              mealQuantities: (mealsByCostRow.get(c.id) ?? []).map((m) => ({
                name: m.name,
                weight: m.weight,
                qty: m.qty,
              })),
            })),
          );
          const afterJson = JSON.stringify(
            (parsed.data.serviceCosts as ServiceCostInputItem[])
              .slice()
              .sort((a, b) =>
                a.projectServiceId.localeCompare(b.projectServiceId),
              )
              .map((c) => {
                const { mandays } = deriveParentRow(c);
                return {
                  projectServiceId: c.projectServiceId,
                  kind: c.kind,
                  cost: Number(c.cost ?? 0),
                  mandays,
                  manualMandays: Number(c.manualMandays ?? 0),
                  mealQuantities: (c.resolvedMealRows ?? []).map((m) => ({
                    name: m.name,
                    weight: m.weight,
                    qty: m.qty,
                  })),
                };
              }),
          );
          if (beforeJson !== afterJson) {
            events.push({
              dailyEntryId: id,
              projectId: entry.projectId,
              action: "UPDATE",
              actorId: req.user!.id,
              field: "serviceCosts",
              oldValue: beforeJson,
              newValue: afterJson,
            });
          }
        }

        await recordAudit(events, tx);
      });
    } catch (e) {
      if (e instanceof LockedConflict) {
        res.status(409).json({ error: e.message });
        return;
      }
      if (e instanceof SubItemIntegrityError) {
        res.status(400).json({ error: e.message });
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
    let conflicted = false;
    await db.transaction(async (tx) => {
      // Audit row remains via ON DELETE SET NULL on dailyEntryId. Recording
      // BEFORE the delete keeps both writes inside one transaction so they
      // commit or roll back atomically.
      await recordAudit(
        {
          dailyEntryId: null,
          projectId: entry.projectId,
          action: "DELETE",
          actorId: req.user!.id,
          field: "sequenceCode",
          oldValue: entry.sequenceCode,
        },
        tx,
      );
      const deleted = await tx
        .delete(dailyEntriesTable)
        .where(
          and(
            eq(dailyEntriesTable.id, id),
            isNull(dailyEntriesTable.lockedAt),
          ),
        )
        .returning({ id: dailyEntriesTable.id });
      if (deleted.length === 0) {
        conflicted = true;
        // Roll back the audit insert by throwing — caught below.
        throw new LockedConflict(
          "Entry was locked concurrently — refresh and retry",
        );
      }
    }).catch((e) => {
      if (e instanceof LockedConflict) return;
      throw e;
    });
    if (conflicted) {
      res
        .status(409)
        .json({ error: "Entry was locked concurrently — refresh and retry" });
      return;
    }
    res.status(204).end();
  },
);

router.post(
  "/entries/:id/reset",
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
    const v = await getProjectVisibility(
      req.user!.id,
      req.user!.role,
      entry.projectId,
    );
    if (req.user!.role !== "admin" && !v.canResetApproval) {
      res
        .status(403)
        .json({ error: "Reset-to-draft permission required" });
      return;
    }
    const previousLevel = entry.currentApprovalLevel;
    const prevStatus = entry.status ?? "draft";
    // No-op only when the entry is already in a clean draft state.
    if (previousLevel === 0 && !entry.lockedAt && prevStatus === "draft") {
      res.json(await buildEntryDetail(id));
      return;
    }

    await db.transaction(async (tx) => {
      await tx
        .update(dailyEntriesTable)
        .set({
          currentApprovalLevel: 0,
          lockedAt: null,
          status: "draft",
          updatedAt: new Date(),
        })
        .where(eq(dailyEntriesTable.id, id));
      await tx
        .delete(entryApprovalsTable)
        .where(eq(entryApprovalsTable.dailyEntryId, id));
      await recordAudit(
        {
          dailyEntryId: id,
          projectId: entry.projectId,
          action: "RESET",
          actorId: req.user!.id,
          level: previousLevel,
          oldValue: String(previousLevel),
          newValue: "0",
        },
        tx,
      );
    });

    res.json(await buildEntryDetail(id));
  },
);

router.post(
  "/entries/:id/submit",
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
    const v = await getProjectVisibility(
      req.user!.id,
      req.user!.role,
      entry.projectId,
    );
    if (req.user!.role !== "admin" && !v.canEditEntries) {
      res.status(403).json({ error: "Edit access required" });
      return;
    }
    if ((entry.status ?? "draft") !== "draft") {
      res
        .status(400)
        .json({ error: "Only draft entries can be submitted for approval" });
      return;
    }

    // PDF-required guard: project setting blocks submission with no attachments.
    const [project] = await db
      .select({ pdfRequired: projectsTable.pdfRequired })
      .from(projectsTable)
      .where(eq(projectsTable.id, entry.projectId));
    if (project?.pdfRequired) {
      const [{ n }] = await db
        .select({ n: sql<number>`COUNT(*)::int` })
        .from(entryAttachmentsTable)
        .where(eq(entryAttachmentsTable.dailyEntryId, id));
      if (Number(n ?? 0) === 0) {
        res.status(400).json({
          error:
            "This project requires at least one attached PDF before submitting for approval.",
        });
        return;
      }
    }

    let conflicted = false;
    await db.transaction(async (tx) => {
      const updated = await tx
        .update(dailyEntriesTable)
        .set({ status: "pending", updatedAt: new Date() })
        .where(
          and(
            eq(dailyEntriesTable.id, id),
            eq(dailyEntriesTable.status, "draft"),
            isNull(dailyEntriesTable.lockedAt),
          ),
        )
        .returning({ id: dailyEntriesTable.id });
      if (updated.length === 0) {
        conflicted = true;
        return;
      }
      await recordAudit(
        {
          dailyEntryId: id,
          projectId: entry.projectId,
          action: "SUBMIT",
          actorId: req.user!.id,
          field: "status",
          oldValue: "draft",
          newValue: "pending",
        },
        tx,
      );
    });

    if (conflicted) {
      res
        .status(409)
        .json({ error: "Entry state changed concurrently — refresh and retry" });
      return;
    }

    res.json(await buildEntryDetail(id));
  },
);

router.get(
  "/entries/:id/audit",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const id = req.params.id as string;
    const [entry] = await db
      .select({
        id: dailyEntriesTable.id,
        projectId: dailyEntriesTable.projectId,
      })
      .from(dailyEntriesTable)
      .where(eq(dailyEntriesTable.id, id));
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
    res.json(await listEntryAudit(id));
  },
);

class LockedConflict extends Error {}

// Suppress lingering reference for plain projectsTable import (kept tree-shakeable).
void projectsTable;

export default router;
