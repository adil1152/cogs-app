import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  securityGroupsTable,
  projectAccessTable,
  securityGroupMembersTable,
  usersTable,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import {
  CreateSecurityGroupBody,
  UpdateSecurityGroupBody,
  AddSecurityGroupMemberBody,
} from "@workspace/api-zod";
import { requireAuth, requireAdmin } from "../middlewares/requireAuth";

const router: IRouter = Router();

/** Drizzle may wrap the pg error, so also check `cause`. */
function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}

async function serializeGroup(g: typeof securityGroupsTable.$inferSelect) {
  const [[{ count: accessCount }], [{ count: memberCount }]] =
    await Promise.all([
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(projectAccessTable)
        .where(eq(projectAccessTable.securityGroupId, g.id)),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(securityGroupMembersTable)
        .where(eq(securityGroupMembersTable.securityGroupId, g.id)),
    ]);
  return {
    id: g.id,
    name: g.name,
    description: g.description,
    canViewSummary: g.canViewSummary,
    canEditEntries: g.canEditEntries,
    canResetApproval: g.canResetApproval,
    autoAssignNewProjects: g.autoAssignNewProjects,
    assignmentCount: Number(accessCount ?? 0),
    memberCount: Number(memberCount ?? 0),
    createdAt: g.createdAt.toISOString(),
  };
}

function serializeMember(
  m: typeof securityGroupMembersTable.$inferSelect,
  u: typeof usersTable.$inferSelect,
) {
  return {
    id: m.id,
    securityGroupId: m.securityGroupId,
    userId: m.userId,
    grantedAt: m.grantedAt.toISOString(),
    user: {
      id: u.id,
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      mobile: u.mobile,
      profileImageUrl: u.profileImageUrl,
      role: (u.role as "admin" | "user") ?? "user",
    },
  };
}

router.get(
  "/security-groups",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    if (req.user!.role !== "admin") {
      res.status(403).json({ error: "Admin access required" });
      return;
    }
    const rows = await db
      .select()
      .from(securityGroupsTable)
      .orderBy(securityGroupsTable.name);
    res.json(await Promise.all(rows.map(serializeGroup)));
  },
);

router.post(
  "/security-groups",
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = CreateSecurityGroupBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body" });
      return;
    }
    try {
      const [created] = await db
        .insert(securityGroupsTable)
        .values({
          name: parsed.data.name.trim(),
          description: parsed.data.description ?? null,
          canViewSummary: parsed.data.canViewSummary ?? false,
          canEditEntries: parsed.data.canEditEntries ?? false,
          canResetApproval: parsed.data.canResetApproval ?? false,
          autoAssignNewProjects: parsed.data.autoAssignNewProjects ?? false,
          createdById: req.user!.id,
        })
        .returning();
      res.status(201).json(await serializeGroup(created));
    } catch (err: unknown) {
      if (isUniqueViolation(err)) {
        res.status(409).json({ error: "A group with that name already exists" });
        return;
      }
      throw err;
    }
  },
);

router.patch(
  "/security-groups/:id",
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = UpdateSecurityGroupBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body" });
      return;
    }
    const data: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) data.name = parsed.data.name.trim();
    if (parsed.data.description !== undefined)
      data.description = parsed.data.description;
    if (parsed.data.canViewSummary !== undefined)
      data.canViewSummary = parsed.data.canViewSummary;
    if (parsed.data.canEditEntries !== undefined)
      data.canEditEntries = parsed.data.canEditEntries;
    if (parsed.data.canResetApproval !== undefined)
      data.canResetApproval = parsed.data.canResetApproval;
    if (parsed.data.autoAssignNewProjects !== undefined)
      data.autoAssignNewProjects = parsed.data.autoAssignNewProjects;
    try {
      const [updated] = await db
        .update(securityGroupsTable)
        .set(data)
        .where(eq(securityGroupsTable.id, req.params.id as string))
        .returning();
      if (!updated) {
        res.status(404).json({ error: "Security group not found" });
        return;
      }
      res.json(await serializeGroup(updated));
    } catch (err: unknown) {
      if (isUniqueViolation(err)) {
        res.status(409).json({ error: "A group with that name already exists" });
        return;
      }
      throw err;
    }
  },
);

router.delete(
  "/security-groups/:id",
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const groupId = req.params.id as string;
    const [[{ count: accessCount }], [{ count: memberCount }]] =
      await Promise.all([
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(projectAccessTable)
          .where(eq(projectAccessTable.securityGroupId, groupId)),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(securityGroupMembersTable)
          .where(eq(securityGroupMembersTable.securityGroupId, groupId)),
      ]);
    if (Number(accessCount ?? 0) > 0) {
      res.status(409).json({
        error: `Cannot delete: ${accessCount} access row(s) still reference this group. Reassign them first.`,
      });
      return;
    }
    if (Number(memberCount ?? 0) > 0) {
      res.status(409).json({
        error: `Cannot delete: ${memberCount} member(s) still belong to this group. Remove them first.`,
      });
      return;
    }
    await db
      .delete(securityGroupsTable)
      .where(eq(securityGroupsTable.id, groupId));
    res.status(204).end();
  },
);

router.get(
  "/security-groups/:id/members",
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const groupId = req.params.id as string;
    const [group] = await db
      .select()
      .from(securityGroupsTable)
      .where(eq(securityGroupsTable.id, groupId));
    if (!group) {
      res.status(404).json({ error: "Security group not found" });
      return;
    }
    const rows = await db
      .select({ member: securityGroupMembersTable, user: usersTable })
      .from(securityGroupMembersTable)
      .innerJoin(usersTable, eq(usersTable.id, securityGroupMembersTable.userId))
      .where(eq(securityGroupMembersTable.securityGroupId, groupId))
      .orderBy(usersTable.email);
    res.json(rows.map((r) => serializeMember(r.member, r.user)));
  },
);

router.post(
  "/security-groups/:id/members",
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const groupId = req.params.id as string;
    const parsed = AddSecurityGroupMemberBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body" });
      return;
    }
    const [group] = await db
      .select()
      .from(securityGroupsTable)
      .where(eq(securityGroupsTable.id, groupId));
    if (!group) {
      res.status(404).json({ error: "Security group not found" });
      return;
    }
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, parsed.data.userId));
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    try {
      const [created] = await db
        .insert(securityGroupMembersTable)
        .values({
          securityGroupId: groupId,
          userId: user.id,
          grantedById: req.user!.id,
        })
        .returning();
      res.status(201).json(serializeMember(created, user));
    } catch (err: unknown) {
      if (isUniqueViolation(err)) {
        res
          .status(409)
          .json({ error: "This user is already a member of the group" });
        return;
      }
      throw err;
    }
  },
);

router.delete(
  "/security-group-members/:id",
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    await db
      .delete(securityGroupMembersTable)
      .where(eq(securityGroupMembersTable.id, req.params.id as string));
    res.status(204).end();
  },
);

export default router;
