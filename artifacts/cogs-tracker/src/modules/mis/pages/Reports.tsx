import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQueries } from "@tanstack/react-query";
import {
  getMisGetReportQueryKey,
  getMisListProjectServicesQueryKey,
  getMisListProjectServicesQueryOptions,
  getMisListProjectsQueryKey,
  getMisListTabsQueryKey,
  useMisGetCurrentAccess,
  useMisGetReport,
  useMisListProjects,
  useMisListTabs,
  type MisEntryStatusDefaultApprovedQueryParameter,
  type MisEntryTypeQueryParameter,
  type MisExportFormat,
  type MisExportReportParams,
  type MisFinancialTotals,
  type MisGetReportParams,
  type MisPermission,
  type MisProject,
  type MisReportGroupRow,
  type MisReportType,
  type MisService,
} from "@workspace/api-client-react";
import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  CalendarRange,
  Download,
  FileText,
  Loader2,
  Search,
} from "lucide-react";
import {
  Bar,
  BarChart as RechartsBarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MultiSelect } from "@/components/ui/multi-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { MisReportProjectPicker } from "../components/MisReportProjectPicker";
import { MisAnalyticsPeriodCards, MisAnalyticsPeriodToggle, defaultAnalyticsPeriods } from "../components/MisAnalyticsPeriods";
import { MisAnalyticsPeriodResults } from "../components/MisAnalyticsPeriodResults";
import { ANALYTICS_STATUS_OPTIONS, canExportAnalytics, canRequestAnalytics } from "../components/MisAnalyticsFilters";
import {
  useMisAnalytics,
  useMisAnalyticsExport,
  type MisAnalyticsDrilldownFilters,
  type MisAnalyticsPeriod,
  type MisAnalyticsRow,
  type MisAnalyticsStatus,
  type MisAnalyticsStatusFilter,
  type MisAnalyticsParams,
} from "../hooks/useMisAnalyticsQuery";
import { useMisReportDownload } from "../hooks/useMisReportDownload";

const REPORT_TYPES: Array<{ value: MisReportType; label: string; description: string }> = [
  { value: "income", label: "Income", description: "Income by project, category, and service." },
  { value: "cost", label: "Cost", description: "Direct cost by project, category, and service." },
  { value: "expense", label: "Expense", description: "Expenses by project, category, and service." },
  { value: "salary", label: "Salary", description: "Salary by project, category, and service." },
  { value: "summary", label: "Financial summary", description: "Profit and activity grouped by project." },
  { value: "project-profitability", label: "Project profitability", description: "Income, cost, and profit by project." },
  { value: "project-comparison", label: "Project comparison", description: "Compare project performance side by side." },
  { value: "period-comparison", label: "Period comparison", description: "Compare each fully-contained entry period." },
  { value: "service-tab-comparison", label: "Service & category comparison", description: "Compare configured categories and services." },
];
const BASIC_REPORT_TYPES = new Set<MisReportType>(["income", "cost", "expense", "salary", "service-tab-comparison"]);

const STATUS_OPTIONS: Array<{ value: MisEntryStatusDefaultApprovedQueryParameter; label: string }> = [
  { value: "approved", label: "Approved" },
  { value: "submitted", label: "Submitted" },
  { value: "draft", label: "Draft" },
  { value: "rejected", label: "Rejected" },
  { value: "cancelled", label: "Cancelled" },
];

const TYPE_OPTIONS: Array<{ value: MisEntryTypeQueryParameter; label: string }> = [
  { value: "income", label: "Income" },
  { value: "cost", label: "Cost" },
  { value: "expense", label: "Expense" },
  { value: "salary", label: "Salary" },
  { value: "other", label: "Other" },
];

const ALL_ANALYTICS_STATUSES: MisAnalyticsStatus[] = ["draft", "submitted", "approved", "rejected", "cancelled"];

function periodReportGrouping(reportType: MisReportType): MisAnalyticsParams["groupBy"] {
  if (reportType === "service-tab-comparison") return ["type", "service"];
  if (reportType === "period-comparison") return ["date"];
  if (["summary", "project-profitability", "project-comparison"].includes(reportType)) return ["project"];
  return ["project", "type", "service"];
}

function periodReportTypes(entryType: MisEntryTypeQueryParameter | "") {
  // The analytics server applies basic report types to financial_class. Keep
  // the optional entry-type filter independent so a custom tab whose entry
  // type is `other` is not accidentally excluded from an income/cost report.
  return entryType ? [entryType] : undefined;
}

function periodRowFilters(
  projectIds: string[],
  projectSelection: "all" | "selected" | "none",
  tabId: string,
  serviceId: string,
  entryType: MisEntryTypeQueryParameter | "",
  periodStatuses: MisAnalyticsStatusFilter[],
  period: MisAnalyticsPeriod,
  currency: string,
): MisAnalyticsDrilldownFilters {
  const statuses = periodStatuses.includes("all")
    ? ALL_ANALYTICS_STATUSES
    : periodStatuses.filter((status): status is MisAnalyticsStatus => status !== "all");
  return {
    projectIds: projectSelection === "selected" ? projectIds : [],
    tabIds: tabId ? [tabId] : [],
    serviceIds: serviceId ? [serviceId] : [],
    entryType: entryType || null,
    status: statuses.length === 1 ? statuses[0] : "all",
    statuses,
    currency,
    from: period.from,
    to: period.to,
    startFrom: null,
    startTo: null,
  };
}

function periodRowValue(
  current: {
    projectIds: string[];
    projectSelection: "all" | "selected" | "none";
    tabId: string;
    serviceId: string;
    entryType: MisEntryTypeQueryParameter | "";
    periodStatuses: MisAnalyticsStatusFilter[];
  },
  row: MisAnalyticsRow,
) {
  const drilldown = row.drilldownFilters;
  return {
    ...current,
    projectIds: drilldown.projectIds.length ? drilldown.projectIds : current.projectIds,
    projectSelection: drilldown.projectIds.length ? "selected" as const : current.projectSelection,
    tabId: drilldown.tabIds.length === 1 ? drilldown.tabIds[0] : current.tabId,
    serviceId: drilldown.serviceIds.length === 1 ? drilldown.serviceIds[0] : current.serviceId,
    entryType: (drilldown.entryType || current.entryType) as MisEntryTypeQueryParameter | "",
    periodStatuses: drilldown.statuses.length ? drilldown.statuses : current.periodStatuses,
  };
}

function money(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(amount) ? amount : 0);
}

function percent(value: number) {
  return `${(Number.isFinite(value) ? value : 0).toFixed(1)}%`;
}

function isStrictCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function projectHasPermission(project: MisProject, globalPermissions: MisPermission[], permission: MisPermission) {
  return globalPermissions.includes(permission) || project.effectivePermissions.includes(permission);
}

function rowLabel(row: Pick<MisReportGroupRow, "projectName" | "tabName" | "serviceName" | "periodStart" | "periodEnd">) {
  if (row.projectName && row.tabName && row.serviceName) return `${row.projectName} · ${row.tabName} · ${row.serviceName}`;
  if (row.projectName) return row.projectName;
  if (row.tabName && row.serviceName) return `${row.tabName} · ${row.serviceName}`;
  if (row.periodStart && row.periodEnd) return `${row.periodStart} – ${row.periodEnd}`;
  return "Report group";
}

function entryLink(
  filters: {
    projectIds: string[];
    tabId: string;
    serviceId: string;
    from: string;
    to: string;
    status: MisEntryStatusDefaultApprovedQueryParameter;
    entryType: MisEntryTypeQueryParameter | "";
    search: string;
  },
  row?: MisReportGroupRow,
) {
  const query = new URLSearchParams();
  const projectIds = row?.projectId ? [row.projectId] : filters.projectIds;
  const tabId = row?.tabId || filters.tabId;
  const serviceId = row?.serviceId || filters.serviceId;
  const from = row?.periodStart || filters.from;
  const to = row?.periodEnd || filters.to;
  if (projectIds.length) query.set("projectIds", projectIds.join(","));
  if (tabId) query.set("tabId", tabId);
  if (serviceId) query.set("serviceId", serviceId);
  if (from) query.set("from", from);
  if (to) query.set("to", to);
  if (filters.status) query.set("status", filters.status);
  if (filters.entryType) query.set("entryType", filters.entryType);
  if (filters.search) query.set("search", filters.search);
  return `/entries${query.size ? `?${query.toString()}` : ""}`;
}

function MisReportMetricCard({
  label,
  amount,
  value,
  currency,
  href,
  hint,
}: {
  label: string;
  amount?: number;
  value?: string;
  currency: string;
  href: string;
  hint?: string;
}) {
  return (
    <Link href={href} className="block rounded-lg border bg-background p-3 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tracking-tight">{value ?? money(amount ?? 0, currency)}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </Link>
  );
}

function MisReportTotals({
  totals,
  currency,
  href,
  comparisonTotals,
  showProfit,
}: {
  totals: MisFinancialTotals;
  currency: string;
  href: string;
  comparisonTotals: MisFinancialTotals | null;
  showProfit: boolean;
}) {
  return (
    <div className={`grid grid-cols-2 gap-3 sm:grid-cols-3 ${showProfit ? "xl:grid-cols-6" : "xl:grid-cols-5"}`}>
      <MisReportMetricCard label="Income" amount={totals.income} currency={currency} href={href} />
      <MisReportMetricCard label="Cost" amount={totals.cost} currency={currency} href={href} />
      <MisReportMetricCard label="Expenses" amount={totals.expenses} currency={currency} href={href} />
      <MisReportMetricCard label="Salaries" amount={totals.salaries} currency={currency} href={href} />
      {showProfit && <MisReportMetricCard label="Net profit" amount={totals.netProfit} currency={currency} href={href} hint={`Margin ${percent(totals.profitMargin)}`} />}
      <MisReportMetricCard
        label="Entries"
        value={totals.entryCount.toLocaleString()}
        currency={currency}
        href={href}
        hint={`${totals.entryCount.toLocaleString()} in current range${comparisonTotals ? ` · ${comparisonTotals.entryCount.toLocaleString()} comparison` : ""}`}
      />
    </div>
  );
}

export default function Reports() {
  const { data: access, isLoading: accessLoading } = useMisGetCurrentAccess();
  const [reportType, setReportType] = useState<MisReportType>("income");
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [projectSelection, setProjectSelection] = useState<"all" | "selected" | "none">("all");
  const [tabId, setTabId] = useState("");
  const [tabSelection, setTabSelection] = useState<"all" | "selected" | "none">("all");
  const [serviceId, setServiceId] = useState("");
  const [serviceSelection, setServiceSelection] = useState<"all" | "selected" | "none">("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [status, setStatus] = useState<MisEntryStatusDefaultApprovedQueryParameter>("approved");
  const [entryType, setEntryType] = useState<MisEntryTypeQueryParameter | "">("");
  const [currency, setCurrency] = useState("");
  const [search, setSearch] = useState("");
  const [compareFrom, setCompareFrom] = useState("");
  const [compareTo, setCompareTo] = useState("");
  const [periodComparison, setPeriodComparison] = useState(false);
  const [periods, setPeriods] = useState<MisAnalyticsPeriod[]>(defaultAnalyticsPeriods);
  const [periodStatuses, setPeriodStatuses] = useState<MisAnalyticsStatusFilter[]>(["all"]);
  const [groupPage, setGroupPage] = useState(1);
  const [periodPage, setPeriodPage] = useState(1);
  const [periodCrossFilter, setPeriodCrossFilter] = useState<{
    label: string;
    restore: {
      projectIds: string[];
      projectSelection: "all" | "selected" | "none";
      tabId: string;
      serviceId: string;
      entryType: MisEntryTypeQueryParameter | "";
      periodStatuses: MisAnalyticsStatusFilter[];
      periods: MisAnalyticsPeriod[];
    };
  } | null>(null);
  const { download, isDownloading, downloadError } = useMisReportDownload();
  const analyticsExport = useMisAnalyticsExport();

  const baseProjectParams = { page: 1, pageSize: 100 };
  const { data: projectPage } = useMisListProjects(baseProjectParams, {
    query: { queryKey: getMisListProjectsQueryKey(baseProjectParams), enabled: Boolean(access?.hasAccess) },
  });
  const { data: tabs } = useMisListTabs({ active: true }, {
    query: { queryKey: getMisListTabsQueryKey({ active: true }), enabled: Boolean(access?.hasAccess) },
  });

  const globalPermissions = access?.permissions ?? [];
  const requiresFinancial = !BASIC_REPORT_TYPES.has(reportType);
  const hasGlobalReports = globalPermissions.includes("reports");
  const hasGlobalFinancialReporting = hasGlobalReports && globalPermissions.includes("financial");
  const scopedPermissionFor = (projectId: string, permission: MisPermission) =>
    access?.projectPermissions.find((grant) => grant.projectId === projectId)?.permissions.includes(permission) ?? false;
  const hasScopedReports = access?.projectPermissions.some((grant) => grant.permissions.includes("reports")) ?? false;
  const hasScopedFinancialReporting = access?.projectPermissions.some((grant) =>
    grant.permissions.includes("reports") && grant.permissions.includes("financial"),
  ) ?? false;
  const selectedProjectsAreReportEligible = projectIds.length === 0 || hasGlobalReports ||
    projectIds.every((id) => scopedPermissionFor(id, "reports"));
  const selectedProjectsAreFinancialEligible = projectIds.length === 0 || hasGlobalFinancialReporting ||
    projectIds.every((id) => scopedPermissionFor(id, "reports") && scopedPermissionFor(id, "financial"));
  const canRequestReport = Boolean(access?.hasAccess) &&
    projectSelection !== "none" &&
    tabSelection !== "none" &&
    serviceSelection !== "none" &&
    (hasGlobalReports || hasScopedReports) &&
    selectedProjectsAreReportEligible &&
    (!requiresFinancial || ((hasGlobalFinancialReporting || hasScopedFinancialReporting) && selectedProjectsAreFinancialEligible));

  const serviceParams = { tabId: tabId || undefined, active: true };
  const serviceQueries = useQueries({
    queries: projectIds.map((id) => getMisListProjectServicesQueryOptions(id, serviceParams, {
      query: {
        queryKey: getMisListProjectServicesQueryKey(id, serviceParams),
        enabled: Boolean(access?.hasAccess) && projectSelection === "selected",
      },
    })),
  });
  const services = useMemo(() => serviceQueries.flatMap((query) => query.data ?? []) as MisService[], [serviceQueries]);
  const serviceOptions = services.map((service) => ({
    value: service.id,
    label: service.name,
    hint: `${projectPage?.items.find((project) => project.id === service.projectId)?.name ?? "Project"} · ${service.tabName}`,
  }));

  const currentIncomplete = Boolean(from) !== Boolean(to);
  const currentInvalid = Boolean((from && !isStrictCalendarDate(from)) || (to && !isStrictCalendarDate(to)));
  const dateInvalid = Boolean(from && to && from > to);
  const compareIncomplete = Boolean(compareFrom) !== Boolean(compareTo);
  const compareInvalid = Boolean(
    (compareFrom && !isStrictCalendarDate(compareFrom)) ||
    (compareTo && !isStrictCalendarDate(compareTo)) ||
    (compareFrom && compareTo && compareFrom > compareTo),
  );
  const invalidPeriod = periods.some((period) =>
    !period.id.trim() || !period.label.trim() || !isStrictCalendarDate(period.from) || !isStrictCalendarDate(period.to) || period.from > period.to,
  );
  const hasDateProblem = periodComparison
    ? periods.length < 3 || invalidPeriod
    : currentIncomplete || currentInvalid || dateInvalid || compareIncomplete || compareInvalid;

  const reportParams = useMemo(() => ({
    reportType,
    projectIds: projectIds.length ? projectIds.join(",") : undefined,
    tabId: tabId || undefined,
    serviceId: serviceId || undefined,
    from: from || undefined,
    to: to || undefined,
    status,
    entryType: entryType || undefined,
    search: search || undefined,
    currency: currency.trim() ? currency.trim().toUpperCase() : undefined,
    compareFrom: compareFrom || undefined,
    compareTo: compareTo || undefined,
  }) satisfies MisGetReportParams, [reportType, projectIds, tabId, serviceId, from, to, status, entryType, search, currency, compareFrom, compareTo]);

  const reportQuery = useMisGetReport(reportParams, {
    query: {
      queryKey: getMisGetReportQueryKey(reportParams),
      enabled: !periodComparison && canRequestReport && !hasDateProblem,
    },
  });
  const periodParams = useMemo<MisAnalyticsParams>(() => ({
    mode: "dynamic",
    reportType,
    groupBy: periodReportGrouping(reportType),
    periodComparison: true,
    periods,
    projectIds: projectIds.length ? projectIds : undefined,
    tabIds: tabId ? [tabId] : undefined,
    serviceIds: serviceId ? [serviceId] : undefined,
    types: periodReportTypes(entryType),
    status: periodStatuses.length ? periodStatuses : ["all"],
    search: search || undefined,
    currency: currency.trim() ? currency.trim().toUpperCase() : undefined,
    page: periodPage,
    pageSize: 50,
  }), [reportType, periods, projectIds, tabId, serviceId, entryType, periodStatuses, search, currency, periodPage]);
  const periodCanRequest = periodComparison &&
    projectSelection !== "none" &&
    tabSelection !== "none" &&
    serviceSelection !== "none" &&
    !hasDateProblem &&
    periodStatuses.length > 0 &&
    canRequestAnalytics(access, projectIds);
  const periodQuery = useMisAnalytics(periodParams, { enabled: periodCanRequest });

  useEffect(() => {
    setGroupPage(1);
    setPeriodPage(1);
  }, [reportType, projectIds, tabId, serviceId, from, to, status, entryType, search, currency, compareFrom, compareTo, periodComparison, periods, periodStatuses]);

  const rows = useMemo(
    () => (reportQuery.data?.currencyGroups ?? []).flatMap((currencyGroup) =>
      currencyGroup.groups.map((row) => ({ currency: currencyGroup.currency, row })),
    ),
    [reportQuery.data],
  );
  const PAGE_SIZE = 12;
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const visibleRows = rows.slice((groupPage - 1) * PAGE_SIZE, groupPage * PAGE_SIZE);
  const selectedReport = REPORT_TYPES.find((report) => report.value === reportType)!;
  const requiredExportPermissions: MisPermission[] = requiresFinancial
    ? ["reports", "financial", "export"]
    : ["reports", "export"];
  const hasScopedExportProject = access?.projectPermissions.some((grant) =>
    requiredExportPermissions.every((permission) => grant.permissions.includes(permission)),
  ) ?? false;
  const selectedProjectsHaveExportPermission = projectIds.every((id) =>
    requiredExportPermissions.every((permission) => scopedPermissionFor(id, permission)),
  );
  const hasExportPermission = requiredExportPermissions.every((permission) => globalPermissions.includes(permission)) ||
    (projectIds.length > 0 && selectedProjectsHaveExportPermission) ||
    (!projectIds.length && hasScopedExportProject);
  const periodCanExport = periodComparison &&
    projectSelection !== "none" &&
    tabSelection !== "none" &&
    serviceSelection !== "none" &&
    !hasDateProblem &&
    periodStatuses.length > 0 &&
    canExportAnalytics(access, projectIds);
  const filtersForDrill = { projectIds, tabId, serviceId, from, to, status, entryType, search };
  const availableReportTypes = REPORT_TYPES.filter((report) =>
    BASIC_REPORT_TYPES.has(report.value) || (projectIds.length
      ? selectedProjectsAreFinancialEligible
      : hasGlobalFinancialReporting || hasScopedFinancialReporting),
  );
  // Basic operational responses deliberately omit profit calculations. Use a
  // financial report for profit metrics, even when this user has that access.
  const showProfit = requiresFinancial;

  function setProjects(ids: string[]) {
    setProjectIds(ids);
    setProjectSelection(ids.length ? "selected" : projectSelection);
    setServiceId("");
    setServiceSelection("all");
  }

  useEffect(() => {
    if (!BASIC_REPORT_TYPES.has(reportType) && !canRequestReport) setReportType("income");
  }, [reportType, canRequestReport]);

  function exportReport(format: MisExportFormat) {
    if (periodComparison) {
      void analyticsExport.download({ ...periodParams, format });
      return;
    }
    const params: MisExportReportParams = { ...reportParams, format };
    void download(params);
  }

  function applyPeriodRow(row: MisAnalyticsRow) {
    const restore = {
      projectIds,
      projectSelection,
      tabId,
      serviceId,
      entryType,
      periodStatuses,
      periods,
    };
    const next = periodRowValue(restore, row);
    setPeriodCrossFilter({
      label: rowLabel({
        projectName: row.projectName,
        tabName: row.tabName ?? null,
        serviceName: row.serviceName ?? null,
        periodStart: row.periodStart,
        periodEnd: row.periodEnd,
      }),
      restore,
    });
    setProjectIds(next.projectIds);
    setProjectSelection(next.projectSelection);
    setTabId(next.tabId);
    setTabSelection(next.tabId ? "selected" : tabSelection);
    setServiceId(next.serviceId);
    setServiceSelection(next.serviceId ? "selected" : serviceSelection);
    setEntryType(next.entryType);
    setPeriodStatuses(next.periodStatuses);
    setPeriodPage(1);
  }

  function applyPeriodSelection(period: MisAnalyticsPeriod, currencyCode: string) {
    setPeriodCrossFilter({
      label: `${period.label} · ${currencyCode}`,
      restore: { projectIds, projectSelection, tabId, serviceId, entryType, periodStatuses, periods },
    });
    setPeriods((current) => [period, ...current.filter((item) => item.id !== period.id)]);
    setPeriodPage(1);
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">MIS Reports</h1>
          <p className="mt-1 text-muted-foreground">Currency-safe, server-aggregated financial and operational reporting.</p>
        </div>
        {((!periodComparison && canRequestReport && hasExportPermission) || (periodComparison && periodCanExport)) && (
          <div className="flex flex-wrap gap-2">
            {(["csv", "xlsx", "pdf"] as MisExportFormat[]).map((format) => (
              <Button key={format} variant="outline" size="sm" disabled={isDownloading || analyticsExport.isDownloading || hasDateProblem} onClick={() => exportReport(format)}>
                {isDownloading || analyticsExport.isDownloading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                {format === "xlsx" ? "Excel" : format.toUpperCase()}
              </Button>
            ))}
          </div>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Report filters</CardTitle>
          <CardDescription>{selectedReport.description} All periods are included only when their full entry range falls inside the selected dates—there is no overlap or proration.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-2">
            <Label>Report</Label>
            <Select value={reportType} onValueChange={(value) => { setReportType(value as MisReportType); setPeriodCrossFilter(null); setPeriodPage(1); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{availableReportTypes.map((report) => <SelectItem key={report.value} value={report.value}>{report.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Projects</Label>
            <MisReportProjectPicker
              selected={projectIds}
              onChange={setProjects}
              selectionMode={projectSelection}
              onSelectionModeChange={setProjectSelection}
              isReportProject={(project) => projectHasPermission(project, globalPermissions, "reports")}
              disabled={accessLoading}
            />
          </div>
          <div className="space-y-2">
            <Label>Category</Label>
            <MultiSelect
              options={(tabs ?? []).filter((tab) => tab.allowReporting).map((tab) => ({ value: tab.id, label: tab.name }))}
              selected={tabId ? [tabId] : []}
              selectionMode={tabSelection}
              onSelectionModeChange={(selectionMode) => setTabSelection(selectionMode)}
              onChange={(values) => {
                setTabId(values.at(-1) ?? "");
                setTabSelection(values.length ? "selected" : tabSelection);
                setServiceId("");
                setServiceSelection("all");
              }}
              placeholder="All categories"
              allLabel="All categories"
              searchPlaceholder="Search categories…"
            />
          </div>
          <div className="space-y-2">
            <Label>Service</Label>
            <MultiSelect
              options={serviceOptions}
              selected={serviceId ? [serviceId] : []}
              selectionMode={serviceSelection}
              onSelectionModeChange={setServiceSelection}
              onChange={(values) => {
                setServiceId(values.at(-1) ?? "");
                setServiceSelection(values.length ? "selected" : serviceSelection);
              }}
              placeholder={projectSelection === "none" ? "No permitted projects" : projectSelection === "selected" ? "All selected-project services" : "All authorized services"}
              searchPlaceholder="Search selected-project services…"
              allLabel={projectSelection === "none" ? "No permitted projects" : projectSelection === "selected" ? "All selected-project services" : "All authorized services"}
              disabled={projectSelection !== "selected" || !projectIds.length || serviceQueries.some((query) => query.isLoading)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="mis-report-from">From</Label>
            <Input id="mis-report-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="mis-report-to">To</Label>
            <Input id="mis-report-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Status</Label>
            <Select value={status} onValueChange={(value) => setStatus(value as MisEntryStatusDefaultApprovedQueryParameter)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{STATUS_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Entry type</Label>
            <Select value={entryType || "__all"} onValueChange={(value) => setEntryType(value === "__all" ? "" : value as MisEntryTypeQueryParameter)}>
              <SelectTrigger><SelectValue placeholder="All types" /></SelectTrigger>
              <SelectContent><SelectItem value="__all">All types</SelectItem>{TYPE_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="mis-report-currency">Currency</Label>
            <Input id="mis-report-currency" maxLength={3} placeholder="All currencies" value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="mis-report-search">Search</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input id="mis-report-search" className="pl-9" placeholder="Project, category, service…" value={search} onChange={(event) => setSearch(event.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="mis-report-compare-from">Comparison from</Label>
            <Input id="mis-report-compare-from" type="date" value={compareFrom} onChange={(event) => setCompareFrom(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="mis-report-compare-to">Comparison to</Label>
            <Input id="mis-report-compare-to" type="date" value={compareTo} onChange={(event) => setCompareTo(event.target.value)} />
          </div>
          <div className="md:col-span-2 xl:col-span-4 space-y-3">
            <MisAnalyticsPeriodToggle
              checked={periodComparison}
              onCheckedChange={(checked) => {
                setPeriodComparison(checked);
                if (checked && periods.length < 3) setPeriods(defaultAnalyticsPeriods());
              }}
              disabled={accessLoading}
            />
            {periodComparison && (
              <>
                <MisAnalyticsPeriodCards periods={periods} onChange={setPeriods} disabled={accessLoading} />
                <div className="max-w-sm space-y-2">
                  <Label>Status for period comparison</Label>
                  <MultiSelect
                    options={ANALYTICS_STATUS_OPTIONS}
                    selected={periodStatuses}
                    selectionMode={periodStatuses.length ? "selected" : "none"}
                    onSelectionModeChange={(selectionMode) => setPeriodStatuses(selectionMode === "all" ? ["all"] : selectionMode === "none" ? [] : periodStatuses)}
                    onChange={(statuses) => setPeriodStatuses(statuses.includes("all") ? periodStatuses.includes("all") ? statuses.filter((status) => status !== "all") as MisAnalyticsStatusFilter[] : ["all"] : statuses as MisAnalyticsStatusFilter[])}
                    allLabel="All statuses"
                    placeholder="Select statuses"
                    searchPlaceholder="Search statuses…"
                  />
                </div>
              </>
            )}
          </div>
        </CardContent>
      </Card>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/20 p-3" aria-label="Active report filters">
        <span className="text-xs font-medium text-muted-foreground">Active filters:</span>
        <Badge variant="secondary">{projectSelection === "none" ? "Projects: none" : projectIds.length ? `${projectIds.length} project(s)` : "All authorized projects"}</Badge>
        <Badge variant="secondary">{tabSelection === "none" ? "Categories: none" : tabId ? "Category selected" : "All categories"}</Badge>
        <Badge variant="secondary">{serviceSelection === "none" ? "Services: none" : serviceId ? "Service selected" : "All services"}</Badge>
        <Badge variant="secondary">{periodComparison ? `${periods.length} periods` : `Status: ${status}`}</Badge>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7"
          onClick={() => {
            setProjectIds([]);
            setProjectSelection("all");
            setTabId("");
            setTabSelection("all");
            setServiceId("");
            setServiceSelection("all");
            setFrom("");
            setTo("");
            setStatus("approved");
            setEntryType("");
            setCurrency("");
            setSearch("");
            setCompareFrom("");
            setCompareTo("");
            setPeriodComparison(false);
            setPeriods(defaultAnalyticsPeriods());
            setPeriodStatuses(["all"]);
             setPeriodCrossFilter(null);
             setPeriodPage(1);
          }}
        >
          Reset
        </Button>
      </div>
      {periodCrossFilter && periodComparison && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm" aria-label="Active period cross filter">
          <span className="font-medium">Cross-filter:</span>
          <span>{periodCrossFilter.label}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              const restore = periodCrossFilter.restore;
              setProjectIds(restore.projectIds);
              setProjectSelection(restore.projectSelection);
              setTabId(restore.tabId);
              setTabSelection(restore.tabId ? "selected" : "all");
              setServiceId(restore.serviceId);
              setServiceSelection(restore.serviceId ? "selected" : "all");
              setEntryType(restore.entryType);
              setPeriodStatuses(restore.periodStatuses);
              setPeriods(restore.periods);
              setPeriodCrossFilter(null);
              setPeriodPage(1);
            }}
          >
            Reset
          </Button>
        </div>
      )}

      {downloadError && (
        <div role="alert" className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> <span>{downloadError}</span>
        </div>
      )}
      {analyticsExport.downloadError && periodComparison && (
        <div role="alert" className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> <span>{analyticsExport.downloadError}</span>
        </div>
      )}
      {hasDateProblem && (
        <div role="alert" className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          <CalendarRange className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{currentIncomplete ? "Enter both report dates or clear both fields." : currentInvalid ? "Report dates must be complete, real calendar dates." : dateInvalid ? "The report start date must be on or before the end date." : compareIncomplete ? "Enter both comparison dates or clear both fields." : "Comparison dates must be complete, real calendar dates in chronological order."}</span>
        </div>
      )}
      {!periodComparison && !accessLoading && !canRequestReport && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-muted-foreground">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <span>You do not have <strong>reports</strong> permission for the selected project scope. Choose another permitted project or request report access.</span>
        </div>
      )}
      {periodComparison && !hasDateProblem && !periodCanRequest && (
        <div role="alert" className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-muted-foreground">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <span>Period comparison uses the MIS analytics contract and requires <strong>reports and financial</strong> permission on every included project. Legacy report permission alone does not grant period analytics access.</span>
        </div>
      )}
      {periodQuery.error && (
        <div role="alert" className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> <span>{periodQuery.error instanceof Error ? periodQuery.error.message : "The period comparison could not be loaded."}</span>
        </div>
      )}
      {reportQuery.error && (
        <div role="alert" className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> <span>{reportQuery.error.message || "The report could not be loaded."}</span>
        </div>
      )}

      {periodComparison && periodQuery.isLoading && (
        <div className="space-y-4">
          <Skeleton className="h-40 w-full rounded-xl" />
          <Skeleton className="h-72 w-full rounded-xl" />
        </div>
      )}
      {!periodComparison && reportQuery.isLoading && (
        <div className="space-y-4">
          <Skeleton className="h-40 w-full rounded-xl" />
          <Skeleton className="h-72 w-full rounded-xl" />
        </div>
      )}

      {periodComparison && periodQuery.data && !periodQuery.isLoading && (
        <MisAnalyticsPeriodResults
          periods={periodQuery.data.periods ?? []}
          onRowClick={applyPeriodRow}
          onPeriodClick={applyPeriodSelection}
          periodDrilldownFilters={(period, currencyCode) => periodRowFilters(projectIds, projectSelection, tabId, serviceId, entryType, periodStatuses, period, currencyCode)}
          page={periodPage}
          onPageChange={setPeriodPage}
        />
      )}
      {!periodComparison && reportQuery.data && !reportQuery.isLoading && (
        reportQuery.data.currencyGroups.length === 0 ? (
          <Card>
            <CardContent className="flex min-h-56 flex-col items-center justify-center text-center text-muted-foreground">
              <FileText className="mb-3 h-9 w-9 opacity-30" />
              <p className="font-medium text-foreground">No entries match these report filters.</p>
              <p className="mt-1 text-sm">Try a wider fully-contained date range, another status, or different projects.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {reportQuery.data.currencyGroups.map((currencyGroup) => (
              <Card key={currencyGroup.currency}>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-lg"><BarChart3 className="h-5 w-5 text-primary" /> {currencyGroup.currency} totals</CardTitle>
                  <CardDescription>Totals are isolated to {currencyGroup.currency}; unlike currencies are never combined.</CardDescription>
                </CardHeader>
                <CardContent>
                  <MisReportTotals totals={currencyGroup.currentTotals} currency={currencyGroup.currency} href={entryLink(filtersForDrill)} comparisonTotals={currencyGroup.comparisonTotals} showProfit={showProfit} />
                  {currencyGroup.comparisonTotals && showProfit && (
                    <p className="mt-3 text-xs text-muted-foreground">
                      Comparison net profit: <span className="font-medium text-foreground">{money(currencyGroup.comparisonTotals.netProfit, currencyGroup.currency)}</span> · margin {percent(currencyGroup.comparisonTotals.profitMargin)}
                    </p>
                  )}
                  {reportType === "project-comparison" && currencyGroup.groups.length > 0 && (
                    <div className="mt-6 h-64 border-t pt-5">
                      <ResponsiveContainer width="100%" height="100%">
                        <RechartsBarChart data={currencyGroup.groups.map((row) => ({ name: row.projectName || "Project", current: row.currentTotals.netProfit, comparison: row.comparisonTotals?.netProfit }))}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} />
                          <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 12 }} />
                          <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 12 }} />
                          <Tooltip formatter={(value: number) => money(value, currencyGroup.currency)} />
                          {currencyGroup.comparisonTotals && <Legend />}
                          <Bar dataKey="current" name="Current net profit" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                          {currencyGroup.comparisonTotals && <Bar dataKey="comparison" name="Comparison net profit" fill="hsl(var(--muted-foreground))" radius={[4, 4, 0, 0]} />}
                        </RechartsBarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}

            <Card className="overflow-hidden">
              <CardHeader>
                <CardTitle>Grouped results</CardTitle>
                <CardDescription>Rows are aggregated by the report service; select a row to open its matching entries.</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[800px] text-sm">
                    <thead className="border-y bg-muted/40 text-left text-muted-foreground">
                      <tr>
                        <th className="px-5 py-3 font-medium">Group</th>
                        <th className="px-5 py-3 font-medium">Period</th>
                        <th className="px-5 py-3 text-right font-medium">Income</th>
                        <th className="px-5 py-3 text-right font-medium">Cost</th>
                        {showProfit && <th className="px-5 py-3 text-right font-medium">Net profit</th>}
                        {compareFrom && compareTo && showProfit && <th className="px-5 py-3 text-right font-medium">Comparison profit</th>}
                        <th className="px-5 py-3 text-right font-medium">Entries</th>
                        <th className="px-5 py-3" aria-label="Open entries" />
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {visibleRows.map(({ currency: rowCurrency, row }) => (
                        <tr key={`${rowCurrency}-${row.projectId}-${row.tabId}-${row.serviceId}-${row.periodStart}`} className="hover:bg-muted/30">
                          <td className="px-5 py-3 font-medium">{rowLabel(row)}<span className="ml-2 text-xs font-normal text-muted-foreground">{rowCurrency}</span></td>
                          <td className="px-5 py-3 text-muted-foreground">{row.periodStart && row.periodEnd ? `${row.periodStart} – ${row.periodEnd}` : "Selected range"}</td>
                          <td className="px-5 py-3 text-right">{money(row.currentTotals.income, rowCurrency)}</td>
                          <td className="px-5 py-3 text-right">{money(row.currentTotals.cost, rowCurrency)}</td>
                          {showProfit && <td className="px-5 py-3 text-right font-medium">{money(row.currentTotals.netProfit, rowCurrency)} <span className="text-xs font-normal text-muted-foreground">({percent(row.currentTotals.profitMargin)})</span></td>}
                          {compareFrom && compareTo && showProfit && <td className="px-5 py-3 text-right">{row.comparisonTotals ? money(row.comparisonTotals.netProfit, rowCurrency) : "—"}</td>}
                          <td className="px-5 py-3 text-right">{row.currentTotals.entryCount.toLocaleString()}</td>
                          <td className="px-5 py-3 text-right">
                            <Link href={entryLink(filtersForDrill, row)} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">Entries <ArrowRight className="h-3.5 w-3.5" /></Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {rows.length > PAGE_SIZE && (
                  <div className="flex items-center justify-between border-t px-5 py-3 text-sm text-muted-foreground">
                    <span>Showing {(groupPage - 1) * PAGE_SIZE + 1}–{Math.min(groupPage * PAGE_SIZE, rows.length)} of {rows.length} groups</span>
                    <span className="flex gap-2">
                      <Button variant="outline" size="sm" disabled={groupPage === 1} onClick={() => setGroupPage((page) => page - 1)}>Previous</Button>
                      <Button variant="outline" size="sm" disabled={groupPage >= totalPages} onClick={() => setGroupPage((page) => page + 1)}>Next</Button>
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )
      )}
    </div>
  );
}