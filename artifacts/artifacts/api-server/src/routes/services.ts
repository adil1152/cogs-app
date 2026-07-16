import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  foodMealItemsTable,
  projectServicesTable,
  serviceCostEntriesTable,
  serviceSubItemsTable,
  subServiceCostEntriesTable,
  dailyEntriesTable,
  projectsTable,
} from "@workspace/db";
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import {
  CreateProjectServiceBody,
  UpdateProjectServiceBody,
  ReorderProjectServicesBody,
} from "@workspace/api-zod";
import { requireAuth, requireAdmin } from "../middlewares/requireAuth";
import { getProjectVisibility, listVisibleProjects } from "../lib/projectAccess";
import { DEFAULT_MEAL_ITEMS } from "../lib/cogsCalc";

const router: IRouter = Router();

type ServiceKind = "food" | "standard" | "group";

interface SerializedService {
  id: string;
  projectId: string;
  name: string;
  kind: ServiceKind;
  sortOrder: number;
  color: string | null;
  subItems: Array<{
    id: string;
    name: string;
    sortOrder: number;
    color: string | null;
  }>;
  mealItems: Array<{
    id: string;
    name: string;
    weight: number;
    sortOrder: number;
  }>;
  hasEntries: boolean;
}

async function serializeMany(
  rows: (typeof projectServicesTable.$inferSelect)[],
): Promise<SerializedService[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [subItems, mealItems, usedRows] = await Promise.all([
    db
      .select()
      .from(serviceSubItemsTable)
      .where(inArray(serviceSubItemsTable.projectServiceId, ids))
      .orderBy(asc(serviceSubItemsTable.sortOrder)),
    db
      .select()
      .from(foodMealItemsTable)
      .where(inArray(foodMealItemsTable.projectServiceId, ids))
      .orderBy(asc(foodMealItemsTable.sortOrder)),
    db
      .selectDistinct({
        projectServiceId: serviceCostEntriesTable.projectServiceId,
      })
      .from(serviceCostEntriesTable)
      .where(inArray(serviceCostEntriesTable.projectServiceId, ids)),
  ]);
  const byService = new Map<
    string,
    Array<{ id: string; name: string; sortOrder: number; color: string | null }>
  >();
  for (const si of subItems) {
    const list = byService.get(si.projectServiceId) ?? [];
    list.push({
      id: si.id,
      name: si.name,
      sortOrder: si.sortOrder,
      color: si.color ?? null,
    });
    byService.set(si.projectServiceId, list);
  }
  const mealsByService = new Map<
    string,
    Array<{ id: string; name: string; weight: number; sortOrder: number }>
  >();
  for (const mi of mealItems) {
    const list = mealsByService.get(mi.projectServiceId) ?? [];
    list.push({
      id: mi.id,
      name: mi.name,
      weight: Number(mi.weight),
      sortOrder: mi.sortOrder,
    });
    mealsByService.set(mi.projectServiceId, list);
  }
  const usedSet = new Set(usedRows.map((r) => r.projectServiceId));
  return rows.map((s) => ({
    id: s.id,
    projectId: s.projectId,
    name: s.name,
    kind: s.kind as ServiceKind,
    sortOrder: s.sortOrder,
    color: s.color ?? null,
    subItems: byService.get(s.id) ?? [],
    mealItems: mealsByService.get(s.id) ?? [],
    hasEntries: usedSet.has(s.id),
  }));
}

async function serializeOne(
  row: typeof projectServicesTable.$inferSelect,
): Promise<SerializedService> {
  const [out] = await serializeMany([row]);
  return out;
}

/**
 * Catalog of services across the projects the caller can view summaries for.
 * Used by the Reports page to populate the service multi-select.
 */
router.get(
  "/services",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const visible = await listVisibleProjects(req.user!.id, req.user!.role);
    let allowedIds = visible
      .filter((v) => v.canViewSummary)
      .map((v) => v.project.id);

    if (typeof req.query.projectIds === "string") {
      const filter = req.query.projectIds
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (filter.length > 0) {
        const filterSet = new Set(filter);
        allowedIds = allowedIds.filter((id) => filterSet.has(id));
      }
    }

    if (allowedIds.length === 0) {
      res.json([]);
      return;
    }

    const rows = await db
      .select({ s: projectServicesTable, p: projectsTable })
      .from(projectServicesTable)
      .leftJoin(
        projectsTable,
        eq(projectsTable.id, projectServicesTable.projectId),
      )
      .where(inArray(projectServicesTable.projectId, allowedIds))
      .orderBy(asc(projectsTable.name), asc(projectServicesTable.sortOrder));

    res.json(
      rows.map(({ s, p }) => ({
        id: s.id,
        projectId: s.projectId,
        projectName: p?.name ?? "",
        name: s.name,
        kind: s.kind as ServiceKind,
        color: s.color ?? null,
      })),
    );
  },
);

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
    res.json(await serializeMany(rows));
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
    const subItems = parsed.data.subItems ?? [];
    if (subItems.length > 0 && parsed.data.kind !== "group") {
      res
        .status(400)
        .json({ error: "subItems are only allowed for kind=group services" });
      return;
    }
    const givenMealItems = parsed.data.mealItems ?? [];
    if (givenMealItems.length > 0 && parsed.data.kind !== "food") {
      res
        .status(400)
        .json({ error: "mealItems are only allowed for kind=food services" });
      return;
    }
    const created = await db.transaction(async (tx) => {
      const [svc] = await tx
        .insert(projectServicesTable)
        .values({
          projectId: req.params.id as string,
          name: parsed.data.name,
          kind: parsed.data.kind,
          sortOrder: parsed.data.sortOrder ?? 0,
          color: parsed.data.color ?? null,
        })
        .returning();
      if (subItems.length > 0) {
        await tx.insert(serviceSubItemsTable).values(
          subItems.map((si, idx) => ({
            projectServiceId: svc.id,
            name: si.name,
            sortOrder: si.sortOrder ?? idx,
            color: si.color ?? null,
          })),
        );
      }
      if (parsed.data.kind === "food") {
        const seed =
          givenMealItems.length > 0
            ? givenMealItems.map((mi, idx) => ({
                name: mi.name,
                weight: mi.weight,
                sortOrder: mi.sortOrder ?? idx,
              }))
            : DEFAULT_MEAL_ITEMS.map((mi, idx) => ({
                name: mi.name,
                weight: mi.weight,
                sortOrder: idx,
              }));
        await tx.insert(foodMealItemsTable).values(
          seed.map((mi) => ({
            projectServiceId: svc.id,
            name: mi.name,
            weight: String(mi.weight),
            sortOrder: mi.sortOrder,
          })),
        );
      }
      return svc;
    });
    res.status(201).json(await serializeOne(created));
  },
);

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Reconcile a service's sub-items against the incoming desired set.
 * - Items with `id` matching an existing row are renamed/reordered.
 * - Items without `id` are inserted.
 * - Existing items not present in the input are deleted.
 *
 * Adds and removes are blocked (409) once any cost row references the parent
 * service — historical entries must keep referencing a stable sub-item set.
 * Renames and reorders remain allowed.
 *
 * Runs inside the caller's transaction so a failure here rolls back any
 * base-row update made in the same PATCH.
 */
async function reconcileSubItems(
  tx: Tx,
  serviceId: string,
  desired: Array<{
    id?: string;
    name: string;
    sortOrder?: number;
    color?: string | null;
  }>,
): Promise<{ status: "ok" } | { status: "locked"; message: string }> {
  {
    const existing = await tx
      .select()
      .from(serviceSubItemsTable)
      .where(eq(serviceSubItemsTable.projectServiceId, serviceId));
    const existingById = new Map(existing.map((e) => [e.id, e]));
    const desiredIds = new Set(
      desired.map((d) => d.id).filter((id): id is string => !!id),
    );

    const toDelete = existing.filter((e) => !desiredIds.has(e.id));
    const toInsert = desired.filter((d) => !d.id);
    const toUpdate = desired.filter(
      (
        d,
      ): d is {
        id: string;
        name: string;
        sortOrder?: number;
        color?: string | null;
      } => !!d.id && existingById.has(d.id),
    );
    const unknown = desired.filter((d) => d.id && !existingById.has(d.id));
    if (unknown.length > 0) {
      return {
        status: "locked" as const,
        message: "Unknown sub-item id in payload",
      };
    }

    const isStructuralChange = toDelete.length > 0 || toInsert.length > 0;
    if (isStructuralChange) {
      const [{ n }] = await tx
        .select({ n: sql<number>`COUNT(*)::int` })
        .from(serviceCostEntriesTable)
        .where(eq(serviceCostEntriesTable.projectServiceId, serviceId));
      if (Number(n ?? 0) > 0) {
        return {
          status: "locked" as const,
          message:
            "Sub-services cannot be added or removed once daily entries exist for this service. Renaming and reordering are still allowed.",
        };
      }
    }

    for (const u of toUpdate) {
      const cur = existingById.get(u.id)!;
      const nameChanged = u.name !== cur.name;
      const orderChanged =
        u.sortOrder !== undefined && u.sortOrder !== cur.sortOrder;
      const colorChanged =
        u.color !== undefined && (u.color ?? null) !== (cur.color ?? null);
      if (nameChanged || orderChanged || colorChanged) {
        await tx
          .update(serviceSubItemsTable)
          .set({
            name: u.name,
            ...(u.sortOrder !== undefined ? { sortOrder: u.sortOrder } : {}),
            ...(u.color !== undefined ? { color: u.color } : {}),
          })
          .where(eq(serviceSubItemsTable.id, u.id));
      }
    }
    if (toInsert.length > 0) {
      await tx.insert(serviceSubItemsTable).values(
        toInsert.map((d, idx) => ({
          projectServiceId: serviceId,
          name: d.name,
          sortOrder: d.sortOrder ?? existing.length + idx,
          color: d.color ?? null,
        })),
      );
    }
    if (toDelete.length > 0) {
      await tx
        .delete(serviceSubItemsTable)
        .where(
          inArray(
            serviceSubItemsTable.id,
            toDelete.map((d) => d.id),
          ),
        );
    }
    return { status: "ok" as const };
  }
}

/**
 * Reconcile a food service's meal types against the incoming desired set.
 * - Items with `id` matching an existing row are renamed / re-weighted / reordered.
 * - Items without `id` are inserted.
 * - Existing items not present in the input are deleted.
 *
 * Unlike group sub-items, this is ALWAYS allowed — daily entries snapshot
 * the meal name + weight they were saved with (meal_cost_entries), so edits
 * never change historical numbers. Deleting a meal item sets `meal_item_id`
 * to NULL on old snapshot rows but keeps their name/weight/qty intact.
 *
 * Runs inside the caller's transaction so a failure here rolls back any
 * base-row update made in the same PATCH.
 */
async function reconcileMealItems(
  tx: Tx,
  serviceId: string,
  desired: Array<{
    id?: string;
    name: string;
    weight: number;
    sortOrder?: number;
  }>,
): Promise<{ status: "ok" } | { status: "invalid"; message: string }> {
  {
    const existing = await tx
      .select()
      .from(foodMealItemsTable)
      .where(eq(foodMealItemsTable.projectServiceId, serviceId));
    const existingById = new Map(existing.map((e) => [e.id, e]));
    const desiredIds = new Set(
      desired.map((d) => d.id).filter((id): id is string => !!id),
    );
    if (desiredIds.size !== desired.filter((d) => d.id).length) {
      return {
        status: "invalid" as const,
        message: "Duplicate meal item id in payload",
      };
    }
    const unknown = desired.filter((d) => d.id && !existingById.has(d.id));
    if (unknown.length > 0) {
      return {
        status: "invalid" as const,
        message: "Unknown meal item id in payload",
      };
    }

    const toDelete = existing.filter((e) => !desiredIds.has(e.id));
    const toInsert = desired.filter((d) => !d.id);
    const toUpdate = desired.filter(
      (
        d,
      ): d is { id: string; name: string; weight: number; sortOrder?: number } =>
        !!d.id,
    );

    for (const u of toUpdate) {
      const cur = existingById.get(u.id)!;
      const nameChanged = u.name !== cur.name;
      const weightChanged = u.weight !== Number(cur.weight);
      const orderChanged =
        u.sortOrder !== undefined && u.sortOrder !== cur.sortOrder;
      if (nameChanged || weightChanged || orderChanged) {
        await tx
          .update(foodMealItemsTable)
          .set({
            name: u.name,
            weight: String(u.weight),
            ...(u.sortOrder !== undefined ? { sortOrder: u.sortOrder } : {}),
          })
          .where(eq(foodMealItemsTable.id, u.id));
      }
    }
    if (toInsert.length > 0) {
      await tx.insert(foodMealItemsTable).values(
        toInsert.map((d, idx) => ({
          projectServiceId: serviceId,
          name: d.name,
          weight: String(d.weight),
          sortOrder: d.sortOrder ?? existing.length + idx,
        })),
      );
    }
    if (toDelete.length > 0) {
      // FK on meal_cost_entries is ON DELETE SET NULL: historical snapshot
      // rows keep their saved name/weight/qty, just lose the live link.
      await tx
        .delete(foodMealItemsTable)
        .where(
          inArray(
            foodMealItemsTable.id,
            toDelete.map((d) => d.id),
          ),
        );
    }
    return { status: "ok" as const };
  }
}

router.patch(
  "/services/:id",
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = UpdateProjectServiceBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body" });
      return;
    }
    const serviceId = req.params.id as string;
    const data: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) data.name = parsed.data.name;
    if (parsed.data.kind !== undefined) data.kind = parsed.data.kind;
    if (parsed.data.sortOrder !== undefined) data.sortOrder = parsed.data.sortOrder;
    if (parsed.data.color !== undefined) data.color = parsed.data.color;

    // Everything runs in ONE transaction: kind guards, base-row update, and
    // child-item reconciliation. Error paths THROW so the transaction rolls
    // back and the service is never left partially mutated (a plain return
    // from the callback would commit the earlier base update).
    class PatchError extends Error {
      constructor(
        public code: number,
        message: string,
      ) {
        super(message);
      }
    }

    let row: typeof projectServicesTable.$inferSelect;
    try {
      row = await db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(projectServicesTable)
          .where(eq(projectServicesTable.id, serviceId))
          .for("update");
        if (!current) throw new PatchError(404, "Service not found");

        // Effective kind after this PATCH (kind change applies in the same request).
        const effectiveKind = (parsed.data.kind ?? current.kind) as ServiceKind;
        if (parsed.data.subItems !== undefined && effectiveKind !== "group") {
          throw new PatchError(
            400,
            "subItems are only allowed for kind=group services",
          );
        }
        if (parsed.data.mealItems !== undefined && effectiveKind !== "food") {
          throw new PatchError(
            400,
            "mealItems are only allowed for kind=food services",
          );
        }

        if (Object.keys(data).length > 0) {
          await tx
            .update(projectServicesTable)
            .set(data)
            .where(eq(projectServicesTable.id, serviceId));
        }

        if (parsed.data.subItems !== undefined) {
          const result = await reconcileSubItems(
            tx,
            serviceId,
            parsed.data.subItems,
          );
          if (result.status === "locked") {
            throw new PatchError(409, result.message);
          }
        }

        if (parsed.data.mealItems !== undefined) {
          const result = await reconcileMealItems(
            tx,
            serviceId,
            parsed.data.mealItems,
          );
          if (result.status === "invalid") {
            throw new PatchError(400, result.message);
          }
        }

        const [updated] = await tx
          .select()
          .from(projectServicesTable)
          .where(eq(projectServicesTable.id, serviceId));
        return updated;
      });
    } catch (err) {
      if (err instanceof PatchError) {
        res.status(err.code).json({ error: err.message });
        return;
      }
      throw err;
    }
    res.json(await serializeOne(row));
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
    // Sub-item RESTRICT FK would block deletion as long as any sub_service_cost_entries
    // reference this service's sub-items. Clear them up-front in the same transaction
    // (the parent service_cost_entries CASCADE chain already handles it on delete).
    // Critical: if the parent delete is blocked by the locked-entries guard, we
    // throw to roll back the sub-row delete — otherwise we'd silently erase
    // historical group breakdowns while keeping the service alive.
    let deleted: Array<{ id: string }> = [];
    try {
      deleted = await db.transaction(async (tx) => {
        // Clear sub-item rows referencing any cost entry for this service so
        // RESTRICT FKs don't block the cascading delete below.
        await tx.execute(sql`
          DELETE FROM ${subServiceCostEntriesTable}
          WHERE service_cost_entry_id IN (
            SELECT id FROM ${serviceCostEntriesTable}
            WHERE project_service_id = ${serviceId}
          )
        `);
        const result = await tx
          .delete(projectServicesTable)
          .where(
            and(
              eq(projectServicesTable.id, serviceId),
              sql`NOT EXISTS ${lockedRefSubquery}`,
            ),
          )
          .returning({ id: projectServicesTable.id });
        if (result.length === 0) {
          // Distinguish "not found" from "locked-blocked" while still inside tx.
          const [stillExists] = await tx
            .select({ id: projectServicesTable.id })
            .from(projectServicesTable)
            .where(eq(projectServicesTable.id, serviceId));
          if (stillExists) {
            // Throw to roll back the sub-row delete above.
            throw new Error("__LOCKED__");
          }
        }
        return result;
      });
    } catch (err) {
      if (err instanceof Error && err.message === "__LOCKED__") {
        res.status(409).json({
          error:
            "This service has cost entries on locked records and cannot be deleted",
        });
        return;
      }
      throw err;
    }
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
      res.json(await serializeMany(rows));
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
    res.json(await serializeMany(rows));
  },
);

export default router;
