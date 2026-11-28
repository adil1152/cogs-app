import { useState } from "react";
import {
  MisAuthority,
  MisAuthorityInput,
  MisPermission,
  MisRole,
  useMisCreateAuthority,
  useMisDeleteAuthority,
  useMisListAuthorities,
  useMisUpdateAuthority,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Search, ShieldAlert, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ProjectPicker } from "../components/ProjectPicker";
import { UserPicker } from "../components/UserPicker";
import { useDebounce } from "@/hooks/use-debounce";
import { useToast } from "@/hooks/use-toast";

const roles = Object.values(MisRole) as MisRole[];
const permissions = Array.from(new Set([...Object.values(MisPermission), "edit_approved"])) as MisPermission[];
const permissionLabels: Record<string, string> = {
  authorities: "Manage authorities",
  projects: "Manage projects",
  configuration: "Manage configuration",
  project_config: "Configure project",
  tabs: "Manage tabs",
  services: "Manage services",
  entries: "Legacy entry access",
  submit: "Submit entries",
  approve: "Approve / reject entries",
  reports: "View reports",
  export: "Export reports",
  financial: "View financial totals",
  history: "View entry history",
  reset: "Reset workflow",
  rate_override: "Edit service rate",
  delete_approved: "Delete approved entries",
  view_project: "View project",
  view_entries: "View entries",
  create_entries: "Create entries",
  edit_entries: "Edit entries",
  delete_entries: "Delete entries",
  edit_approved: "Edit approved entries",
  overhead: "Overhead settings",
  op_expense: "OP Expense settings",
};
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "The request could not be completed.";

function AuthorityDialog({ authority, projectId, open, onOpenChange }: { authority?: MisAuthority; projectId?: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const create = useMisCreateAuthority();
  const update = useMisUpdateAuthority();
  const [userId, setUserId] = useState<string | null>(authority?.userId ?? null);
  const [scopeProjectId, setScopeProjectId] = useState<string | null>(authority?.projectId ?? projectId ?? null);
  const [role, setRole] = useState<MisRole>(authority?.role ?? MisRole.viewer);
  const [extraPermissions, setExtraPermissions] = useState<MisPermission[]>(authority?.extraPermissions ?? []);
  const editing = Boolean(authority);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!userId) {
      toast({ title: "Select a user", description: "An authority grant must have a user.", variant: "destructive" });
      return;
    }
    const data: MisAuthorityInput = { userId, projectId: scopeProjectId, role, extraPermissions };
    const callbacks = {
      onSuccess: () => {
        void queryClient.invalidateQueries({ predicate: (query) => query.queryKey.some((part) => typeof part === "string" && part.includes("/api/mis")) });
        toast({ title: editing ? "Authority updated" : "Authority created" });
        onOpenChange(false);
      },
      onError: (error: unknown) => toast({ title: editing ? "Unable to update authority" : "Unable to create authority", description: errorMessage(error), variant: "destructive" as const }),
    };
    if (authority) update.mutate({ id: authority.id, data }, callbacks);
    else create.mutate({ data }, callbacks);
  };
  const togglePermission = (permission: MisPermission) => setExtraPermissions((current) => current.includes(permission) ? current.filter((item) => item !== permission) : [...current, permission]);

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[620px]"><DialogHeader><DialogTitle>{editing ? "Edit authority" : "Create authority"}</DialogTitle></DialogHeader>
    <form onSubmit={submit} className="space-y-5"><div className="space-y-2"><Label>User</Label><UserPicker value={userId} onChange={setUserId} disabled={editing} selectedLabel={authority?.user.displayName} /><p className="text-xs text-muted-foreground">{editing ? "The user on an existing grant cannot be changed." : "Search registered users; no identifier entry is required."}</p></div>
      <div className="space-y-2"><Label>Scope</Label><ProjectPicker value={scopeProjectId} onChange={setScopeProjectId} selectedLabel={authority?.projectName} disabled={Boolean(projectId)} /><p className="text-xs text-muted-foreground">{projectId ? "This security screen is locked to the current project." : "Choose Global for organization-wide access, or select one project."}</p></div>
      <div className="space-y-2"><Label>Role</Label><Select value={role} onValueChange={(value) => setRole(value as MisRole)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{roles.map((item) => <SelectItem key={item} value={item}>{item.replace("_", " ")}</SelectItem>)}</SelectContent></Select></div>
      <div className="space-y-3 border-t pt-4"><div><Label>Permissions</Label><p className="mt-1 text-xs text-muted-foreground">{role === "custom" ? "Custom roles inherit nothing; select every permission explicitly." : "These add to a role and never remove its standard permissions."}</p></div><div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" onClick={() => setExtraPermissions(["view_project", "view_entries"])}>View</Button><Button type="button" size="sm" variant="outline" onClick={() => setExtraPermissions(["view_project", "view_entries", "create_entries", "edit_entries"])}>View + Edit</Button><Button type="button" size="sm" variant="outline" onClick={() => setExtraPermissions(["view_project", "view_entries", "create_entries", "edit_entries", "delete_entries", "approve", "reports", "export", "rate_override"])}>Full Access</Button></div><div className="grid grid-cols-2 gap-3">{permissions.map((permission) => <label key={permission} className="flex cursor-pointer items-center gap-2 text-sm"><Checkbox checked={extraPermissions.includes(permission)} onCheckedChange={() => togglePermission(permission)} />{permissionLabels[permission]}</label>)}</div></div>
      <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" disabled={create.isPending || update.isPending}>{editing ? "Save changes" : "Create authority"}</Button></DialogFooter>
    </form>
  </DialogContent></Dialog>;
}

export default function Authorities({ projectId }: { projectId?: string; params?: unknown } = {}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const remove = useMisDeleteAuthority();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<MisAuthority | null>(null);
  const debouncedSearch = useDebounce(search, 300);
  const params = { projectId, search: debouncedSearch || undefined, page, pageSize: 20 };
  const { data, isLoading, isError } = useMisListAuthorities(params);
  const deleteAuthority = (authority: MisAuthority) => {
    if (!window.confirm(`Remove ${authority.user.displayName}'s ${authority.role.replace("_", " ")} authority?`)) return;
    remove.mutate({ id: authority.id }, {
      onSuccess: () => {
         void queryClient.invalidateQueries({ predicate: (query) => query.queryKey.some((part) => typeof part === "string" && part.includes("/api/mis")) });
        toast({ title: "Authority removed" });
      },
      onError: (error) => toast({ title: "Unable to remove authority", description: errorMessage(error), variant: "destructive" }),
    });
  };
  return <div className="space-y-6">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center"><div><h1 className="text-3xl font-semibold tracking-tight">Authorities</h1><p className="mt-1 text-muted-foreground">Manage global and project-scoped MIS role grants.</p></div><Button onClick={() => setCreating(true)}><Plus className="mr-2 h-4 w-4" />Add authority</Button></div>
    <div className="relative max-w-sm"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" /><Input className="pl-9" value={search} placeholder="Search user name or email…" onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></div>
    <AuthorityDialog key={`new-${creating}-${projectId ?? "global"}`} projectId={projectId} open={creating} onOpenChange={setCreating} />
    {editing && <AuthorityDialog key={editing.id} authority={editing} projectId={projectId} open onOpenChange={(open) => !open && setEditing(null)} />}
    <Card><CardHeader><CardTitle>{projectId ? "Project security" : "Role grants"}</CardTitle><CardDescription>{projectId ? "Assign only this project's MIS permissions. Global roles are managed from the global security screen." : "Roles: mis admin, mis manager, project manager, finance, data entry, viewer, and custom."}</CardDescription></CardHeader><CardContent><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b bg-muted/50"><tr><th className="p-3">User</th><th className="p-3">Role</th><th className="p-3">Scope</th><th className="p-3">Permissions</th><th className="p-3 text-right">Actions</th></tr></thead><tbody className="divide-y">
        {isLoading ? <tr><td colSpan={5}><Skeleton className="m-3 h-8 w-full" /></td></tr> : isError ? <tr><td colSpan={5} className="p-10 text-center text-destructive">Authorities could not be loaded. Please retry.</td></tr> : data?.items.length ? data.items.map((authority) => { const readablePermissions = authority.extraPermissions.map((permission) => permissionLabels[permission] ?? permission).join(", "); return <tr key={authority.id}><td className="p-3 font-medium">{authority.user.displayName}<div className="text-xs font-normal text-muted-foreground">{authority.user.email}</div></td><td className="p-3 capitalize">{authority.role.replace("_", " ")}</td><td className="p-3">{authority.projectName ?? "Global"}</td><td className="max-w-xs truncate p-3 text-xs text-muted-foreground" title={readablePermissions}>{readablePermissions || "—"}</td><td className="space-x-1 p-3 text-right"><Button aria-label={`Edit authority for ${authority.user.displayName}`} variant="ghost" size="icon" onClick={() => setEditing(authority)}><Pencil className="h-4 w-4" /></Button><Button aria-label={`Delete authority for ${authority.user.displayName}`} variant="ghost" size="icon" disabled={remove.isPending} onClick={() => deleteAuthority(authority)}><Trash2 className="h-4 w-4 text-destructive" /></Button></td></tr>; }) : <tr><td colSpan={5} className="p-12 text-center text-muted-foreground"><ShieldAlert className="mx-auto mb-3 h-8 w-8 opacity-20" />No authorities found.</td></tr>}
    </tbody></table></div>
    {data && data.total > 0 && <div className="mt-4 flex items-center justify-between border-t pt-4 text-sm text-muted-foreground"><span>Showing {(data.page - 1) * data.pageSize + 1}–{Math.min(data.page * data.pageSize, data.total)} of {data.total}</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Previous</Button><Button variant="outline" size="sm" disabled={page * data.pageSize >= data.total} onClick={() => setPage((current) => current + 1)}>Next</Button></div></div>}
    </CardContent></Card>
  </div>;
}