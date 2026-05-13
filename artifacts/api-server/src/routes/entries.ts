import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  dailyEntriesTable,
  entryApprovalsTable,
  entryAttachmentsTable,
  projectsTable,
  serviceCostEntriesTable,
} from "@workspace/db";
import { and, eq, gte, lte, desc, isNull, inArray, sql } from "drizzle-orm";
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
  slugifyForSequence,
  type ServiceCostInputItem,
} from "../lib/entries";
import { diffSnapshots, listEntryAudit, recordAudit } from "../lib/audit";

const router: IRouter = Router();

function asDateString(d: Date | string): string {
  return d instanceof Date ? d.toISOString().slice(0, 10) : d;
}

function pad4(n: number): string {
  return n.toString().padStart(4, "0");
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

    const override = !!parsed.data.totalMandaysOverride;
    const serviceCosts = parsed.data.serviceCosts as ServiceCostInputItem[];
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

          if (serviceCosts.length > 0) {
            await tx.insert(serviceCostEntriesTable).values(
              serviceCosts.map((sc) => ({
                dailyEntryId: entry.id,
                projectServiceId: sc.projectServiceId,
                kind: sc.kind,
                cost: String(sc.cost ?? 0),
                mandays: sc.mandays != null ? String(sc.mandays) : null,
                manualMandays: String(sc.manualMandays ?? 0),
                breakfastQty: sc.breakfastQty ?? null,
                lunchQty: sc.lunchQty ?? null,
                dinnerQty: sc.dinnerQty ?? null,
                midnightQty: sc.midnightQty ?? null,
                mealBoxQty: sc.mealBoxQty ?? null,
              })),
            );
          }

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

    // Snapshot of cost rows for audit diff (compared as JSON strings).
    const beforeCosts = await db
      .select()
      .from(serviceCostEntriesTable)
      .where(eq(serviceCostEntriesTable.dailyEntryId, id))
      .orderBy(serviceCostEntriesTable.projectServiceId);

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
              kind: c.kind as "food" | "standard",
              cost: Number(c.cost ?? 0),
              mandays: c.mandays != null ? Number(c.mandays) : undefined,
              manualMandays: Number(c.manualMandays ?? 0),
              breakfastQty: c.breakfastQty ?? undefined,
              lunchQty: c.lunchQty ?? undefined,
              dinnerQty: c.dinnerQty ?? undefined,
              midnightQty: c.midnightQty ?? undefined,
              mealBoxQty: c.mealBoxQty ?? undefined,
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
          if (parsed.data.serviceCosts.length > 0) {
            await tx.insert(serviceCostEntriesTable).values(
              (parsed.data.serviceCosts as ServiceCostInputItem[]).map(
                (sc) => ({
                  dailyEntryId: id,
                  projectServiceId: sc.projectServiceId,
                  kind: sc.kind,
                  cost: String(sc.cost ?? 0),
                  mandays: sc.mandays != null ? String(sc.mandays) : null,
                  manualMandays: String(sc.manualMandays ?? 0),
                  breakfastQty: sc.breakfastQty ?? null,
                  lunchQty: sc.lunchQty ?? null,
                  dinnerQty: sc.dinnerQty ?? null,
                  midnightQty: sc.midnightQty ?? null,
                  mealBoxQty: sc.mealBoxQty ?? null,
                }),
              ),
            );
          }
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
              breakfastQty: c.breakfastQty,
              lunchQty: c.lunchQty,
              dinnerQty: c.dinnerQty,
              midnightQty: c.midnightQty,
              mealBoxQty: c.mealBoxQty,
            })),
          );
          const afterJson = JSON.stringify(
            (parsed.data.serviceCosts as ServiceCostInputItem[])
              .slice()
              .sort((a, b) =>
                a.projectServiceId.localeCompare(b.projectServiceId),
              )
              .map((c) => ({
                projectServiceId: c.projectServiceId,
                kind: c.kind,
                cost: Number(c.cost ?? 0),
                mandays: c.mandays != null ? Number(c.mandays) : null,
                manualMandays: Number(c.manualMandays ?? 0),
                breakfastQty: c.breakfastQty ?? null,
                lunchQty: c.lunchQty ?? null,
                dinnerQty: c.dinnerQty ?? null,
                midnightQty: c.midnightQty ?? null,
                mealBoxQty: c.mealBoxQty ?? null,
              })),
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
