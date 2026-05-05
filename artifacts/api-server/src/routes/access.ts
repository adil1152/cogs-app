import { Router, type IRouter, type Request, type Response } from "express";
import { db, projectAccessTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  GrantProjectAccessBody,
  UpdateProjectAccessBody,
} from "@workspace/api-zod";
import { requireAuth, requireAdmin } from "../middlewares/requireAuth";
import { getProjectVisibility } from "../lib/projectAccess";

const router: IRouter = Router();

async function serializeAccess(a: typeof projectAccessTable.$inferSelect) {
  const [u] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, a.userId));
  return {
    id: a.id,
    projectId: a.projectId,
    userId: a.userId,
    canViewSummary: a.canViewSummary,
    canEditEntries: a.canEditEntries,
    canResetApproval: a.canResetApproval,
    grantedAt: a.grantedAt.toISOString(),
    user: u
      ? {
          id: u.id,
          email: u.email,
          firstName: u.firstName,
          lastName: u.lastName,
          profileImageUrl: u.profileImageUrl,
          role: (u.role as "admin" | "user") ?? "user",
        }
      : null,
  };
}

router.get(
  "/projects/:id/access",
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
    // Only admins or summary-viewers can see the access list
    if (req.user!.role !== "admin" && !v.canViewSummary) {
      res.status(403).json({ error: "No access" });
      return;
    }
    const rows = await db
      .select()
      .from(projectAccessTable)
      .where(eq(projectAccessTable.projectId, (req.params.id as string)));
    res.json(await Promise.all(rows.map(serializeAccess)));
  },
);

router.post(
  "/projects/:id/access",
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = GrantProjectAccessBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body" });
      return;
    }
    const [created] = await db
      .insert(projectAccessTable)
      .values({
        projectId: (req.params.id as string),
        userId: parsed.data.userId,
        canViewSummary: parsed.data.canViewSummary ?? true,
        canEditEntries: parsed.data.canEditEntries ?? false,
        canResetApproval: parsed.data.canResetApproval ?? false,
        grantedById: req.user!.id,
      })
      .onConflictDoUpdate({
        target: [projectAccessTable.projectId, projectAccessTable.userId],
        set: {
          canViewSummary: parsed.data.canViewSummary ?? true,
          canEditEntries: parsed.data.canEditEntries ?? false,
          canResetApproval: parsed.data.canResetApproval ?? false,
          grantedById: req.user!.id,
          grantedAt: new Date(),
        },
      })
      .returning();
    res.status(201).json(await serializeAccess(created));
  },
);

router.patch(
  "/access/:id",
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = UpdateProjectAccessBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body" });
      return;
    }
    const data: Record<string, unknown> = {};
    if (parsed.data.canViewSummary !== undefined)
      data.canViewSummary = parsed.data.canViewSummary;
    if (parsed.data.canEditEntries !== undefined)
      data.canEditEntries = parsed.data.canEditEntries;
    if (parsed.data.canResetApproval !== undefined)
      data.canResetApproval = parsed.data.canResetApproval;
    const [updated] = await db
      .update(projectAccessTable)
      .set(data)
      .where(eq(projectAccessTable.id, (req.params.id as string)))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Access record not found" });
      return;
    }
    res.json(await serializeAccess(updated));
  },
);

router.delete(
  "/access/:id",
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    await db
      .delete(projectAccessTable)
      .where(eq(projectAccessTable.id, (req.params.id as string)));
    res.status(204).end();
  },
);

export default router;
