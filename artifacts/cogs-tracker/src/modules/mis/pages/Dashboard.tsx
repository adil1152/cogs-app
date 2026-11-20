import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Link } from "wouter";
import { useQueries } from "@tanstack/react-query";
import {
  getMisGetDashboardQueryKey,
  getMisListProjectServicesQueryKey,
  getMisListProjectServicesQueryOptions,
  getMisListTabsQueryKey,
  MisGetDashboardStatus,
  useMisGetCurrentAccess,
  useMisGetDashboard,
  useMisListTabs,
  type MisDashboardAdjustment,
  type MisDashboardCurrencyGroup,
  type MisDashboardPeriodRow,
  type MisDashboardProjectRow,
  type MisDashboardServiceRow,
  type MisDashboardTabRow,
  type MisFinancialTotals,
  type MisGetDashboardParams,
  type MisMe,
  type MisPermission,
  type MisService,
} from "@workspace/api-client-react";
import {
  AlertCircle,
  BarChart3,
  CircleDollarSign,
  FileText,
  FolderKanban,
  Landmark,
  Loader2,
  Percent,
  Receipt,
  TrendingDown,
  TrendingUp,
  WalletCards,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { MisReportProjectPicker } from "../components/MisReportProjectPicker";
import { DashboardExportButtons } from "../components/DashboardExportButtons";
import { hasPermission } from "../lib/access";
import { summarizePercentageCharges } from "../lib/percentageSummary";

type DashboardFilters = {
  projectIds: string[];
  tabId: string;
  serviceId: string;
  from: string;
  to: string;
  status: MisGetDashboardStatus;
};

type DashboardDateRange = Pick<DashboardFilters, "from" | "to">;

function monthToDate(): DashboardDateRange {
  const now = new Date();
  return {
    from: format(new Date(now.getFullYear(), now.getMonth(), 1), "yyyy-MM-dd"),
    to: format(now, "yyyy-MM-dd"),
  };
}

/** Strictly rejects malformed and impossible calendar dates such as 2025-02-30. */
function isCalendarDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function parseInitialDashboardFilters(defaultRange: DashboardDateRange): DashboardFilters {
  const query = new URLSearchParams(window.location.search);
  const rawProjectIds = query.get("projectIds")?.split(",") ?? [];
  const projectIds = [...new Set(rawProjectIds.map((id) => id.trim()).filter(Boolean))];
  const rawStatus = query.get("status");
  const status = rawStatus && Object.values(MisGetDashboardStatus).includes(rawStatus as MisGetDashboardStatus)
    ? rawStatus as MisGetDashboardStatus
    : MisGetDashboardStatus.all;
  const from = query.get("from") ?? "";
  const to = query.get("to") ?? "";

  return {
    projectIds,
    tabId: query.get("tabId") ?? "",
    serviceId: query.get("serviceId") ?? "",
    from: isCalendarDate(from) ? from : defaultRange.from,
    to: isCalendarDate(to) ? to : defaultRange.to,
    status,
  };
}

function money(amount: number, currency: string) {
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(safeAmount);
  } catch {
    return `${safeAmount.toFixed(2)} ${currency}`;
  }
}

function percentage(value: number) {
  return `${(Number.isFinite(value) ? value : 0).toFixed(1)}%`;
}

function canUsePermission(access: MisMe | undefined, permission: MisPermission, projectId?: string) {
  if (!access?.hasAccess) return false;
  if (access.permissions.includes(permission) || access.permissions.includes("authorities")) return true;
  if (projectId) {
    const grant = access.projectPermissions.find((item) => item.projectId === projectId);
    return Boolean(grant?.permissions.includes(permission) || grant?.permissions.includes("authorities"));
  }
  return access.projectPermissions.some((grant) =>
    grant.permissions.includes(permission) || grant.permissions.includes("authorities"),
  );
}

/**
 * Dashboard aggregates are financial reports. A project must have both scopes
 * (global permissions can satisfy either scope) before it is offered here.
 */
function canViewDashboardProject(access: MisMe | undefined, projectId: string) {
  return canUsePermission(access, "reports", projectId) && canUsePermission(access, "financial", projectId);
}

function canViewAnyDashboard(access: MisMe | undefined) {
  if (!access?.hasAccess) return false;
  if (canUsePermission(access, "reports") && canUsePermission(access, "financial")
    && (access.permissions.includes("authorities")
      || (access.permissions.includes("reports") && access.permissions.includes("financial")))) return true;
  return access.projectPermissions.some((grant) => canViewDashboardProject(access, grant.projectId));
}

function entriesHref(
  filters: DashboardFilters,
  overrides: Partial<{ projectIds: string[]; tabId: string; serviceId: string; from: string; to: string }> = {},
) {
  const query = new URLSearchParams();
  const projectIds = overrides.projectIds ?? filters.projectIds;
  const tabId = overrides.tabId ?? filters.tabId;
  const serviceId = overrides.serviceId ?? filters.serviceId;
  const from = overrides.from ?? filters.from;
  const to = overrides.to ?? filters.to;

  if (projectIds.length) query.set("projectIds", projectIds.join(","));
  if (tabId) query.set("tabId", tabId);
  if (serviceId) query.set("serviceId", serviceId);
  if (from) query.set("from", from);
  if (to) query.set("to", to);
  // Entries treats a missing status as "all statuses"; never send "all" as a single status.
  if (filters.status !== MisGetDashboardStatus.all) query.set("status", filters.status);
  return `/entries?${query.toString()}`;
}

function statusLabel(status: MisGetDashboardStatus) {
  return status === MisGetDashboardStatus.all ? "All statuses" : `${status.charAt(0).toUpperCase()}${status.slice(1)} entries`;
}

function PercentageAdjustments({ rows }: { rows: MisDashboardAdjustment[] }) {
  const groups = summarizePercentageCharges(rows);
  if (!groups.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Overall Overhead &amp; OP Expense</CardTitle>
        <CardDescription>Percentages from all selected projects are added together and applied to their combined income for the selected dates and statuses, separately per currency. Category and service filters do not change this income base. Only authorized charges are shown.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        {groups.map((group) => (
          <div key={`${group.currency}-${group.kind}`} className="min-w-0 rounded-lg border p-4" data-testid={`summary-${group.kind}-${group.currency}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b pb-3">
              <h3 className="font-medium">{group.kind === "overhead" ? "Overhead" : "OP Expense"} <span className="text-xs text-muted-foreground">({group.currency}) · {group.percentage}%</span></h3>
              <span className="font-semibold tabular-nums">{money(group.total, group.currency)}</span>
            </div>
            {group.services.length ? (
              <ul className="mt-3 space-y-2 text-sm">
                {group.services.map((service) => (
                  <li key={service.name} className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 break-words">{service.name} <span className="text-muted-foreground">· {service.percentage}%</span></span>
                    <span className="shrink-0 tabular-nums">{money(service.amount, group.currency)}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="mt-3 text-sm text-muted-foreground">No active services.</p>}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function errorText(error: unknown) {
  if (error && typeof error === "object" && "error" in error && typeof error.error === "string") {
    return error.error;
  }
  return error instanceof Error && error.message ? error.message : "The dashboard could not be loaded.";
}

function DashboardKpiCard({
  label,
  value,
  description,
  valueSuffix,
  icon: Icon,
  href,
}: {
  label: string;
  value: string;
  description: string;
  valueSuffix?: string;
  icon: LucideIcon;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`View entries for ${label}`}
    >
      <Card className="h-full transition-colors hover:bg-muted/40">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
          <Icon className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <p className="flex flex-wrap items-baseline gap-x-2 text-xl font-semibold tracking-tight">
            <span className="break-all">{value}</span>
            {valueSuffix && <span className="text-sm text-muted-foreground" title="Gross profit ÷ income × 100">{valueSuffix}</span>}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </CardContent>
      </Card>
    </Link>
  );
}

function DashboardKpis({
  totals,
  currency,
  href,
  adjustedNetProfit,
}: {
  totals: MisFinancialTotals;
  currency: string;
  href: string;
  adjustedNetProfit?: number;
}) {
  const netProfit = adjustedNetProfit ?? totals.netProfit;
  const grossProfit = totals.grossProfit;
  const grossProfitPercentage = totals.income ? grossProfit / totals.income * 100 : 0;
  const profitMargin = adjustedNetProfit === undefined ? totals.profitMargin : totals.income ? netProfit / totals.income * 100 : 0;
  const cards = [
    { label: "Income", value: money(totals.income, currency), icon: TrendingUp, description: currency },
    { label: "Cost", value: money(totals.cost, currency), icon: TrendingDown, description: currency },
    { label: "Expenses", value: money(totals.expenses, currency), icon: Receipt, description: currency },
    { label: "Salaries", value: money(totals.salaries, currency), icon: WalletCards, description: currency },
    { label: "Gross profit", value: money(grossProfit, currency), valueSuffix: `(${percentage(grossProfitPercentage)})`, icon: Landmark, description: "Income − Cost − Expenses − Salaries" },
    { label: "Net profit", value: money(netProfit, currency), icon: CircleDollarSign, description: adjustedNetProfit === undefined ? "Before OH / OP · restricted access" : "After Overhead & OP Expense" },
    { label: "Profit margin", value: percentage(profitMargin), icon: Percent, description: adjustedNetProfit === undefined ? "Before OH / OP ÷ income" : "Adjusted net profit ÷ income" },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => <DashboardKpiCard key={card.label} {...card} href={href} />)}
    </div>
  );
}

function ProjectRows({
  rows,
  currency,
  filters,
}: {
  rows: MisDashboardProjectRow[];
  currency: string;
  filters: DashboardFilters;
}) {
  if (!rows.length) return <p className="py-6 text-sm text-muted-foreground">No project totals match these filters.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b text-left text-muted-foreground">
          <tr><th className="pb-2 font-medium">Project</th><th className="pb-2 text-right font-medium">Income</th><th className="pb-2 text-right font-medium">Net profit</th><th className="pb-2 text-right font-medium">Entries</th></tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((row) => (
            <tr key={row.projectId} className="hover:bg-muted/40">
              <td className="py-3 font-medium">
                <Link className="hover:underline" href={entriesHref(filters, { projectIds: [row.projectId] })}>{row.projectName}</Link>
              </td>
              <td className="py-3 text-right">{money(row.totals.income, currency)}</td>
              <td className="py-3 text-right">{money(row.totals.netProfit, currency)}</td>
              <td className="py-3 text-right">{row.totals.entryCount.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TabRows({
  rows,
  currency,
  filters,
}: {
  rows: MisDashboardTabRow[];
  currency: string;
  filters: DashboardFilters;
}) {
  if (!rows.length) return <p className="py-6 text-sm text-muted-foreground">No reporting category totals match these filters.</p>;
  const order: Record<string, number> = { income: 0, cost: 1, expense: 2, salary: 3 };
  const sortedRows = [...rows].sort((a, b) => (order[a.financialClass] ?? 4) - (order[b.financialClass] ?? 4) || a.tabName.localeCompare(b.tabName));
  return (
    <div className="space-y-1">
      {sortedRows.map((row) => (
        <Link
          key={row.tabId}
          href={entriesHref(filters, { tabId: row.tabId })}
          className="flex items-center justify-between gap-4 rounded-md px-2 py-2 hover:bg-muted/50"
        >
          <span className="min-w-0"><span className="block truncate font-medium">{row.tabName}</span><span className="text-xs capitalize text-muted-foreground">{row.type}</span></span>
          <span className="shrink-0 text-right"><span className="block font-medium">{money(row.totals.netProfit, currency)}</span><span className="text-xs text-muted-foreground">{row.totals.entryCount.toLocaleString()} entries</span></span>
        </Link>
      ))}
    </div>
  );
}

function PeriodRows({
  rows,
  currency,
  filters,
}: {
  rows: MisDashboardPeriodRow[];
  currency: string;
  filters: DashboardFilters;
}) {
  if (!rows.length) return <p className="py-6 text-sm text-muted-foreground">No period totals match these filters.</p>;
  return (
    <div className="space-y-1">
      {rows.map((row) => (
        <Link
          key={`${row.fromDate}-${row.toDate}`}
          href={entriesHref(filters, { from: row.fromDate, to: row.toDate })}
          className="flex items-center justify-between gap-4 rounded-md px-2 py-2 hover:bg-muted/50"
        >
          <span className="font-medium">{row.fromDate} – {row.toDate}</span>
          <span className="shrink-0 text-right"><span className="block font-medium">{money(row.totals.netProfit, currency)}</span><span className="text-xs text-muted-foreground">{row.totals.entryCount.toLocaleString()} entries</span></span>
        </Link>
      ))}
    </div>
  );
}

const SERVICE_SECTIONS = [
  { cls: "income", title: "Income by service", key: "income" },
  { cls: "cost", title: "Cost by service", key: "cost" },
  { cls: "expense", title: "Expenses by service", key: "expenses" },
  { cls: "salary", title: "Salaries by service", key: "salaries" },
] as const;

function ServiceBreakdowns({ rows, currency, filters }: { rows: MisDashboardServiceRow[]; currency: string; filters: DashboardFilters }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Service breakdown</CardTitle>
        <CardDescription>Selected-project services grouped by their category financial class ({currency}). Amounts are recorded values before Overhead and OP Expense.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        {SERVICE_SECTIONS.map((section) => {
          const scoped = rows.filter((row) => row.financialClass === section.cls);
          const subtotal = scoped.reduce((sum, row) => sum + (row.totals[section.key] ?? 0), 0);
          return (
            <div key={section.cls} className="min-w-0 rounded-lg border p-4" data-testid={`service-breakdown-${section.cls}-${currency}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b pb-3">
                <h3 className="font-medium">{section.title} <span className="text-xs text-muted-foreground">({currency})</span></h3>
                <span className="font-semibold tabular-nums">{money(subtotal, currency)}</span>
              </div>
              {scoped.length ? (
                <ul className="mt-3 space-y-1 text-sm">
                  {scoped.map((row) => (
                    <li key={`${row.serviceId}-${row.tabId}`}>
                      <Link href={entriesHref(filters, { tabId: row.tabId, serviceId: row.serviceId })} className="flex items-baseline justify-between gap-3 rounded-md px-1 py-1 hover:bg-muted/50">
                        <span className="min-w-0 break-words">{row.serviceName} <span className="text-xs text-muted-foreground">· {row.tabName} · {row.totals.entryCount.toLocaleString()} entries</span></span>
                        <span className="shrink-0 tabular-nums">{money(row.totals[section.key], currency)}</span>
                      </Link>
                    </li>
                  ))}
                  <li className="flex items-baseline justify-between gap-3 border-t px-1 pt-2 font-medium">
                    <span>Subtotal</span><span className="tabular-nums">{money(subtotal, currency)}</span>
                  </li>
                </ul>
              ) : <p className="mt-3 text-sm text-muted-foreground">No {section.title.split(" ")[0].toLowerCase()} services match these filters.</p>}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function CurrencyDashboard({
  group,
  filters,
  adjustments,
  mode,
}: {
  group: MisDashboardCurrencyGroup;
  filters: DashboardFilters;
  adjustments: MisDashboardAdjustment[];
  mode: DashboardMode;
}) {
  const href = entriesHref(filters);
  return (
    <section className="space-y-4" aria-label={`${group.currency} dashboard totals`}>
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold">{group.currency}</h2>
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs text-muted-foreground">Values are not combined across currencies</span>
      </div>
      <DashboardKpis totals={group.totals} currency={group.currency} href={href} adjustedNetProfit={group.adjustedNetProfit} />
      <p className="text-xs text-muted-foreground">Net profit and profit margin include selected-project Overhead and OP Expense only when you have access to both sections for every selected project. Entry breakdowns below show recorded amounts before these dashboard charges.</p>
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="min-w-0 space-y-4 xl:col-span-2">
          <PercentageAdjustments rows={adjustments} />
          {mode === "overview" && <ServiceBreakdowns rows={group.byService ?? []} currency={group.currency} filters={filters} />}
          <Card>
            <CardHeader><CardTitle className="text-base">By project</CardTitle><CardDescription>Open a project total to inspect its filtered entries.</CardDescription></CardHeader>
            <CardContent><ProjectRows rows={group.byProject} currency={group.currency} filters={filters} /></CardContent>
          </Card>
        </div>
        <Card>
          <CardHeader><CardTitle className="text-base">By category</CardTitle><CardDescription>Reporting-enabled categories only.</CardDescription></CardHeader>
          <CardContent><TabRows rows={group.byTab} currency={group.currency} filters={filters} /></CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">By entry period</CardTitle></CardHeader>
        <CardContent><PeriodRows rows={group.byPeriod} currency={group.currency} filters={filters} /></CardContent>
      </Card>
    </section>
  );
}

export type DashboardMode = "dashboard" | "overview";

export default function Dashboard({ mode = "dashboard" }: { mode?: DashboardMode } = {}) {
  const isOverview = mode === "overview";
  const defaultRange = useMemo(monthToDate, []);
  const initialFilters = useMemo(() => parseInitialDashboardFilters(defaultRange), [defaultRange]);
  const [projectIds, setProjectIds] = useState<string[]>(() => initialFilters.projectIds);
  const [tabId, setTabId] = useState(() => initialFilters.tabId);
  const [serviceId, setServiceId] = useState(() => initialFilters.serviceId);
  const [from, setFrom] = useState(() => initialFilters.from);
  const [to, setTo] = useState(() => initialFilters.to);
  const [status, setStatus] = useState<MisGetDashboardStatus>(() => initialFilters.status);
  const accessQuery = useMisGetCurrentAccess();
  const access = accessQuery.data;
  const canViewDashboard = canViewAnyDashboard(access);
  const filters = { projectIds, tabId, serviceId, from, to, status };

  useEffect(() => {
    const query = new URLSearchParams();
    if (projectIds.length) query.set("projectIds", projectIds.join(","));
    if (tabId) query.set("tabId", tabId);
    if (serviceId) query.set("serviceId", serviceId);
    // Never persist an incomplete/invalid date as a request-ready filter.
    if (isCalendarDate(from)) query.set("from", from);
    if (isCalendarDate(to)) query.set("to", to);
    query.set("status", status);
    const nextUrl = `${window.location.pathname}${query.size ? `?${query.toString()}` : ""}${window.location.hash}`;
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextUrl !== currentUrl) window.history.replaceState(window.history.state, "", nextUrl);
  }, [projectIds, tabId, serviceId, from, to, status]);

  const tabsParams = { active: true };
  const tabsQuery = useMisListTabs(tabsParams, {
    query: {
      queryKey: getMisListTabsQueryKey(tabsParams),
      enabled: canViewDashboard,
    },
  });
  const reportingTabs = (tabsQuery.data ?? []).filter((tab) => tab.allowReporting);
  const reportingTabIds = new Set(reportingTabs.map((tab) => tab.id));

  const serviceParams = { tabId: tabId || undefined, active: true };
  const serviceQueries = useQueries({
    queries: projectIds.map((projectId) => getMisListProjectServicesQueryOptions(projectId, serviceParams, {
      query: {
        queryKey: getMisListProjectServicesQueryKey(projectId, serviceParams),
        enabled: canViewDashboard,
      },
    })),
  });
  const services = useMemo(
    () => serviceQueries.flatMap((query) => query.data ?? [])
      .filter((service): service is MisService => reportingTabIds.has(service.tabId)),
    [serviceQueries, reportingTabs],
  );
  const serviceLoading = serviceQueries.some((query) => query.isLoading);
  const datesReady = isCalendarDate(from) && isCalendarDate(to) && from <= to;
  const dateProblem = !datesReady;
  const dashboardParams = useMemo(() => ({
    projectIds: projectIds.length ? projectIds.join(",") : undefined,
    tabId: tabId || undefined,
    serviceId: serviceId || undefined,
    from: isCalendarDate(from) ? from : undefined,
    to: isCalendarDate(to) ? to : undefined,
    status,
    ...(isOverview ? { includeServices: "true" as const } : {}),
  }) satisfies MisGetDashboardParams, [projectIds, tabId, serviceId, from, to, status, isOverview]);
  const dashboardQuery = useMisGetDashboard(dashboardParams, {
    query: {
      queryKey: getMisGetDashboardQueryKey(dashboardParams),
      enabled: canViewDashboard && datesReady,
    },
  });
  const canExport = projectIds.length
    ? projectIds.every((projectId) => canViewDashboardProject(access, projectId) && canUsePermission(access, "export", projectId))
    : canUsePermission(access, "export");
  const exportDisabledReason = !canExport
    ? "Export requires Reports, Financial and Export permission for every included project."
    : !datesReady ? "Enter a valid date range to export."
    : dashboardQuery.isLoading ? "Loading dashboard data..."
    : dashboardQuery.error ? "Dashboard data could not be loaded."
    : null;
  const canConfigureProjects = hasPermission(access, "configuration") || hasPermission(access, "project_config");
  const canViewEntries = hasPermission(access, "entries");
  const canViewReports = hasPermission(access, "reports");

  function updateProjects(ids: string[]) {
    setProjectIds(ids);
    setServiceId("");
  }

  function resetFilters() {
    setProjectIds([]);
    setTabId("");
    setServiceId("");
    setFrom(defaultRange.from);
    setTo(defaultRange.to);
    setStatus(MisGetDashboardStatus.all);
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{isOverview ? "MIS Overview Report" : "MIS Dashboard"}</h1>
          <p className="mt-1 text-muted-foreground">{isOverview ? "Dashboard totals with income, cost, expense and salary breakdowns by service. Currencies stay separate." : "Financial aggregates remain separate for each currency."}</p>
        </div>
        {canViewDashboard && (
          <div className="flex flex-col gap-2 sm:items-end">
            <DashboardExportButtons
              params={{ view: mode, projectIds: dashboardParams.projectIds, tabId: dashboardParams.tabId, serviceId: dashboardParams.serviceId, from: dashboardParams.from, to: dashboardParams.to, status }}
              disabledReason={exportDisabledReason}
            />
            <Button variant="outline" onClick={resetFilters}>Reset to month to date</Button>
          </div>
        )}
      </div>

      {!accessQuery.isLoading && !canViewDashboard ? (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardHeader>
            <CardTitle>Financial dashboard access is required</CardTitle>
            <CardDescription>Dashboard totals require both Reports and Financial permission in the same global or project scope. No financial values are shown without that access.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {canViewEntries && <Link href="/entries"><Button><FileText className="mr-2 h-4 w-4" />Open entries</Button></Link>}
            {canViewReports && <Link href="/reports"><Button variant="outline"><BarChart3 className="mr-2 h-4 w-4" />Open basic reports</Button></Link>}
            {!canViewEntries && !canViewReports && <p className="text-sm text-muted-foreground">Ask a MIS administrator to grant Reports and Financial access.</p>}
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Dashboard filters</CardTitle>
              <CardDescription>Entries with the selected status whose complete period falls within the selected dates are included.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <div className="space-y-2">
                <Label>Projects</Label>
                <MisReportProjectPicker
                  selected={projectIds}
                  onChange={updateProjects}
                  isReportProject={(project) => canViewDashboardProject(access, project.id)}
                  disabled={accessQuery.isLoading}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dashboard-from">From</Label>
                <Input id="dashboard-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dashboard-to">To</Label>
                <Input id="dashboard-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dashboard-tab">Category</Label>
                <Select value={tabId || "__all"} onValueChange={(value) => { setTabId(value === "__all" ? "" : value); setServiceId(""); }}>
                  <SelectTrigger id="dashboard-tab"><SelectValue placeholder="All categories" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all">All reporting categories</SelectItem>
                    {reportingTabs.map((tab) => <SelectItem key={tab.id} value={tab.id}>{tab.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="dashboard-service">Service</Label>
                <Select value={serviceId || "__all"} disabled={!projectIds.length || serviceLoading} onValueChange={(value) => setServiceId(value === "__all" ? "" : value)}>
                  <SelectTrigger id="dashboard-service"><SelectValue placeholder={projectIds.length ? "All services" : "Select a project first"} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all">All services</SelectItem>
                    {services.map((service) => <SelectItem key={service.id} value={service.id}>{service.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="dashboard-status">Status</Label>
                <Select value={status} onValueChange={(value) => setStatus(value as MisGetDashboardStatus)}>
                  <SelectTrigger id="dashboard-status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.values(MisGetDashboardStatus).map((item) => <SelectItem key={item} value={item} className="capitalize">{item === MisGetDashboardStatus.all ? "All statuses" : item}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {dateProblem && (
            <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
              {!isCalendarDate(from) || !isCalendarDate(to)
                ? "Enter valid calendar dates in YYYY-MM-DD format to load the dashboard."
                : "The end date must be on or after the start date."}
            </div>
          )}
          {datesReady && (
            <p role="status" className="text-sm text-muted-foreground">
              Dashboard ready for {from} to {to} · {statusLabel(status).toLowerCase()}.
            </p>
          )}

          {dashboardQuery.isLoading && datesReady && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 7 }, (_, index) => <Skeleton key={index} className="h-28" />)}</div>
              <Skeleton className="h-72" />
            </div>
          )}

          {dashboardQuery.error && datesReady && (
            <Card className="border-destructive/30">
              <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
                <AlertCircle className="h-8 w-8 text-destructive" />
                <div><p className="font-semibold">Unable to load dashboard data</p><p className="mt-1 text-sm text-muted-foreground">{errorText(dashboardQuery.error)}</p></div>
                <Button variant="outline" onClick={() => void dashboardQuery.refetch()}><Loader2 className="mr-2 h-4 w-4" />Retry</Button>
              </CardContent>
            </Card>
          )}

          {!dashboardQuery.isLoading && !dashboardQuery.error && datesReady && (dashboardQuery.data?.currencyGroups.length ?? 0) === 0 && (
            <Card>
              <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
                <FolderKanban className="h-9 w-9 text-muted-foreground" />
                <div><p className="font-semibold">No {status === MisGetDashboardStatus.all ? "" : `${status} `}reporting data matches these filters</p><p className="mt-1 text-sm text-muted-foreground">Try another period or add reporting-enabled project categories and services.</p></div>
                <div className="flex flex-wrap justify-center gap-2">
                  {canConfigureProjects && <Link href="/projects"><Button><FolderKanban className="mr-2 h-4 w-4" />Configure projects</Button></Link>}
                  {canViewEntries && <Link href={entriesHref(filters)}><Button variant="outline">View filtered entries</Button></Link>}
                </div>
              </CardContent>
            </Card>
          )}

          {!dashboardQuery.isLoading && !dashboardQuery.error && datesReady && dashboardQuery.data?.currencyGroups.map((group) => (
            <CurrencyDashboard
              key={group.currency}
              group={group}
              filters={filters}
              mode={mode}
              adjustments={(dashboardQuery.data?.percentageAdjustments ?? []).filter((row) => row.currency === group.currency)}
            />
          ))}

          {!dashboardQuery.isLoading && !dashboardQuery.error && datesReady && Boolean(dashboardQuery.data?.recentEntries.length) && (
            <Card>
              <CardHeader><CardTitle className="text-base">Recent {status === MisGetDashboardStatus.all ? "" : `${status} `}entries</CardTitle><CardDescription>Each entry opens with its saved project, category, service, and period filters.</CardDescription></CardHeader>
              <CardContent className="divide-y">
                {dashboardQuery.data!.recentEntries.slice(0, 8).map((entry) => (
                  <Link
                    key={entry.id}
                    href={entriesHref(filters, { projectIds: [entry.projectId], tabId: entry.tabId, serviceId: entry.serviceId, from: entry.fromDate, to: entry.toDate })}
                    className="flex items-center justify-between gap-4 py-3 hover:bg-muted/40"
                  >
                    <span className="min-w-0"><span className="block truncate font-medium">{entry.projectName}</span><span className="block truncate text-xs text-muted-foreground">{entry.tabName} · {entry.serviceName} · {entry.fromDate} – {entry.toDate}</span></span>
                    <span className="shrink-0 font-medium">{money(entry.amount, entry.currency)}</span>
                  </Link>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}