import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  projectsTable,
  projectApprovalChainTable,
  projectApproverAssignmentsTable,
  dailyEntriesTable,
} from "@workspace/db";
import { and, eq, gt, sql } from "drizzle-orm";
import { SetProjectApprovalChainBody } from "@workspace/api-zod";
import { requireAdmin, requireAuth } from "../middlewares/requireAuth";
import { getProjectVisibility } from "../lib/projectAccess";
import { getProjectChain } from "../lib/approvalChain";

const router: IRouter = Router();

router.get(
  "/projects/:id/approval-chain",
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
    if (
      req.user!.role !== "admin" &&
      !v.canViewSummary &&
      !v.canEditEntries
    ) {
      res.status(403).json({ error: "No access" });
      return;
    }
    res.json(await getProjectChain(projectId));
  },
);

router.put(
  "/projects/:id/approval-chain",
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const projectId = req.params.id as string;
    const [project] = await db
      .select({ id: projectsTable.id })
      .from(projectsTable)
      .where(eq(projectsTable.id, projectId));
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const parsed = SetProjectApprovalChainBody.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Invalid body", details: parsed.error.issues });
      return;
    }

    const newChain = parsed.data.chain;

    // Validate: positions are 1..N contiguous
    const sorted = [...newChain].sort((a, b) => a.position - b.position);
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i].position !== i + 1) {
        res
          .status(400)
          .json({ error: "Chain positions must be contiguous starting at 1" });
        return;
      }
    }

    // Validate: level names unique and trimmed
    const names = new Set<string>();
    for (const c of newChain) {
      const n = c.levelName.trim();
      if (n.length === 0) {
        res.status(400).json({ error: "Level name cannot be empty" });
        return;
      }
      if (names.has(n.toLowerCase())) {
        res
          .status(400)
          .json({ error: `Duplicate level name "${n}" in chain` });
        return;
      }
      names.add(n.toLowerCase());
    }

    const newPosByName = new Map<string, number>();
    for (const c of sorted) {
      newPosByName.set(c.levelName.trim().toLowerCase(), c.position);
    }

    const newChainRows = await db.transaction(async (tx) => {
      // Lock the project row so two concurrent reorders serialize on the same
      // project. We must read old chain INSIDE the transaction so the remap
      // can't be computed against stale data.
      await tx.execute(
        sql`SELECT id FROM ${projectsTable} WHERE id = ${projectId} FOR UPDATE`,
      );

      const oldRows = await tx
        .select()
        .from(projectApprovalChainTable)
        .where(eq(projectApprovalChainTable.projectId, projectId))
        .orderBy(projectApprovalChainTable.position);

      const oldChain =
        oldRows.length > 0
          ? oldRows.map((r) => ({
              position: r.position,
              levelName: r.levelName,
            }))
          : [
              { position: 1, levelName: "OP" },
              { position: 2, levelName: "SOP" },
              { position: 3, levelName: "COO" },
              { position: 4, levelName: "CC" },
              { position: 5, levelName: "Additional" },
            ];

      // Existing levels must be preserved (no removes — entry approvals
      // already reference them by position). New levels may be appended,
      // and existing levels may be reordered freely.
      if (sorted.length < oldChain.length) {
        const e = new Error(
          `Chain length cannot shrink below existing (${oldChain.length}).`,
        ) as Error & { httpStatus: number };
        e.httpStatus = 400;
        throw e;
      }
      for (const c of oldChain) {
        if (!newPosByName.has(c.levelName.toLowerCase())) {
          const e = new Error(
            `Cannot remove level "${c.levelName}" — existing levels must be kept.`,
          ) as Error & { httpStatus: number };
          e.httpStatus = 400;
          throw e;
        }
      }

      // Build oldPosition → newPosition map.
      const remap = new Map<number, number>();
      let reordered = false;
      for (const c of oldChain) {
        const np = newPosByName.get(c.levelName.toLowerCase())!;
        remap.set(c.position, np);
        if (np !== c.position) reordered = true;
      }

      // Reordering existing positions would misroute in-flight approvals
      // (entry_approvals.level + daily_entries.currentApprovalLevel reference
      // positions, not names). Pure appends are always safe. Block reorders
      // while any partially-approved or pending entries exist.
      if (reordered) {
        const [inflight] = await tx
          .select({ n: sql<number>`COUNT(*)::int` })
          .from(dailyEntriesTable)
          .where(
            and(
              eq(dailyEntriesTable.projectId, projectId),
              gt(dailyEntriesTable.currentApprovalLevel, 0),
            ),
          );
        if ((inflight?.n ?? 0) > 0) {
          const e = new Error(
            "Cannot reorder existing levels while there are entries with approvals in progress. Reset those entries to draft first, or only append new levels.",
          ) as Error & { httpStatus: number };
          e.httpStatus = 409;
          throw e;
        }
      }

      // Two-step assignment level remap to dodge unique(project_id, level, user_id) conflicts.
      await tx
        .update(projectApproverAssignmentsTable)
        .set({ level: sql`-${projectApproverAssignmentsTable.level}` })
        .where(eq(projectApproverAssignmentsTable.projectId, projectId));

      for (const [oldPos, newPos] of remap.entries()) {
        await tx
          .update(projectApproverAssignmentsTable)
          .set({ level: newPos })
          .where(
            and(
              eq(projectApproverAssignmentsTable.projectId, projectId),
              eq(projectApproverAssignmentsTable.level, -oldPos),
            ),
          );
      }

      await tx
        .delete(projectApprovalChainTable)
        .where(eq(projectApprovalChainTable.projectId, projectId));
      await tx.insert(projectApprovalChainTable).values(
        sorted.map((c) => ({
          projectId,
          position: c.position,
          levelName: c.levelName.trim(),
        })),
      );

      return sorted.map((c) => ({
        position: c.position,
        levelName: c.levelName.trim(),
      }));
    }).catch((err: Error & { httpStatus?: number }) => {
      if (err.httpStatus) {
        res.status(err.httpStatus).json({ error: err.message });
        return null;
      }
      throw err;
    });

    if (newChainRows === null) return;
    res.json(newChainRows);
  },
);

export default router;
