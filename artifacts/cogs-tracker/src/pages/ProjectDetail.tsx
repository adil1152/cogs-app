import { useEffect, useMemo, useState } from "react";
import { Link, useRoute } from "wouter";
import { useForm } from "react-hook-form";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetProject,
  useListProjectServices,
  useListProjectAccess,
  useListProjectEntries,
  useListUsers,
  useCreateProjectService,
  useUpdateProjectService,
  useDeleteProjectService,
  useReorderProjectServices,
  useGrantProjectAccess,
  useUpdateProjectAccess,
  useRevokeProjectAccess,
  useListSecurityGroups,
  getListSecurityGroupsQueryKey,
  useUpdateProject,
  useDeleteProject,
  useListProjectApprovers,
  useSetProjectApprovers,
  useSetProjectApprovalChain,
  getGetProjectQueryKey,
  getListProjectServicesQueryKey,
  getListProjectAccessQueryKey,
  getListProjectEntriesQueryKey,
  getListProjectsQueryKey,
  getListUsersQueryKey,
  getListProjectApproversQueryKey,
  type ApprovalChainEntry,
  type CreateProjectServiceBody,
  type GrantAccessBody,
  type UpdateProjectBody,
} from "@workspace/api-client-react";
import { useAuth } from "@workspace/replit-auth-web";
import { AppLayout, PageHeader } from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
import { Lock, Plus, Trash2, MapPin, Calendar, Pencil, BarChart3, ArrowUp, ArrowDown, Check, X, GripVertical } from "lucide-react";

export default function ProjectDetail() {
  const [, params] = useRoute("/projects/:id");
  const id = params?.id ?? "";
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const { data: project, isLoading } = useGetProject(id, {
    query: { enabled: !!id, queryKey: getGetProjectQueryKey(id) },
  });
  const { data: services } = useListProjectServices(id, {
    query: { enabled: !!id, queryKey: getListProjectServicesQueryKey(id) },
  });
  const { data: entries } = useListProjectEntries(id, undefined, {
    query: { enabled: !!id, queryKey: getListProjectEntriesQueryKey(id) },
  });

  if (!id) return null;

  return (
    <AppLayout>
      <PageHeader
        title={isLoading ? "Loading…" : project?.name ?? "Project"}
        subtitle={
          project ? (
            <span className="inline-flex items-center gap-3 text-sm text-muted-foreground">
              {project.code && (
                <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider text-foreground">
                  {project.code}
                </span>
              )}
              <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{project.location}</span>
              <span className="inline-flex items-center gap-1"><Calendar className="h-3.5 w-3.5" />{formatDate(project.contractStart)} → {formatDate(project.contractEnd)}</span>
            </span>
          ) as any
          : undefined
        }
        actions={
          <div className="flex gap-2">
            <Link href={`/projects/${id}/summary`}>
              <Button variant="outline" data-testid="button-summary"><BarChart3 className="mr-2 h-4 w-4" /> Summary</Button>
            </Link>
            <Link href={`/projects/${id}/entries/new`}>
              <Button data-testid="button-new-entry"><Plus className="mr-2 h-4 w-4" /> New entry</Button>
            </Link>
          </div>
        }
      />
      <div className="px-8 py-6">
        <Tabs defaultValue="entries">
          <TabsList>
            <TabsTrigger value="entries" data-testid="tab-entries">Daily entries</TabsTrigger>
            <TabsTrigger value="services" data-testid="tab-services">Services</TabsTrigger>
            <TabsTrigger value="security" data-testid="tab-security">
              <Lock className="mr-1.5 h-3.5 w-3.5" /> Security
            </TabsTrigger>
            {isAdmin && (
              <TabsTrigger value="approvers" data-testid="tab-approvers">
                Approvers
              </TabsTrigger>
            )}
            {isAdmin && <TabsTrigger value="settings" data-testid="tab-settings">Settings</TabsTrigger>}
          </TabsList>

          <TabsContent value="entries" className="mt-4">
            <EntriesPanel projectId={id} entries={entries ?? []} />
          </TabsContent>

          <TabsContent value="services" className="mt-4">
            <ServicesPanel projectId={id} services={services ?? []} canEdit={isAdmin} />
          </TabsContent>

          <TabsContent value="security" className="mt-4">
            <SecurityPanel projectId={id} canEdit={isAdmin} />
          </TabsContent>

          {isAdmin && (
            <TabsContent value="approvers" className="mt-4">
              <ApproversPanel projectId={id} project={project} isAdmin={isAdmin} />
            </TabsContent>
          )}

          {isAdmin && project && (
            <TabsContent value="settings" className="mt-4">
              <SettingsPanel project={project} />
            </TabsContent>
          )}
        </Tabs>
      </div>
    </AppLayout>
  );
}

function EntriesPanel({ projectId, entries }: { projectId: string; entries: Array<any> }) {
  if (entries.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          No daily entries yet — log today's mandays to get started.
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">#</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Location</TableHead>
              <TableHead className="text-right">Mandays</TableHead>
              <TableHead className="text-right">Total cost</TableHead>
              <TableHead className="text-right">SAR / manday</TableHead>
              <TableHead className="text-center">Status</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((e) => (
              <TableRow key={e.id} data-testid={`entry-row-${e.id}`}>
                <TableCell className="font-mono text-xs text-muted-foreground tabular-nums">
                  {e.sequenceCode ?? "—"}
                </TableCell>
                <TableCell className="font-medium">{formatDate(e.entryDate)}</TableCell>
                <TableCell>{e.location}</TableCell>
                <TableCell className="text-right tabular-nums">{formatNumber(e.totalMandays, 1)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatCurrency(e.totalCost)}</TableCell>
                <TableCell className="text-right tabular-nums">{e.totalMandays ? formatCurrency(e.costPerManday) : "—"}</TableCell>
                <TableCell className="text-center">
                  {e.isLocked || e.status === "approved" ? (
                    <Badge variant="default" className="gap-1"><Lock className="h-3 w-3" /> Locked</Badge>
                  ) : e.status === "pending" ? (
                    <Badge variant="secondary">
                      Pending {(e.currentApprovalLevel ?? 0) > 0 ? `· ${e.currentApprovalLevel}/5` : ""}
                    </Badge>
                  ) : (
                    <Badge variant="outline">Draft</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <Link href={`/projects/${projectId}/entries/${e.id}`}>
                    <Button variant="ghost" size="sm">{e.isLocked ? "View" : "Edit"}</Button>
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function ServicesPanel({ projectId, services, canEdit }: { projectId: string; services: Array<any>; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { register, handleSubmit, reset, watch, setValue } = useForm<CreateProjectServiceBody>({
    defaultValues: { kind: "standard" as any },
  });
  const kind = watch("kind");
  const sorted = useMemo(
    () => [...services].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name)),
    [services],
  );
  const invalidateServices = () => {
    queryClient.invalidateQueries({ queryKey: getListProjectServicesQueryKey(projectId) });
    queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(projectId) });
  };
  const createService = useCreateProjectService({
    mutation: {
      onSuccess: () => {
        toast({ title: "Service added" });
        invalidateServices();
        reset({ kind: "standard" as any });
      },
      onError: (err: any) => toast({ title: "Could not add service", description: err.message, variant: "destructive" }),
    },
  });
  const deleteService = useDeleteProjectService({
    mutation: {
      onSuccess: () => {
        toast({ title: "Service removed" });
        invalidateServices();
      },
    },
  });
  const reorder = useReorderProjectServices({
    mutation: {
      onSuccess: () => invalidateServices(),
      onError: (err: any) => toast({ title: "Reorder failed", description: err.message, variant: "destructive" }),
    },
  });

  function move(idx: number, dir: -1 | 1) {
    const target = idx + dir;
    if (target < 0 || target >= sorted.length) return;
    const next = sorted.slice();
    [next[idx], next[target]] = [next[target], next[idx]];
    reorder.mutate({
      id: projectId,
      data: { services: next.map((s, i) => ({ id: s.id, sortOrder: i })) },
    });
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <Card className="lg:col-span-2">
        <CardHeader><CardTitle className="text-base">Services for this project</CardTitle></CardHeader>
        <CardContent className="p-0">
          {sorted.length === 0 ? (
            <div className="px-6 py-8 text-sm text-muted-foreground text-center">
              No services configured yet. Add services like Catering, Transport, Accommodation — each daily entry will record cost and mandays per service.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Kind</TableHead>
                  {canEdit && <TableHead className="text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((s, i) => (
                  <ServiceRow
                    key={s.id}
                    service={s}
                    canEdit={canEdit}
                    isFirst={i === 0}
                    isLast={i === sorted.length - 1}
                    onMoveUp={() => move(i, -1)}
                    onMoveDown={() => move(i, 1)}
                    onDelete={() => deleteService.mutate({ id: s.id })}
                    onRenamed={invalidateServices}
                  />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {canEdit && (
        <Card>
          <CardHeader><CardTitle className="text-base">Add a service</CardTitle></CardHeader>
          <CardContent>
            <form
              onSubmit={handleSubmit((data) => createService.mutate({ id: projectId, data }))}
              className="space-y-3"
            >
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Name</Label>
                <Input {...register("name", { required: true })} placeholder="e.g. Catering" data-testid="input-service-name" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Kind</Label>
                <Select value={kind as string} onValueChange={(v) => setValue("kind", v as any)}>
                  <SelectTrigger data-testid="select-service-kind"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="standard">Standard</SelectItem>
                    <SelectItem value="food">Food</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" className="w-full" disabled={createService.isPending} data-testid="button-add-service">
                Add service
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ServiceRow({
  service,
  canEdit,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
  onDelete,
  onRenamed,
}: {
  service: any;
  canEdit: boolean;
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  onRenamed: () => void;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(service.name);
  const update = useUpdateProjectService({
    mutation: {
      onSuccess: () => {
        toast({ title: "Service renamed" });
        setEditing(false);
        onRenamed();
      },
      onError: (err: any) => toast({ title: "Rename failed", description: err.message, variant: "destructive" }),
    },
  });

  return (
    <TableRow data-testid={`service-row-${service.id}`}>
      <TableCell className="font-medium">
        {editing ? (
          <div className="flex items-center gap-1">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-8 max-w-xs"
              autoFocus
              data-testid={`input-rename-${service.id}`}
              onKeyDown={(e) => {
                if (e.key === "Enter") update.mutate({ id: service.id, data: { name } });
                if (e.key === "Escape") { setName(service.name); setEditing(false); }
              }}
            />
            <Button
              size="icon" variant="ghost" className="h-8 w-8"
              onClick={() => update.mutate({ id: service.id, data: { name } })}
              disabled={update.isPending || !name.trim()}
              data-testid={`save-rename-${service.id}`}
            >
              <Check className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="icon" variant="ghost" className="h-8 w-8"
              onClick={() => { setName(service.name); setEditing(false); }}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          service.name
        )}
      </TableCell>
      <TableCell>
        <Badge variant={service.kind === "food" ? "default" : "secondary"}>{service.kind}</Badge>
      </TableCell>
      {canEdit && (
        <TableCell className="text-right">
          <div className="inline-flex items-center gap-0.5">
            <Button size="icon" variant="ghost" className="h-8 w-8" disabled={isFirst} onClick={onMoveUp} data-testid={`move-up-${service.id}`}>
              <ArrowUp className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon" variant="ghost" className="h-8 w-8" disabled={isLast} onClick={onMoveDown} data-testid={`move-down-${service.id}`}>
              <ArrowDown className="h-3.5 w-3.5" />
            </Button>
            {!editing && (
              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setEditing(true)} data-testid={`rename-${service.id}`}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button
              size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:text-destructive"
              onClick={onDelete}
              data-testid={`delete-service-${service.id}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </TableCell>
      )}
    </TableRow>
  );
}

const NO_GROUP = "__none__";

function SecurityPanel({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const { data: access } = useListProjectAccess(projectId, {
    query: { enabled: !!projectId && canEdit, queryKey: getListProjectAccessQueryKey(projectId) },
  });
  const { data: users } = useListUsers({
    query: { enabled: canEdit, queryKey: getListUsersQueryKey() },
  });
  const { data: groups } = useListSecurityGroups({
    query: { enabled: canEdit, queryKey: getListSecurityGroupsQueryKey() },
  });

  if (!canEdit) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          <Lock className="h-5 w-5 mx-auto mb-2 text-muted-foreground/60" />
          Only admins can manage project access.
        </CardContent>
      </Card>
    );
  }

  const grantedIds = new Set((access ?? []).map((a) => a.userId));
  const ungranted = (users ?? []).filter((u) => !grantedIds.has(u.id));
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListProjectAccessQueryKey(projectId) });
  };
  return (
    <div className="space-y-4">
      <Card className="border-accent/30 bg-accent/5">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Lock className="h-4 w-4 text-accent" /> Security field
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Pick a security group to grant a baseline set of permissions, and tick
            extra boxes to layer additional ones on top. The effective permission
            shown to the user is the OR-merge of the group and the row's extras.
            Admins always have full access.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          {access && access.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead className="w-[200px]">Security group</TableHead>
                  <TableHead className="text-center">View summary</TableHead>
                  <TableHead className="text-center">Edit entries</TableHead>
                  <TableHead className="text-center">Reset to draft</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {access.map((a) => (
                  <AccessRow
                    key={a.id}
                    access={a}
                    groups={groups ?? []}
                    onChange={invalidate}
                  />
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="px-6 py-8 text-sm text-muted-foreground text-center">
              Nobody has been granted access yet.
            </div>
          )}
        </CardContent>
      </Card>
      <GrantAccessCard
        projectId={projectId}
        users={ungranted}
        groups={groups ?? []}
        onGranted={invalidate}
      />
    </div>
  );
}

function PermCell({
  effective,
  fromGroup,
  fromRow,
  onToggleRow,
  testid,
}: {
  effective: boolean;
  fromGroup: boolean;
  fromRow: boolean;
  onToggleRow: (next: boolean) => void;
  testid: string;
}) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <Checkbox
        checked={fromRow}
        onCheckedChange={(v) => onToggleRow(!!v)}
        data-testid={testid}
        title="Grant this permission as a per-row extra"
      />
      {fromGroup ? (
        <span
          className="text-[9px] uppercase tracking-wider text-emerald-600"
          title="Granted by the assigned security group"
        >
          via group
        </span>
      ) : effective ? null : (
        <span className="text-[9px] uppercase tracking-wider text-muted-foreground/50">
          off
        </span>
      )}
    </div>
  );
}

function AccessRow({
  access,
  groups,
  onChange,
}: {
  access: any;
  groups: Array<{ id: string; name: string }>;
  onChange: () => void;
}) {
  const { toast } = useToast();
  const update = useUpdateProjectAccess({
    mutation: {
      onSuccess: () => { onChange(); toast({ title: "Permissions updated" }); },
      onError: (err: any) => toast({ title: "Update failed", description: err.message, variant: "destructive" }),
    },
  });
  const revoke = useRevokeProjectAccess({
    mutation: {
      onSuccess: () => { onChange(); toast({ title: "Access revoked" }); },
    },
  });
  const groupFlags = {
    view: !!access.securityGroup?.canViewSummary,
    edit: !!access.securityGroup?.canEditEntries,
    reset: !!access.securityGroup?.canResetApproval,
  };
  return (
    <TableRow data-testid={`access-row-${access.userId}`}>
      <TableCell>
        <div className="font-medium">{access.user.firstName ?? access.user.email}</div>
        <div className="text-xs text-muted-foreground">{access.user.email}</div>
      </TableCell>
      <TableCell>
        <Select
          value={access.securityGroupId ?? NO_GROUP}
          onValueChange={(v) =>
            update.mutate({
              id: access.id,
              data: { securityGroupId: v === NO_GROUP ? null : v },
            })
          }
        >
          <SelectTrigger data-testid={`access-group-${access.userId}`} className="h-8">
            <SelectValue placeholder="None" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_GROUP}>— None —</SelectItem>
            {groups.map((g) => (
              <SelectItem key={g.id} value={g.id}>
                {g.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell className="text-center">
        <PermCell
          effective={access.effectiveCanViewSummary}
          fromGroup={groupFlags.view}
          fromRow={access.canViewSummary}
          onToggleRow={(v) =>
            update.mutate({ id: access.id, data: { canViewSummary: v } })
          }
          testid={`access-summary-${access.userId}`}
        />
      </TableCell>
      <TableCell className="text-center">
        <PermCell
          effective={access.effectiveCanEditEntries}
          fromGroup={groupFlags.edit}
          fromRow={access.canEditEntries}
          onToggleRow={(v) =>
            update.mutate({ id: access.id, data: { canEditEntries: v } })
          }
          testid={`access-edit-${access.userId}`}
        />
      </TableCell>
      <TableCell className="text-center">
        <PermCell
          effective={access.effectiveCanResetApproval}
          fromGroup={groupFlags.reset}
          fromRow={access.canResetApproval}
          onToggleRow={(v) =>
            update.mutate({ id: access.id, data: { canResetApproval: v } })
          }
          testid={`access-reset-${access.userId}`}
        />
      </TableCell>
      <TableCell className="text-right">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => revoke.mutate({ id: access.id })}
          data-testid={`revoke-access-${access.userId}`}
        >
          Revoke
        </Button>
      </TableCell>
    </TableRow>
  );
}

function GrantAccessCard({
  projectId,
  users,
  groups,
  onGranted,
}: {
  projectId: string;
  users: Array<any>;
  groups: Array<{ id: string; name: string }>;
  onGranted: () => void;
}) {
  const { toast } = useToast();
  const [userId, setUserId] = useState<string>("");
  const [securityGroupId, setSecurityGroupId] = useState<string>(NO_GROUP);
  const [canViewSummary, setCanViewSummary] = useState(true);
  const [canEditEntries, setCanEditEntries] = useState(false);
  const [canResetApproval, setCanResetApproval] = useState(false);
  const grant = useGrantProjectAccess({
    mutation: {
      onSuccess: () => {
        toast({ title: "Access granted" });
        setUserId("");
        setSecurityGroupId(NO_GROUP);
        setCanEditEntries(false);
        setCanViewSummary(true);
        setCanResetApproval(false);
        onGranted();
      },
      onError: (err: any) => toast({ title: "Could not grant access", description: err.message, variant: "destructive" }),
    },
  });

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Grant access</CardTitle></CardHeader>
      <CardContent>
        {users.length === 0 ? (
          <div className="text-sm text-muted-foreground">All users already have access.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-[1.4fr_1fr_auto_auto_auto_auto] gap-3 items-end">
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">User</Label>
              <Select value={userId} onValueChange={setUserId}>
                <SelectTrigger data-testid="select-grant-user"><SelectValue placeholder="Choose a user" /></SelectTrigger>
                <SelectContent>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.firstName ?? u.email} — {u.email}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Security group</Label>
              <Select value={securityGroupId} onValueChange={setSecurityGroupId}>
                <SelectTrigger data-testid="select-grant-group"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_GROUP}>— None —</SelectItem>
                  {groups.map((g) => (
                    <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center gap-2 text-xs">
              <Checkbox checked={canViewSummary} onCheckedChange={(v) => setCanViewSummary(!!v)} data-testid="checkbox-grant-summary" />
              View summary
            </label>
            <label className="flex items-center gap-2 text-xs">
              <Checkbox checked={canEditEntries} onCheckedChange={(v) => setCanEditEntries(!!v)} data-testid="checkbox-grant-edit" />
              Edit entries
            </label>
            <label className="flex items-center gap-2 text-xs">
              <Checkbox
                checked={canResetApproval}
                onCheckedChange={(v) => setCanResetApproval(!!v)}
                data-testid="checkbox-grant-reset"
              />
              Reset to draft
            </label>
            <Button
              disabled={!userId || grant.isPending}
              onClick={() =>
                grant.mutate({
                  id: projectId,
                  data: {
                    userId,
                    securityGroupId: securityGroupId === NO_GROUP ? null : securityGroupId,
                    canViewSummary,
                    canEditEntries,
                    canResetApproval,
                  } as GrantAccessBody,
                })
              }
              data-testid="button-grant"
            >
              Grant
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ApproversPanel({
  projectId,
  project,
  isAdmin,
}: {
  projectId: string;
  project: { approvalChain?: ApprovalChainEntry[] } | undefined;
  isAdmin: boolean;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: assignments } = useListProjectApprovers(projectId, {
    query: {
      enabled: !!projectId,
      queryKey: getListProjectApproversQueryKey(projectId),
    },
  });
  const { data: users } = useListUsers({
    query: { queryKey: getListUsersQueryKey() },
  });
  const { data: access } = useListProjectAccess(projectId, {
    query: { queryKey: getListProjectAccessQueryKey(projectId) },
  });

  // Server-truth chain (with default fallback if absent).
  const serverChain: ApprovalChainEntry[] = useMemo(
    () =>
      project?.approvalChain && project.approvalChain.length > 0
        ? [...project.approvalChain].sort((a, b) => a.position - b.position)
        : [
            { position: 1, levelName: "OP" },
            { position: 2, levelName: "SOP" },
            { position: 3, levelName: "COO" },
            { position: 4, levelName: "CC" },
            { position: 5, levelName: "Additional" },
          ],
    [project],
  );

  // Eligible users: anyone with project access OR admins.
  const eligible = useMemo(() => {
    const accessIds = new Set((access ?? []).map((a) => a.userId));
    return (users ?? []).filter(
      (u) => u.role === "admin" || accessIds.has(u.id),
    );
  }, [users, access]);

  // Local edit state, seeded from server.
  // - chainDraft: ordered array of level names (length matches serverChain.length).
  // - assignmentsDraft: keyed by ORIGINAL position (1..N) on the SERVER chain.
  const [chainDraft, setChainDraft] = useState<string[] | null>(null);
  const [assignmentsDraft, setAssignmentsDraft] = useState<
    Record<number, string[]> | null
  >(null);

  useEffect(() => {
    if (assignments && assignmentsDraft === null) {
      const seed: Record<number, string[]> = {};
      for (let l = 1; l <= serverChain.length; l++) seed[l] = [];
      for (const a of assignments) {
        if (!seed[a.level]) seed[a.level] = [];
        if (!seed[a.level].includes(a.userId)) seed[a.level].push(a.userId);
      }
      setAssignmentsDraft(seed);
    }
  }, [assignments, assignmentsDraft, serverChain.length]);

  useEffect(() => {
    if (chainDraft === null) {
      setChainDraft(serverChain.map((c) => c.levelName));
    }
  }, [chainDraft, serverChain]);

  const setApprovers = useSetProjectApprovers({
    mutation: {
      onSuccess: () => {
        toast({ title: "Approvers saved" });
        queryClient.invalidateQueries({
          queryKey: getListProjectApproversQueryKey(projectId),
        });
        setAssignmentsDraft(null);
      },
      onError: (err: any) =>
        toast({
          title: "Save failed",
          description: err.message,
          variant: "destructive",
        }),
    },
  });

  const setChain = useSetProjectApprovalChain({
    mutation: {
      onSuccess: () => {
        toast({ title: "Approval order saved" });
        queryClient.invalidateQueries({
          queryKey: getGetProjectQueryKey(projectId),
        });
        queryClient.invalidateQueries({
          queryKey: getListProjectApproversQueryKey(projectId),
        });
        // Reset assignments draft so it re-seeds from the new server-truth.
        setAssignmentsDraft(null);
        setChainDraft(null);
      },
      onError: (err: any) =>
        toast({
          title: "Save order failed",
          description: err.message,
          variant: "destructive",
        }),
    },
  });

  function addUser(originalLevel: number, userId: string) {
    setAssignmentsDraft((prev) => {
      const base = prev ?? {};
      const cur = base[originalLevel] ?? [];
      if (cur.includes(userId)) return base;
      return { ...base, [originalLevel]: [...cur, userId] };
    });
  }
  function removeUser(originalLevel: number, userId: string) {
    setAssignmentsDraft((prev) => {
      const base = prev ?? {};
      const cur = base[originalLevel] ?? [];
      return { ...base, [originalLevel]: cur.filter((u) => u !== userId) };
    });
  }
  function saveAssignments() {
    if (!assignmentsDraft) return;
    const payload = {
      assignments: Object.entries(assignmentsDraft).flatMap(([lvl, ids]) =>
        ids.map((userId) => ({ level: Number(lvl), userId })),
      ),
    };
    setApprovers.mutate({ id: projectId, data: payload });
  }

  function moveLevel(idx: number, dir: -1 | 1) {
    setChainDraft((prev) => {
      if (!prev) return prev;
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }
  function saveChain() {
    if (!chainDraft) return;
    setChain.mutate({
      id: projectId,
      data: {
        chain: chainDraft.map((levelName, i) => ({
          position: i + 1,
          levelName,
        })),
      },
    });
  }

  const chainDirty = useMemo(() => {
    if (!chainDraft) return false;
    if (chainDraft.length !== serverChain.length) return true;
    return chainDraft.some((n, i) => n !== serverChain[i].levelName);
  }, [chainDraft, serverChain]);

  if (!assignmentsDraft || !chainDraft) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Loading approvers…
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Approval order</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Drag the arrows to reorder the chain. Approvals run top-to-bottom
              and the last position locks the entry. Approver assignments stay
              attached to each role when you reorder.
            </p>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border border-border divide-y divide-border bg-card">
              {chainDraft.map((name, i) => (
                <div
                  key={`${name}-${i}`}
                  className="flex items-center gap-3 px-3 py-2.5"
                  data-testid={`chain-row-${i}`}
                >
                  <GripVertical className="h-4 w-4 text-muted-foreground" />
                  <Badge variant="secondary" className="tabular-nums">
                    {i + 1}
                  </Badge>
                  <span className="flex-1 text-sm font-medium">{name}</span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => moveLevel(i, -1)}
                    disabled={i === 0}
                    data-testid={`chain-up-${i}`}
                    title="Move up"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => moveLevel(i, 1)}
                    disabled={i === chainDraft.length - 1}
                    data-testid={`chain-down-${i}`}
                    title="Move down"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2 mt-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setChainDraft(serverChain.map((c) => c.levelName))}
                disabled={!chainDirty || setChain.isPending}
                data-testid="button-reset-chain"
              >
                Reset order
              </Button>
              <Button
                size="sm"
                onClick={saveChain}
                disabled={!chainDirty || setChain.isPending}
                data-testid="button-save-chain"
              >
                Save order
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Approvers per level</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Each daily entry is approved sequentially in the order shown above.
            Only the users you list at a level may approve at that level
            (admins always can). Eligible picks are admins plus users with any
            project access.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {serverChain.map(({ position, levelName }) => {
            const selectedIds = assignmentsDraft[position] ?? [];
            const remaining = eligible.filter((u) => !selectedIds.includes(u.id));
            return (
              <div
                key={position}
                className="rounded-md border border-border bg-card p-4"
                data-testid={`approver-level-${levelName}`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{position}</Badge>
                    <span className="font-medium text-sm">{levelName}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {selectedIds.length} assigned
                  </span>
                </div>
                <div className="flex flex-wrap gap-2 mb-2 min-h-7">
                  {selectedIds.length === 0 && (
                    <span className="text-xs text-muted-foreground italic">
                      No approver assigned — non-admins cannot approve at this
                      level.
                    </span>
                  )}
                  {selectedIds.map((uid) => {
                    const u = (users ?? []).find((x) => x.id === uid);
                    return (
                      <span
                        key={uid}
                        className="inline-flex items-center gap-1 rounded-full bg-accent/15 border border-accent/30 px-2 py-0.5 text-xs"
                      >
                        {u?.firstName ?? u?.email ?? uid}
                        <button
                          type="button"
                          className="hover:text-destructive"
                          onClick={() => removeUser(position, uid)}
                          data-testid={`remove-approver-${levelName}-${uid}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    );
                  })}
                </div>
                {remaining.length > 0 && (
                  <Select
                    value=""
                    onValueChange={(v) => v && addUser(position, v)}
                  >
                    <SelectTrigger
                      className="h-8 max-w-sm"
                      data-testid={`add-approver-${levelName}`}
                    >
                      <SelectValue placeholder="Add approver…" />
                    </SelectTrigger>
                    <SelectContent>
                      {remaining.map((u) => (
                        <SelectItem key={u.id} value={u.id}>
                          {u.firstName ?? u.email} — {u.email}
                          {u.role === "admin" ? " (admin)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          onClick={() => setAssignmentsDraft(null)}
          data-testid="button-cancel-approvers"
        >
          Reset
        </Button>
        <Button
          onClick={saveAssignments}
          disabled={setApprovers.isPending}
          data-testid="button-save-approvers"
        >
          Save approvers
        </Button>
      </div>
    </div>
  );
}

function SettingsPanel({ project }: { project: any }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { register, handleSubmit } = useForm<UpdateProjectBody>({
    defaultValues: {
      name: project.name,
      code: project.code ?? "",
      location: project.location,
      contractStart: project.contractStart,
      contractEnd: project.contractEnd,
      notes: project.notes ?? "",
    },
  });
  const [pdfRequired, setPdfRequired] = useState<boolean>(!!project.pdfRequired);
  const update = useUpdateProject({
    mutation: {
      onSuccess: () => {
        toast({ title: "Project updated" });
        queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(project.id) });
        queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
      },
    },
  });
  const del = useDeleteProject({
    mutation: {
      onSuccess: () => {
        toast({ title: "Project deleted" });
        queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
        window.location.href = `${import.meta.env.BASE_URL}projects`;
      },
    },
  });
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <Card className="lg:col-span-2">
        <CardHeader><CardTitle className="text-base">Project details</CardTitle></CardHeader>
        <CardContent>
          <form
            onSubmit={handleSubmit((data) =>
              update.mutate({ id: project.id, data: { ...data, pdfRequired } }),
            )}
            className="space-y-3"
          >
            <Field label="Name"><Input {...register("name")} data-testid="input-edit-name" /></Field>
            <Field label="Project code (sequence prefix)">
              <Input
                {...register("code")}
                placeholder="e.g. ACME — leave blank to use the project name"
                maxLength={32}
                data-testid="input-edit-code"
              />
            </Field>
            <Field label="Location"><Input {...register("location")} data-testid="input-edit-location" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Start"><Input type="date" {...register("contractStart")} /></Field>
              <Field label="End"><Input type="date" {...register("contractEnd")} /></Field>
            </div>
            <Field label="Notes"><Textarea rows={3} {...register("notes")} /></Field>
            <div className="flex items-start justify-between gap-4 rounded-md border border-border bg-muted/30 px-3 py-2">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium">Require PDF attachment</Label>
                <p className="text-xs text-muted-foreground">
                  When on, daily entries cannot be submitted for approval until
                  at least one attachment is uploaded.
                </p>
              </div>
              <Switch
                checked={pdfRequired}
                onCheckedChange={setPdfRequired}
                data-testid="switch-pdf-required"
              />
            </div>
            <Button type="submit" disabled={update.isPending} data-testid="button-save-project">Save changes</Button>
          </form>
        </CardContent>
      </Card>
      <Card className="border-destructive/30">
        <CardHeader><CardTitle className="text-base text-destructive">Danger zone</CardTitle></CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-3">
            Deleting removes all daily entries, services and access grants for this project. This can't be undone.
          </p>
          <Button variant="destructive" onClick={() => setConfirmOpen(true)} data-testid="button-delete-project">
            <Trash2 className="mr-2 h-4 w-4" /> Delete project
          </Button>
        </CardContent>
      </Card>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this project?</AlertDialogTitle>
            <AlertDialogDescription>
              All entries, services and access grants for "{project.name}" will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => del.mutate({ id: project.id })}
              data-testid="button-confirm-delete"
            >
              Delete project
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs uppercase tracking-wider text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
