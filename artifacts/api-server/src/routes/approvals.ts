import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  dailyEntriesTable,
  entryApprovalsTable,
  usersTable,
} from "@workspace/db";
import { and, eq, asc, isNull } from "drizzle-orm";
import { requireAdmin, requireAuth } from "../middlewares/requireAuth";
import { getProjectVisibility } from "../lib/projectAccess";
import { buildEntryDetail } from "../lib/entries";

const router: IRouter = Router();

export const APPROVAL_LEVELS = ["OP", "SOP", "COO", "CC", "Additional"] as const;
export const FINAL_LEVEL = APPROVAL_LEVELS.length;

router.post(
  "/entries/:id/approve",
  requireAdmin,
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
      res.status(403).json({ error: "Entry is locked" });
      return;
    }
    const expectedLevel = entry.currentApprovalLevel;
    const nextLevel = expectedLevel + 1;
    if (nextLevel > FINAL_LEVEL) {
      res.status(403).json({ error: "Already fully approved" });
      return;
    }
    const levelName = APPROVAL_LEVELS[nextLevel - 1];

    try {
      await db.transaction(async (tx) => {
        // Atomic conditional update: only advances if state unchanged.
        const updated = await tx
          .update(dailyEntriesTable)
          .set({
            currentApprovalLevel: nextLevel,
            lockedAt: nextLevel === FINAL_LEVEL ? new Date() : null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(dailyEntriesTable.id, id),
              eq(dailyEntriesTable.currentApprovalLevel, expectedLevel),
              isNull(dailyEntriesTable.lockedAt),
            ),
          )
          .returning({ id: dailyEntriesTable.id });
        if (updated.length === 0) {
          throw new ConflictError(
            "Entry state changed concurrently — please refresh and try again",
          );
        }
        // Unique (dailyEntryId, level) prevents duplicate level rows under races.
        await tx.insert(entryApprovalsTable).values({
          dailyEntryId: id,
          level: nextLevel,
          levelName,
          approverId: req.user!.id,
        });
      });
    } catch (e) {
      if (e instanceof ConflictError) {
        res.status(409).json({ error: e.message });
        return;
      }
      // Unique violation (race or duplicate) — surface 409.
      const code = (e as { code?: string }).code;
      if (code === "23505") {
        res
          .status(409)
          .json({ error: "Approval already recorded — please refresh" });
        return;
      }
      throw e;
    }

    res.json(await buildEntryDetail(id));
  },
);

router.post(
  "/entries/:id/reject",
  requireAdmin,
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
      res
        .status(403)
        .json({ error: "Entry is final-locked and cannot be rejected" });
      return;
    }
    const expectedLevel = entry.currentApprovalLevel;
    if (expectedLevel === 0) {
      res.status(400).json({ error: "Entry is already in draft" });
      return;
    }
    try {
      await db.transaction(async (tx) => {
        // Compare-and-swap on currentApprovalLevel prevents a stale reject
        // from overwriting a concurrent approve that advanced the level.
        const updated = await tx
          .update(dailyEntriesTable)
          .set({
            currentApprovalLevel: 0,
            lockedAt: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(dailyEntriesTable.id, id),
              eq(dailyEntriesTable.currentApprovalLevel, expectedLevel),
              isNull(dailyEntriesTable.lockedAt),
            ),
          )
          .returning({ id: dailyEntriesTable.id });
        if (updated.length === 0) {
          throw new ConflictError(
            "Entry state changed concurrently — please refresh and try again",
          );
        }
        await tx
          .delete(entryApprovalsTable)
          .where(eq(entryApprovalsTable.dailyEntryId, id));
      });
    } catch (e) {
      if (e instanceof ConflictError) {
        res.status(409).json({ error: e.message });
        return;
      }
      throw e;
    }
    res.json(await buildEntryDetail(id));
  },
);

router.get(
  "/entries/:id/approvals",
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
    if (req.user!.role !== "admin" && !v.canViewSummary && !v.canEditEntries) {
      res.status(403).json({ error: "No access" });
      return;
    }

    const rows = await db
      .select({ a: entryApprovalsTable, u: usersTable })
      .from(entryApprovalsTable)
      .leftJoin(usersTable, eq(usersTable.id, entryApprovalsTable.approverId))
      .where(eq(entryApprovalsTable.dailyEntryId, id))
      .orderBy(asc(entryApprovalsTable.level));
    res.json(
      rows.map(({ a, u }) => ({
        id: a.id,
        dailyEntryId: a.dailyEntryId,
        level: a.level,
        levelName: a.levelName,
        approverId: a.approverId,
        approverName: u
          ? [u.firstName, u.lastName].filter(Boolean).join(" ") ||
            u.email ||
            null
          : null,
        approvedAt: a.approvedAt.toISOString(),
      })),
    );
  },
);

class ConflictError extends Error {}

export default router;
