import { useMemo, useState, type ReactNode } from "react";
import { format, startOfMonth } from "date-fns";
import { AlertCircle, BarChart3, Download, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  canExportAnalytics,
  canRequestAnalytics,
  defaultAnalyticsFilters,
  filterParams,
  MisAnalyticsFilters,
  type MisAnalyticsFilterValues,
} from "../components/MisAnalyticsFilters";
import { MisAnalyticsCharts } from "../components/MisAnalyticsCharts";
import { MisAnalyticsPeriodResults } from "../components/MisAnalyticsPeriodResults";
import { useMisAccess } from "../hooks/useMisAccess";
import {
  useMisAnalytics,
  useMisAnalyticsExport,
  type MisAnalyticsDrilldownFilters,
  type MisAnalyticsMetricKey,
  type MisAnalyticsParams,
  type MisAnalyticsPeriod,
  type MisAnalyticsRow,
  type MisAnalyticsStatus,
} from "../hooks/useMisAnalyticsQuery";

const KPI_METRICS: Array<{ key: MisAnalyticsMetricKey; label: string; percent?: boolean }> = [
  { key: "totalIncome", label: "Total income" },
  { key: "totalCost", label: "Total cost" },
  { key: "totalExpenses", label: "Total expenses" },
  { key: "totalSalaries", label: "Total salaries" },
  { key: "grossProfit", label: "Gross profit" },
  { key: "netProfit", label: "Net profit" },
  { key: "profitMargin", label: "Profit margin", percent: true },
];

function realDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function money(value: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(Number.isFinite(value) ? value : 0);
  } catch {
    return `${(Number.isFinite(value) ? value : 0).toFixed(2)} ${currency}`;
  }
}

function metricValue(value: number, currency: string, percent = false) {
  return percent ? `${(Number.isFinite(value) ? value : 0).toFixed(1)}%` : money(value, currency);
}

function errorText(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

const ALL_ANALYTICS_STATUSES: MisAnalyticsStatus[] = ["draft", "submitted", "approved", "rejected", "cancelled"];

function rowFilterValue(filters: MisAnalyticsFilterValues, row: MisAnalyticsRow): MisAnalyticsFilterValues {
  const drilldown = row.drilldownFilters;
  return {
    ...filters,
    projectIds: drilldown.projectIds.length ? drilldown.projectIds : filters.projectIds,
    projectSelection: drilldown.projectIds.length ? "selected" : filters.projectSelection,
    tabIds: drilldown.tabIds.length ? drilldown.tabIds : filters.tabIds,
    tabSelection: drilldown.tabIds.length ? "selected" : filters.tabSelection,
    serviceIds: drilldown.serviceIds.length ? drilldown.serviceIds : filters.serviceIds,
    serviceSelection: drilldown.serviceIds.length ? "selected" : filters.serviceSelection,
    types: drilldown.entryType ? [drilldown.entryType] : filters.types,
    statuses: drilldown.statuses.length ? drilldown.statuses : filters.statuses,
    from: !filters.periodComparison && drilldown.startFrom ? drilldown.startFrom : filters.from,
    to: !filters.periodComparison && drilldown.startTo ? drilldown.startTo : filters.to,
  };
}

function periodDrilldown(
  filters: MisAnalyticsFilterValues,
  period: MisAnalyticsPeriod,
  currency: string,
): MisAnalyticsDrilldownFilters {
  const statuses = filters.statuses.includes("all")
    ? ALL_ANALYTICS_STATUSES
    : filters.statuses.filter((status): status is MisAnalyticsStatus => status !== "all");
  return {
    projectIds: filters.projectSelection === "selected" ? filters.projectIds : [],
    tabIds: filters.tabSelection === "selected" ? filters.tabIds : [],
    serviceIds: filters.serviceSelection === "selected" ? filters.serviceIds : [],
    entryType: filters.types.length === 1 ? filters.types[0] : null,
    status: statuses.length === 1 ? statuses[0] : "all",
    statuses,
    currency,
    // A period comparison period is an exact whole-period range. It is not a
    // trend bucket, so do not add startFrom/startTo constraints.
    from: period.from,
    to: period.to,
    startFrom: null,
    startTo: null,
  };
}

function AccessState({
  accessQuery,
  children,
}: {
  accessQuery: ReturnType<typeof useMisAccess>;
  children: ReactNode;
}) {
  if (accessQuery.isLoading) {
    return (
      <Card>
        <CardContent className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Checking MIS analytics access…
        </CardContent>
      </Card>
    );
  }
  if (accessQuery.error) {
    return (
      <Card>
        <CardContent className="flex min-h-40 flex-col items-center justify-center gap-3 text-center">
          <AlertCircle className="h-8 w-8 text-destructive" />
          <p className="text-sm text-destructive">{errorText(accessQuery.error, "Unable to check MIS analytics access.")}</p>
          <Button variant="outline" size="sm" onClick={() => void accessQuery.refetch()}>
            <RefreshCw className="mr-2 h-4 w-4" /> Retry access check
          </Button>
        </CardContent>
      </Card>
    );
  }
  if (!accessQuery.data?.hasAccess) {
    return (
      <Card>
        <CardContent className="flex min-h-40 flex-col items-center justify-center text-center">
          <AlertCircle className="mb-2 h-8 w-8 text-amber-600" />
          <p className="font-medium">MIS access is pending</p>
          <p className="mt-1 text-sm text-muted-foreground">A MIS administrator must grant reporting and financial access on the same project scope.</p>
        </CardContent>
      </Card>
    );
  }
  return <>{children}</>;
}

function KpiCards({
  currency,
  current,
  previous,
  difference,
  percentageDifference,
}: {
  currency: string;
  current: NonNullable<ReturnType<typeof useMisAnalytics>["data"]>["totalsByCurrency"][number]["current"];
  previous: NonNullable<ReturnType<typeof useMisAnalytics>["data"]>["totalsByCurrency"][number]["previous"];
  difference: NonNullable<ReturnType<typeof useMisAnalytics>["data"]>["totalsByCurrency"][number]["difference"];
  percentageDifference: NonNullable<ReturnType<typeof useMisAnalytics>["data"]>["totalsByCurrency"][number]["percentageDifference"];
}) {
  return (
    <div className="grid gap-3 grid-cols-2 md:grid-cols-4 lg:grid-cols-7">
      {KPI_METRICS.map(({ key, label, percent }) => {
        const currentValue = Number(current[key] ?? 0);
        const delta = difference?.[key as keyof typeof difference];
        const deltaPercent = percentageDifference?.[key as keyof typeof percentageDifference];
        return (
          <Card key={key}>
            <CardHeader className="p-4 pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">{label}</CardTitle></CardHeader>
            <CardContent className="p-4 pt-0">
              <p className="text-lg font-bold">{metricValue(currentValue, currency, percent)}</p>
              {previous && delta !== undefined && (
                <p className={`mt-1 text-xs ${delta >= 0 ? "text-emerald-600" : "text-destructive"}`}>
                  {delta >= 0 ? "+" : ""}{metricValue(delta, currency, percent)} · {deltaPercent === null || deltaPercent === undefined ? "—" : `${deltaPercent >= 0 ? "+" : ""}${deltaPercent.toFixed(1)}%`}
                </p>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

export default function Analytics() {
  const accessQuery = useMisAccess();
  const [filters, setFilters] = useState<MisAnalyticsFilterValues>(() => {
    const today = new Date();
    return {
      ...defaultAnalyticsFilters(),
      from: format(startOfMonth(today), "yyyy-MM-dd"),
      to: format(today, "yyyy-MM-dd"),
    };
  });
  const [crossFilter, setCrossFilter] = useState<{ label: string; restore: MisAnalyticsFilterValues } | null>(null);
  const [periodPage, setPeriodPage] = useState(1);
  const { download, isDownloading, downloadError } = useMisAnalyticsExport();
  const access = accessQuery.data;
  const invalidPeriod = filters.periods.some((period) =>
    !period.id.trim() || !period.label.trim() || !realDate(period.from) || !realDate(period.to) || period.from > period.to,
  );
  const dateError = filters.periodComparison
    ? filters.periods.length < 3
      ? "Enable period comparison with at least three periods."
      : invalidPeriod
        ? "Every comparison period needs a label and a real chronological date range."
        : null
    : filters.from && filters.to && (!realDate(filters.from) || !realDate(filters.to) || filters.from > filters.to)
    ? "Use real calendar dates in chronological order."
    : Boolean(filters.from) !== Boolean(filters.to)
      ? "Enter both dates or clear both dates."
      : filters.view === "custom" && (!filters.from || !filters.to)
        ? "Custom period view requires both dates."
        : null;
  const params = useMemo<MisAnalyticsParams>(() => ({
    mode: "analytics",
    ...filterParams(filters),
    page: filters.periodComparison ? periodPage : undefined,
  }), [filters, periodPage]);
  const canRequest = filters.projectSelection !== "none" &&
    filters.tabSelection !== "none" &&
    filters.serviceSelection !== "none" &&
    filters.statuses.length > 0 &&
    canRequestAnalytics(access, filters.projectIds) && !dateError;
  const analyticsQuery = useMisAnalytics(params, { enabled: canRequest });
  const canExport = filters.projectSelection !== "none" &&
    filters.tabSelection !== "none" &&
    filters.serviceSelection !== "none" &&
    filters.statuses.length > 0 &&
    canExportAnalytics(access, filters.projectIds) && !dateError;

  function exportAnalytics(format: "csv" | "xlsx" | "pdf") {
    void download({ ...params, format });
  }

  function applyRowCrossFilter(row: MisAnalyticsRow) {
    setCrossFilter({
      label: row.projectName || row.serviceName || row.type || "Selected server group",
      restore: filters,
    });
    setFilters(rowFilterValue(filters, row));
    setPeriodPage(1);
  }

  function applyPeriodCrossFilter(period: MisAnalyticsPeriod, currency: string) {
    setCrossFilter({
      label: `${period.label} · ${currency}`,
      restore: filters,
    });
    // Keep the full comparison selection valid while making the clicked
    // period the explicit first period in the query state.
    setFilters((current) => ({
      ...current,
      periods: [period, ...current.periods.filter((item) => item.id !== period.id)],
    }));
    setPeriodPage(1);
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">MIS Analytics</h1>
          <p className="mt-1 text-muted-foreground">Currency-safe KPI and trend analysis. Entries are included only when their complete period is inside the range; trend attribution uses the period start and never prorates.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(["csv", "xlsx", "pdf"] as const).map((format) => (
            <Button key={format} variant="outline" size="sm" disabled={!canExport || isDownloading} onClick={() => exportAnalytics(format)} title={!canExport ? "Export requires reports, financial, and export on every selected project." : undefined}>
              {isDownloading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
              {format === "xlsx" ? "Excel" : format.toUpperCase()}
            </Button>
          ))}
        </div>
      </div>

      <AccessState accessQuery={accessQuery}>
        <Card>
          <CardHeader>
            <CardTitle>Analytics filters</CardTitle>
            <CardDescription>Project, project code, reporting tab, service, service code, type, status, dates, and daily/weekly/monthly/custom trend view are sent as the documented analytics query parameters.</CardDescription>
          </CardHeader>
          <CardContent>
            <MisAnalyticsFilters value={filters} onChange={(next) => { setFilters(next); setPeriodPage(1); }} access={access} />
          </CardContent>
        </Card>
        {crossFilter && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm" aria-label="Active cross filter">
            <span className="font-medium">Cross-filter:</span>
            <span>{crossFilter.label}</span>
             <Button type="button" variant="ghost" size="sm" onClick={() => { setFilters(crossFilter.restore); setCrossFilter(null); setPeriodPage(1); }}>Reset</Button>
          </div>
        )}

        {dateError && <div role="alert" className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-800"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{dateError}</div>}
        {!dateError && !canRequest && <div role="alert" className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-muted-foreground"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />Select projects where the same grant has both reports and financial permission, or ask for that combined access.</div>}
        {downloadError && <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{downloadError}</div>}
        {analyticsQuery.error && <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{errorText(analyticsQuery.error, "The analytics request failed.")}</div>}
        {analyticsQuery.isLoading && <div className="space-y-4"><Skeleton className="h-28 w-full rounded-xl" /><Skeleton className="h-96 w-full rounded-xl" /></div>}

        {analyticsQuery.data && !analyticsQuery.isLoading && (
          analyticsQuery.data.periods?.length ? (
            <MisAnalyticsPeriodResults
              periods={analyticsQuery.data.periods}
              onRowClick={applyRowCrossFilter}
              onPeriodClick={applyPeriodCrossFilter}
              periodDrilldownFilters={(period, currency) => periodDrilldown(filters, period, currency)}
              page={periodPage}
              onPageChange={setPeriodPage}
            />
          ) : analyticsQuery.data.totalsByCurrency.length ? (
            <div className="space-y-8">
              <p className="text-xs text-muted-foreground">Server date basis: <span className="font-medium text-foreground">{analyticsQuery.data.dateBasis}</span>. Currencies are displayed in separate sections and are never combined.</p>
              {analyticsQuery.data.totalsByCurrency.map((currencyGroup) => (
                <section key={currencyGroup.currency} className="space-y-4" aria-label={`${currencyGroup.currency} analytics`}>
                  <div>
                    <h2 className="flex items-center gap-2 text-xl font-semibold"><BarChart3 className="h-5 w-5 text-primary" />{currencyGroup.currency}</h2>
                    <p className="text-sm text-muted-foreground">Seven dashboard KPIs and six charts for this currency only.</p>
                  </div>
                  <KpiCards currency={currencyGroup.currency} current={currencyGroup.current} previous={currencyGroup.previous} difference={currencyGroup.difference} percentageDifference={currencyGroup.percentageDifference} />
                   <MisAnalyticsCharts
                     currencyGroup={currencyGroup}
                     trend={analyticsQuery.data.trend}
                     onPointClick={applyRowCrossFilter}
                   />
                </section>
              ))}
            </div>
          ) : (
            <Card><CardContent className="flex min-h-48 flex-col items-center justify-center text-center text-muted-foreground"><BarChart3 className="mb-2 h-9 w-9 opacity-30" /><p className="font-medium text-foreground">No analytics rows match these filters.</p><p className="mt-1 text-sm">Try a wider fully-contained date range, another status, or a permitted project scope.</p></CardContent></Card>
          )
        )}
      </AccessState>
    </div>
  );
}