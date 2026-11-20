import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import * as z from "zod";
import {
  getMisGetEntryHistoryQueryKey,
  getMisGetEntryQueryKey,
  getMisListEntryServicesQueryKey,
  getMisListProjectTabsQueryKey,
  MisEntryAction,
  type MisEntry,
  type MisEntryInput,
  type MisMe,
  useMisActOnEntry,
  useMisCreateEntry,
  useMisDeleteEntry,
  useMisGetCurrentAccess,
  useMisGetEntry,
  useMisGetEntryHistory,
  useMisListEntryServices,
  useMisListProjectTabs,
  useMisUpdateEntry,
} from "@workspace/api-client-react";
import { ArrowLeft, CheckCircle2, History, Loader2, Save, Send, Trash2, Undo2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { MisEntryProjectSelector } from "../components/MisEntryProjectSelector";
import { MisEntryStatusBadge } from "../components/MisEntryStatusBadge";
import { getMisParentConflict, safeMisParentUrl } from "../hooks/useMisParents";

const entrySchema = z.object({
  projectId: z.string().min(1, "Project is required"),
  tabId: z.string().min(1, "Tab is required"),
  serviceId: z.string().min(1, "Service is required"),
  fromDate: z.string().min(1, "From date is required"),
  toDate: z.string().min(1, "To date is required"),
  quantity: z.number().finite("Quantity must be a number").min(0, "Quantity cannot be negative"),
  rate: z.number().finite("Rate must be a number").min(0, "Rate cannot be negative"),
  amount: z.number().finite("Amount must be a number").min(0, "Amount cannot be negative"),
  remarks: z.string().max(2000, "Remarks cannot exceed 2,000 characters").nullable(),
  rateReason: z.string().max(1000, "Rate reason cannot exceed 1,000 characters").nullable(),
}).superRefine((value, context) => {
  if (value.fromDate && value.toDate && value.fromDate > value.toDate) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["toDate"], message: "To date must be on or after from date" });
  }
});

type MisEntryFormValues = z.infer<typeof entrySchema>;
type ActionToConfirm = Exclude<MisEntryAction, "submit" | "approve"> | "delete";
type InteractiveService = {
  unit: string;
  defaultRate: number;
  rateEnabled?: boolean;
  calculationMode?: "quantity_rate" | "amount";
  calculatePercentAgainstIncome?: boolean;
};
type InteractiveEntry = MisEntry & {
  calculationMode?: "quantity_rate" | "amount";
  rateEnabled?: boolean;
  calculatePercentAgainstIncome?: boolean;
};

function entryCalculationMode(service?: InteractiveService, entry?: InteractiveEntry): "quantity_rate" | "amount" {
  // A legacy row keeps its saved mode even if the current service
  // configuration has since changed. Salary/Expense rows can explicitly
  // transition from this preserved snapshot to direct amount mode below.
  if (entry) return entry.calculationMode ?? "quantity_rate";
  if (service?.calculationMode) return service.calculationMode;
  return service?.rateEnabled === false ? "amount" : "quantity_rate";
}

function valuesFromEntry(entry?: MisEntry): MisEntryFormValues {
  const interactiveEntry = entry as InteractiveEntry | undefined;
  const isLegacySalaryExpense = Boolean(entry && (entry.type === "expense" || entry.type === "salary") && interactiveEntry?.calculationMode !== "amount");
  return {
    projectId: entry?.projectId || "",
    tabId: entry?.tabId || "",
    serviceId: entry?.serviceId || "",
    fromDate: entry?.fromDate || "",
    toDate: entry?.toDate || "",
    quantity: entry?.quantity ?? 0,
    rate: entry?.rate ?? 0,
    amount: interactiveEntry?.calculationMode === "amount" || isLegacySalaryExpense ? entry?.amount ?? 0 : 0,
    remarks: entry?.remarks ?? null,
    rateReason: entry?.rateReason ?? null,
  };
}

function hasProjectPermission(
  access: MisMe | undefined,
  projectId: string,
  permission: string,
) {
  return Boolean(
    access?.permissions.includes(permission as never)
    || access?.projectPermissions.find((grant) => grant.projectId === projectId)?.permissions.includes(permission as never),
  );
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "error" in error && typeof error.error === "string") return error.error;
  return "The request could not be completed. Please try again.";
}

function displayValue(value: unknown) {
  if (value == null || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function MisEntryActionConfirmation({
  action,
  open,
  pending,
  onOpenChange,
  onConfirm,
}: {
  action: ActionToConfirm | null;
  open: boolean;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (remarks: string | null) => void;
}) {
  const [remarks, setRemarks] = useState("");
  const requiresRemarks = action === "reject";
  const title = action === "delete" ? "Delete entry?" : `${action ? action[0].toUpperCase() + action.slice(1) : ""} entry?`;
  const description = action === "reject"
    ? "Provide remarks explaining why this entry is rejected."
    : action === "delete"
      ? "This removes the entry from active MIS records. This cannot be undone."
      : "This changes the entry workflow status.";

  useEffect(() => {
    if (!open) setRemarks("");
  }, [open]);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {requiresRemarks && (
          <div className="space-y-2">
            <Label htmlFor="workflow-remarks">Rejection remarks</Label>
            <Textarea id="workflow-remarks" value={remarks} onChange={(event) => setRemarks(event.target.value)} placeholder="Reason for rejection" data-testid="input-rejection-remarks" />
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending} data-testid="button-cancel-workflow-confirmation">Back</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending || (requiresRemarks && !remarks.trim())}
            onClick={(event) => {
              event.preventDefault();
              onConfirm(remarks.trim() || null);
            }}
            className={action === "delete" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : ""}
            data-testid="button-confirm-workflow-action"
          >
            {pending ? "Working…" : action === "delete" ? "Delete" : action ? action[0].toUpperCase() + action.slice(1) : "Confirm"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function MisEntryHistory({ entryId, canView }: { entryId: string; canView: boolean }) {
  const { data: history, isLoading, error } = useMisGetEntryHistory(entryId, {
    query: {
      enabled: Boolean(entryId && canView),
      queryKey: getMisGetEntryHistoryQueryKey(entryId),
    },
  });
  if (!canView) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg"><History className="h-5 w-5" />History</CardTitle>
        <CardDescription>Workflow and edit audit trail for this entry.</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? <p className="text-sm text-muted-foreground">Loading history…</p> : error ? (
          <p className="text-sm text-destructive" data-testid="text-entry-history-error">{errorMessage(error)}</p>
        ) : history?.length ? (
          <ol className="space-y-4">
            {history.map((item) => (
              <li key={item.id} className="border-l-2 pl-4" data-testid={`history-entry-${item.id}`}>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-medium">{item.action}</span>
                  <span className="text-sm text-muted-foreground">by {item.actorName || "Unknown user"} · {new Date(item.occurredAt).toLocaleString()}</span>
                </div>
                {item.remarks && <p className="mt-1 text-sm">{item.remarks}</p>}
                {(item.oldValues || item.newValues) && (
                  <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
                    <p className="rounded bg-muted p-2"><span className="font-medium">Old: </span>{displayValue(item.oldValues)}</p>
                    <p className="rounded bg-muted p-2"><span className="font-medium">New: </span>{displayValue(item.newValues)}</p>
                  </div>
                )}
              </li>
            ))}
          </ol>
        ) : <p className="text-sm text-muted-foreground">No history is available for this entry.</p>}
      </CardContent>
    </Card>
  );
}

export default function EntryForm() {
  const { id } = useParams();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const isNew = !id;
  const [error, setError] = useState<string | null>(null);
  const [projectName, setProjectName] = useState<string | null>(null);
  const [hydratedEntryId, setHydratedEntryId] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<ActionToConfirm | null>(null);
  const [legacyAmountMode, setLegacyAmountMode] = useState(false);
  const { data: access } = useMisGetCurrentAccess();
  const entryQuery = useMisGetEntry(id || "", {
    query: { enabled: !isNew, queryKey: getMisGetEntryQueryKey(id || "") },
  });
  const entry = entryQuery.data;
  const parentIdentity = entry as (MisEntry & { parentId?: string | null; bulkNumber?: string | null }) | undefined;
  const parentConflict = getMisParentConflict(entryQuery.error);
  const parentId = parentIdentity?.parentId || parentConflict?.existing?.parentId;
  const form = useForm<MisEntryFormValues>({
    resolver: zodResolver(entrySchema),
    defaultValues: valuesFromEntry(),
  });
  const selectedProjectId = useWatch({ control: form.control, name: "projectId" });
  const selectedTabId = useWatch({ control: form.control, name: "tabId" });
  const selectedServiceId = useWatch({ control: form.control, name: "serviceId" });
  const fromDate = useWatch({ control: form.control, name: "fromDate" });
  const toDate = useWatch({ control: form.control, name: "toDate" });
  const quantity = useWatch({ control: form.control, name: "quantity" });
  const rate = useWatch({ control: form.control, name: "rate" });
  const directAmount = useWatch({ control: form.control, name: "amount" });
  const tabParams = selectedProjectId || "";
  const { data: assignments } = useMisListProjectTabs(tabParams, {
    query: { enabled: Boolean(selectedProjectId), queryKey: getMisListProjectTabsQueryKey(tabParams) },
  });
  const serviceParams = { from: fromDate || undefined, to: toDate || undefined };
  const { data: services } = useMisListEntryServices(selectedProjectId || "", serviceParams, {
    query: {
      enabled: Boolean(selectedProjectId && selectedTabId),
      queryKey: getMisListEntryServicesQueryKey(selectedProjectId || "", serviceParams),
    },
  });
  const createEntry = useMisCreateEntry();
  const updateEntry = useMisUpdateEntry();
  const actionEntry = useMisActOnEntry();
  const deleteEntry = useMisDeleteEntry();

  const hydratedEntryIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (isNew) {
      hydratedEntryIdRef.current = null;
      setHydratedEntryId(null);
      return;
    }
    if (!entry || hydratedEntryIdRef.current === entry.id) return;
    // Hydrate all fields together, exactly once for this record. In
    // particular, do not let async tabs/services queries cause a saved rate
    // or service selection to be replaced by a new-entry default.
    hydratedEntryIdRef.current = entry.id;
    form.reset(valuesFromEntry(entry));
    setLegacyAmountMode(false);
    setProjectName(entry.projectName);
    setHydratedEntryId(entry.id);
  }, [entry?.id, form, isNew]);

  useEffect(() => {
    if (isNew || !parentId) return;
    const destination = safeMisParentUrl(parentConflict?.openUrl)
      ? parentConflict!.openUrl!
      : `/entries/parents/${encodeURIComponent(parentId)}`;
    setLocation(destination);
  }, [isNew, parentConflict?.openUrl, parentId, setLocation]);

  const canCreateEntry = Boolean(access?.permissions.includes("create_entries") || access?.projectPermissions.some((grant) => grant.permissions.includes("create_entries")));
  const canEdit = Boolean(
    isNew
      ? canCreateEntry
        : Boolean(entry && !parentIdentity?.parentId && ["draft", "submitted", "rejected", "returned"].includes(entry.status) && hasProjectPermission(access, entry.projectId, "edit_entries")),
  );
  const canRateOverride = hasProjectPermission(access, selectedProjectId || "", "rate_override");
  const canHistory = Boolean(entry && (hasProjectPermission(access, entry.projectId, "history") || hasProjectPermission(access, entry.projectId, "view_entries")));
  const canSubmit = Boolean(entry && !parentIdentity?.parentId && ["draft", "rejected", "returned"].includes(entry.status) && hasProjectPermission(access, entry.projectId, "submit"));
  const canApprove = Boolean(entry && !parentIdentity?.parentId && entry.status === "submitted" && hasProjectPermission(access, entry.projectId, "approve"));
  const canReset = Boolean(entry && (
    !parentIdentity?.parentId && (
    entry.status === "approved"
      ? hasProjectPermission(access, entry.projectId, "edit_approved")
      : ["submitted", "rejected", "returned", "cancelled"].includes(entry.status) && hasProjectPermission(access, entry.projectId, "reset")
    )
  ));
  const canCancel = Boolean(entry && (
    !parentIdentity?.parentId && (
    entry.status === "approved"
      ? hasProjectPermission(access, entry.projectId, "edit_approved")
      : ["draft", "rejected", "returned", "submitted"].includes(entry.status) && hasProjectPermission(access, entry.projectId, "edit_entries")
    )
  ));
  const canDelete = Boolean(entry && !parentIdentity?.parentId && ["draft", "rejected", "returned", "cancelled", "approved"].includes(entry.status) && hasProjectPermission(access, entry.projectId, "delete_entries") && (entry.status !== "approved" || hasProjectPermission(access, entry.projectId, "delete_approved")));
  const activeTabs = useMemo(() => assignments?.filter((assignment) => assignment.enabled && assignment.tab.active && assignment.tab.allowEntry) || [], [assignments]);
  const activeServices = useMemo(() => services?.filter((service) => (
    service.active
    && service.tabId === selectedTabId
    && (!service.effectiveFrom || !fromDate || service.effectiveFrom <= fromDate)
    && (!service.effectiveTo || !toDate || service.effectiveTo >= toDate)
  )) || [], [services, selectedTabId, fromDate, toDate]);
  const selectedService = services?.find((service) => service.id === selectedServiceId) as InteractiveService | undefined;
  const legacyAmountTransition = Boolean(entry && (entry.type === "expense" || entry.type === "salary")
    && (entry as InteractiveEntry).calculationMode !== "amount"
    && entryCalculationMode(selectedService, entry as InteractiveEntry | undefined) === "quantity_rate");
  const calculationMode = legacyAmountTransition && legacyAmountMode
    ? "amount"
    : entryCalculationMode(selectedService, entry as InteractiveEntry | undefined);
  const showDirectAmount = calculationMode === "amount" || legacyAmountTransition;
  const amount = calculationMode === "amount"
    ? (Number.isFinite(directAmount) ? directAmount : 0)
    : legacyAmountTransition
      ? (entry?.amount ?? 0)
    : (Number.isFinite(quantity) ? quantity : 0) * (Number.isFinite(rate) ? rate : 0);

  const invalidateMis = async () => {
    await queryClient.invalidateQueries({
      predicate: (query) => typeof query.queryKey[0] === "string" && query.queryKey[0].startsWith("/api/mis"),
    });
  };

  const performAction = async (action: MisEntryAction, remarks: string | null = null) => {
    if (!entry) return;
    if (parentIdentity?.parentId) {
      setLocation(`/entries/parents/${encodeURIComponent(parentIdentity.parentId)}`);
      return;
    }
    setError(null);
    try {
      await actionEntry.mutateAsync({ id: entry.id, data: { action, remarks } });
      await invalidateMis();
      await entryQuery.refetch();
    } catch (mutationError) {
      setError(errorMessage(mutationError));
    }
  };

  const save = async (values: MisEntryFormValues, submitAfterSave: boolean) => {
    setError(null);
    if (parentIdentity?.parentId) {
      setLocation(`/entries/parents/${encodeURIComponent(parentIdentity.parentId)}`);
      return;
    }
    const data = {
      projectId: values.projectId,
      tabId: values.tabId,
      serviceId: values.serviceId,
      fromDate: values.fromDate,
      toDate: values.toDate,
      remarks: values.remarks?.trim() || null,
      rateReason: values.rateReason?.trim() || null,
      ...(legacyAmountTransition && calculationMode === "amount" ? { calculationMode: "amount" as const } : {}),
      ...(calculationMode === "amount"
        ? { amount: values.amount }
        : { quantity: values.quantity, rate: values.rate }),
    } as unknown as MisEntryInput;
    try {
      const saved = isNew
        ? await createEntry.mutateAsync({ data })
        : await updateEntry.mutateAsync({ id: id!, data });
      if (submitAfterSave) await actionEntry.mutateAsync({ id: saved.id, data: { action: "submit", remarks: null } });
      await invalidateMis();
      if (isNew) {
        setLocation(`/entries/${saved.id}`);
      } else {
        form.reset(valuesFromEntry(saved));
        setLegacyAmountMode(false);
        await entryQuery.refetch();
      }
    } catch (mutationError) {
      setError(errorMessage(mutationError));
    }
  };

  const confirmWorkflowAction = async (remarks: string | null) => {
    if (!entry || !confirmAction) return;
    if (confirmAction === "delete") {
      setError(null);
      try {
        if (parentIdentity?.parentId) {
          setLocation(`/entries/parents/${encodeURIComponent(parentIdentity.parentId)}`);
          return;
        }
        await deleteEntry.mutateAsync({ id: entry.id });
        await invalidateMis();
        setLocation("/entries");
      } catch (mutationError) {
        setError(errorMessage(mutationError));
      }
    } else {
      await performAction(confirmAction, remarks);
    }
    setConfirmAction(null);
  };

  const isMutating = createEntry.isPending || updateEntry.isPending || actionEntry.isPending || deleteEntry.isPending;
  const selectedTabMissing = Boolean(entry && selectedTabId && !activeTabs.some((assignment) => assignment.tabId === selectedTabId));
  const selectedServiceMissing = Boolean(entry && selectedServiceId && !activeServices.some((service) => service.id === selectedServiceId));

  if (!isNew && (entryQuery.isLoading || (entry && hydratedEntryId !== entry.id))) {
    return <div className="flex min-h-48 items-center justify-center" data-testid="loading-entry"><Loader2 className="h-7 w-7 animate-spin" /></div>;
  }

  if (!isNew && entryQuery.error) {
    return (
      <div className="space-y-3">
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-destructive" role="alert" data-testid="text-entry-load-error">
          {errorMessage(entryQuery.error)}
        </div>
        {parentConflict?.existing?.parentId && (
          <Link
            href={`/entries/parents/${encodeURIComponent(parentConflict.existing.parentId)}`}
            className="inline-flex h-9 items-center rounded-md border px-3 text-sm font-medium hover:bg-muted"
          >
            Open parent entry
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/entries" className="inline-flex h-9 w-9 items-center justify-center rounded-md border transition-colors hover:bg-muted" aria-label="Back to entries" data-testid="link-back-to-entries"><ArrowLeft className="h-4 w-4" /></Link>
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{isNew ? "New entry" : entry?.projectName || "Entry details"}</h1>
            {entry && <MisEntryStatusBadge status={entry.status} />}
          </div>
          <p className="text-sm text-muted-foreground">{isNew ? "Record a period transaction." : `${entry?.tabName} · ${entry?.serviceName}`}</p>
        </div>
      </div>

      {error && <div className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert" data-testid="text-entry-mutation-error"><span className="flex-1">{error}</span><Button type="button" variant="outline" size="sm" onClick={() => { form.reset(valuesFromEntry(entry)); setLegacyAmountMode(false); setError(null); }}>Rollback local changes</Button></div>}

      {canEdit ? (
        <Form {...form}>
          <form onSubmit={form.handleSubmit((values) => save(values, false))}>
            <Card>
              <CardHeader>
                <CardTitle>Entry details</CardTitle>
                <CardDescription>Project, tab, and service selections are validated again when saved.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <MisEntryProjectSelector
                  id="entry-project"
                  label="Project"
                  value={selectedProjectId || ""}
                  selectedName={projectName || entry?.projectName}
                  activeOnly={isNew}
                  onChange={(project) => {
                    form.setValue("projectId", project.id, { shouldValidate: true });
                    form.setValue("tabId", "", { shouldValidate: false });
                    form.setValue("serviceId", "", { shouldValidate: false });
                    form.setValue("rate", 0, { shouldValidate: false });
                     form.setValue("amount", 0, { shouldValidate: false });
                    form.setValue("rateReason", null, { shouldValidate: false });
                     form.clearErrors(["projectId", "tabId", "serviceId", "rate", "amount", "rateReason"]);
                    void form.trigger("projectId");
                    setProjectName(project.name);
                  }}
                />
                {form.formState.errors.projectId && <p className="text-sm font-medium text-destructive">{form.formState.errors.projectId.message}</p>}
                <div className="grid gap-4 md:grid-cols-2">
                  <FormField control={form.control} name="tabId" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tab</FormLabel>
                      <Select value={field.value} disabled={!selectedProjectId} onValueChange={(value) => {
                        field.onChange(value);
                        form.setValue("serviceId", "", { shouldValidate: false });
                        form.setValue("rate", 0, { shouldValidate: false });
                         form.setValue("amount", 0, { shouldValidate: false });
                        form.setValue("rateReason", null, { shouldValidate: false });
                         form.clearErrors(["tabId", "serviceId", "rate", "amount", "rateReason"]);
                        void form.trigger("tabId");
                      }}>
                        <FormControl><SelectTrigger data-testid="select-entry-tab"><SelectValue placeholder={selectedProjectId ? "Select an enabled tab" : "Select a project first"} /></SelectTrigger></FormControl>
                        <SelectContent>
                          {selectedTabMissing && <SelectItem value={selectedTabId} disabled>Saved tab: {entry?.tabName} (inactive or removed)</SelectItem>}
                          {activeTabs.map((assignment) => <SelectItem key={assignment.tabId} value={assignment.tabId}>{assignment.tab.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="serviceId" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Service</FormLabel>
                      <Select value={field.value} disabled={!selectedTabId} onValueChange={(value) => {
                        field.onChange(value);
                        const service = services?.find((candidate) => candidate.id === value);
                        if (service) form.setValue("rate", service.defaultRate, { shouldValidate: false });
                         form.setValue("amount", 0, { shouldValidate: false });
                        form.setValue("rateReason", null, { shouldValidate: false });
                         form.clearErrors(["serviceId", "rate", "amount", "rateReason"]);
                        void form.trigger("serviceId");
                      }}>
                        <FormControl><SelectTrigger data-testid="select-entry-service"><SelectValue placeholder={selectedTabId ? "Select an active service" : "Select a tab first"} /></SelectTrigger></FormControl>
                        <SelectContent>
                          {selectedServiceMissing && <SelectItem value={field.value} disabled>Saved service: {entry?.serviceName} (inactive, removed, or outside effective dates)</SelectItem>}
                          {activeServices.map((service) => <SelectItem key={service.id} value={service.id}>{service.name} · {service.unit}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="fromDate" render={({ field }) => (
                    <FormItem><FormLabel>From date</FormLabel><FormControl><Input type="date" {...field} value={field.value || ""} data-testid="input-entry-from-date" /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="toDate" render={({ field }) => (
                    <FormItem><FormLabel>To date</FormLabel><FormControl><Input type="date" {...field} value={field.value || ""} data-testid="input-entry-to-date" /></FormControl><FormMessage /></FormItem>
                  )} />
                   {legacyAmountTransition && <div className="md:col-span-2 flex items-center justify-between rounded-md border bg-muted/20 p-3"><div><Label htmlFor="legacy-amount-mode">Convert this legacy row to a direct amount</Label><p className="text-xs text-muted-foreground">The saved amount is shown for reference. Quantity and rate snapshots stay unchanged unless you explicitly convert.</p></div><Switch id="legacy-amount-mode" checked={legacyAmountMode} onCheckedChange={(checked) => { setLegacyAmountMode(checked); if (checked && entry) form.setValue("amount", entry.amount, { shouldValidate: true }); }} /></div>}
                   {showDirectAmount ? <FormField control={form.control} name="amount" render={({ field }) => (
                     <FormItem><FormLabel>Amount {entry?.currency ? `(${entry.currency})` : ""}</FormLabel><FormControl><Input type="number" min="0" step="any" readOnly={legacyAmountTransition && !legacyAmountMode} value={Number.isFinite(field.value) ? field.value : ""} onChange={(event) => field.onChange(event.target.value === "" ? Number.NaN : Number(event.target.value))} data-testid="input-entry-amount" /></FormControl><p className="text-xs text-muted-foreground">{legacyAmountTransition && !legacyAmountMode ? "Preserved amount from the saved quantity/rate snapshot. Enable conversion to edit it." : "Enter the actual amount directly. Quantity and rate are not used for this type."}</p><FormMessage /></FormItem>
                   )} /> : <><FormField control={form.control} name="quantity" render={({ field }) => (
                     <FormItem><FormLabel>Quantity {selectedService?.unit ? `(${selectedService.unit})` : ""}</FormLabel><FormControl><Input type="number" min="0" step="any" value={Number.isFinite(field.value) ? field.value : ""} onChange={(event) => field.onChange(event.target.value === "" ? Number.NaN : Number(event.target.value))} data-testid="input-entry-quantity" /></FormControl><FormMessage /></FormItem>
                   )} />
                   <FormField control={form.control} name="rate" render={({ field }) => (
                     <FormItem><FormLabel>Rate</FormLabel><FormControl><Input type="number" min="0" step="any" disabled={!canRateOverride && Boolean(selectedService)} value={Number.isFinite(field.value) ? field.value : ""} onChange={(event) => field.onChange(event.target.value === "" ? Number.NaN : Number(event.target.value))} data-testid="input-entry-rate" /></FormControl>{!canRateOverride && selectedService && <p className="text-xs text-muted-foreground">Rate is locked to this service’s default rate.</p>}<FormMessage /></FormItem>
                   )} /></>}
                </div>
                <FormField control={form.control} name="remarks" render={({ field }) => (
                  <FormItem><FormLabel>Remarks (optional)</FormLabel><FormControl><Textarea value={field.value || ""} onChange={(event) => field.onChange(event.target.value || null)} data-testid="input-entry-remarks" /></FormControl><FormMessage /></FormItem>
                )} />
                   {calculationMode === "quantity_rate" && !legacyAmountTransition && canRateOverride && selectedService && rate !== selectedService.defaultRate && <FormField control={form.control} name="rateReason" render={({ field }) => (
                   <FormItem><FormLabel>Rate override reason</FormLabel><FormControl><Textarea value={field.value || ""} onChange={(event) => field.onChange(event.target.value || null)} placeholder="Explain why this rate differs from the configured service rate" data-testid="input-entry-rate-reason" /></FormControl><FormMessage /></FormItem>
                 )} />}
                <div className="flex items-center justify-between rounded-md bg-muted p-3">
                  <span className="text-sm text-muted-foreground">Amount preview</span>
                  <strong data-testid="text-entry-amount-preview">{Number.isFinite(amount) ? amount.toFixed(2) : "0.00"} {entry?.currency || "—"}</strong>
                </div>
                <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
                  <Button type="submit" variant="outline" disabled={isMutating} data-testid="button-save-entry"><Save className="mr-2 h-4 w-4" />{isMutating ? "Saving…" : "Save draft"}</Button>
                  <Button type="button" disabled={isMutating} onClick={form.handleSubmit((values) => save(values, true))} data-testid="button-save-and-submit-entry"><Send className="mr-2 h-4 w-4" />Save and submit</Button>
                </div>
              </CardContent>
            </Card>
          </form>
        </Form>
      ) : entry ? (
        <Card>
          <CardHeader><CardTitle>Entry details</CardTitle><CardDescription>Only draft entries can be edited.</CardDescription></CardHeader>
          <CardContent className="grid gap-4 text-sm sm:grid-cols-2">
            <div><span className="block text-muted-foreground">Project</span><strong>{entry.projectName}</strong></div>
            <div><span className="block text-muted-foreground">Tab / service</span><strong>{entry.tabName} · {entry.serviceName}</strong></div>
            <div><span className="block text-muted-foreground">Period</span><strong>{entry.fromDate} – {entry.toDate}</strong></div>
              {(entry as InteractiveEntry).calculationMode === "amount" || entry.type === "expense" || entry.type === "salary" ? <div><span className="block text-muted-foreground">Amount</span><strong>{entry.amount.toFixed(2)} {entry.currency}</strong></div> : <><div><span className="block text-muted-foreground">Quantity</span><strong>{entry.quantity} {entry.unit}</strong></div><div><span className="block text-muted-foreground">Rate</span><strong>{entry.rate} {entry.currency}</strong></div><div><span className="block text-muted-foreground">Amount</span><strong>{entry.amount.toFixed(2)} {entry.currency}</strong></div></>}
            <div className="sm:col-span-2"><span className="block text-muted-foreground">Remarks</span><strong className="font-normal">{entry.remarks || "—"}</strong></div>
          </CardContent>
        </Card>
      ) : isNew ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">You do not have permission to create MIS entries.</CardContent>
        </Card>
      ) : null}

      {entry && (
        <Card>
          <CardHeader><CardTitle>Workflow</CardTitle><CardDescription>Actions are available only with the required project-scoped permission.</CardDescription></CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {canSubmit && <Button type="button" onClick={() => performAction("submit")} disabled={isMutating} data-testid="button-submit-entry"><Send className="mr-2 h-4 w-4" />Submit saved draft</Button>}
            {canApprove && <Button type="button" onClick={() => performAction("approve")} disabled={isMutating} data-testid="button-approve-entry"><CheckCircle2 className="mr-2 h-4 w-4" />Approve</Button>}
            {canApprove && <Button type="button" variant="destructive" onClick={() => setConfirmAction("reject")} disabled={isMutating} data-testid="button-reject-entry"><XCircle className="mr-2 h-4 w-4" />Reject</Button>}
            {canReset && <Button type="button" variant="outline" onClick={() => setConfirmAction("reset")} disabled={isMutating} data-testid="button-reset-entry"><Undo2 className="mr-2 h-4 w-4" />Reset</Button>}
            {canCancel && <Button type="button" variant="outline" onClick={() => setConfirmAction("cancel")} disabled={isMutating} data-testid="button-cancel-entry"><XCircle className="mr-2 h-4 w-4" />Cancel</Button>}
            {canDelete && <Button type="button" variant="destructive" onClick={() => setConfirmAction("delete")} disabled={isMutating} data-testid="button-delete-entry"><Trash2 className="mr-2 h-4 w-4" />Delete</Button>}
            {!canSubmit && !canApprove && !canReset && !canCancel && !canDelete && <p className="text-sm text-muted-foreground">No workflow actions are currently available.</p>}
          </CardContent>
        </Card>
      )}
      {entry && <MisEntryHistory entryId={entry.id} canView={canHistory} />}
      <MisEntryActionConfirmation action={confirmAction} open={Boolean(confirmAction)} pending={isMutating} onOpenChange={(open) => { if (!open) setConfirmAction(null); }} onConfirm={confirmWorkflowAction} />
    </div>
  );
}