import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  projectAccessTable,
  securityGroupsTable,
  usersTable,
} from "@workspace/db";
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
  let group: typeof securityGroupsTable.$inferSelect | undefined;
  if (a.securityGroupId) {
    const [g] = await db
      .select()
      .from(securityGroupsTable)
      .where(eq(securityGroupsTable.id, a.securityGroupId));
    group = g;
  }
  // OR-merge: effective = group's flag OR row's flag.
  const effectiveCanViewSummary =
    (group?.canViewSummary ?? false) || a.canViewSummary;
  const effectiveCanEditEntries =
    (group?.canEditEntries ?? false) || a.canEditEntries;
  const effectiveCanResetApproval =
    (group?.canResetApproval ?? false) || a.canResetApproval;
  return {
    id: a.id,
    projectId: a.projectId,
    userId: a.userId,
    securityGroupId: a.securityGroupId,
    securityGroup: group
      ? {
          id: group.id,
          name: group.name,
          description: group.description,
          canViewSummary: group.canViewSummary,
          canEditEntries: group.canEditEntries,
          canResetApproval: group.canResetApproval,
          // assignmentCount is not used by the client when nested here.
          assignmentCount: 0,
          createdAt: group.createdAt.toISOString(),
        }
      : null,
    canViewSummary: a.canViewSummary,
    canEditEntries: a.canEditEntries,
    canResetApproval: a.canResetApproval,
    effectiveCanViewSummary,
    effectiveCanEditEntries,
    effectiveCanResetApproval,
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
      req.params.id as string,
    );
    if (!v.project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    if (req.user!.role !== "admin" && !v.canViewSummary) {
      res.status(403).json({ error: "No access" });
      return;
    }
    const rows = await db
      .select()
      .from(projectAccessTable)
      .where(eq(projectAccessTable.projectId, req.params.id as string));
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
    const values = {
      projectId: req.params.id as string,
      userId: parsed.data.userId,
      securityGroupId: parsed.data.securityGroupId ?? null,
      canViewSummary: parsed.data.canViewSummary ?? true,
      canEditEntries: parsed.data.canEditEntries ?? false,
      canResetApproval: parsed.data.canResetApproval ?? false,
      grantedById: req.user!.id,
    };
    const [created] = await db
      .insert(projectAccessTable)
      .values(values)
      .onConflictDoUpdate({
        target: [projectAccessTable.projectId, projectAccessTable.userId],
        set: {
          securityGroupId: values.securityGroupId,
          canViewSummary: values.canViewSummary,
          canEditEntries: values.canEditEntries,
          canResetApproval: values.canResetApproval,
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
    if (parsed.data.securityGroupId !== undefined)
      data.securityGroupId = parsed.data.securityGroupId;
    if (parsed.data.canViewSummary !== undefined)
      data.canViewSummary = parsed.data.canViewSummary;
    if (parsed.data.canEditEntries !== undefined)
      data.canEditEntries = parsed.data.canEditEntries;
    if (parsed.data.canResetApproval !== undefined)
      data.canResetApproval = parsed.data.canResetApproval;
    const [updated] = await db
      .update(projectAccessTable)
      .set(data)
      .where(eq(projectAccessTable.id, req.params.id as string))
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
      .where(eq(projectAccessTable.id, req.params.id as string));
    res.status(204).end();
  },
);

export default router;
