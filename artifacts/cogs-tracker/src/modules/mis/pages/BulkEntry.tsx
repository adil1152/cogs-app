import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  getMisListEntryServicesQueryKey,
  useMisGetCurrentAccess,
  useMisListEntryServices,
  MisService,
} from "@workspace/api-client-react";
import { ArrowLeft, Save, Send, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { MisEntryProjectSelector } from "../components/MisEntryProjectSelector";
import { hasPermission } from "../lib/access";
import {
  getMisParentConflict,
  misParentErrorMessage,
  safeMisParentUrl,
  type MisParentConflict,
  type MisParentLineInput,
  useMisCreateParent,
} from "../hooks/useMisParents";
import {
  bulkGroupRank,
  bulkRowAmount,
  calculatedCostRate,
  formatCalculatedRate,
  isCostBulkRow,
  parseFiniteNumber,
  percentageLabel,
} from "../lib/bulkEntryHelpers";

import { applyQuantityLinks, isBlankCostRow } from "../lib/quantityLinks";

type ServiceFormState = {
  quantityOverridden?: boolean;
  quantity: string;
  rate: string;
  amount: string;
  remarks: string;
  rateReason: string;
  explicitSave: boolean;
};

type ServiceGroup = {
  type: string;
  tabName: string;
  tabId: string;
  services: MisService[];
};

type CurrencyTotals = {
  income: number;
  cost: number;
  expense: number;
  salary: number;
  other: number;
  net: number;
  gross: number;
};

type InteractiveService = MisService & {
  rateEnabled?: boolean;
  calculatePercentAgainstIncome?: boolean;
  calculationMode?: "quantity_rate" | "amount";
};

function bulkEntryErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object") {
    const value = error as { data?: { detail?: unknown; message?: unknown; error?: unknown }; detail?: unknown; message?: unknown };
    const detail = value.data?.detail ?? value.data?.message ?? value.data?.error ?? value.detail ?? value.message;
    if (typeof detail === "string" && detail.trim()) return detail;
  }
  return "Unable to save bulk entries. Your entered rows were kept.";
}

function initialBulkServiceState(service: MisService): ServiceFormState {
  return {
    quantity: "",
    rate: String(service.defaultRate),
    amount: service.tabType === "expense" ? String(service.defaultRate) : "",
    remarks: "",
    rateReason: "",
    explicitSave: false,
  };
}

function serviceCalculationMode(service: MisService): "quantity_rate" | "amount" {
  const interactive = service as InteractiveService;
  if (isCostBulkRow(service)) return "quantity_rate";
  if (interactive.calculationMode) return interactive.calculationMode;
  if (interactive.rateEnabled === false) return "amount";
  return "quantity_rate";
}

function calculatesPercent(service: MisService): boolean {
  return (service as InteractiveService).calculatePercentAgainstIncome === true;
}

function isLumpSumService(service: MisService): boolean {
  const unit = service.unit.trim().toLowerCase();
  return unit === "ls" || unit.includes("lump");
}

function parsedNumber(value: string): number | null {
  return parseFiniteNumber(value);
}

function validBulkDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return date.getUTCFullYear() === Number(value.slice(0, 4))
    && date.getUTCMonth() + 1 === Number(value.slice(5, 7))
    && date.getUTCDate() === Number(value.slice(8, 10));
}

function formatBulkAmount(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function bulkServiceSignature(services: MisService[]): string {
  return services.map((service) => service.id).join("\u001f");
}

type BulkSummaryRow = {
  label: string;
  amount: number;
  showPercentage: boolean;
};

function summaryAmountForGroup(
  group: ServiceGroup,
  currency: string,
  formState: Record<string, ServiceFormState>,
): number {
  return group.services.reduce((total, service) => {
    if (service.currency !== currency) return total;
    const state = formState[service.id];
    if (!state) return total;
    const blank = isCostBulkRow(service)
      ? isBlankCostRow(state)
      : serviceCalculationMode(service) === "amount" ? state.amount.trim() === "" : state.quantity.trim() === "";
    if (blank && !state.explicitSave) return total;
    const amount = bulkRowAmount(service, state, state.explicitSave);
    return amount != null && amount >= 0 ? total + amount : total;
  }, 0);
}

function summaryRowsForCurrency(
  groups: ServiceGroup[],
  currency: string,
  formState: Record<string, ServiceFormState>,
): BulkSummaryRow[] {
  const rows: BulkSummaryRow[] = [];
  const standardTypes = [
    ["income", "Income"],
    ["cost", "Cost"],
    ["expense", "Expense"],
    ["salary", "Salary"],
  ] as const;
  standardTypes.forEach(([type, label]) => {
    const matchingGroups = groups.filter((group) => group.type.toLowerCase() === type && group.services.some((service) => service.currency === currency));
    if (!matchingGroups.length) return;
    rows.push({
      label,
      amount: matchingGroups.reduce((total, group) => total + summaryAmountForGroup(group, currency, formState), 0),
      showPercentage: matchingGroups.every((group) => group.services.filter((service) => service.currency === currency).every(calculatesPercent)),
    });
  });
  groups
    .filter((group) => !standardTypes.some(([type]) => group.type.toLowerCase() === type))
    .forEach((group) => {
      const amount = summaryAmountForGroup(group, currency, formState);
      if (group.services.some((service) => service.currency === currency)) {
        rows.push({
          label: group.tabName,
          amount,
          showPercentage: group.services.filter((service) => service.currency === currency).every(calculatesPercent),
        });
      }
    });
  return rows;
}

export default function BulkEntry() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { data: access } = useMisGetCurrentAccess();
  
  const [filters, setFilters] = useState({ projectId: "", fromDate: "", toDate: "" });
  const [projectName, setProjectName] = useState<string | null>(null);
  const [formState, setFormState] = useState<Record<string, ServiceFormState>>({});
  const [initialState, setInitialState] = useState<Record<string, ServiceFormState>>({});
  const [showErrors, setShowErrors] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<MisParentConflict | null>(null);
  const [visibleServices, setVisibleServices] = useState<MisService[] | null>(null);
  const appliedServiceSignature = useRef<string | null>(null);
  const declinedServiceSignature = useRef<string | null>(null);
  const acceptedLocation = useRef<string>(window.location.href);
  const restoringLocation = useRef(false);

  const serviceParams = {
    from: filters.fromDate || undefined,
    to: filters.toDate || undefined,
  };
  const servicesQuery = useMisListEntryServices(filters.projectId, serviceParams, {
    query: {
      enabled: Boolean(filters.projectId && validBulkDate(filters.fromDate) && validBulkDate(filters.toDate) && filters.fromDate <= filters.toDate),
      queryKey: getMisListEntryServicesQueryKey(filters.projectId, serviceParams),
    },
  });
  const { data: services, isLoading, error: servicesError } = servicesQuery;
  const createParent = useMisCreateParent();

  const isDirty = useMemo(() => {
    return Object.keys(formState).some((id) => {
      const s = formState[id];
      const init = initialState[id];
      if (!init) return false;
      return s.quantity !== init.quantity
        || s.rate !== init.rate
         || s.amount !== init.amount
        || s.remarks !== init.remarks
        || s.rateReason !== init.rateReason
        || s.explicitSave !== init.explicitSave;
    });
  }, [formState, initialState]);

  const confirmDiscard = useCallback((message: string): boolean => {
    return !isDirty || window.confirm(message);
  }, [isDirty]);

  const clearBulkRows = useCallback(() => {
    setVisibleServices(null);
    setFormState({});
    setInitialState({});
    appliedServiceSignature.current = null;
    declinedServiceSignature.current = null;
    setShowErrors(false);
    setFormError(null);
  }, []);

  useEffect(() => {
    if (!isDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty]);

  useEffect(() => {
    // A changed query can briefly retain the previous response while the new
    // period is loading. Keep the cleared snapshot until that response lands.
    if (servicesQuery.isFetching && appliedServiceSignature.current === null) return;
    if (!services) {
      if (!filters.projectId || !filters.fromDate || !filters.toDate) clearBulkRows();
      return;
    }

    const signature = bulkServiceSignature(services);
    const changedServiceSet = appliedServiceSignature.current !== null
      && appliedServiceSignature.current !== signature;
    if (
      changedServiceSet
      && isDirty
      && declinedServiceSignature.current !== signature
      && !window.confirm("The available services changed. Discard values for services that are no longer available?")
    ) {
      declinedServiceSignature.current = signature;
      return;
    }

    declinedServiceSignature.current = null;
    appliedServiceSignature.current = signature;
    setVisibleServices(services);
    setFormState((previous) => {
      const next: Record<string, ServiceFormState> = {};
      services.forEach((service) => {
        next[service.id] = previous[service.id] ?? initialBulkServiceState(service);
      });
      return applyQuantityLinks(next, services.map((service) => ({ ...service, serviceId: service.id })));
    });
    setInitialState((previous) => {
      const next: Record<string, ServiceFormState> = {};
      services.forEach((service) => {
        next[service.id] = previous[service.id] ?? initialBulkServiceState(service);
      });
      return next;
    });
  }, [clearBulkRows, filters.fromDate, filters.projectId, filters.toDate, isDirty, services, servicesQuery.isFetching]);

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

  const canRateOverride = hasPermission(access, "rate_override", filters.projectId);
  const canCreate = hasPermission(access, "create_entries", filters.projectId);
  const canSubmit = hasPermission(access, "submit", filters.projectId);
  const hasFinancial = hasPermission(access, "financial", filters.projectId);
  const validPeriod = validBulkDate(filters.fromDate)
    && validBulkDate(filters.toDate)
    && filters.fromDate <= filters.toDate;
  const dataReady = Boolean(
    filters.projectId
    && validPeriod
    && visibleServices !== null
    && services !== undefined
    && !servicesError,
  );
  const loadingServices = isLoading || (servicesQuery.isFetching && visibleServices === null);

  const updateForm = (serviceId: string, field: keyof ServiceFormState, value: string | boolean) => {
    setFormState((previous) => {
      const current = previous[serviceId];
      if (!current) return previous;
      const next = { ...current, [field]: value };
      if (field === "rate" && typeof value === "string" && parsedNumber(value) === visibleServices?.find((service) => service.id === serviceId)?.defaultRate) {
        next.rateReason = "";
      }
      if (field === "quantity") next.quantityOverridden = true;
      return applyQuantityLinks({ ...previous, [serviceId]: next }, (visibleServices ?? []).map((service) => ({ ...service, serviceId: service.id })));
    });
    setFormError(null);
  };

  const getRowErrors = (service: MisService, state: ServiceFormState): string[] => {
    const errors: string[] = [];
    if (isCostBulkRow(service)) {
      const quantityBlank = state.quantity.trim() === "";
      const amountBlank = state.amount.trim() === "";
      if (isBlankCostRow(state) && !state.explicitSave) return errors;
      const quantity = quantityBlank && state.explicitSave ? 0 : parsedNumber(state.quantity);
      const amount = amountBlank && state.explicitSave ? 0 : parsedNumber(state.amount);
      if (quantity == null || quantity < 0 || amount == null || amount < 0) {
        errors.push("Enter finite, non-negative quantity and amount.");
      }
      return errors;
    }
    if (serviceCalculationMode(service) === "amount") {
      const isBlank = state.amount.trim() === "";
      const amount = isBlank && state.explicitSave ? 0 : parsedNumber(state.amount);
      if (isBlank && !state.explicitSave) return errors;
      if (amount == null || amount < 0) errors.push("Enter a finite, non-negative amount.");
      return errors;
    }
    const isBlank = state.quantity.trim() === "";
    const quantity = isBlank && state.explicitSave ? 0 : parsedNumber(state.quantity);
    if (isBlank && !state.explicitSave) return errors;
    if (quantity == null || quantity < 0) errors.push("Enter a finite, non-negative quantity.");

    const rate = parsedNumber(state.rate);
    if (rate == null || rate < 0) {
      errors.push("Enter a finite, non-negative rate.");
    } else if (rate !== service.defaultRate && !state.rateReason.trim()) {
      errors.push("A reason is required for this rate override.");
    }
    return errors;
  };

  const groupedServices = useMemo<ServiceGroup[]>(() => {
    const groups: ServiceGroup[] = [];
    (visibleServices ?? []).forEach((service) => {
      let group = groups.find((candidate) => candidate.tabId === service.tabId);
      if (!group) {
        group = {
          type: service.tabType || "other",
          tabName: service.tabName,
          tabId: service.tabId,
          services: [],
        };
        groups.push(group);
      }
      group.services.push(service);
    });
    const typeOrder = ["income", "cost", "expense", "salary", "other"];
    groups.sort((a, b) => {
      const aOrder = typeOrder.indexOf(a.type.toLowerCase());
      const bOrder = typeOrder.indexOf(b.type.toLowerCase());
      const aPosition = aOrder === -1 ? bulkGroupRank(a.type) : aOrder;
      const bPosition = bOrder === -1 ? bulkGroupRank(b.type) : bOrder;
      // Keep the API's service/tab order within a category.  Sorting only by
      // category prevents a configured tab sequence from moving Cost below a
      // custom tab while preserving the order of rows within each group.
      return aPosition - bPosition;
    });
    return groups;
  }, [visibleServices]);

  const totalsByCurrency = useMemo<Record<string, CurrencyTotals>>(() => {
    const totals: Record<string, CurrencyTotals> = {};
    (visibleServices ?? []).forEach((service) => {
      const state = formState[service.id];
      if (!state) return;
        const mode = serviceCalculationMode(service);
        const isBlank = isCostBulkRow(service)
          ? isBlankCostRow(state)
          : mode === "amount" ? state.amount.trim() === "" : state.quantity.trim() === "";
        if (isBlank && !state.explicitSave) return;
        const amount = bulkRowAmount(service, state, state.explicitSave);
        if (amount == null || amount < 0) return;
      const currency = service.currency;
       const current = totals[currency] ?? { income: 0, cost: 0, expense: 0, salary: 0, other: 0, net: 0, gross: 0 };
      // Display grouping and accounting classification are independent.
      // A custom Other tab may contribute to income, cost, expense or salary.
      const type = service.financialClass;
      if (type === "income") current.income += amount;
      else if (type === "cost") current.cost += amount;
      else if (type === "expense") current.expense += amount;
      else if (type === "salary") current.salary += amount;
      else current.other += amount;
       current.gross = current.income - current.cost - current.expense - current.salary;
      current.net = current.income - current.cost - current.expense - current.salary;
      totals[currency] = current;
    });
    return totals;
  }, [formState, visibleServices]);

  const submitData = async (action: "draft" | "submit") => {
    setShowErrors(true);
    setFormError(null);
    setConflict(null);
    if (!validPeriod) {
      setFormError("Choose a valid period with a from date no later than the to date.");
      return;
    }
    if (!dataReady || !visibleServices) {
      setFormError("Choose a project and valid period, then wait for all services to finish loading.");
      return;
    }
    if (!canCreate) {
      setFormError("You need create_entries permission for this project to save bulk entries.");
      return;
    }
    if (action === "submit" && !canSubmit) {
      setFormError("You need submit permission for this project to save and submit entries.");
      return;
    }

    const lines: MisParentLineInput[] = [];
    let hasValidationError = false;
    visibleServices.forEach((service) => {
      const state = formState[service.id];
      if (!state) return;
      const mode = serviceCalculationMode(service);
      const isCost = isCostBulkRow(service);
      const isBlank = isCost
        ? isBlankCostRow(state)
        : mode === "amount" ? state.amount.trim() === "" : state.quantity.trim() === "";
      if (isBlank && !state.explicitSave) return;
      const errors = getRowErrors(service, state);
      if (errors.length) {
        hasValidationError = true;
        return;
      }
      const line = { serviceId: service.id } as MisParentLineInput & { amount?: number };
      if (isCost) {
        const quantity = state.quantity.trim() === "" && state.explicitSave ? 0 : parsedNumber(state.quantity);
        const amount = isBlank && state.explicitSave ? 0 : parsedNumber(state.amount);
        if (quantity == null || amount == null) return;
        // Cost uses amount as the source value.  Never send a calculated rate
        // or a rate-override reason, even when the caller can edit rates.
        line.quantity = quantity;
        line.amount = amount;
      } else if (mode === "amount") {
        const amount = isBlank ? 0 : parsedNumber(state.amount);
        if (amount == null) return;
        line.amount = amount;
       } else {
         const quantity = isBlank ? 0 : parsedNumber(state.quantity);
         const rate = parsedNumber(state.rate);
         if (quantity == null || rate == null) return;
         line.quantity = quantity;
         if (rate !== service.defaultRate) {
           line.rate = rate;
           line.rateReason = state.rateReason.trim();
        }
       }
      const remarks = state.remarks.trim();
      if (remarks) line.remarks = remarks;
      lines.push(line);
    });
    if (hasValidationError) {
      setFormError("Please fix the highlighted rows. Unchanged blank rows are skipped.");
      return;
    }
    if (lines.length === 0) {
      setFormError("Enter at least one quantity, or mark a zero quantity row to save this bulk entry.");
      return;
    }

    try {
      const created = await createParent.mutateAsync({
        projectId: filters.projectId,
        fromDate: filters.fromDate,
        toDate: filters.toDate,
        lines,
        action,
      });
      await queryClient.invalidateQueries({
        predicate: (query) => query.queryKey.some(
          (part) => typeof part === "string" && part.startsWith("/api/mis"),
        ),
      });
      setLocation(`/entries/parents/${created.parent.id}`);
    } catch (error) {
      const parentConflict = getMisParentConflict(error);
      if (parentConflict) setConflict(parentConflict);
      setFormError(misParentErrorMessage(error) || bulkEntryErrorMessage(error));
    }
  };

  const rollbackLocalChanges = () => {
    setFormState(initialState);
    setShowErrors(false);
    setFormError(null);
    setConflict(null);
  };

  return (
    <div className="w-full min-w-0 space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="icon" onClick={() => {
          if (isDirty && !window.confirm("You have unsaved changes. Leave page?")) return;
          setLocation("/entries");
        }}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">Bulk Entry</h1>
          <p className="text-sm text-muted-foreground">Enter all project services for a period simultaneously.</p>
        </div>
      </div>
      
      <Card>
        <CardHeader>
          <CardTitle>Period Configuration</CardTitle>
          <CardDescription>Select a project and date range to load available services.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <MisEntryProjectSelector
              id="bulk-project"
              label="Project"
              value={filters.projectId}
              selectedName={projectName}
              activeOnly={true}
              onChange={(project) => {
                if (!confirmDiscard("Discard unsaved changes before changing project?")) return;
                setFilters(prev => ({ ...prev, projectId: project.id }));
                setProjectName(project.name);
                clearBulkRows();
              }}
            />
            <div className="space-y-2">
              <Label htmlFor="bulk-from">From Date</Label>
              <Input 
                id="bulk-from" type="date" 
                value={filters.fromDate} 
                onChange={(e) => {
                  if (!confirmDiscard("Discard unsaved changes before changing the period?")) return;
                  setFilters(prev => ({ ...prev, fromDate: e.target.value }));
                  clearBulkRows();
                }} 
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bulk-to">To Date</Label>
              <Input 
                id="bulk-to" type="date" 
                value={filters.toDate} 
                onChange={(e) => {
                  if (!confirmDiscard("Discard unsaved changes before changing the period?")) return;
                  setFilters(prev => ({ ...prev, toDate: e.target.value }));
                  clearBulkRows();
                }} 
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {servicesError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-destructive">
          {servicesError instanceof Error ? servicesError.message : "Failed to load services"}
        </div>
      )}
      
      {loadingServices && (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {!loadingServices && !servicesError && filters.projectId && filters.fromDate && filters.toDate && groupedServices.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No active services found for the selected project and date range.
          </CardContent>
        </Card>
      )}

      {!loadingServices && !servicesError && groupedServices.length > 0 && (
        <div className="space-y-6">
          {groupedServices.map(group => (
            <Card key={group.tabId} className="overflow-hidden">
              <div className="bg-muted/30 px-6 py-4 border-b flex items-center justify-between">
                <h3 className="text-lg font-semibold">{group.tabName}</h3>
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{group.type}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm min-w-[800px]">
                  <thead className="bg-muted/10 text-muted-foreground">
                     <tr>
                       <th className="px-6 py-3 font-medium w-[22%]">Service</th>
                        <th className="px-4 py-3 font-medium w-40">{group.services.some((service) => serviceCalculationMode(service) === "quantity_rate") ? "Quantity" : "Amount"}</th>
                       <th className="px-4 py-3 font-medium w-24 text-center">Save 0</th>
                        {group.services.some((service) => serviceCalculationMode(service) === "quantity_rate") && <th className="px-4 py-3 font-medium w-40">Rate{group.services.some(isCostBulkRow) ? " / Calculated" : ""}</th>}
                       <th className="px-4 py-3 font-medium w-32 text-right">Amount</th>
                       <th className="px-4 py-3 font-medium w-24 text-right">% of income</th>
                       <th className="px-6 py-3 font-medium">Remarks</th>
                     </tr>
                  </thead>
                  <tbody className="divide-y">
                     {group.services.map((s) => {
                      const fs = formState[s.id];
                      if (!fs) return null;
                         const mode = serviceCalculationMode(s);
                         const isCost = isCostBulkRow(s);
                        const quantity = parsedNumber(fs.quantity);
                        const rate = parsedNumber(fs.rate);
                        const directAmount = parsedNumber(fs.amount);
                         const isBlank = isCost
                           ? fs.quantity.trim() === "" && fs.amount.trim() === ""
                           : mode === "amount" ? fs.amount.trim() === "" : fs.quantity.trim() === "";
                        const rowAmount = (isBlank && !fs.explicitSave)
                          ? 0
                           : bulkRowAmount(s, fs, fs.explicitSave) ?? 0;
                      const errors = showErrors ? getRowErrors(s, fs) : [];
                        const rateIsOverridden = !isCost && rate != null && rate !== s.defaultRate;
                        const incomeTotal = totalsByCurrency[s.currency]?.income ?? 0;
                         const calculatedRate = isCost ? calculatedCostRate(quantity, directAmount) : null;

                      return (
                        <tr key={s.id} className={`transition-colors ${errors.length > 0 ? "bg-destructive/5" : "hover:bg-muted/20"}`}>
                          <td className="px-6 py-4 align-top">
                            <div className="font-medium text-foreground">{s.name}</div>
                             <div className="text-xs text-muted-foreground mt-1">{serviceCalculationMode(s) === "amount" ? "Direct amount" : s.unit}</div>
                            {isCost && s.quantitySourceServiceId && <div className="mt-1 text-xs text-muted-foreground">Quantity from {visibleServices?.find((source) => source.id === s.quantitySourceServiceId)?.name ?? "linked Income service"}{fs.quantityOverridden ? " — manually overridden" : " — editable default"}. Blank amount skips this row.</div>}
                            {errors.map(err => <div key={err} className="text-xs text-destructive mt-1.5">{err}</div>)}
                          </td>
                           <td className="px-4 py-4 align-top">
                             <Input
                               type="number" min="0" step="any"
                               value={mode === "amount" ? fs.amount : fs.quantity}
                               onChange={(e) => updateForm(s.id, mode === "amount" ? "amount" : "quantity", e.target.value)}
                                className={showErrors && (isCost ? (quantity == null && fs.quantity.trim() !== "") : !isBlank && (mode === "amount" ? directAmount == null : quantity == null)) ? "border-destructive" : ""}
                               aria-label={`${s.name} ${mode === "amount" ? "amount" : "quantity"}`}
                             />
                              {mode === "quantity_rate" && !isCost && isLumpSumService(s) && (
                               <Button
                                 type="button"
                                 variant="ghost"
                                 size="sm"
                                 className="mt-1 h-7 px-1 text-xs text-muted-foreground"
                                 onClick={() => updateForm(s.id, "quantity", "1")}
                               >
                                 Set lump sum to 1
                               </Button>
                             )}
                           </td>
                          <td className="px-4 py-4 align-top text-center">
                            <div className="flex justify-center h-10 items-center">
                              <Checkbox 
                                checked={fs.explicitSave} 
                                onCheckedChange={(c) => updateForm(s.id, 'explicitSave', !!c)} 
                              />
                            </div>
                          </td>
                           {group.services.some((service) => serviceCalculationMode(service) === "quantity_rate") && <td className="px-4 py-4 align-top">
                              {isCost ? (
                                <output className="flex min-h-10 items-center rounded-md border bg-muted/30 px-3 text-sm" aria-label={`Calculated rate for ${s.name}`} aria-live="polite">
                                  {formatCalculatedRate(calculatedRate)}
                                </output>
                              ) : mode === "quantity_rate" && <><Input
                               type="number" min="0" step="any"
                               disabled={!canRateOverride}
                               value={fs.rate}
                               onChange={(e) => updateForm(s.id, "rate", e.target.value)}
                               className={showErrors && rate == null ? "border-destructive" : ""}
                               aria-describedby={!canRateOverride ? `${s.id}-rate-permission` : undefined}
                             />
                             {!canRateOverride && <p id={`${s.id}-rate-permission`} className="mt-1 text-xs text-muted-foreground">Configured rate. Rate override permission is required to change it.</p>}
                             {canRateOverride && rateIsOverridden && <Input
                               placeholder="Reason for rate override"
                               value={fs.rateReason}
                               onChange={(e) => updateForm(s.id, "rateReason", e.target.value)}
                               className={`mt-2 h-8 text-xs ${showErrors && !fs.rateReason?.trim() ? "border-destructive" : ""}`}
                               aria-label={`Reason for changing ${s.name} rate`}
                              />}</>}
                           </td>}
                          <td className="px-4 py-4 align-top text-right font-medium text-foreground/80">
                              {isCost ? <Input
                                type="number"
                                min="0"
                                step="any"
                                value={fs.amount}
                                onChange={(e) => updateForm(s.id, "amount", e.target.value)}
                                className={`ml-auto max-w-40 text-right ${showErrors && directAmount == null && (fs.amount.trim() !== "" || quantity != null) ? "border-destructive" : ""}`}
                                aria-label={`${s.name} amount`}
                              /> : formatBulkAmount(rowAmount, s.currency)}
                          </td>
                           <td className="px-4 py-4 align-top text-right font-medium">
                              {percentageLabel(rowAmount, incomeTotal, calculatesPercent(s))}
                           </td>
                          <td className="px-6 py-4 align-top">
                            <Textarea 
                              value={fs.remarks} 
                              onChange={(e) => updateForm(s.id, 'remarks', e.target.value)} 
                              className="min-h-[40px] h-10 resize-y" 
                              placeholder="Optional remarks"
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
               {(() => {
                 const groupAmounts = group.services.reduce((total, service) => {
                   const state = formState[service.id];
                   if (!state) return total;
                    const blank = isCostBulkRow(service)
                      ? state.quantity.trim() === "" && state.amount.trim() === ""
                      : serviceCalculationMode(service) === "amount" ? state.amount.trim() === "" : state.quantity.trim() === "";
                   if (blank && !state.explicitSave) return total;
                    return total + (bulkRowAmount(service, state, state.explicitSave) ?? 0);
                 }, 0);
                 const groupCurrency = group.services[0]?.currency ?? "—";
                 const groupIncome = totalsByCurrency[groupCurrency]?.income ?? 0;
                  const groupPercentEnabled = group.services.filter((service) => service.currency === groupCurrency).every(calculatesPercent);
                  return <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/20 px-6 py-3 text-sm"><span className="font-medium">Total {group.tabName}</span><span className="font-semibold">{formatBulkAmount(groupAmounts, groupCurrency)}{groupPercentEnabled && ` · ${percentageLabel(groupAmounts, groupIncome, true)}`}</span></div>;
               })()}
            </Card>
          ))}
          
          <Card>
            <CardHeader>
              <CardTitle>Period Totals</CardTitle>
            </CardHeader>
            <CardContent>
              {Object.entries(totalsByCurrency).length === 0 ? (
                <p className="text-sm text-muted-foreground">No active amounts to summarize.</p>
              ) : (
                <div className="space-y-6">
                  {Object.entries(totalsByCurrency).map(([curr, t]) => {
                    const summaryRows = summaryRowsForCurrency(groupedServices, curr, formState);
                    return <div key={curr} className="overflow-x-auto rounded-xl border bg-muted/20 shadow-sm">
                      <table className="w-full min-w-[520px] text-left text-sm">
                        <caption className="border-b px-5 py-3 text-left font-semibold">{curr} Totals</caption>
                        <thead className="bg-muted/30 text-muted-foreground">
                          <tr><th className="px-5 py-3 font-medium">Category</th><th className="px-5 py-3 text-right font-medium">Total Amount</th><th className="px-5 py-3 text-right font-medium">Percentage of Income</th></tr>
                        </thead>
                        <tbody className="divide-y">
                          {summaryRows.map((row) => <tr key={row.label}>
                            <td className="px-5 py-3">{row.label}</td>
                            <td className="px-5 py-3 text-right font-medium">{formatBulkAmount(row.amount, curr)}</td>
                            <td className="px-5 py-3 text-right">{percentageLabel(row.amount, t.income, row.showPercentage)}</td>
                          </tr>)}
                          {hasFinancial && <tr className="border-t">
                            <td className="px-5 py-3">Gross profit</td>
                            <td className="px-5 py-3 text-right font-medium">{formatBulkAmount(t.gross, curr)}</td>
                            <td className="px-5 py-3 text-right">{percentageLabel(t.gross, t.income, true)}</td>
                          </tr>}
                          {hasFinancial && <tr className="border-t-2 font-bold">
                            <td className="px-5 py-3">CONTRIBUTION MARGIN</td>
                            <td className={`px-5 py-3 text-right ${t.net < 0 ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"}`}>{formatBulkAmount(t.net, curr)}</td>
                            <td className="px-5 py-3 text-right">{percentageLabel(t.net, t.income, true)}</td>
                          </tr>}
                        </tbody>
                      </table>
                    </div>;
                  })}
                </div>
              )}
            </CardContent>
          </Card>
          
          {formError && (
            <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive flex items-center gap-3">
              <AlertCircle className="h-5 w-5 shrink-0" /> 
              <span className="font-medium flex-1">{formError}</span>
              {isDirty && <Button type="button" variant="outline" size="sm" onClick={rollbackLocalChanges}>Rollback local changes</Button>}
            </div>
          )}
          {conflict && (
            <Card className="border-amber-500/40 bg-amber-500/5">
              <CardHeader>
                <CardTitle className="text-base">Period conflict</CardTitle>
                <CardDescription>
                  {conflict.existing?.bulkNumber
                    ? `Existing bulk entry ${conflict.existing.bulkNumber} covers ${conflict.existing.fromDate ?? "an earlier date"} – ${conflict.existing.toDate ?? "the selected period"}.`
                    : "An existing MIS entry covers the selected period."}
                  {conflict.existing?.status ? ` Status: ${conflict.existing.status}.` : ""}
                </CardDescription>
              </CardHeader>
              {conflict.canView && safeMisParentUrl(conflict.openUrl) && (
                <CardContent>
                  <Button type="button" variant="outline" onClick={() => setLocation(conflict.openUrl!)}>
                    Open existing entry
                  </Button>
                </CardContent>
              )}
            </Card>
          )}
          
          <div className="flex flex-wrap justify-end gap-3 sticky bottom-4 p-4 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border rounded-xl shadow-sm z-10">
            <Button
              variant="outline"
              disabled={createParent.isPending || !dataReady || !canCreate}
              title={!canCreate ? "Create-entry permission is required for this project." : undefined}
              onClick={() => submitData('draft')}
            >
              {createParent.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              Save as Draft
            </Button>
            <Button
              disabled={createParent.isPending || !dataReady || !canCreate || !canSubmit}
              title={!canSubmit ? "Submit permission is required for this project." : undefined}
              onClick={() => submitData('submit')}
            >
              {createParent.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
              Save & Submit All
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
