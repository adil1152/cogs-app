import {
  db,
  projectsTable,
  projectAccessTable,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";

export interface VisibleProject {
  project: typeof projectsTable.$inferSelect;
  canViewSummary: boolean;
  canEditEntries: boolean;
  isAdminOwned: boolean;
}

/**
 * Returns all projects visible to a user.
 * - Admins see all projects (full access).
 * - Regular users see projects where they have an access record OR are the creator.
 */
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
      isAdminOwned: true,
    }));
  }

  const accessRows = await db
    .select()
    .from(projectAccessTable)
    .where(eq(projectAccessTable.userId, userId));

  const projectIds = accessRows.map((a) => a.projectId);
  if (projectIds.length === 0) return [];

  const projects = await db
    .select()
    .from(projectsTable)
    .where(inArray(projectsTable.id, projectIds));

  const accessById = new Map(accessRows.map((a) => [a.projectId, a]));
  return projects.map((p) => {
    const a = accessById.get(p.id);
    return {
      project: p,
      canViewSummary: a?.canViewSummary ?? false,
      canEditEntries: a?.canEditEntries ?? false,
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
  isAdminOwned: boolean;
}> {
  const [project] = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId));

  if (!project) {
    return { project: null, canViewSummary: false, canEditEntries: false, isAdminOwned: false };
  }

  if (role === "admin") {
    return {
      project,
      canViewSummary: true,
      canEditEntries: true,
      isAdminOwned: true,
    };
  }

  const [access] = await db
    .select()
    .from(projectAccessTable)
    .where(
      and(
        eq(projectAccessTable.userId, userId),
        eq(projectAccessTable.projectId, projectId),
      ),
    );

  return {
    project,
    canViewSummary: access?.canViewSummary ?? false,
    canEditEntries: access?.canEditEntries ?? false,
    isAdminOwned: false,
  };
}

export function serializeProject(v: VisibleProject) {
  const p = v.project;
  return {
    id: p.id,
    name: p.name,
    location: p.location,
    contractStart: p.contractStart,
    contractEnd: p.contractEnd,
    notes: p.notes,
    createdAt: p.createdAt.toISOString(),
    isAdminOwned: v.isAdminOwned,
    currentUserCanViewSummary: v.canViewSummary,
    currentUserCanEditEntries: v.canEditEntries,
  };
}
