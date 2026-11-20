import { useEffect, useState } from "react";
import { Link, useParams } from "wouter";
import {
  getMisGetProjectQueryKey,
  getMisListProjectServicesQueryKey,
  getMisListProjectTabsQueryKey,
  MisEntryStatus,
  MisPercentageKind,
  MisProjectInput,
  MisProject,
  MisProjectTabAssignment,
  MisProjectTabAssignmentInput,
  MisService,
  MisServiceInput,
  MisTab,
  useMisCreateProjectService,
  useMisGetCurrentAccess,
  useMisGetProject,
  useMisListProjectServices,
  useMisListProjectTabs,
  useMisListTabs,
  useMisReplaceProjectTabs,
  useMisReorderProjectServices,
  useMisUpdateProject,
  useMisUpdateService,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowLeft, ArrowUp, GripVertical, Layers, Loader2, Pencil, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UserPicker } from "../components/UserPicker";
import Authorities from "./Authorities";
import { PercentageServicesSection } from "../components/PercentageServicesSection";
import { hasPermission } from "../lib/access";
import { useToast } from "@/hooks/use-toast";

const errorMessage = (error: unknown) => error instanceof Error ? error.message : "The request could not be completed.";
type OverlapPolicy = "nonoverlap" | "overlap" | "unlimited";
type ReportingSettingsWithPeriodPolicy = MisProject["reportingSettings"] & {
  allowMultipleEntries: boolean;
  overlapPolicy: OverlapPolicy;
  maxEntriesPerPeriod: number | null;
};
type InteractiveService = MisService & {
  rateEnabled: boolean;
  calculatePercentAgainstIncome: boolean;
  calculationMode: "quantity_rate" | "amount";
};

function ServiceDialog({ projectId, projectCurrency, service, assignments, nextSequence, open, onOpenChange }: {
  projectId: string; projectCurrency: string; service?: MisService; assignments: MisProjectTabAssignment[]; nextSequence?: number; open: boolean; onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const create = useMisCreateProjectService();
  const update = useMisUpdateService();
  const { data: projectServices = [] } = useMisListProjectServices(projectId);
  const editing = Boolean(service);
  const enabledAssignments = assignments.filter((assignment) => assignment.enabled);
  const [selectedTabId, setSelectedTabId] = useState(service?.tabId ?? enabledAssignments[0]?.tabId ?? "");
  useEffect(() => {
    if (open) setSelectedTabId(service?.tabId ?? assignments.find((assignment) => assignment.enabled)?.tabId ?? "");
  }, [open, service?.id, service?.tabId, assignments]);
  const isExpense = assignments.find((assignment) => assignment.tabId === selectedTabId)?.tab.type === "expense";
  const isCost = assignments.find((assignment) => assignment.tabId === selectedTabId)?.tab.type === "cost";

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const data = {
      tabId: String(form.get("tabId") ?? ""),
      code: String(form.get("code") ?? "").trim().toUpperCase() || undefined,
      name: String(form.get("name") ?? "").trim(),
      description: String(form.get("description") ?? "").trim() || null,
      unit: String(form.get("unit") ?? "").trim(),
      defaultRate: Number(form.get("defaultRate")),
      quantitySourceServiceId: isCost ? String(form.get("quantitySourceServiceId") ?? "") || null : null,
      currency: String(form.get("currency") ?? "").trim().toUpperCase() || projectCurrency,
      active: form.get("active") === "on",
      // Sequence remains server/database-owned. This internal append position
      // is never shown as an administrator-editable field.
      sequence: service?.sequence ?? nextSequence ?? 0,
      effectiveFrom: String(form.get("effectiveFrom") ?? "") || null,
      effectiveTo: String(form.get("effectiveTo") ?? "") || null,
    } as unknown as MisServiceInput;
    const callbacks = {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getMisListProjectServicesQueryKey(projectId) });
        void queryClient.invalidateQueries({ predicate: (query) => query.queryKey.some((part) => typeof part === "string" && part.includes(`/api/mis/projects/${projectId}/entry-services`)) });
        toast({ title: editing ? "Service updated" : "Service created" });
        onOpenChange(false);
      },
      onError: (error: unknown) => toast({ title: editing ? "Unable to update service" : "Unable to create service", description: errorMessage(error), variant: "destructive" as const }),
    };
    if (service) update.mutate({ id: service.id, data }, callbacks);
    else create.mutate({ id: projectId, data }, callbacks);
  };

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="sm:max-w-[600px]"><DialogHeader><DialogTitle>{editing ? "Edit service" : "Create service"}</DialogTitle></DialogHeader>
    <form onSubmit={submit} className="space-y-4"><div className="grid grid-cols-2 gap-4">
      <div className="space-y-2"><Label htmlFor="service-code">Service code</Label><Input id="service-code" name="code" defaultValue={service?.code ?? ""} placeholder="Auto-generated if blank" maxLength={32} /></div><div className="space-y-2"><Label htmlFor="service-name">Service name</Label><Input id="service-name" name="name" defaultValue={service?.name} required /></div>
      <div className="col-span-2 space-y-2"><Label htmlFor="service-description">Description</Label><Input id="service-description" name="description" defaultValue={service?.description ?? ""} /></div>
       <div className="space-y-2"><Label>Tab / category</Label><Select name="tabId" value={selectedTabId} onValueChange={setSelectedTabId} required><SelectTrigger><SelectValue placeholder="Select enabled tab" /></SelectTrigger><SelectContent>{enabledAssignments.map((assignment) => <SelectItem key={assignment.tabId} value={assignment.tabId}>{assignment.tab.name}</SelectItem>)}</SelectContent></Select></div>
      <div className="space-y-2"><Label htmlFor="service-unit">Unit of measure</Label><Input id="service-unit" name="unit" defaultValue={service?.unit ?? ""} required /></div>
      {isCost && <div className="col-span-2 space-y-2"><Label htmlFor="quantity-source">Default quantity from Income service</Label><select id="quantity-source" name="quantitySourceServiceId" defaultValue={service?.quantitySourceServiceId ?? ""} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"><option value="">No link — enter quantity manually</option>{projectServices.filter((source) => source.tabType === "income" && (source.active || source.id === service?.quantitySourceServiceId)).map((source) => <option key={source.id} value={source.id}>{source.name} ({source.unit}){!source.active ? " — inactive" : ""}</option>)}</select><p className="text-xs text-muted-foreground">During bulk entry, quantity follows this Income service until you edit the Cost quantity. Saved quantities are preserved when reopening an entry.</p></div>}
      <div className="space-y-2"><Label htmlFor="service-rate">{isExpense ? "Default Amount" : "Default rate"}</Label><Input id="service-rate" name="defaultRate" type="number" min="0" step="0.01" defaultValue={service?.defaultRate ?? 0} required />{isExpense && <p className="text-xs text-muted-foreground">Prefills the editable Expense amount in new bulk entries. Clear it there to skip the service.</p>}</div><div className="space-y-2"><Label htmlFor="service-currency">Currency</Label><Input id="service-currency" name="currency" maxLength={3} defaultValue={service?.currency ?? projectCurrency} required /></div>
      <div className="space-y-2"><Label htmlFor="service-from">Effective from</Label><Input id="service-from" name="effectiveFrom" type="date" defaultValue={service?.effectiveFrom ?? ""} /></div>
      <div className="space-y-2"><Label htmlFor="service-to">Effective to</Label><Input id="service-to" name="effectiveTo" type="date" defaultValue={service?.effectiveTo ?? ""} /></div>
       <div className="col-span-2 flex items-center justify-between border-t pt-3"><Label htmlFor="service-active">Active</Label><Switch id="service-active" name="active" defaultChecked={service?.active ?? true} /></div>
    </div><DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" disabled={create.isPending || update.isPending}>{editing ? "Save changes" : "Create service"}</Button></DialogFooter></form>
  </DialogContent></Dialog>;
}

export default function ProjectSettings() {
  const { id } = useParams<{ id: string }>();
  const projectId = id ?? "";
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: access } = useMisGetCurrentAccess();
  const { data: project, isLoading: projectLoading, isError: projectError } = useMisGetProject(projectId, { query: { queryKey: getMisGetProjectQueryKey(projectId), enabled: Boolean(projectId) } });
  const { data: assignments, isLoading: assignmentsLoading, isError: assignmentsError } = useMisListProjectTabs(projectId, { query: { queryKey: getMisListProjectTabsQueryKey(projectId), enabled: Boolean(projectId) } });
  const { data: masterTabs } = useMisListTabs();
  const { data: services, isLoading: servicesLoading, isError: servicesError } = useMisListProjectServices(projectId, undefined, { query: { queryKey: getMisListProjectServicesQueryKey(projectId), enabled: Boolean(projectId) } });
  const updateProject = useMisUpdateProject();
  const replaceTabs = useMisReplaceProjectTabs();
  const reorderMutation = useMisReorderProjectServices();
  const [managerId, setManagerId] = useState<string | null>(null);
  const [preventDuplicatePeriods, setPreventDuplicatePeriods] = useState(false);
  const [allowMultipleEntries, setAllowMultipleEntries] = useState(false);
  const [overlapPolicy, setOverlapPolicy] = useState<OverlapPolicy>("nonoverlap");
  const [maxEntriesPerPeriod, setMaxEntriesPerPeriod] = useState("");
  const [createServiceOpen, setCreateServiceOpen] = useState(false);
  const [editingService, setEditingService] = useState<MisService | null>(null);
  const [orderedServices, setOrderedServices] = useState<InteractiveService[]>([]);
  const [draggedServiceId, setDraggedServiceId] = useState<string | null>(null);
  const [savingOrder, setSavingOrder] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const canSearchUsers = access?.roles.includes("mis_admin") ?? false;
  const canOverhead = hasPermission(access, "overhead", projectId);
  const canOpExpense = hasPermission(access, "op_expense", projectId);
  const canManagePercentServices = hasPermission(access, "services", projectId) || hasPermission(access, "project_config", projectId);

  useEffect(() => {
    if (!project) return;
    setManagerId(project.managerId);
    const settings = project.reportingSettings as ReportingSettingsWithPeriodPolicy;
    setPreventDuplicatePeriods(settings.preventDuplicatePeriods);
    setAllowMultipleEntries(settings.allowMultipleEntries ?? false);
    setOverlapPolicy(settings.overlapPolicy ?? "nonoverlap");
    setMaxEntriesPerPeriod(settings.maxEntriesPerPeriod == null ? "" : String(settings.maxEntriesPerPeriod));
  }, [project?.id, project?.managerId, project?.reportingSettings]);
  useEffect(() => {
    if (!services || savingOrder) return;
    setOrderedServices(services as InteractiveService[]);
  }, [services, savingOrder]);

  const saveServiceOrder = async (next: InteractiveService[], previous: InteractiveService[]) => {
    setOrderedServices(next);
    setOrderError(null);
    setSavingOrder(true);
    try {
      const saved = await reorderMutation.mutateAsync({ id: projectId, data: { serviceIds: next.map((service) => service.id) } });
      if (Array.isArray(saved) && saved.length === next.length) {
        const ordered = saved as InteractiveService[];
        setOrderedServices(ordered);
        queryClient.setQueryData(getMisListProjectServicesQueryKey(projectId), ordered);
      }
      await queryClient.invalidateQueries({ queryKey: getMisListProjectServicesQueryKey(projectId) });
      await queryClient.invalidateQueries({ predicate: (query) => query.queryKey.some((part) => typeof part === "string" && part.includes(`/api/mis/projects/${projectId}/entry-services`)) });
      toast({ title: "Service order saved" });
    } catch (error) {
      setOrderedServices(previous);
      const message = errorMessage(error);
      setOrderError(message);
      toast({ title: "Unable to save service order", description: `${message} The previous order was restored.`, variant: "destructive" });
    } finally {
      setSavingOrder(false);
    }
  };

  const moveService = (serviceId: string, direction: -1 | 1) => {
    const index = orderedServices.findIndex((service) => service.id === serviceId);
    const destination = index + direction;
    if (index < 0 || destination < 0 || destination >= orderedServices.length || savingOrder) return;
    const previous = orderedServices;
    const next = [...orderedServices];
    [next[index], next[destination]] = [next[destination], next[index]];
    void saveServiceOrder(next, previous);
  };

  const dropService = (serviceId: string) => {
    if (!draggedServiceId || draggedServiceId === serviceId || savingOrder) return;
    const from = orderedServices.findIndex((service) => service.id === draggedServiceId);
    const to = orderedServices.findIndex((service) => service.id === serviceId);
    if (from < 0 || to < 0) return;
    const previous = orderedServices;
    const next = [...orderedServices];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setDraggedServiceId(null);
    void saveServiceOrder(next, previous);
  };
  if (projectLoading) return <div className="p-8"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  if (projectError || !project) return <div className="p-8 text-destructive">Project could not be loaded. Please return to projects and try again.</div>;

  const updateGeneral = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsedMax = Number(maxEntriesPerPeriod);
    const reportingSettings = {
      defaultEntryStatus: form.get("defaultEntryStatus") as MisEntryStatus,
      preventDuplicatePeriods,
      allowMultipleEntries,
      overlapPolicy,
      maxEntriesPerPeriod: allowMultipleEntries && overlapPolicy !== "unlimited" && Number.isInteger(parsedMax) && parsedMax > 0 ? parsedMax : null,
    } as unknown as MisProjectInput["reportingSettings"];
    const data: MisProjectInput = {
      name: String(form.get("name") ?? "").trim(),
      code: String(form.get("code") ?? "").trim(),
      managerId,
      status: form.get("status") as MisProjectInput["status"],
      startDate: String(form.get("startDate") ?? "") || null,
      endDate: String(form.get("endDate") ?? "") || null,
      currency: String(form.get("currency") ?? "").trim().toUpperCase(),
      reportingSettings,
    };
    updateProject.mutate({ id: projectId, data }, {
      onSuccess: () => { void queryClient.invalidateQueries({ queryKey: getMisGetProjectQueryKey(projectId) }); void queryClient.invalidateQueries({ queryKey: ["/api/mis/projects"] }); toast({ title: "Project updated" }); },
      onError: (error) => toast({ title: "Unable to update project", description: errorMessage(error), variant: "destructive" }),
  });
  };

  const updateTabs = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!masterTabs) return;
    const form = new FormData(event.currentTarget);
    const assignmentByTab = new Map((assignments ?? []).map((assignment) => [assignment.tabId, assignment]));
    const next: MisProjectTabAssignmentInput[] = masterTabs.map((tab: MisTab, index) => ({
      tabId: tab.id,
      enabled: form.get(`enabled_${tab.id}`) === "on",
      sequence: Number(form.get(`sequence_${tab.id}`)) || assignmentByTab.get(tab.id)?.sequence || tab.sequence || index * 10,
      calculatePercentAgainstIncome: form.get(`percent_${tab.id}`) === "inherit"
        ? null
        : form.get(`percent_${tab.id}`) === "yes",
    }));
    replaceTabs.mutate({ id: projectId, data: { assignments: next } }, {
      onSuccess: () => { void queryClient.invalidateQueries({ queryKey: getMisListProjectTabsQueryKey(projectId) }); toast({ title: "Tab assignments updated" }); },
      onError: (error) => toast({ title: "Unable to update assignments", description: errorMessage(error), variant: "destructive" }),
    });
  };

  return <div className="space-y-6">
    <div className="flex items-center gap-4"><Link href="/projects" className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-muted hover:bg-muted/80"><ArrowLeft className="h-4 w-4" /></Link><div><h1 className="text-2xl font-bold">{project.name}</h1><p className="text-sm text-muted-foreground">{project.code} · Project configuration</p></div></div>
    <Tabs defaultValue="general"><TabsList className="h-12 w-full justify-start rounded-none border-b bg-transparent p-0"><TabsTrigger value="general">General</TabsTrigger><TabsTrigger value="tabs">Tabs & categories</TabsTrigger><TabsTrigger value="services">Services</TabsTrigger>{canOverhead && <TabsTrigger value="overhead" data-testid="tab-overhead">Overhead</TabsTrigger>}{canOpExpense && <TabsTrigger value="op_expense" data-testid="tab-op-expense">OP Expense</TabsTrigger>}<TabsTrigger value="security">Security</TabsTrigger></TabsList>
       <TabsContent value="general" className="mt-6 max-w-3xl"><form onSubmit={updateGeneral}><Card><CardHeader><CardTitle>General settings</CardTitle><CardDescription>All writable project values are saved together.</CardDescription></CardHeader><CardContent className="space-y-4"><div className="grid grid-cols-2 gap-4">
        <div className="col-span-2 space-y-2"><Label htmlFor="project-name">Project name</Label><Input id="project-name" name="name" defaultValue={project.name} required /></div><div className="space-y-2"><Label htmlFor="project-code">Project code</Label><Input id="project-code" name="code" defaultValue={project.code} required /></div><div className="space-y-2"><Label htmlFor="project-currency">Currency</Label><Input id="project-currency" name="currency" defaultValue={project.currency} maxLength={3} required /></div>
        <div className="col-span-2 space-y-2"><Label>Project manager</Label><UserPicker value={managerId} onChange={setManagerId} selectedLabel={project.manager?.displayName} canSearch={canSearchUsers} disabled={!canSearchUsers} /><p className="text-xs text-muted-foreground">{canSearchUsers ? "Search and select a manager." : "Your current manager is preserved; only a global MIS administrator can search users."}</p></div>
         <div className="space-y-2"><Label>Status</Label><Select name="status" defaultValue={project.status}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="inactive">Inactive</SelectItem></SelectContent></Select></div><div className="space-y-2"><Label>Default entry status</Label><Select name="defaultEntryStatus" defaultValue={project.reportingSettings.defaultEntryStatus}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value={MisEntryStatus.draft}>Draft</SelectItem><SelectItem value={MisEntryStatus.submitted}>Submitted</SelectItem><SelectItem value={MisEntryStatus.approved}>Approved</SelectItem><SelectItem value={MisEntryStatus.rejected}>Rejected</SelectItem><SelectItem value={MisEntryStatus.cancelled}>Cancelled</SelectItem></SelectContent></Select></div>
         <div className="space-y-2"><Label htmlFor="project-start">Start date</Label><Input id="project-start" name="startDate" type="date" defaultValue={project.startDate ?? ""} /></div><div className="space-y-2"><Label htmlFor="project-end">End date</Label><Input id="project-end" name="endDate" type="date" defaultValue={project.endDate ?? ""} /></div>
         <div className="col-span-2 flex items-center justify-between gap-4 border-t pt-3"><div><Label htmlFor="project-duplicates">Prevent duplicate periods</Label><p className="text-xs text-muted-foreground">Block a second parent when the project policy does not allow multiple entries.</p></div><Switch id="project-duplicates" name="preventDuplicatePeriods" checked={preventDuplicatePeriods} onCheckedChange={setPreventDuplicatePeriods} /></div>
         <div className="col-span-2 space-y-4 rounded-lg border bg-muted/20 p-4">
           <div className="flex items-center justify-between gap-4"><div><Label htmlFor="project-multiple-entries">Allow Multiple MIS Entries for Same Period</Label><p className="text-xs text-muted-foreground">Default: NO. Enable only when this project needs more than one parent for a reporting period.</p></div><Switch id="project-multiple-entries" name="allowMultipleEntries" checked={allowMultipleEntries} onCheckedChange={setAllowMultipleEntries} /></div>
           {allowMultipleEntries && <div className="grid gap-4 border-t pt-4 md:grid-cols-2">
             <div className="space-y-2"><Label htmlFor="project-overlap-policy">Period overlap policy</Label><Select name="overlapPolicy" value={overlapPolicy} onValueChange={(value) => setOverlapPolicy(value as OverlapPolicy)}><SelectTrigger id="project-overlap-policy"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="nonoverlap">Non-overlap</SelectItem><SelectItem value="overlap">Overlap allowed</SelectItem><SelectItem value="unlimited">Unlimited</SelectItem></SelectContent></Select><p className="text-xs text-muted-foreground">{overlapPolicy === "nonoverlap" ? "Multiple entries are allowed only when their inclusive periods do not overlap." : overlapPolicy === "overlap" ? "Overlapping periods are explicitly allowed." : "No period-count or overlap restriction is applied."}</p></div>
             {overlapPolicy !== "unlimited" && <div className="space-y-2"><Label htmlFor="project-max-entries">Maximum entries per period (optional)</Label><Input id="project-max-entries" name="maxEntriesPerPeriod" type="number" min="1" step="1" value={maxEntriesPerPeriod} onChange={(event) => setMaxEntriesPerPeriod(event.target.value)} placeholder="No maximum" /><p className="text-xs text-muted-foreground">Leave blank for no count limit.</p></div>}
           </div>}
         </div>
      </div><div className="flex justify-end border-t pt-4"><Button type="submit" disabled={updateProject.isPending}>{updateProject.isPending ? "Saving…" : "Save changes"}</Button></div></CardContent></Card></form></TabsContent>
       <TabsContent value="tabs" className="mt-6"><Card><CardHeader><CardTitle>Tab assignments</CardTitle><CardDescription>Enable tabs and optionally override their global percentage setting for this project.</CardDescription></CardHeader><CardContent>{assignmentsLoading || !masterTabs ? <Skeleton className="h-40 w-full" /> : assignmentsError ? <p className="text-destructive">Assignments could not be loaded.</p> : <form onSubmit={updateTabs}><div className="mb-6 space-y-3">{masterTabs.map((tab) => { const assignment = assignments?.find((row) => row.tabId === tab.id) as (MisProjectTabAssignment & { calculatePercentAgainstIncome?: boolean | null }) | undefined; const override = assignment?.calculatePercentAgainstIncome == null ? "inherit" : assignment.calculatePercentAgainstIncome ? "yes" : "no"; return <div key={tab.id} className="flex flex-wrap items-center justify-between gap-4 rounded-lg border p-3"><div className="flex items-center gap-3"><Switch name={`enabled_${tab.id}`} defaultChecked={assignment?.enabled ?? false} /><div><p className="font-medium">{tab.name}</p><p className="text-xs text-muted-foreground capitalize">{tab.type} · {tab.financialClass}</p></div></div><div className="flex flex-wrap items-center gap-3"><div className="space-y-1"><Label className="text-xs" htmlFor={`percent_${tab.id}`}>% of income</Label><Select name={`percent_${tab.id}`} defaultValue={override}><SelectTrigger id={`percent_${tab.id}`} className="h-8 w-28"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="inherit">Inherit</SelectItem><SelectItem value="yes">Yes</SelectItem><SelectItem value="no">No</SelectItem></SelectContent></Select></div><div className="space-y-1"><Label className="text-xs">Display order</Label><Input className="h-8 w-20" name={`sequence_${tab.id}`} type="number" min="0" defaultValue={assignment?.sequence ?? tab.sequence} aria-label={`${tab.name} display order`} /></div></div></div>; })}</div><div className="flex justify-end border-t pt-4"><Button type="submit" disabled={replaceTabs.isPending}>{replaceTabs.isPending ? "Saving…" : "Save assignments"}</Button></div></form>}</CardContent></Card></TabsContent>
       <TabsContent value="services" className="mt-6"><Card><CardHeader className="flex flex-row items-center justify-between space-y-0"><div><CardTitle>Project services</CardTitle><CardDescription>Drag services into the order used by bulk entry, entries, and reports. The order is saved automatically.</CardDescription></div><Button disabled={!assignments?.some((assignment) => assignment.enabled)} onClick={() => setCreateServiceOpen(true)}><Plus className="mr-2 h-4 w-4" />Add service</Button></CardHeader><CardContent>{!assignments?.some((assignment) => assignment.enabled) && <p className="mb-4 rounded-md border border-amber-500/30 p-3 text-sm text-amber-700">Enable a tab before adding a service.</p>}{orderError && <p role="alert" className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{orderError} The previous order was restored.</p>}<div className="space-y-2">{servicesLoading ? <Skeleton className="h-40 w-full" /> : servicesError ? <p className="p-8 text-center text-destructive">Services could not be loaded.</p> : orderedServices.length ? orderedServices.map((service, index) => <div key={service.id} draggable={!savingOrder} onDragStart={() => setDraggedServiceId(service.id)} onDragOver={(event) => event.preventDefault()} onDrop={() => dropService(service.id)} onDragEnd={() => setDraggedServiceId(null)} className={`flex flex-wrap items-center gap-3 rounded-lg border p-3 ${draggedServiceId === service.id ? "opacity-50" : ""}`}><Button type="button" variant="ghost" size="icon" className="cursor-grab touch-none" aria-label={`Drag ${service.name} to reorder`} disabled={savingOrder} onKeyDown={(event) => { if (event.key === "ArrowUp") { event.preventDefault(); moveService(service.id, -1); } if (event.key === "ArrowDown") { event.preventDefault(); moveService(service.id, 1); } }}><GripVertical className="h-5 w-5" /></Button><div className="min-w-0 flex-1"><div className="font-medium">{service.name}</div><div className="text-xs text-muted-foreground">{service.code} · {service.tabName} · {service.defaultRate} {service.currency} / {service.unit}</div><div className="mt-1 flex flex-wrap gap-1"><Badge variant={service.active ? "default" : "secondary"}>{service.active ? "Active" : "Inactive"}</Badge><Badge variant={service.rateEnabled === false ? "secondary" : "outline"}>{service.rateEnabled === false ? "Direct amount" : "Quantity × rate"}</Badge>{service.calculatePercentAgainstIncome === true && <Badge variant="outline">% of income</Badge>}</div></div><div className="flex items-center gap-1"><Button type="button" variant="ghost" size="icon" aria-label={`Move ${service.name} up`} disabled={savingOrder || index === 0} onClick={() => moveService(service.id, -1)}><ArrowUp className="h-4 w-4" /></Button><Button type="button" variant="ghost" size="icon" aria-label={`Move ${service.name} down`} disabled={savingOrder || index === orderedServices.length - 1} onClick={() => moveService(service.id, 1)}><ArrowDown className="h-4 w-4" /></Button><Button aria-label={`Edit ${service.name}`} variant="ghost" size="icon" onClick={() => setEditingService(service)}><Pencil className="h-4 w-4" /></Button></div></div>) : <p className="p-12 text-center text-muted-foreground"><Layers className="mx-auto mb-3 h-8 w-8 opacity-20" />No services defined for this project.</p>}</div>{savingOrder && <p className="mt-3 text-sm text-muted-foreground">Saving service order…</p>}</CardContent></Card></TabsContent>
       {canOverhead && <TabsContent value="overhead" className="mt-6"><PercentageServicesSection projectId={projectId} kind="overhead" canWrite={canManagePercentServices} /></TabsContent>}
       {canOpExpense && <TabsContent value="op_expense" className="mt-6"><PercentageServicesSection projectId={projectId} kind="op_expense" canWrite={canManagePercentServices} /></TabsContent>}
       <TabsContent value="security" className="mt-6"><Authorities projectId={projectId} /></TabsContent>
    </Tabs>
      <ServiceDialog projectId={projectId} projectCurrency={project.currency} assignments={assignments ?? []} nextSequence={orderedServices.length} open={createServiceOpen} onOpenChange={setCreateServiceOpen} />
     {editingService && <ServiceDialog key={editingService.id} projectId={projectId} projectCurrency={project.currency} service={editingService} assignments={assignments ?? []} open onOpenChange={(open) => !open && setEditingService(null)} />}
  </div>;
}