import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  getMisListProjectServicesQueryKey,
  getMisListEntryServicesQueryKey,
  useMisListEntryServices,
  useMisGetCurrentAccess,
  useMisListProjectServices,
  type MisService,
} from "@workspace/api-client-react";
import { AlertCircle, ArrowLeft, CheckCircle2, History, Loader2, Save, Send, Trash2, Undo2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { MisEntryStatusBadge } from "../components/MisEntryStatusBadge";
import { hasPermission } from "../lib/access";
import { isUnfinishedDraftRow, resumeDraftRows } from "../lib/resumeDraftRows";
import { applyQuantityLinks, isBlankCostRow } from "../lib/quantityLinks";
import {
  getMisParentConflict,
  misParentErrorMessage,
  safeMisParentUrl,
  type MisParentAction,
  type MisParentChild,
  type MisParentConflict,
  type MisParentDetailResponse,
  type MisParentLineInput,
  useMisDeleteParent,
  useMisGetParent,
  useMisGetParentHistory,
  useMisParentAction,
  useMisUpdateParent,
} from "../hooks/useMisParents";
import {
  calculatedCostRate,
  formatCalculatedRate,
  isCostBulkRow,
  parseFiniteNumber,
  percentageLabel,
  quantityRateAmount,
} from "../lib/bulkEntryHelpers";

type DetailLineState = {
  quantityOverridden?: boolean;
  quantity: string;
  rate: string;
  amount: string;
  remarks: string;
  rateReason: string;
  calculationMode: "quantity_rate" | "amount";
  calculatePercentAgainstIncome: boolean;
  canTransitionToAmount: boolean;
};

type InteractiveParentChild = MisParentChild & {
  calculationMode?: "quantity_rate" | "amount";
  rateEnabled?: boolean;
  calculatePercentAgainstIncome?: boolean;
};

type ConfirmAction = MisParentAction | "delete";

function numberValue(value: string): number | null {
  return parseFiniteNumber(value);
}

function formatMoney(value: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

function dateLabel(value: string) {
  if (!value) return "—";
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString();
}

function errorText(error: unknown) {
  return misParentErrorMessage(error);
}

type DetailSummaryRow = {
  label: string;
  amount: number;
  showPercentage: boolean;
};

function detailItemAmount(item: MisParentChild, state: DetailLineState): number {
  if (isCostBulkRow(item) || state.calculationMode === "amount") return numberValue(state.amount) ?? 0;
  return quantityRateAmount(state.quantity, state.rate) ?? 0;
}

function detailSummaryRows(
  items: MisParentChild[],
  lineState: Record<string, DetailLineState>,
  currency: string,
): DetailSummaryRow[] {
  const rows: DetailSummaryRow[] = [];
  const standardTypes = [
    ["income", "Income"],
    ["cost", "Cost"],
    ["expense", "Expense"],
    ["salary", "Salary"],
  ] as const;
  standardTypes.forEach(([type, label]) => {
    const matching = items.filter((item) => item.type === type && item.currency === currency);
    if (!matching.length) return;
    rows.push({
      label,
      amount: matching.reduce((total, item) => total + detailItemAmount(item, lineState[item.id] ?? lineStateFromItem(item)), 0),
      showPercentage: matching.every((item) => item.calculatePercentAgainstIncome === true),
    });
  });
  const custom = new Map<string, MisParentChild[]>();
  items.filter((item) => !standardTypes.some(([type]) => item.type === type) && item.currency === currency).forEach((item) => {
    const current = custom.get(item.tabName || item.type) ?? [];
    current.push(item);
    custom.set(item.tabName || item.type, current);
  });
  custom.forEach((matching, label) => rows.push({
    label,
    amount: matching.reduce((total, item) => total + detailItemAmount(item, lineState[item.id] ?? lineStateFromItem(item)), 0),
    showPercentage: matching.every((item) => item.calculatePercentAgainstIncome === true),
  }));
  return rows;
}

function snapshotKey(detail: MisParentDetailResponse) {
  return `${detail.parent.id}:${detail.parent.updatedAt ?? ""}:${detail.items.map((item) => `${item.id}:${item.updatedAt == null ? "" : String(item.updatedAt)}`).join(",")}`;
}

function lineStateFromItem(item: MisParentChild): DetailLineState {
  const interactive = item as InteractiveParentChild;
  return {
    quantityOverridden: !isUnfinishedDraftRow(item),
    quantity: isUnfinishedDraftRow(item) ? "" : String(item.quantity ?? ""),
    rate: String(item.rate ?? ""),
    amount: isUnfinishedDraftRow(item) ? "" : String(item.amount ?? ""),
    remarks: item.remarks ?? "",
    rateReason: item.rateReason ?? "",
    // Preserve the saved mode for legacy rows; Salary/Expense rows expose an
    // explicit transition to direct amount mode without rewriting untouched
    // quantity/rate snapshots.
    calculationMode: interactive.calculationMode ?? "quantity_rate",
    calculatePercentAgainstIncome: interactive.calculatePercentAgainstIncome === true,
    canTransitionToAmount: interactive.calculationMode !== "amount" && (item.type === "expense" || item.type === "salary"),
  };
}

function actionLabel(action: ConfirmAction) {
  if (action === "reset") return "Set to Draft";
  return action === "delete" ? "Delete" : `${action.slice(0, 1).toUpperCase()}${action.slice(1)}`;
}

export default function BulkEntryDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { data: access } = useMisGetCurrentAccess();
  const parentQuery = useMisGetParent(id ?? "");
  const detail = parentQuery.data;
  const parent = detail?.parent;
  const { data: services } = useMisListProjectServices(parent?.projectId ?? "", undefined, {
    query: {
      enabled: Boolean(parent?.projectId),
      queryKey: getMisListProjectServicesQueryKey(parent?.projectId ?? ""),
    },
  });
  const updateParent = useMisUpdateParent();
  const parentAction = useMisParentAction();
  const deleteParent = useMisDeleteParent();
  const historyQuery = useMisGetParentHistory(id ?? "", {
    enabled: Boolean(parent && (hasPermission(access, "history", parent.projectId) || hasPermission(access, "view_entries", parent.projectId))),
  });

  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [lineState, setLineState] = useState<Record<string, DetailLineState>>({});
  const [initialLineState, setInitialLineState] = useState<Record<string, DetailLineState>>({});
  const [initialDates, setInitialDates] = useState({ fromDate: "", toDate: "" });
  const [approvedEditReason, setApprovedEditReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<MisParentConflict | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [workflowRemarks, setWorkflowRemarks] = useState("");
  const hydratedKeyRef = useRef<string | null>(null);
  const acceptedLocation = useRef<string>(window.location.href);
  const restoringLocation = useRef(false);

  const hydrate = useCallback((next: MisParentDetailResponse) => {
    const nextLineState: Record<string, DetailLineState> = {};
    next.items.forEach((item) => { nextLineState[item.id] = lineStateFromItem(item); });
    setFromDate(next.parent.fromDate);
    setToDate(next.parent.toDate);
    setInitialDates({ fromDate: next.parent.fromDate, toDate: next.parent.toDate });
    setLineState(nextLineState);
    setInitialLineState(nextLineState);
    setApprovedEditReason("");
    hydratedKeyRef.current = snapshotKey(next);
  }, []);

  const projectId = parent?.projectId ?? "";
  const hasEditEntries = hasPermission(access, "edit_entries", projectId);
  const hasApprovedEdit = hasPermission(access, "edit_approved" as never, projectId);
  const canEditParent = Boolean(
    parent && (
      parent.status === "approved"
        ? hasApprovedEdit
        : ["draft", "submitted", "rejected", "returned"].includes(parent.status) && hasEditEntries
    ),
  );
  const canRateOverride = hasPermission(access, "rate_override", projectId);
  const hasFinancial = hasPermission(access, "financial", projectId);
  const canSubmit = Boolean(parent && ["draft", "rejected", "returned"].includes(parent.status) && hasPermission(access, "submit", projectId));
  const canApprove = Boolean(parent && parent.status === "submitted" && hasPermission(access, "approve", projectId));
  const canReject = canApprove;
  const canReturn = canApprove;
  const canReset = Boolean(parent
    && ["submitted", "approved", "rejected", "returned", "cancelled"].includes(parent.status)
    && hasPermission(access, "reset", projectId)
    && (parent.status !== "approved" || hasApprovedEdit));
  const canCancel = Boolean(parent && (
    parent.status === "approved"
      ? hasApprovedEdit
      : ["draft", "rejected", "returned", "submitted"].includes(parent.status) && hasEditEntries
  ));
  const canDelete = Boolean(parent && ["draft", "rejected", "returned", "cancelled", "approved"].includes(parent.status)
    && hasPermission(access, "delete_entries", projectId)
    && (parent.status !== "approved" || hasPermission(access, "delete_approved", projectId)));
  const resumingDraft = parent?.status === "draft" && canEditParent;
  const entryServiceParams = { from: fromDate || parent?.fromDate, to: toDate || parent?.toDate };
  const entryServicesQuery = useMisListEntryServices(projectId, entryServiceParams, {
    query: {
      queryKey: getMisListEntryServicesQueryKey(projectId, entryServiceParams),
      enabled: Boolean(resumingDraft && entryServiceParams.from && entryServiceParams.to),
    },
  });
  const serviceById = useMemo(() => new Map(
    [...(services ?? []), ...(entryServicesQuery.data ?? [])].map((service) => [service.id, service]),
  ), [services, entryServicesQuery.data]);
  const displayItems = useMemo(() => {
    if (!detail) return [];
    return resumingDraft ? resumeDraftRows(detail, entryServicesQuery.data ?? []) : detail.items;
  }, [detail, resumingDraft, entryServicesQuery.data]);
  useEffect(() => {
    const addMissing = (current: Record<string, DetailLineState>) => {
      const missing = displayItems.filter((item) => !current[item.id]);
      const next = missing.length
        ? { ...current, ...Object.fromEntries(missing.map((item) => [item.id, lineStateFromItem(item)])) }
        : current;
      return resumingDraft ? applyQuantityLinks(next, displayItems.map((item) => ({
        id: item.id, serviceId: item.serviceId, tabType: item.type,
        quantitySourceServiceId: serviceById.get(item.serviceId)?.quantitySourceServiceId,
      }))) : next;
    };
    setLineState(addMissing);
    setInitialLineState(addMissing);
  }, [displayItems, lineState, resumingDraft, serviceById]);
  const isDirty = useMemo(() => {
    if (fromDate !== initialDates.fromDate || toDate !== initialDates.toDate) return true;
    return Object.keys(lineState).some((lineId) => {
      const current = lineState[lineId];
      const initial = initialLineState[lineId];
      return !initial || current.quantity !== initial.quantity || current.rate !== initial.rate
        || current.amount !== initial.amount || current.calculationMode !== initial.calculationMode
        || current.remarks !== initial.remarks || current.rateReason !== initial.rateReason;
    });
  }, [fromDate, initialDates, initialLineState, lineState, toDate]);

  useEffect(() => {
    if (!detail || !id) return;
    const serverKey = snapshotKey(detail);
    if (
      hydratedKeyRef.current === null
      || hydratedKeyRef.current.split(":")[0] !== detail.parent.id
      || (!isDirty && hydratedKeyRef.current !== serverKey)
    ) hydrate(detail);
  }, [detail, hydrate, id, isDirty]);

  useEffect(() => {
    if (!isDirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty]);

  useEffect(() => {
    const onDocumentClick = (event: MouseEvent) => {
      if (!isDirty || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a");
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const href = anchor.href;
      if (!href || new URL(href, window.location.href).origin !== window.location.origin) return;
      if (!window.confirm("You have unsaved bulk entry changes. Leave this page?")) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    document.addEventListener("click", onDocumentClick, true);
    return () => document.removeEventListener("click", onDocumentClick, true);
  }, [isDirty]);

  useEffect(() => {
    const onPopState = () => {
      if (restoringLocation.current) {
        restoringLocation.current = false;
        return;
      }
      const destination = window.location.href;
      if (isDirty && !window.confirm("You have unsaved bulk entry changes. Leave this page?")) {
        restoringLocation.current = true;
        window.history.pushState(null, "", acceptedLocation.current);
        window.dispatchEvent(new PopStateEvent("popstate"));
        return;
      }
      acceptedLocation.current = destination;
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [isDirty]);

  const confirmDiscard = useCallback((message: string) => !isDirty || window.confirm(message), [isDirty]);
  const updateLine = (itemId: string, field: keyof DetailLineState, value: string) => {
    setLineState((current) => {
       const previous = current[itemId] ?? { quantity: "", rate: "", amount: "", remarks: "", rateReason: "", calculationMode: "quantity_rate" as const, calculatePercentAgainstIncome: false, canTransitionToAmount: false };
      const next = { ...current, [itemId]: { ...previous, [field]: value, ...(field === "quantity" ? { quantityOverridden: true } : {}) } };
      return resumingDraft ? applyQuantityLinks(next, displayItems.map((item) => ({
        id: item.id, serviceId: item.serviceId, tabType: item.type,
        quantitySourceServiceId: serviceById.get(item.serviceId)?.quantitySourceServiceId,
      }))) : next;
    });
    setError(null);
  };

  const isItemEditable = (item: MisParentChild) => {
    const service = serviceById.get(item.serviceId);
    return canEditParent && Boolean(service?.active);
  };

  const totalsByCurrency = useMemo(() => {
    const totals: Record<string, { income: number; cost: number; expense: number; salary: number; gross: number; net: number }> = {};
    displayItems.forEach((item) => {
      const state = lineState[item.id];
      if (!state) return;
      const amount = detailItemAmount(item, state);
      if (!Number.isFinite(amount)) return;
      const currency = item.currency || "—";
      const current = totals[currency] ?? { income: 0, cost: 0, expense: 0, salary: 0, gross: 0, net: 0 };
      if (item.financialClass === "income") current.income += amount;
      else if (item.financialClass === "cost") current.cost += amount;
      else if (item.financialClass === "expense") current.expense += amount;
      else if (item.financialClass === "salary") current.salary += amount;
      current.gross = current.income - current.cost - current.expense - current.salary;
      current.net = current.income - current.cost - current.expense - current.salary;
      totals[currency] = current;
    });
    return totals;
  }, [displayItems, lineState]);

  const invalidateParents = async () => {
    await queryClient.invalidateQueries({
      predicate: (query) => query.queryKey.some((part) => typeof part === "string" && part.includes("/api/mis")),
    });
  };

  const save = async (submitAfterSave: boolean) => {
    if (!parent || !detail) return;
    setError(null);
    setConflict(null);
    if (!fromDate || !toDate || fromDate > toDate) {
      setError("Choose a valid period with a from date no later than the to date.");
      return;
    }
    if (parent.status === "approved" && !approvedEditReason.trim()) {
      setError("A reason is required when editing an approved parent.");
      return;
    }
    const lines: MisParentLineInput[] = [];
    for (const item of displayItems) {
      const state = lineState[item.id];
      if (!state) continue;
      const isCost = isCostBulkRow(item);
      const isLegacyAmountDisplay = state.canTransitionToAmount && state.calculationMode === "quantity_rate";
      const isAmountMode = state.calculationMode === "amount";
      const inputBlank = isCost
        ? isBlankCostRow(state)
        : (isAmountMode ? state.amount : state.quantity).trim() === "";
      // Editable blank rows are intentionally omitted.  A read-only snapshot
      // still needs to be sent back so an inactive/deleted service keeps its
      // child identity and stored values during parent replacement.
      if (inputBlank && isItemEditable(item)) continue;
      const configuredService = serviceById.get(item.serviceId);
      const line = {
        ...(!isUnfinishedDraftRow(item) ? { id: item.id } : {}),
        serviceId: item.serviceId,
          ...(!isCost && state.canTransitionToAmount && state.calculationMode === "amount" ? { calculationMode: "amount" as const } : {}),
        remarks: state.remarks.trim() || null,
         ...(!isCost ? { rateReason: state.rateReason.trim() || null } : {}),
       } as MisParentLineInput & { amount?: number };
      if (isCost) {
        const quantity = numberValue(inputBlank ? String(item.quantity ?? 0) : state.quantity);
        const amount = numberValue(inputBlank ? String(item.amount ?? 0) : state.amount);
        if (quantity == null || quantity < 0 || amount == null || amount < 0) {
          setError(`Enter finite, non-negative quantity and amount values for ${item.serviceName || item.serviceId}.`);
          return;
        }
        line.quantity = quantity;
        line.amount = amount;
      } else if (isAmountMode) {
        const amount = numberValue(inputBlank ? String(item.amount ?? 0) : state.amount);
        if (amount == null || amount < 0) {
          setError(`Enter a valid non-negative amount for ${item.serviceName || item.serviceId}.`);
          return;
        }
        line.amount = amount;
      } else {
        const quantity = numberValue(inputBlank ? String(item.quantity ?? 0) : state.quantity);
        const rate = numberValue(inputBlank ? String(item.rate ?? 0) : state.rate);
        if (quantity == null || quantity < 0 || rate == null || rate < 0) {
          setError(`Enter valid non-negative quantity and rate values for ${item.serviceName || item.serviceId}.`);
          return;
        }
          const originalRate = numberValue(String(item.rate));
          const rateChanged = originalRate == null || rate !== originalRate;
          const isRateOverride = Boolean(!isLegacyAmountDisplay && configuredService && rateChanged && rate !== configuredService.defaultRate);
          if (isRateOverride && !state.rateReason.trim()) {
           setError(`A rate override reason is required for ${item.serviceName || item.serviceId}.`);
           return;
         }
         line.quantity = quantity;
         line.rate = rate;
      }
      lines.push(line);
    }
    if (lines.length === 0) {
      setError("Enter at least one quantity, or restore a zero quantity row before saving.");
      return;
    }
    try {
      let result = await updateParent.mutateAsync({
        id: parent.id,
        data: {
          fromDate,
          toDate,
          lines,
          ...(parent.status === "approved" ? { reason: approvedEditReason.trim() } : {}),
        },
      });
      if (submitAfterSave) {
        result = await parentAction.mutateAsync({ id: parent.id, data: { action: "submit", remarks: null } });
      }
      const refreshed = await parentQuery.refetch();
      hydrate(refreshed.data ?? result);
      await invalidateParents();
    } catch (mutationError) {
      const parentConflict = getMisParentConflict(mutationError);
      if (parentConflict) setConflict(parentConflict);
      setError(errorText(mutationError));
    }
  };

  const runAction = async (action: ConfirmAction, remarks: string | null = null) => {
    if (!parent) return;
    setError(null);
    setConflict(null);
    try {
      if (action === "delete") {
        await deleteParent.mutateAsync(parent.id);
        await invalidateParents();
        setLocation("/bulk-entries");
        return;
      }
      const result = await parentAction.mutateAsync({ id: parent.id, data: { action, remarks } });
      const refreshed = await parentQuery.refetch();
      hydrate(refreshed.data ?? result);
      await invalidateParents();
    } catch (mutationError) {
      setError(errorText(mutationError));
    } finally {
      setConfirmAction(null);
      setWorkflowRemarks("");
    }
  };

  const isMutating = updateParent.isPending || parentAction.isPending || deleteParent.isPending
    || Boolean(resumingDraft && (entryServicesQuery.isFetching || entryServicesQuery.isError));
  const openParentConflict = conflict?.canView && safeMisParentUrl(conflict.openUrl) ? conflict.openUrl : null;
  const historyItems = historyQuery.data;
  const hasQuantityRateLines = displayItems.some((item) => {
    const interactive = item as InteractiveParentChild;
    return isCostBulkRow(item) || (interactive.calculationMode !== "amount" && item.type !== "expense" && item.type !== "salary");
  }) ?? false;

  if (parentQuery.isLoading) {
    return <div className="flex min-h-48 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin" /></div>;
  }
  if (parentQuery.error || !detail || !parent) {
    return <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-destructive" role="alert">{errorText(parentQuery.error)}</div>;
  }

  return (
    <div className="w-full min-w-0 space-y-6">
      <div className="flex items-center gap-4">
        <Button type="button" variant="outline" size="icon" onClick={() => {
          if (confirmDiscard("You have unsaved bulk entry changes. Leave this page?")) setLocation("/bulk-entries");
        }}><ArrowLeft className="h-4 w-4" /></Button>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{parent.bulkNumber}</h1>
            <MisEntryStatusBadge status={parent.status} />
          </div>
          <p className="text-sm text-muted-foreground">{parent.projectName || parent.projectId}{parent.projectNumber ? ` · ${parent.projectNumber}` : ""} · Bulk MIS entry</p>
        </div>
      </div>

       {error && <div className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert"><AlertCircle className="h-4 w-4 shrink-0" /><span className="flex-1">{error}</span>{isDirty && <Button type="button" variant="outline" size="sm" onClick={() => { hydrate(detail); setError(null); }}>Rollback local changes</Button>}</div>}
      {conflict && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardHeader><CardTitle className="text-base">Period conflict</CardTitle><CardDescription>
            {conflict.existing?.bulkNumber
              ? `Existing bulk entry ${conflict.existing.bulkNumber} covers ${conflict.existing.fromDate ?? "an earlier date"} – ${conflict.existing.toDate ?? "the selected period"}.`
              : "Another MIS entry covers the selected period."}
            {conflict.existing?.status ? ` Status: ${conflict.existing.status}.` : ""}
          </CardDescription></CardHeader>
          {openParentConflict && <CardContent><Button type="button" variant="outline" onClick={() => setLocation(openParentConflict)}>Open existing entry</Button></CardContent>}
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Parent transaction</CardTitle>
          <CardDescription>One period and one workflow status apply to every service line.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div><span className="block text-muted-foreground">Bulk number</span><strong>{parent.bulkNumber}</strong></div>
          <div><span className="block text-muted-foreground">Project</span><strong>{parent.projectName || parent.projectId}</strong></div>
          <div><span className="block text-muted-foreground">Created by</span><strong>{parent.createdByName || parent.createdById}</strong></div>
          <div><span className="block text-muted-foreground">Entry type</span><strong>{parent.entryType}</strong></div>
          <div className="space-y-2"><Label htmlFor="parent-from-date">From date</Label><Input id="parent-from-date" type="date" value={fromDate} disabled={!canEditParent} onChange={(event) => setFromDate(event.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor="parent-to-date">To date</Label><Input id="parent-to-date" type="date" value={toDate} disabled={!canEditParent} onChange={(event) => setToDate(event.target.value)} /></div>
          <div><span className="block text-muted-foreground">Original period</span><strong>{dateLabel(parent.fromDate)} – {dateLabel(parent.toDate)}</strong></div>
          <div><span className="block text-muted-foreground">Last updated</span><strong>{parent.updatedAt ? new Date(parent.updatedAt).toLocaleString() : "—"}</strong></div>
          {parent.status === "approved" && canEditParent && (
            <div className="space-y-2 sm:col-span-2 lg:col-span-4">
              <Label htmlFor="approved-edit-reason">Approved edit reason</Label>
              <Textarea id="approved-edit-reason" value={approvedEditReason} onChange={(event) => setApprovedEditReason(event.target.value)} placeholder="Explain the correction to this approved entry" />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>All service lines</CardTitle><CardDescription>Inactive or deleted services remain visible as read-only snapshots. The server replaces the editable parent atomically.</CardDescription></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
                 <thead className="border-b bg-muted/50"><tr>
                  <th className="px-4 py-3">Service</th><th className="px-4 py-3">Period</th><th className="px-4 py-3">Quantity / Amount</th>{hasQuantityRateLines && <th className="px-4 py-3">Rate{displayItems.some(isCostBulkRow) ? " / Calculated" : ""}</th>}<th className="px-4 py-3 text-right">Amount</th><th className="px-4 py-3 text-right">% of income</th><th className="px-4 py-3">Remarks</th><th className="px-4 py-3">Status</th>
              </tr></thead>
              <tbody className="divide-y">
                {displayItems.map((item) => {
                  const state = lineState[item.id] ?? lineStateFromItem(item);
                  const service = serviceById.get(item.serviceId) as MisService | undefined;
                  const editable = isItemEditable(item);
                   const isCost = isCostBulkRow(item);
                  const quantity = numberValue(state.quantity);
                  const rate = numberValue(state.rate);
                   const directAmount = numberValue(state.amount);
                   const legacyAmountDisplay = state.canTransitionToAmount && state.calculationMode === "quantity_rate";
                    const amount = isCost || state.calculationMode === "amount" || legacyAmountDisplay
                     ? (directAmount != null && Number.isFinite(directAmount) ? directAmount : 0)
                      : quantityRateAmount(state.quantity, state.rate) ?? 0;
                    const calculatedRate = isCost ? calculatedCostRate(quantity, directAmount) : null;
                  const currency = item.currency || service?.currency || "USD";
                   const incomeTotal = totalsByCurrency[currency]?.income ?? 0;
                    const rowPercent = percentageLabel(amount, incomeTotal, state.calculatePercentAgainstIncome);
                  return (
                    <tr key={item.id} className={editable ? "hover:bg-muted/20" : "bg-muted/20"}>
                      <td className="px-4 py-3 align-top">
                        <div className="font-medium">{item.serviceName || item.serviceId}</div>
                        <div className="text-xs text-muted-foreground">{item.serviceId}{service?.unit || item.unit ? ` · ${service?.unit || item.unit}` : ""}</div>
                        {!editable && <div className="mt-1 text-xs text-muted-foreground">Snapshot (service inactive or removed)</div>}
                          {editable && state.canTransitionToAmount && <div className="mt-2 flex items-center gap-2"><Switch id={`amount-mode-${item.id}`} checked={state.calculationMode === "amount"} onCheckedChange={(checked) => setLineState((current) => { const previous = current[item.id] ?? state; return { ...current, [item.id]: { ...previous, calculationMode: checked ? "amount" : "quantity_rate", amount: checked ? String(item.amount) : previous.amount } }; })} /><Label htmlFor={`amount-mode-${item.id}`} className="text-xs">Convert to direct amount</Label></div>}
                      </td>
                       <td className="px-4 py-3 align-top text-xs text-muted-foreground">{dateLabel(item.fromDate)} – {dateLabel(item.toDate)}</td>
                         <td className="px-4 py-3 align-top">{isCost ? <Input type="number" min="0" step="any" value={state.quantity} disabled={!editable} onChange={(event) => updateLine(item.id, "quantity", event.target.value)} aria-label={`${item.serviceName || item.serviceId} quantity`} /> : legacyAmountDisplay ? <><Input type="number" min="0" step="any" value={state.amount} readOnly aria-label={`${item.serviceName || item.serviceId} preserved amount`} /><p className="mt-1 text-xs text-muted-foreground">Preserved amount; enable conversion to edit.</p></> : <><Input type="number" min="0" step="any" value={state.calculationMode === "amount" ? state.amount : state.quantity} disabled={!editable} onChange={(event) => updateLine(item.id, state.calculationMode === "amount" ? "amount" : "quantity", event.target.value)} aria-label={`${item.serviceName || item.serviceId} ${state.calculationMode === "amount" ? "amount" : "quantity"}`} />{state.calculationMode === "amount" && <p className="mt-1 text-xs text-muted-foreground">Direct amount</p>}</>}</td>
                       {hasQuantityRateLines && <td className="px-4 py-3 align-top">
                           {isCost ? <output className="flex min-h-10 items-center rounded-md border bg-muted/30 px-3 text-sm" aria-label={`Calculated rate for ${item.serviceName || item.serviceId}`} aria-live="polite">{formatCalculatedRate(calculatedRate)}</output> : state.calculationMode === "quantity_rate" && !legacyAmountDisplay && <><Input type="number" min="0" step="any" value={state.rate} disabled={!editable || !canRateOverride} onChange={(event) => updateLine(item.id, "rate", event.target.value)} aria-label={`${item.serviceName || item.serviceId} rate`} />
                         {editable && !canRateOverride && <p className="mt-1 text-xs text-muted-foreground">Configured rate</p>}
                         {editable && rate != null && service && rate !== service.defaultRate && (
                          <Input className="mt-2" disabled={!canRateOverride} placeholder="Rate override reason" value={state.rateReason} onChange={(event) => updateLine(item.id, "rateReason", event.target.value)} aria-label={`Rate reason for ${item.serviceName || item.serviceId}`} />
                         )}</>}
                       </td>}
                       <td className="px-4 py-3 text-right align-top font-medium">{isCost ? <Input type="number" min="0" step="any" value={state.amount} disabled={!editable} onChange={(event) => updateLine(item.id, "amount", event.target.value)} className={`ml-auto max-w-40 text-right ${editable && directAmount == null && state.amount.trim() !== "" ? "border-destructive" : ""}`} aria-label={`${item.serviceName || item.serviceId} amount`} /> : formatMoney(amount, currency)}</td>
                       <td className="px-4 py-3 text-right align-top font-medium">{rowPercent}</td>
                      <td className="px-4 py-3 align-top"><Textarea className="min-h-10" value={state.remarks} disabled={!editable} onChange={(event) => updateLine(item.id, "remarks", event.target.value)} /></td>
                      <td className="px-4 py-3 align-top"><MisEntryStatusBadge status={parent.status} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="border-t p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-muted-foreground">{detail.items.length} saved service line{detail.items.length === 1 ? "" : "s"}{resumingDraft && ` · ${displayItems.length - detail.items.length} unfinished services`}</div>
              {resumingDraft && entryServicesQuery.isFetching && <p role="status" className="text-sm text-muted-foreground">Loading all services for this draft…</p>}
              {resumingDraft && entryServicesQuery.isError && <p role="alert" className="text-sm text-destructive">Unable to load unfinished services. <button type="button" className="underline" onClick={() => void entryServicesQuery.refetch()}>Retry</button></p>}
               <div className="flex flex-wrap gap-4 text-sm font-medium">{Object.entries(totalsByCurrency).map(([currency, total]) => <span key={currency}>Income {currency}: {formatMoney(total.income, currency)} · Cost: {formatMoney(total.cost, currency)} · Expense: {formatMoney(total.expense, currency)} · Salary: {formatMoney(total.salary, currency)}</span>)}</div>
            </div>
             <div className="mt-4 space-y-6">
               {Object.entries(totalsByCurrency).map(([currency, total]) => {
                 const rows = detailSummaryRows(displayItems, lineState, currency);
                 return <div key={`summary-${currency}`} className="overflow-x-auto rounded-md border bg-muted/20">
                   <table className="w-full min-w-[520px] text-left text-sm">
                     <caption className="border-b px-4 py-3 text-left font-semibold">{currency} totals</caption>
                     <thead className="bg-muted/30 text-muted-foreground"><tr><th className="px-4 py-3 font-medium">Category</th><th className="px-4 py-3 text-right font-medium">Total Amount</th><th className="px-4 py-3 text-right font-medium">Percentage of Income</th></tr></thead>
                     <tbody className="divide-y">
                       {rows.map((row) => <tr key={row.label}><td className="px-4 py-3">{row.label}</td><td className="px-4 py-3 text-right font-medium">{formatMoney(row.amount, currency)}</td><td className="px-4 py-3 text-right">{percentageLabel(row.amount, total.income, row.showPercentage)}</td></tr>)}
                       {hasFinancial && <tr className="border-t"><td className="px-4 py-3">Gross profit</td><td className="px-4 py-3 text-right font-medium">{formatMoney(total.gross, currency)}</td><td className="px-4 py-3 text-right">{percentageLabel(total.gross, total.income, true)}</td></tr>}
                       {hasFinancial && <tr className="border-t-2 font-bold"><td className="px-4 py-3">CONTRIBUTION MARGIN</td><td className={`px-4 py-3 text-right ${total.net < 0 ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"}`}>{formatMoney(total.net, currency)}</td><td className="px-4 py-3 text-right">{percentageLabel(total.net, total.income, true)}</td></tr>}
                     </tbody>
                   </table>
                 </div>;
               })}
             </div>
            {canEditParent && <div className="mt-4 flex flex-wrap justify-end gap-2 border-t pt-4">
              <Button type="button" variant="outline" disabled={isMutating || !isDirty} onClick={() => hydrate(detail)}><Undo2 className="mr-2 h-4 w-4" />Discard changes</Button>
              <Button type="button" variant="outline" disabled={isMutating || !isDirty} onClick={() => void save(false)}><Save className="mr-2 h-4 w-4" />Save changes</Button>
              {canSubmit && <Button type="button" disabled={isMutating || !isDirty} onClick={() => void save(true)}><Send className="mr-2 h-4 w-4" />Save and resubmit</Button>}
            </div>}
            {!canEditParent && <p className="mt-4 border-t pt-4 text-sm text-muted-foreground">This parent is read-only for your current status and permissions.</p>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Workflow</CardTitle><CardDescription>Actions update the parent and every child in one transaction.</CardDescription></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {canSubmit && <Button type="button" onClick={() => setConfirmAction("submit")} disabled={isMutating}><Send className="mr-2 h-4 w-4" />Submit</Button>}
          {canApprove && <Button type="button" onClick={() => setConfirmAction("approve")} disabled={isMutating}><CheckCircle2 className="mr-2 h-4 w-4" />Approve</Button>}
          {canReject && <Button type="button" variant="destructive" onClick={() => setConfirmAction("reject")} disabled={isMutating}><XCircle className="mr-2 h-4 w-4" />Reject</Button>}
          {canReturn && <Button type="button" variant="outline" onClick={() => setConfirmAction("return")} disabled={isMutating}><Undo2 className="mr-2 h-4 w-4" />Return</Button>}
          {canReset && <Button type="button" variant="outline" onClick={() => setConfirmAction("reset")} disabled={isMutating}>Set to Draft</Button>}
          {canCancel && <Button type="button" variant="outline" onClick={() => setConfirmAction("cancel")} disabled={isMutating}><XCircle className="mr-2 h-4 w-4" />Cancel</Button>}
          {canDelete && <Button type="button" variant="destructive" onClick={() => setConfirmAction("delete")} disabled={isMutating}><Trash2 className="mr-2 h-4 w-4" />Delete</Button>}
          {!canSubmit && !canApprove && !canReset && !canCancel && !canDelete && !canReturn && <p className="text-sm text-muted-foreground">No workflow actions are currently available.</p>}
        </CardContent>
      </Card>

      {(historyItems || historyQuery.isLoading || historyQuery.error) && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><History className="h-5 w-5" />Parent history</CardTitle><CardDescription>Append-only audit records for this parent transaction.</CardDescription></CardHeader>
          <CardContent>
            {historyQuery.isLoading ? <p className="text-sm text-muted-foreground">Loading history…</p> : historyQuery.error ? <p className="text-sm text-destructive">{errorText(historyQuery.error)}</p> : historyItems?.length ? <ol className="space-y-4">{historyItems.map((item) => (
              <li key={item.id} className="border-l-2 pl-4"><div className="flex flex-wrap gap-2"><span className="font-medium">{item.action}</span><span className="text-sm text-muted-foreground">by {item.actorName || item.actorId || "Unknown user"} · {new Date(item.occurredAt).toLocaleString()}</span></div>{item.remarks && <p className="mt-1 text-sm">{item.remarks}</p>}{(item.oldValues || item.newValues) && <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2"><pre className="overflow-auto rounded bg-muted p-2">Old: {JSON.stringify(item.oldValues ?? null)}</pre><pre className="overflow-auto rounded bg-muted p-2">New: {JSON.stringify(item.newValues ?? null)}</pre></div>}</li>
            ))}</ol> : <p className="text-sm text-muted-foreground">No history is available for this parent.</p>}
          </CardContent>
        </Card>
      )}

      <AlertDialog open={Boolean(confirmAction)} onOpenChange={(open) => { if (!open) { setConfirmAction(null); setWorkflowRemarks(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>{confirmAction === "reset" ? "Set bulk entry to Draft?" : confirmAction ? `${actionLabel(confirmAction)} parent?` : ""}</AlertDialogTitle><AlertDialogDescription>
            {confirmAction === "delete" ? "This removes the parent and every child atomically. This cannot be undone." : "This workflow action changes the parent and synchronizes every child line."}
          </AlertDialogDescription></AlertDialogHeader>
          {confirmAction && confirmAction !== "delete" && (confirmAction === "reject" || confirmAction === "return" || confirmAction === "submit") && (
            <div className="space-y-2"><Label htmlFor="parent-workflow-remarks">{confirmAction === "reject" || confirmAction === "return" ? "Remarks (required)" : "Remarks (optional)"}</Label><Textarea id="parent-workflow-remarks" value={workflowRemarks} onChange={(event) => setWorkflowRemarks(event.target.value)} /></div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isMutating}>Back</AlertDialogCancel>
            <AlertDialogAction disabled={isMutating || (confirmAction !== "delete" && (confirmAction === "reject" || confirmAction === "return") && !workflowRemarks.trim())} onClick={(event) => { event.preventDefault(); if (confirmAction) void runAction(confirmAction, workflowRemarks.trim() || null); }}>{isMutating ? "Working…" : confirmAction ? actionLabel(confirmAction) : "Confirm"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
