import { MisMe, MisPermission } from "@workspace/api-client-react";

export function hasPermission(
  access: MisMe | null | undefined,
  permission: MisPermission,
  projectId?: string
): boolean {
  if (!access || !access.hasAccess) return false;
  if (access.permissions?.includes(permission)) return true;

  if (projectId) {
    const projPerms = access.projectPermissions?.find(p => p.projectId === projectId);
    if (projPerms?.permissions.includes(permission)) return true;
  } else {
    // If no project specified, return true if they have this permission on ANY project
    const hasInAnyProject = access.projectPermissions?.some(p => p.permissions.includes(permission));
    if (hasInAnyProject) return true;
  }

  return false;
}

export function hasAnyPermission(
  access: MisMe | null | undefined, 
  permissions: MisPermission[], 
  projectId?: string
): boolean {
  return permissions.some(p => hasPermission(access, p, projectId));
}
