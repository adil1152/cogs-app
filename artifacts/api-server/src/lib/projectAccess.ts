import {
  db,
  projectsTable,
  projectAccessTable,
  securityGroupsTable,
  securityGroupMembersTable,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import type { ChainEntry } from "./approvalChain";

export interface VisibleProject {
  project: typeof projectsTable.$inferSelect;
  canViewSummary: boolean;
  canEditEntries: boolean;
  canResetApproval: boolean;
  isAdminOwned: boolean;
}

/**
 * Returns all projects visible to a user.
 * - Admins see all projects (full access).
 * - Regular users see projects where they have an access record (effective
 *   permission = OR-merge of the linked security group's flags and the row's
 *   own flags), plus every non-disabled project when they are a global member
 *   of any security group (the group's flags apply to all projects).
 */
interface GlobalFlags {
  canViewSummary: boolean;
  canEditEntries: boolean;
  canResetApproval: boolean;
}

/**
 * OR-merge of the flags of every security group the user is a GLOBAL member
 * of. These flags apply to every non-disabled project.
 */
async function getGlobalGroupFlags(userId: string): Promise<GlobalFlags> {
  const rows = await db
    .select({ group: securityGroupsTable })
    .from(securityGroupMembersTable)
    .innerJoin(
      securityGroupsTable,
      eq(securityGroupsTable.id, securityGroupMembersTable.securityGroupId),
    )
    .where(
      and(
        eq(securityGroupMembersTable.userId, userId),
        // Auto-assign groups grant access via per-project rows created at
        // project creation, NOT via global membership flags.
        eq(securityGroupsTable.autoAssignNewProjects, false),
      ),
    );
  return {
    canViewSummary: rows.some((r) => r.group.canViewSummary),
    canEditEntries: rows.some((r) => r.group.canEditEntries),
    canResetApproval: rows.some((r) => r.group.canResetApproval),
  };
}

export async function listVisibleProjects(
  userId: string,
  role: string,
): Promise<VisibleProject[]> {
  if (role === "admin") {
    const rows = await db.select().from(projectsTable).orderBy(projectsTable.name);
    return rows.map((p) => ({
      project: p,
      canViewSummary: true,
      canEditEntries: true,
      canResetApproval: true,
      isAdminOwned: true,
    }));
  }

  const [accessRows, globalFlags] = await Promise.all([
    db
      .select({
        access: projectAccessTable,
        group: securityGroupsTable,
      })
      .from(projectAccessTable)
      .leftJoin(
        securityGroupsTable,
        eq(securityGroupsTable.id, projectAccessTable.securityGroupId),
      )
      .where(eq(projectAccessTable.userId, userId)),
    getGlobalGroupFlags(userId),
  ]);

  const hasGlobalAccess =
    globalFlags.canViewSummary ||
    globalFlags.canEditEntries ||
    globalFlags.canResetApproval;

  const projectIds = accessRows.map((r) => r.access.projectId);
  if (projectIds.length === 0 && !hasGlobalAccess) return [];

  const projects = await db
    .select()
    .from(projectsTable)
    .where(
      hasGlobalAccess
        ? eq(projectsTable.disabled, false)
        : and(
            inArray(projectsTable.id, projectIds),
            eq(projectsTable.disabled, false),
          ),
    )
    .orderBy(projectsTable.name);

  const accessById = new Map(accessRows.map((r) => [r.access.projectId, r]));
  return projects.map((p) => {
    const r = accessById.get(p.id);
    const a = r?.access;
    const g = r?.group;
    return {
      project: p,
      canViewSummary:
        globalFlags.canViewSummary ||
        (g?.canViewSummary ?? false) ||
        (a?.canViewSummary ?? false),
      canEditEntries:
        globalFlags.canEditEntries ||
        (g?.canEditEntries ?? false) ||
        (a?.canEditEntries ?? false),
      canResetApproval:
        globalFlags.canResetApproval ||
        (g?.canResetApproval ?? false) ||
        (a?.canResetApproval ?? false),
      isAdminOwned: false,
    };
  });
}

export async function getProjectVisibility(
  userId: string,
  role: string,
  projectId: string,
): Promise<{
  project: typeof projectsTable.$inferSelect | null;
  canViewSummary: boolean;
  canEditEntries: boolean;
  canResetApproval: boolean;
  isAdminOwned: boolean;
}> {
  const [project] = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId));

  if (!project) {
    return {
      project: null,
      canViewSummary: false,
      canEditEntries: false,
      canResetApproval: false,
      isAdminOwned: false,
    };
  }

  if (role === "admin") {
    return {
      project,
      canViewSummary: true,
      canEditEntries: true,
      canResetApproval: true,
      isAdminOwned: true,
    };
  }

  // Disabled projects are invisible to non-admins, even with an access grant.
  if (project.disabled) {
    return {
      project: null,
      canViewSummary: false,
      canEditEntries: false,
      canResetApproval: false,
      isAdminOwned: false,
    };
  }

  const [[row], globalFlags] = await Promise.all([
    db
      .select({
        access: projectAccessTable,
        group: securityGroupsTable,
      })
      .from(projectAccessTable)
      .leftJoin(
        securityGroupsTable,
        eq(securityGroupsTable.id, projectAccessTable.securityGroupId),
      )
      .where(
        and(
          eq(projectAccessTable.userId, userId),
          eq(projectAccessTable.projectId, projectId),
        ),
      ),
    getGlobalGroupFlags(userId),
  ]);

  const a = row?.access;
  const g = row?.group;
  return {
    project,
    canViewSummary:
      globalFlags.canViewSummary ||
      (g?.canViewSummary ?? false) ||
      (a?.canViewSummary ?? false),
    canEditEntries:
      globalFlags.canEditEntries ||
      (g?.canEditEntries ?? false) ||
      (a?.canEditEntries ?? false),
    canResetApproval:
      globalFlags.canResetApproval ||
      (g?.canResetApproval ?? false) ||
      (a?.canResetApproval ?? false),
    isAdminOwned: false,
  };
}

export function serializeProject(
  v: VisibleProject,
  approvalChain: ChainEntry[],
) {
  const p = v.project;
  return {
    id: p.id,
    name: p.name,
    code: p.code,
    location: p.location,
    contractStart: p.contractStart,
    contractEnd: p.contractEnd,
    notes: p.notes,
    pdfRequired: !!(p as { pdfRequired?: boolean }).pdfRequired,
    disabled: !!(p as { disabled?: boolean }).disabled,
    backdatedDays:
      (p as { backdatedDays?: number | null }).backdatedDays ?? null,
    futureDays: (p as { futureDays?: number | null }).futureDays ?? null,
    createdAt: p.createdAt.toISOString(),
    isAdminOwned: v.isAdminOwned,
    currentUserCanViewSummary: v.canViewSummary,
    currentUserCanEditEntries: v.canEditEntries,
    currentUserCanResetApproval: v.canResetApproval,
    approvalChain,
  };
}
