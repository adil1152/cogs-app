import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  projectsTable,
  projectApproverAssignmentsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { SetProjectApproversBody } from "@workspace/api-zod";
import { requireAdmin, requireAuth } from "../middlewares/requireAuth";
import { getProjectVisibility } from "../lib/projectAccess";
import { listProjectApprovers } from "../lib/approvers";
import { FINAL_LEVEL } from "./approvals";

const router: IRouter = Router();

router.get(
  "/projects/:id/approvers",
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
    if (req.user!.role !== "admin" && !v.canViewSummary && !v.canEditEntries) {
      res.status(403).json({ error: "No access" });
      return;
    }
    res.json(await listProjectApprovers(projectId));
  },
);

router.put(
  "/projects/:id/approvers",
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
    const parsed = SetProjectApproversBody.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Invalid body", details: parsed.error.issues });
      return;
    }
    const assignments = parsed.data.assignments.filter(
      (a) => a.level >= 1 && a.level <= FINAL_LEVEL,
    );

    await db.transaction(async (tx) => {
      await tx
        .delete(projectApproverAssignmentsTable)
        .where(eq(projectApproverAssignmentsTable.projectId, projectId));
      if (assignments.length > 0) {
        // Deduplicate (level,userId) so the unique index does not throw.
        const seen = new Set<string>();
        const rows = assignments.flatMap((a) => {
          const key = `${a.level}:${a.userId}`;
          if (seen.has(key)) return [];
          seen.add(key);
          return [
            {
              projectId,
              level: a.level,
              userId: a.userId,
            },
          ];
        });
        if (rows.length > 0) {
          await tx.insert(projectApproverAssignmentsTable).values(rows);
        }
      }
    });

    res.json(await listProjectApprovers(projectId));
  },
);

export default router;
