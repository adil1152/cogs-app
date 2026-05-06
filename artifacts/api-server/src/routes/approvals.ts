import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  dailyEntriesTable,
  entryApprovalsTable,
  usersTable,
} from "@workspace/db";
import { and, eq, asc, isNull } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { getProjectVisibility } from "../lib/projectAccess";
import { buildEntryDetail } from "../lib/entries";
import { isApproverFor } from "../lib/approvers";
import { recordAudit } from "../lib/audit";
import { getProjectChain, levelNameAt } from "../lib/approvalChain";

const router: IRouter = Router();

router.post(
  "/entries/:id/approve",
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
      res.status(403).json({ error: "Entry is locked" });
      return;
    }
    const chain = await getProjectChain(entry.projectId);
    const finalLevel = chain.length;
    const expectedLevel = entry.currentApprovalLevel;
    const nextLevel = expectedLevel + 1;
    if (nextLevel > finalLevel) {
      res.status(403).json({ error: "Already fully approved" });
      return;
    }
    const levelName = levelNameAt(chain, nextLevel);

    if (req.user!.role !== "admin") {
      const allowed = await isApproverFor(
        entry.projectId,
        nextLevel,
        req.user!.id,
      );
      if (!allowed) {
        res
          .status(403)
          .json({ error: `Only the assigned ${levelName} approver can approve this level` });
        return;
      }
    }

    try {
      await db.transaction(async (tx) => {
        const updated = await tx
          .update(dailyEntriesTable)
          .set({
            currentApprovalLevel: nextLevel,
            lockedAt: nextLevel === finalLevel ? new Date() : null,
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
        await tx.insert(entryApprovalsTable).values({
          dailyEntryId: id,
          level: nextLevel,
          levelName,
          approverId: req.user!.id,
        });
        await recordAudit(
          {
            dailyEntryId: id,
            projectId: entry.projectId,
            action: "APPROVE",
            actorId: req.user!.id,
            level: nextLevel,
            levelName,
            oldValue: String(expectedLevel),
            newValue: String(nextLevel),
          },
          tx,
        );
      });
    } catch (e) {
      if (e instanceof ConflictError) {
        res.status(409).json({ error: e.message });
        return;
      }
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

    if (req.user!.role !== "admin") {
      // The most-recent approver (current level) can revoke their own approval.
      const allowed = await isApproverFor(
        entry.projectId,
        expectedLevel,
        req.user!.id,
      );
      if (!allowed) {
        res.status(403).json({
          error: "Only the current-level approver or an admin can reject",
        });
        return;
      }
    }

    try {
      await db.transaction(async (tx) => {
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
        await recordAudit(
          {
            dailyEntryId: id,
            projectId: entry.projectId,
            action: "REJECT",
            actorId: req.user!.id,
            level: expectedLevel,
            oldValue: String(expectedLevel),
            newValue: "0",
          },
          tx,
        );
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
