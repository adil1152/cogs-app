import { useMemo, useRef } from "react";
import { useQueries } from "@tanstack/react-query";
import {
  getMisListProjectServicesQueryKey,
  getMisListProjectServicesQueryOptions,
  getMisListTabsQueryKey,
  useMisListTabs,
  type MisMe,
  type MisPermission,
  type MisProject,
  type MisService,
} from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MultiSelect, type MultiSelectOption } from "@/components/ui/multi-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MisReportProjectPicker } from "./MisReportProjectPicker";
import {
  defaultAnalyticsPeriods,
  MisAnalyticsPeriodCards,
  MisAnalyticsPeriodToggle,
  type MisPeriodSelection,
} from "./MisAnalyticsPeriods";
import {
  type MisAnalyticsPeriod,
  type MisAnalyticsStatus,
  type MisAnalyticsStatusFilter,
  type MisAnalyticsView,
} from "../hooks/useMisAnalyticsQuery";

export interface MisAnalyticsFilterValues {
  projectIds: string[];
  projectSelection: MisPeriodSelection;
  projectCode: string;
  tabIds: string[];
  tabSelection: MisPeriodSelection;
  serviceIds: string[];
  serviceSelection: MisPeriodSelection;
  serviceCodes: string;
  types: string[];
  from: string;
  to: string;
  statuses: MisAnalyticsStatusFilter[];
  view: MisAnalyticsView;
  compareFrom: string;
  compareTo: string;
  periodComparison: boolean;
  periods: MisAnalyticsPeriod[];
}

interface MisAnalyticsFiltersProps {
  value: MisAnalyticsFilterValues;
  onChange: (value: MisAnalyticsFilterValues) => void;
  access?: MisMe | null;
  showComparison?: boolean;
  showView?: boolean;
  /** Category comparison is scoped by real configured tab IDs, not guessed labels. */
  categoryMode?: boolean;
  showPeriodComparison?: boolean;
  disabled?: boolean;
}

export const ANALYTICS_STATUSES: Array<{ value: MisAnalyticsStatus; label: string }> = [
  { value: "approved", label: "Approved" },
  { value: "submitted", label: "Submitted" },
  { value: "draft", label: "Draft" },
  { value: "rejected", label: "Rejected" },
  { value: "cancelled", label: "Cancelled" },
];

export const ANALYTICS_STATUS_OPTIONS: Array<{ value: MisAnalyticsStatusFilter; label: string }> = [
  { value: "all", label: "All statuses" },
  ...ANALYTICS_STATUSES,
];

export const ANALYTICS_VIEWS: Array<{ value: MisAnalyticsView; label: string }> = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "custom", label: "Custom period" },
];

const FINANCIAL_REPORT_PERMISSIONS: MisPermission[] = ["reports", "financial"];

export function hasSameProjectAnalyticsPermission(access: MisMe | null | undefined, projectId: string) {
  if (!access?.hasAccess) return false;
  // Combine global permissions with scoped permissions for this exact project.
  // Never satisfy the pair by borrowing a grant from another project.
  return FINANCIAL_REPORT_PERMISSIONS.every((permission) =>
    access.permissions.includes(permission) ||
    access.projectPermissions.some((grant) => grant.projectId === projectId && grant.permissions.includes(permission)),
  );
}

export function canRequestAnalytics(
  access: MisMe | null | undefined,
  projectIds: string[] = [],
) {
  if (!access?.hasAccess) return false;
  if (projectIds.length) return projectIds.every((projectId) => hasSameProjectAnalyticsPermission(access, projectId));
  if (FINANCIAL_REPORT_PERMISSIONS.every((permission) => access.permissions.includes(permission))) return true;
  return access.projectPermissions.some((grant) => hasSameProjectAnalyticsPermission(access, grant.projectId));
}

export function canExportAnalytics(
  access: MisMe | null | undefined,
  projectIds: string[] = [],
) {
  if (!canRequestAnalytics(access, projectIds)) return false;
  if (!access) return false;
  const required = ["reports", "financial", "export"] as const;
  if (projectIds.length) {
    return projectIds.every((projectId) => required.every((permission) =>
      access?.permissions.includes(permission) ||
      access.projectPermissions.some((grant) => grant.projectId === projectId && grant.permissions.includes(permission)),
    ));
  }
  // With no explicit project list the server evaluates every report-eligible
  // project. Global reports+financial means the server evaluates all projects,
  // so only a global export grant can authorize that export. With one scoped
  // half of the pair, evaluate each project that becomes eligible after
  // combining global and same-project scoped permissions.
  if (FINANCIAL_REPORT_PERMISSIONS.every((permission) => access.permissions.includes(permission))) {
    return access.permissions.includes("export");
  }
  if (required.every((permission) => access?.permissions.includes(permission))) return true;
  const eligibleProjects = access?.projectPermissions
    .map((grant) => grant.projectId)
    .filter((projectId, index, all) => all.indexOf(projectId) === index)
    .filter((projectId) => hasSameProjectAnalyticsPermission(access, projectId)) ?? [];
  return eligibleProjects.length > 0 && eligibleProjects.every((projectId) =>
    access?.permissions.includes("export") ||
    access?.projectPermissions.some((grant) => grant.projectId === projectId && grant.permissions.includes("export")),
  );
}

function setValue(
  current: MisAnalyticsFilterValues,
  onChange: (value: MisAnalyticsFilterValues) => void,
  patch: Partial<MisAnalyticsFilterValues>,
) {
  onChange({ ...current, ...patch });
}

function projectHasReportAndFinancial(project: MisProject, access?: MisMe | null) {
  if (!access?.hasAccess) return false;
  if (access.permissions.includes("reports") && access.permissions.includes("financial")) return true;
  return FINANCIAL_REPORT_PERMISSIONS.every((permission) => project.effectivePermissions.includes(permission));
}

export function MisAnalyticsFilters({
  value,
  onChange,
  access,
  showComparison = false,
  showView = true,
  categoryMode = false,
  showPeriodComparison = true,
  disabled = false,
}: MisAnalyticsFiltersProps) {
  const tabsQuery = useMisListTabs({ active: true }, {
    query: {
      queryKey: getMisListTabsQueryKey({ active: true }),
      enabled: Boolean(access?.hasAccess) && canRequestAnalytics(access),
    },
  });

  const tabs = useMemo(
    () => (tabsQuery.data ?? []).filter((tab) => tab.active && tab.allowReporting),
    [tabsQuery.data],
  );
  const serviceProjectIds = value.projectIds;
  const serviceParams = { active: true };
  const serviceQueries = useQueries({
    queries: serviceProjectIds.map((projectId) =>
      getMisListProjectServicesQueryOptions(projectId, serviceParams, {
        query: {
          queryKey: getMisListProjectServicesQueryKey(projectId, serviceParams),
          enabled: !disabled && canRequestAnalytics(access, [projectId]),
        },
      }),
    ),
  });
  const services = useMemo(
    () => serviceQueries.flatMap((query) => query.data ?? []) as MisService[],
    [serviceQueries],
  );
  const tabOptions: MultiSelectOption[] = tabs.map((tab) => ({
    value: tab.id,
    label: tab.name,
    hint: tab.code,
  }));
  const serviceOptions: MultiSelectOption[] = services
    .filter((service) => !value.tabIds.length || value.tabIds.includes(service.tabId))
    .sort((left, right) => `${left.code} ${left.name}`.localeCompare(`${right.code} ${right.name}`))
    .map((service) => ({
      value: service.id,
      label: service.name,
      hint: `${service.code} · ${service.tabName} · ${service.projectId}`,
    }));
  const typeOptions: MultiSelectOption[] = [...new Set(tabs.map((tab) => tab.type))].map((type) => ({
    value: type,
    label: type.charAt(0).toUpperCase() + type.slice(1),
  }));

  const pendingValue = useRef(value);
  pendingValue.current = value;
  function patch(next: Partial<MisAnalyticsFilterValues>) {
    // Selection and selection-mode callbacks can fire within one React batch.
    // Merge both against the latest patch rather than the stale render value.
    pendingValue.current = { ...pendingValue.current, ...next };
    setValue(pendingValue.current, onChange, {});
  }

  const activeFilters = [
    value.projectSelection === "none" ? "Projects: none" : value.projectSelection === "selected" ? `Projects: ${value.projectIds.length}` : "Projects: all authorized",
    value.tabSelection === "none" ? "Categories: none" : value.tabSelection === "selected" ? `Categories: ${value.tabIds.length}` : "Categories: all",
    value.serviceSelection === "none" ? "Services: none" : value.serviceSelection === "selected" ? `Services: ${value.serviceIds.length}` : "Services: all",
    value.projectCode.trim() ? `Code: ${value.projectCode.trim()}` : null,
    value.serviceCodes.trim() ? `Service code: ${value.serviceCodes.trim()}` : null,
    value.types.length ? `Types: ${value.types.length}` : null,
    !value.statuses.length ? "Statuses: none" : value.statuses.includes("all") ? "Statuses: all" : `Statuses: ${value.statuses.length}`,
    value.periodComparison ? `Periods: ${value.periods.length}` : value.from || value.to ? `Range: ${value.from || "…"}–${value.to || "…"}` : null,
  ].filter((item): item is string => Boolean(item));

  return (
    <div className="space-y-4">
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <div className="space-y-2">
        <Label>Projects</Label>
        <MisReportProjectPicker
          selected={value.projectIds}
          selectionMode={value.projectSelection}
          onSelectionModeChange={(projectSelection) => patch({ projectSelection })}
          onChange={(projectIds) => patch({
            projectIds,
            projectSelection: projectIds.length ? "selected" : value.projectSelection,
            serviceIds: [],
            serviceSelection: "all",
          })}
          isReportProject={(project) => projectHasReportAndFinancial(project, access)}
          disabled={disabled}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="analytics-project-code">Project code contains</Label>
        <Input
          id="analytics-project-code"
          value={value.projectCode}
          onChange={(event) => patch({ projectCode: event.target.value })}
          placeholder="Search project code"
          disabled={disabled}
        />
      </div>
      <div className="space-y-2">
        <Label>{categoryMode ? "Categories (dynamic tabs)" : "Reporting tabs"}</Label>
        <MultiSelect
          options={tabOptions}
          selected={value.tabIds}
          selectionMode={value.tabSelection}
          onSelectionModeChange={(tabSelection) => patch({ tabSelection })}
          onChange={(tabIds) => patch({
            tabIds,
            tabSelection: tabIds.length ? "selected" : value.tabSelection,
            serviceIds: [],
            serviceSelection: "all",
          })}
          placeholder={categoryMode ? "All dynamic categories" : "All reporting tabs"}
          allLabel={categoryMode ? "All dynamic categories" : "All reporting tabs"}
          searchPlaceholder={categoryMode ? "Search configured categories…" : "Search tabs…"}
          emptyText={tabsQuery.isLoading ? "Loading tabs…" : categoryMode ? "No configured categories." : "No reporting tabs."}
          disabled={disabled || tabsQuery.isLoading}
        />
      </div>
      <div className="space-y-2">
        <Label>Services</Label>
        <MultiSelect
          options={serviceOptions}
          selected={value.serviceIds}
          selectionMode={value.serviceSelection}
          onSelectionModeChange={(serviceSelection) => patch({ serviceSelection })}
          onChange={(serviceIds) => patch({
            serviceIds,
            serviceSelection: serviceIds.length ? "selected" : value.serviceSelection,
          })}
          placeholder={
            value.projectSelection === "none"
              ? "No permitted projects"
              : value.projectSelection === "selected"
                ? "All selected-project services"
                : "All authorized services"
          }
          allLabel={
            value.projectSelection === "none"
              ? "No permitted projects"
              : value.projectSelection === "selected"
                ? "All selected-project services"
                : "All authorized services"
          }
          searchPlaceholder="Search services…"
          emptyText={serviceProjectIds.length ? "No services match." : "No permitted projects."}
          disabled={disabled || value.projectSelection !== "selected" || !value.projectIds.length || serviceQueries.some((query) => query.isLoading)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="analytics-service-codes">Service codes</Label>
        <Input
          id="analytics-service-codes"
          value={value.serviceCodes}
          onChange={(event) => patch({ serviceCodes: event.target.value })}
          placeholder="Code(s), comma separated"
          disabled={disabled}
        />
      </div>
      {!categoryMode && <div className="space-y-2">
        <Label>Types / categories</Label>
        <MultiSelect
          options={typeOptions}
          selected={value.types}
          onChange={(types) => patch({ types })}
          placeholder="All types"
          allLabel="All types"
          searchPlaceholder="Search types…"
          emptyText="No configured types."
          disabled={disabled || tabsQuery.isLoading}
        />
      </div>}
      {!value.periodComparison && (
        <>
          <div className="space-y-2">
            <Label htmlFor="analytics-from">From date</Label>
            <Input id="analytics-from" type="date" value={value.from} onChange={(event) => patch({ from: event.target.value })} disabled={disabled} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="analytics-to">To date</Label>
            <Input id="analytics-to" type="date" value={value.to} onChange={(event) => patch({ to: event.target.value })} disabled={disabled} />
          </div>
        </>
      )}
      <div className="space-y-2">
        <Label>Status</Label>
        <MultiSelect
          options={ANALYTICS_STATUS_OPTIONS}
          selected={value.statuses}
          selectionMode={value.statuses.length ? "selected" : "none"}
          onSelectionModeChange={(selectionMode) => {
            if (selectionMode !== "selected") patch({ statuses: selectionMode === "all" ? ["all"] : [] });
          }}
          onChange={(statuses) => patch({
            statuses: statuses.includes("all")
              ? value.statuses.includes("all")
                ? statuses.filter((status) => status !== "all") as MisAnalyticsStatusFilter[]
                : ["all"]
              : statuses as MisAnalyticsStatusFilter[],
          })}
          placeholder="Select statuses"
          allLabel="All statuses"
          searchPlaceholder="Search statuses…"
          emptyText="No statuses."
          disabled={disabled}
        />
      </div>
      {showView && (
        <div className="space-y-2">
          <Label>Trend view</Label>
          <Select value={value.view} onValueChange={(view) => patch({ view: view as MisAnalyticsView })} disabled={disabled}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{ANALYTICS_VIEWS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      )}
      {!value.periodComparison && showComparison && (
        <>
          <div className="space-y-2">
            <Label htmlFor="analytics-compare-from">Comparison from</Label>
            <Input id="analytics-compare-from" type="date" value={value.compareFrom} onChange={(event) => patch({ compareFrom: event.target.value })} disabled={disabled} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="analytics-compare-to">Comparison to</Label>
            <Input id="analytics-compare-to" type="date" value={value.compareTo} onChange={(event) => patch({ compareTo: event.target.value })} disabled={disabled} />
          </div>
        </>
      )}
      {showPeriodComparison && (
        <div className="space-y-3 md:col-span-2 xl:col-span-4">
          <MisAnalyticsPeriodToggle
            checked={value.periodComparison}
            onCheckedChange={(periodComparison) => patch({
              periodComparison,
              periods: periodComparison && value.periods.length < 3 ? defaultAnalyticsPeriods() : value.periods,
            })}
            disabled={disabled}
          />
          {value.periodComparison && (
            <MisAnalyticsPeriodCards
              periods={value.periods}
              onChange={(periods) => patch({ periods })}
              disabled={disabled}
            />
          )}
        </div>
      )}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t pt-3" aria-label="Active analytics filters">
        <span className="text-xs font-medium text-muted-foreground">Active filters:</span>
        {activeFilters.map((filter) => <Badge key={filter} variant="secondary">{filter}</Badge>)}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7"
          onClick={() => onChange(defaultAnalyticsFilters())}
          disabled={disabled}
        >
          Reset
        </Button>
      </div>
    </div>
  );
}

export function defaultAnalyticsFilters(): MisAnalyticsFilterValues {
  return {
    projectIds: [],
    projectSelection: "all",
    projectCode: "",
    tabIds: [],
    tabSelection: "all",
    serviceIds: [],
    serviceSelection: "all",
    serviceCodes: "",
    types: [],
    from: "",
    to: "",
    statuses: ["all"],
    view: "monthly",
    compareFrom: "",
    compareTo: "",
    periodComparison: false,
    periods: defaultAnalyticsPeriods(),
  };
}

export function filterParams(value: MisAnalyticsFilterValues) {
  return {
    projectIds: value.projectSelection === "selected" && value.projectIds.length ? value.projectIds : undefined,
    projectCode: value.projectCode.trim() || undefined,
    tabIds: value.tabSelection === "selected" && value.tabIds.length ? value.tabIds : undefined,
    serviceIds: value.serviceSelection === "selected" && value.serviceIds.length ? value.serviceIds : undefined,
    serviceCodes: value.serviceCodes.split(",").map((part) => part.trim()).filter(Boolean).length
      ? value.serviceCodes.split(",").map((part) => part.trim()).filter(Boolean)
      : undefined,
    types: value.types.length ? value.types : undefined,
    from: !value.periodComparison && value.from ? value.from : undefined,
    to: !value.periodComparison && value.to ? value.to : undefined,
    status: value.statuses.length ? value.statuses : undefined,
    view: value.view,
    compareFrom: !value.periodComparison && value.compareFrom ? value.compareFrom : undefined,
    compareTo: !value.periodComparison && value.compareTo ? value.compareTo : undefined,
    periodComparison: value.periodComparison || undefined,
    periods: value.periodComparison ? value.periods : undefined,
  };
}