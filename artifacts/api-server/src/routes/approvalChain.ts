import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  projectsTable,
  projectApprovalChainTable,
  projectApproverAssignmentsTable,
  dailyEntriesTable,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { SetProjectApprovalChainBody } from "@workspace/api-zod";
import { requireAdmin, requireAuth } from "../middlewares/requireAuth";
import { getProjectVisibility } from "../lib/projectAccess";
import {
  defaultChain,
  getProjectChain,
  midApprovalCondition,
} from "../lib/approvalChain";

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

    const newChainRows = await db.transaction(async (tx) => {
      // Lock the project row so two concurrent edits serialize on the same
      // project. We must read old chain INSIDE the transaction so the remap
      // can't be computed against stale data.
      await tx.execute(
        sql`SELECT id FROM ${projectsTable} WHERE id = ${projectId} FOR UPDATE`,
      );

      // Single gate: the approval chain routes approvals by numeric position.
      // Only entries actively in the MIDDLE of approval (pending with at
      // least one approval already given) block a reorder — their in-flight
      // routing would be corrupted. Draft, rejected and fully APPROVED
      // entries do not block: their history is a snapshot and no further
      // routing happens.
      const [tied] = await tx
        .select({ n: sql<number>`COUNT(*)::int` })
        .from(dailyEntriesTable)
        .where(
          and(
            eq(dailyEntriesTable.projectId, projectId),
            midApprovalCondition(),
          ),
        );
      const tiedCount = tied?.n ?? 0;
      if (tiedCount > 0) {
        const e = new Error(
          `This project has ${tiedCount} ${
            tiedCount === 1 ? "entry" : "entries"
          } in the middle of approval. Reset ${
            tiedCount === 1 ? "it" : "them"
          } to draft (or delete ${
            tiedCount === 1 ? "it" : "them"
          }) before changing the approval order.`,
        ) as Error & { httpStatus: number };
        e.httpStatus = 409;
        throw e;
      }

      const persistedRows = await tx
        .select()
        .from(projectApprovalChainTable)
        .where(eq(projectApprovalChainTable.projectId, projectId))
        .orderBy(projectApprovalChainTable.position);

      // The effective "old" chain we are editing. Projects created after the
      // seed-on-creation change always have persisted rows (with ids). For any
      // legacy project that still has none, fall back to the synthetic default
      // chain so its approver assignments (keyed by the default positions) can
      // still be tracked across this edit.
      const oldRows =
        persistedRows.length > 0
          ? persistedRows.map((r) => ({
              id: r.id as string | null,
              position: r.position,
              levelName: r.levelName,
            }))
          : defaultChain();

      // Determine which old level each surviving payload row came from.
      //   - Persisted chains: match by stable id, so a rename keeps its
      //     approvers. A brand-new row (no id / unknown id) has no old level.
      //   - Legacy default chains (no ids): match null-id rows by name, so
      //     reorder/delete keep their approvers. (Rename+no-id can't be tracked,
      //     but seed-on-creation + backfill means real projects have ids.)
      const oldById = new Map<string, (typeof oldRows)[number]>();
      const oldByName = new Map<string, (typeof oldRows)[number]>();
      for (const r of oldRows) {
        if (r.id) oldById.set(r.id, r);
        oldByName.set(r.levelName.trim().toLowerCase(), r);
      }

      const survivorRemap = new Map<number, number>(); // oldPos → newPos
      const reuseIdByNewPos = new Map<number, string>(); // newPos → old id
      const claimedOldPos = new Set<number>();
      for (const c of sorted) {
        let src: (typeof oldRows)[number] | undefined;
        if (c.id) {
          src = oldById.get(c.id);
        } else {
          const m = oldByName.get(c.levelName.trim().toLowerCase());
          // Only treat a name match as a survivor when it maps to a real old
          // level we haven't already claimed (defends against a new row whose
          // name collides with a surviving level matched by id).
          if (m && !claimedOldPos.has(m.position)) src = m;
        }
        if (src && !claimedOldPos.has(src.position)) {
          claimedOldPos.add(src.position);
          survivorRemap.set(src.position, c.position);
          if (src.id) reuseIdByNewPos.set(c.position, src.id);
        }
      }

      // Rebuild the chain rows from the payload (renames/reorders/deletes/appends).
      // Surviving levels keep their existing id so ids stay stable across saves
      // (a stale client re-saving with old ids still matches correctly).
      await tx
        .delete(projectApprovalChainTable)
        .where(eq(projectApprovalChainTable.projectId, projectId));
      const insertedRows = await tx
        .insert(projectApprovalChainTable)
        .values(
          sorted.map((c) => {
            const reuseId = reuseIdByNewPos.get(c.position);
            return {
              ...(reuseId ? { id: reuseId } : {}),
              projectId,
              position: c.position,
              levelName: c.levelName.trim(),
            };
          }),
        )
        .returning();

      // Rebuild approver assignments for the new positions. Drop assignments
      // for deleted levels (old positions not in survivorRemap), and remap
      // survivors to their new positions. Two-step negate-then-set dodges the
      // unique(project_id, level, user_id) constraint during the shuffle.
      const survivingOldPositions = [...survivorRemap.keys()];
      // Remove assignments whose old level is not surviving.
      if (survivingOldPositions.length > 0) {
        await tx
          .delete(projectApproverAssignmentsTable)
          .where(
            and(
              eq(projectApproverAssignmentsTable.projectId, projectId),
              sql`${projectApproverAssignmentsTable.level} NOT IN (${sql.join(
                survivingOldPositions.map((p) => sql`${p}`),
                sql`, `,
              )})`,
            ),
          );
      } else {
        await tx
          .delete(projectApproverAssignmentsTable)
          .where(eq(projectApproverAssignmentsTable.projectId, projectId));
      }

      if (survivingOldPositions.length > 0) {
        // Negate all remaining levels first.
        await tx
          .update(projectApproverAssignmentsTable)
          .set({ level: sql`-${projectApproverAssignmentsTable.level}` })
          .where(eq(projectApproverAssignmentsTable.projectId, projectId));

        for (const [oldPos, newPos] of survivorRemap.entries()) {
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
      }

      return insertedRows
        .sort((a, b) => a.position - b.position)
        .map((r) => ({
          id: r.id,
          position: r.position,
          levelName: r.levelName,
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
