import { useMemo, useState } from "react";
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
  useUpdateProject,
  useDeleteProject,
  getGetProjectQueryKey,
  getListProjectServicesQueryKey,
  getListProjectAccessQueryKey,
  getListProjectEntriesQueryKey,
  getListProjectsQueryKey,
  getListUsersQueryKey,
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
import { Lock, Plus, Trash2, MapPin, Calendar, Pencil, BarChart3, ArrowUp, ArrowDown, Check, X } from "lucide-react";

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
                <TableCell className="font-medium">{formatDate(e.entryDate)}</TableCell>
                <TableCell>{e.location}</TableCell>
                <TableCell className="text-right tabular-nums">{formatNumber(e.totalMandays, 1)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatCurrency(e.totalCost)}</TableCell>
                <TableCell className="text-right tabular-nums">{e.totalMandays ? formatCurrency(e.costPerManday) : "—"}</TableCell>
                <TableCell className="text-center">
                  {e.isLocked ? (
                    <Badge variant="default" className="gap-1"><Lock className="h-3 w-3" /> Locked</Badge>
                  ) : (e.currentApprovalLevel ?? 0) > 0 ? (
                    <Badge variant="secondary">{e.currentApprovalLevel}/5</Badge>
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

function SecurityPanel({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: access } = useListProjectAccess(projectId, {
    query: { enabled: !!projectId && canEdit, queryKey: getListProjectAccessQueryKey(projectId) },
  });
  const { data: users } = useListUsers({
    query: { enabled: canEdit, queryKey: getListUsersQueryKey() },
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
            Choose exactly who can view this project's summary report or edit its daily entries.
            Admins always have full access; other users see nothing here unless you grant it.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          {access && access.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead className="text-center">View summary</TableHead>
                  <TableHead className="text-center">Edit entries</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {access.map((a) => (
                  <AccessRow key={a.id} projectId={projectId} access={a} onChange={invalidate} />
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
      <GrantAccessCard projectId={projectId} users={ungranted} onGranted={invalidate} />
    </div>
  );
}

function AccessRow({ projectId, access, onChange }: { projectId: string; access: any; onChange: () => void }) {
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
  return (
    <TableRow data-testid={`access-row-${access.userId}`}>
      <TableCell>
        <div className="font-medium">{access.user.firstName ?? access.user.email}</div>
        <div className="text-xs text-muted-foreground">{access.user.email}</div>
      </TableCell>
      <TableCell className="text-center">
        <Checkbox
          checked={access.canViewSummary}
          onCheckedChange={(v) =>
            update.mutate({ id: access.id, data: { canViewSummary: !!v } })
          }
          data-testid={`access-summary-${access.userId}`}
        />
      </TableCell>
      <TableCell className="text-center">
        <Checkbox
          checked={access.canEditEntries}
          onCheckedChange={(v) =>
            update.mutate({ id: access.id, data: { canEditEntries: !!v } })
          }
          data-testid={`access-edit-${access.userId}`}
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

function GrantAccessCard({ projectId, users, onGranted }: { projectId: string; users: Array<any>; onGranted: () => void }) {
  const { toast } = useToast();
  const [userId, setUserId] = useState<string>("");
  const [canViewSummary, setCanViewSummary] = useState(true);
  const [canEditEntries, setCanEditEntries] = useState(false);
  const grant = useGrantProjectAccess({
    mutation: {
      onSuccess: () => {
        toast({ title: "Access granted" });
        setUserId("");
        setCanEditEntries(false);
        setCanViewSummary(true);
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
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto_auto] gap-3 items-end">
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
            <label className="flex items-center gap-2 text-xs">
              <Checkbox checked={canViewSummary} onCheckedChange={(v) => setCanViewSummary(!!v)} data-testid="checkbox-grant-summary" />
              View summary
            </label>
            <label className="flex items-center gap-2 text-xs">
              <Checkbox checked={canEditEntries} onCheckedChange={(v) => setCanEditEntries(!!v)} data-testid="checkbox-grant-edit" />
              Edit entries
            </label>
            <Button
              disabled={!userId || grant.isPending}
              onClick={() => grant.mutate({ id: projectId, data: { userId, canViewSummary, canEditEntries } as GrantAccessBody })}
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

function SettingsPanel({ project }: { project: any }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { register, handleSubmit } = useForm<UpdateProjectBody>({
    defaultValues: {
      name: project.name,
      location: project.location,
      contractStart: project.contractStart,
      contractEnd: project.contractEnd,
      notes: project.notes ?? "",
    },
  });
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
            onSubmit={handleSubmit((data) => update.mutate({ id: project.id, data }))}
            className="space-y-3"
          >
            <Field label="Name"><Input {...register("name")} data-testid="input-edit-name" /></Field>
            <Field label="Location"><Input {...register("location")} data-testid="input-edit-location" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Start"><Input type="date" {...register("contractStart")} /></Field>
              <Field label="End"><Input type="date" {...register("contractEnd")} /></Field>
            </div>
            <Field label="Notes"><Textarea rows={3} {...register("notes")} /></Field>
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
