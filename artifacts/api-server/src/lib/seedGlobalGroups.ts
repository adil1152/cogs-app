import { db, securityGroupsTable } from "@workspace/db";
import { logger } from "./logger";

/**
 * Idempotently ensures the two built-in "all projects" security groups exist.
 * Members of these groups (via security_group_members) get the flags on every
 * non-disabled project. Safe to run on every startup — conflicts on the
 * unique group name are ignored.
 */
export async function seedGlobalGroups(): Promise<void> {
  try {
    await db
      .insert(securityGroupsTable)
      .values([
        {
          name: "All Projects — Report Viewer",
          description: "Members can view every project's summary reports.",
          canViewSummary: true,
          canEditEntries: false,
          canResetApproval: false,
        },
        {
          name: "All Projects — Entry Editor",
          description:
            "Members can create and edit daily entries on every project.",
          canViewSummary: false,
          canEditEntries: true,
          canResetApproval: false,
        },
      ])
      .onConflictDoNothing({ target: securityGroupsTable.name });
  } catch (err) {
    logger.error({ err }, "Failed to seed global security groups");
  }
}
