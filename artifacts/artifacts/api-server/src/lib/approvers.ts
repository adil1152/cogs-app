import {
  db,
  projectApproverAssignmentsTable,
  usersTable,
} from "@workspace/db";
import { and, asc, eq } from "drizzle-orm";
import { getProjectChain, levelNameAt } from "./approvalChain";

export async function listProjectApprovers(projectId: string) {
  const [chain, rows] = await Promise.all([
    getProjectChain(projectId),
    db
      .select({ a: projectApproverAssignmentsTable, u: usersTable })
      .from(projectApproverAssignmentsTable)
      .leftJoin(
        usersTable,
        eq(usersTable.id, projectApproverAssignmentsTable.userId),
      )
      .where(eq(projectApproverAssignmentsTable.projectId, projectId))
      .orderBy(
        asc(projectApproverAssignmentsTable.level),
        asc(projectApproverAssignmentsTable.createdAt),
      ),
  ]);

  return rows.map(({ a, u }) => ({
    id: a.id,
    projectId: a.projectId,
    level: a.level,
    levelName: levelNameAt(chain, a.level),
    userId: a.userId,
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
  }));
}

/**
 * True iff a user is registered as an approver for a project at the given
 * level. If no assignments exist at all for that level the project has no
 * gating for it (legacy / new project) — admins can still proceed but
 * non-admins cannot, so this returns false.
 */
export async function isApproverFor(
  projectId: string,
  level: number,
  userId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: projectApproverAssignmentsTable.id })
    .from(projectApproverAssignmentsTable)
    .where(
      and(
        eq(projectApproverAssignmentsTable.projectId, projectId),
        eq(projectApproverAssignmentsTable.level, level),
        eq(projectApproverAssignmentsTable.userId, userId),
      ),
    )
    .limit(1);

  return !!row;
}
