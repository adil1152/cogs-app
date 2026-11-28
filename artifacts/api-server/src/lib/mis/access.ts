import { and, eq, isNull } from "drizzle-orm";
import { db, misAuthoritiesTable } from "@workspace/db";

export const MIS_PERMISSIONS = [
  "authorities", "projects", "configuration", "project_config", "tabs", "services",
  "entries", "submit", "approve", "reports", "export", "financial", "history",
  "reset", "rate_override", "delete_approved",
  "edit_approved",
  "overhead", "op_expense",
  "view_project", "view_entries", "create_entries", "edit_entries", "delete_entries",
] as const;
export type MisPermission = (typeof MIS_PERMISSIONS)[number];
export type MisRole = "mis_admin" | "mis_manager" | "project_manager" | "finance" | "data_entry" | "viewer" | "custom";

const all = new Set<MisPermission>(MIS_PERMISSIONS);
const rolePermissions: Record<MisRole, Set<MisPermission>> = {
  mis_admin: all,
  // Legacy roles retain every permission they had before granular entry
  // permissions were introduced. The granular values are additive aliases,
  // not a migration of existing grants.
  mis_manager: new Set(["projects", "configuration", "tabs", "services", "entries", "submit", "approve", "reports", "export", "financial", "history", "reset", "rate_override", "delete_approved", "view_project", "view_entries", "create_entries", "edit_entries", "delete_entries"]),
  project_manager: new Set(["project_config", "services", "entries", "submit", "reports", "export", "financial", "history", "rate_override", "view_project", "view_entries", "create_entries", "edit_entries", "delete_entries"]),
  finance: new Set(["entries", "submit", "approve", "reports", "export", "financial", "history", "rate_override", "reset", "view_project", "view_entries", "create_entries", "edit_entries", "delete_entries"]),
  data_entry: new Set(["entries", "submit", "history", "view_project", "view_entries", "create_entries", "edit_entries", "delete_entries"]),
  // Viewers historically could list entries in their project scope. Keep that
  // behavior while still requiring the new granular permission everywhere.
  viewer: new Set(["reports", "history", "view_project", "view_entries"]),
  // Custom grants deliberately inherit nothing. Administrators must select
  // each requested permission explicitly.
  custom: new Set(),
};

export interface MisAccess {
  userId: string;
  globalAccess: boolean;
  globalRoles: MisRole[];
  roles: MisRole[];
  globalPermissions: Set<MisPermission>;
  projectPermissions: Map<string, Set<MisPermission>>;
  projectIds: string[];
}

function safePermissions(value: unknown): MisPermission[] {
  return Array.isArray(value) ? value.filter((p): p is MisPermission => typeof p === "string" && (MIS_PERMISSIONS as readonly string[]).includes(p)) : [];
}

const legacyPermissionAliases: Partial<Record<MisPermission, readonly MisPermission[]>> = {
  entries: ["view_entries", "create_entries", "edit_entries", "delete_entries"],
};

export async function loadMisAccess(userId: string): Promise<MisAccess> {
  const grants = await db.select().from(misAuthoritiesTable).where(eq(misAuthoritiesTable.userId, userId));
  const globalPermissions = new Set<MisPermission>();
  const projectPermissions = new Map<string, Set<MisPermission>>();
  const roles = new Set<MisRole>();
  const globalRoles: MisRole[] = [];
  for (const grant of grants) {
    const role = grant.role as MisRole;
    if (!rolePermissions[role]) continue;
    const explicitPermissions = safePermissions(grant.extraPermissions);
    const permissions = new Set<MisPermission>([
      ...rolePermissions[role],
      ...explicitPermissions,
      ...explicitPermissions.flatMap((permission) => legacyPermissionAliases[permission] ?? []),
    ]);
    if (permissions.size === 0) continue;
    roles.add(role);
    if (grant.projectId == null) {
      globalRoles.push(role);
      for (const permission of permissions) globalPermissions.add(permission);
    } else {
      const bucket = projectPermissions.get(grant.projectId) ?? new Set<MisPermission>();
      for (const permission of permissions) bucket.add(permission);
      projectPermissions.set(grant.projectId, bucket);
    }
  }
  return {
    userId, globalAccess: globalPermissions.size > 0, globalRoles, roles: [...roles],
    globalPermissions, projectPermissions: new Map([...projectPermissions.entries()].filter(([, permissions]) => permissions.size > 0)),
    projectIds: [...projectPermissions.entries()].filter(([, permissions]) => permissions.size > 0).map(([projectId]) => projectId),
  };
}

export function permissionsForProject(access: MisAccess, projectId: string): Set<MisPermission> {
  if (access.globalAccess) return new Set([...access.globalPermissions, ...(access.projectPermissions.get(projectId) ?? [])]);
  return new Set(access.projectPermissions.get(projectId) ?? []);
}
export function can(access: MisAccess, permission: MisPermission, projectId?: string): boolean {
  return projectId == null ? access.globalPermissions.has(permission) : permissionsForProject(access, projectId).has(permission);
}
export function canAccessProject(access: MisAccess, projectId: string): boolean {
  return access.globalAccess || (access.projectPermissions.get(projectId)?.size ?? 0) > 0;
}
export function isGlobalMisAdmin(access: MisAccess): boolean {
  return access.globalRoles.includes("mis_admin");
}
export function isKnownPermission(value: string): value is MisPermission {
  return (MIS_PERMISSIONS as readonly string[]).includes(value);
}
export async function countGlobalMisAdmins(): Promise<number> {
  const rows = await db.select({ id: misAuthoritiesTable.id }).from(misAuthoritiesTable)
    .where(and(eq(misAuthoritiesTable.role, "mis_admin"), isNull(misAuthoritiesTable.projectId)));
  return rows.length;
}