import { useMemo, useState, type ReactNode } from "react";
import { format, startOfMonth } from "date-fns";
import { Link } from "wouter";
import { AlertCircle, ArrowRight, BarChart3, Download, Loader2, RefreshCw } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  canExportAnalytics,
  canRequestAnalytics,
  defaultAnalyticsFilters,
  filterParams,
  MisAnalyticsFilters,
  type MisAnalyticsFilterValues,
} from "../components/MisAnalyticsFilters";
import { useMisAccess } from "../hooks/useMisAccess";
import {
  useMisAnalytics,
  useMisAnalyticsExport,
  analyticsEntryHrefs,
  type MisAnalyticsDrilldownFilters,
  type MisAnalyticsDifference,
  type MisAnalyticsMetricSet,
  type MisAnalyticsMode,
  type MisAnalyticsParams,
  type MisAnalyticsPeriod,
  type MisAnalyticsRow,
  type MisAnalyticsStatus,
} from "../hooks/useMisAnalyticsQuery";
import { MisAnalyticsPeriodResults } from "../components/MisAnalyticsPeriodResults";

const COMPARE_METRICS: Array<{ key: keyof MisAnalyticsMetricSet; label: string; percent?: boolean }> = [
  { key: "totalIncome", label: "Total income" },
  { key: "totalCost", label: "Total cost" },
  { key: "totalExpenses", label: "Total expenses" },
  { key: "totalSalaries", label: "Total salaries" },
  { key: "grossProfit", label: "Gross profit" },
  { key: "netProfit", label: "Net profit" },
  { key: "profitMargin", label: "Profit margin", percent: true },
  { key: "quantity", label: "Quantity" },
  { key: "totalAmount", label: "Total amount" },
  { key: "weightedRate", label: "Weighted rate" },
  { key: "entryCount", label: "Entries" },
];

function realDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function money(value: number | null | undefined, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(Number.isFinite(value ?? NaN) ? value ?? 0 : 0);
  } catch {
    return `${(Number.isFinite(value ?? NaN) ? value ?? 0 : 0).toFixed(2)} ${currency}`;
  }
}

function valueText(value: number | null | undefined, currency: string, percent = false, plain = false) {
  if (value === null || value === undefined) return "—";
  if (percent) return `${value.toFixed(1)}%`;
  if (plain) return value.toLocaleString();
  return money(value, currency);
}

function labelForRow(row: { projectName: string | null; projectCode: string | null; tabName?: string | null; type: string | null; serviceCode: string | null; serviceName: string | null; periodStart: string | null; periodEnd: string | null }) {
  const dimensions = [
    row.projectName && row.projectCode ? `${row.projectCode} · ${row.projectName}` : row.projectName || row.projectCode,
    row.tabName || row.type,
    row.serviceName && row.serviceCode ? `${row.serviceCode} · ${row.serviceName}` : row.serviceName || row.serviceCode,
    row.periodStart && row.periodEnd ? `${row.periodStart} – ${row.periodEnd}` : row.periodStart,
  ].filter(Boolean);
  return dimensions.join(" / ") || "Comparison total";
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

function periodDrilldown(filters: MisAnalyticsFilterValues, period: MisAnalyticsPeriod, currency: string): MisAnalyticsDrilldownFilters {
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
    from: period.from,
    to: period.to,
    startFrom: null,
    startTo: null,
  };
}

function AccessState({ query, children }: { query: ReturnType<typeof useMisAccess>; children: ReactNode }) {
  if (query.isLoading) return <Card><CardContent className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Checking MIS comparison access…</CardContent></Card>;
  if (query.error) return <Card><CardContent className="flex min-h-40 flex-col items-center justify-center gap-3 text-center"><AlertCircle className="h-8 w-8 text-destructive" /><p className="text-sm text-destructive">{query.error instanceof Error ? query.error.message : "Unable to check access."}</p><Button variant="outline" size="sm" onClick={() => void query.refetch()}><RefreshCw className="mr-2 h-4 w-4" />Retry access check</Button></CardContent></Card>;
  if (!query.data?.hasAccess) return <Card><CardContent className="flex min-h-40 flex-col items-center justify-center text-center"><AlertCircle className="mb-2 h-8 w-8 text-amber-600" /><p className="font-medium">MIS comparison access is pending</p><p className="mt-1 text-sm text-muted-foreground">Reports and financial permission must be granted together on each included project.</p></CardContent></Card>;
  return <>{children}</>;
}

function DrilldownLinks({
  label,
  filters,
}: {
  label: string;
  filters: MisAnalyticsRow["drilldownFilters"];
}) {
  const links = analyticsEntryHrefs(filters);
  if (links.length === 1) {
    return <Link href={links[0].href} className="inline-flex items-center text-xs font-medium text-primary hover:underline">{label} <ArrowRight className="ml-1 h-3 w-3" /></Link>;
  }
  return (
    <details className="text-xs">
      <summary className="cursor-pointer font-medium text-primary">{label} ({links.length} filter views)</summary>
      <div className="mt-1 flex flex-col items-end gap-1">
        {links.map((link) => <Link key={link.href} href={link.href} className="text-primary hover:underline">{link.label} <ArrowRight className="inline h-3 w-3" /></Link>)}
      </div>
    </details>
  );
}

function ComparisonRows({
  currency,
  row,
}: {
  currency: string;
  row: MisAnalyticsRow;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[980px] text-sm">
        <thead className="border-y bg-muted/40 text-left text-muted-foreground">
          <tr>
            <th className="px-4 py-3 font-medium">Metric</th>
            <th className="px-4 py-3 text-right font-medium">Current</th>
            <th className="px-4 py-3 text-right font-medium">Previous</th>
            <th className="px-4 py-3 text-right font-medium">Difference</th>
            <th className="px-4 py-3 text-right font-medium">Percentage difference</th>
            <th className="px-4 py-3 text-right font-medium">Varied units</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {COMPARE_METRICS.map(({ key, label, percent }) => {
            const current = row.current[key];
            const previous = row.previous?.[key];
            const difference = row.difference && key in row.difference
              ? row.difference[key as keyof MisAnalyticsDifference]
              : undefined;
            const percentage = row.percentageDifference && key in row.percentageDifference
              ? row.percentageDifference[key as keyof MisAnalyticsDifference]
              : undefined;
            return (
              <tr key={key} className="hover:bg-muted/30">
                <td className="px-4 py-2 font-medium">{label}</td>
                <td className="px-4 py-2 text-right">{typeof current === "number" ? valueText(current, currency, percent, key === "quantity" || key === "entryCount") : "—"}</td>
                <td className="px-4 py-2 text-right">{typeof previous === "number" ? valueText(previous, currency, percent, key === "quantity" || key === "entryCount") : "—"}</td>
                <td className="px-4 py-2 text-right">{typeof difference === "number" ? valueText(difference, currency, percent, key === "quantity" || key === "entryCount") : "—"}</td>
                <td className="px-4 py-2 text-right">{percentage === null || percentage === undefined ? "—" : `${percentage.toFixed(1)}%`}</td>
                <td className="px-4 py-2 text-right">{key === "quantity" || key === "weightedRate" ? (row.current.unitVaried ? "Yes" : "No") : "—"}</td>
              </tr>
            );
          })}
          <tr className="bg-muted/20">
            <td className="px-4 py-2 font-medium">Observed units</td>
            <td className="px-4 py-2 text-right">{row.current.units.length ? row.current.units.join(", ") : "—"}</td>
            <td className="px-4 py-2 text-right">{row.previous?.units.length ? row.previous.units.join(", ") : "—"}</td>
            <td colSpan={2} className="px-4 py-2 text-right">Rate varied: {row.current.rateVaried ? "Yes" : "No"}</td>
            <td className="px-4 py-2 text-right">{row.current.unitVaried ? "Yes" : "No"}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export default function Comparison() {
  const accessQuery = useMisAccess();
  const [mode, setMode] = useState<Extract<MisAnalyticsMode, "project" | "service" | "type">>("project");
  const [filters, setFilters] = useState<MisAnalyticsFilterValues>(() => {
    const today = new Date();
    const prior = new Date(today);
    prior.setMonth(prior.getMonth() - 1);
    return {
      ...defaultAnalyticsFilters(),
      from: format(startOfMonth(today), "yyyy-MM-dd"),
      to: format(today, "yyyy-MM-dd"),
      compareFrom: format(startOfMonth(prior), "yyyy-MM-dd"),
      compareTo: format(new Date(prior.getFullYear(), prior.getMonth() + 1, 0), "yyyy-MM-dd"),
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
    : Boolean(filters.from) !== Boolean(filters.to) || Boolean(filters.compareFrom) !== Boolean(filters.compareTo)
      ? "Enter both dates for each period or clear the pair."
      : !realDate(filters.from) || !realDate(filters.to) || !realDate(filters.compareFrom) || !realDate(filters.compareTo) || filters.from > filters.to || filters.compareFrom > filters.compareTo
        ? "Both periods must use real calendar dates in chronological order."
        : null;
  const params = useMemo<MisAnalyticsParams>(() => ({
    mode,
    groupBy: [mode],
    ...filterParams(filters),
    page: filters.periodComparison ? periodPage : undefined,
  }), [filters, mode, periodPage]);
  const canRequest = filters.projectSelection !== "none" &&
    filters.tabSelection !== "none" &&
    filters.serviceSelection !== "none" &&
    filters.statuses.length > 0 &&
    canRequestAnalytics(access, filters.projectIds) && !dateError;
  const query = useMisAnalytics(params, { enabled: canRequest });
  const canExport = filters.projectSelection !== "none" &&
    filters.tabSelection !== "none" &&
    filters.serviceSelection !== "none" &&
    filters.statuses.length > 0 &&
    canExportAnalytics(access, filters.projectIds) && !dateError;

  function exportComparison(format: "csv" | "xlsx" | "pdf") {
    void download({ ...params, format });
  }

  function applyRowCrossFilter(row: MisAnalyticsRow) {
    setCrossFilter({ label: labelForRow(row), restore: filters });
    setFilters(rowFilterValue(filters, row));
    setPeriodPage(1);
  }

  function applyPeriodCrossFilter(period: MisAnalyticsPeriod, currency: string) {
    setCrossFilter({ label: `${period.label} · ${currency}`, restore: filters });
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
          <h1 className="text-3xl font-semibold tracking-tight">MIS Comparison</h1>
          <p className="mt-1 text-muted-foreground">Compare fully-contained periods by project, stable service code, or type. Previous values, differences, quantities, weighted rates, and mixed units come directly from the analytics contract.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(["csv", "xlsx", "pdf"] as const).map((format) => <Button key={format} variant="outline" size="sm" disabled={!canExport || isDownloading} onClick={() => exportComparison(format)} title={!canExport ? "Export requires reports, financial, and export on every selected project." : undefined}>{isDownloading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}{format === "xlsx" ? "Excel" : format.toUpperCase()}</Button>)}
        </div>
      </div>

      <AccessState query={accessQuery}>
        <Card>
          <CardHeader>
            <CardTitle>Comparison filters</CardTitle>
            <CardDescription>Service comparison groups on the case-insensitive stable service code, so the same service can be compared across projects. Select service IDs for a chosen project scope or enter service codes to compare across projects and different services.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="max-w-xs space-y-2">
              <Label>Compare by</Label>
               <Select value={mode} onValueChange={(value) => setMode(value as typeof mode)}>
                 <SelectTrigger><SelectValue /></SelectTrigger>
                 <SelectContent><SelectItem value="project">Project</SelectItem><SelectItem value="service">Service code</SelectItem><SelectItem value="type">Category (dynamic tab)</SelectItem></SelectContent>
              </Select>
            </div>
             <MisAnalyticsFilters value={filters} onChange={(next) => { setFilters(next); setPeriodPage(1); }} access={access} showComparison showView categoryMode={mode === "type"} />
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
        {!dateError && !canRequest && <div role="alert" className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-muted-foreground"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />Every included project needs reports and financial permission on the same grant.</div>}
        {downloadError && <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{downloadError}</div>}
        {query.error && <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{query.error instanceof Error ? query.error.message : "The comparison request failed."}</div>}
        {query.isLoading && <Skeleton className="h-96 w-full rounded-xl" />}

        {query.data && !query.isLoading && (
          query.data.periods?.length ? (
          <MisAnalyticsPeriodResults
            periods={query.data.periods}
            onRowClick={applyRowCrossFilter}
            onPeriodClick={applyPeriodCrossFilter}
            periodDrilldownFilters={(period, currency) => periodDrilldown(filters, period, currency)}
            page={periodPage}
            onPageChange={setPeriodPage}
          />
          ) : query.data.totalsByCurrency.length ? (
            <div className="space-y-6">
              <p className="text-xs text-muted-foreground">Date basis: <span className="font-medium text-foreground">{query.data.dateBasis}</span>. Currency totals and rows remain separate; no exchange-rate conversion is applied.</p>
              {query.data.totalsByCurrency.map((currencyGroup) => {
                const rows = query.data.rows.filter((row) => row.currency === currencyGroup.currency);
                const chartRows = rows.map((row) => ({ name: labelForRow(row).slice(0, 28), current: row.current.netProfit, previous: row.previous?.netProfit ?? 0, row }));
                return (
                  <section key={currencyGroup.currency} className="space-y-4" aria-label={`${currencyGroup.currency} comparison`}>
                    <div><h2 className="flex items-center gap-2 text-xl font-semibold"><BarChart3 className="h-5 w-5 text-primary" />{currencyGroup.currency} comparison</h2><p className="text-sm text-muted-foreground">Rows present only in the comparison period have zero current metrics as required by the API.</p></div>
                    <Card>
                      <CardHeader><CardTitle>Net profit comparison</CardTitle></CardHeader>
                      <CardContent className="h-72">
                        {chartRows.length ? <ResponsiveContainer width="100%" height="100%"><BarChart data={chartRows} onClick={(state) => { const row = state?.activePayload?.[0]?.payload?.row as MisAnalyticsRow | undefined; if (row) applyRowCrossFilter(row); }}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} /><YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10 }} /><Tooltip formatter={(value: number) => money(value, currencyGroup.currency)} /><Legend /><Bar dataKey="current" name="Current net profit" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} cursor="pointer" /><Bar dataKey="previous" name="Previous net profit" fill="hsl(var(--muted-foreground))" radius={[4, 4, 0, 0]} cursor="pointer" /></BarChart></ResponsiveContainer> : <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No grouped rows for this currency.</div>}
                      </CardContent>
                    </Card>
                    {rows.length ? rows.map((row, index) => (
                      <Card key={`${row.currency}-${row.projectId}-${row.serviceCode}-${row.type}-${row.periodStart}-${index}`}>
                        <CardHeader className="pb-3">
                          <div className="flex flex-col justify-between gap-2 md:flex-row md:items-start">
                            <div>
                              <CardTitle className="text-base"><button type="button" className="text-left hover:underline" onClick={() => applyRowCrossFilter(row)}>{labelForRow(row)}</button></CardTitle>
                              <CardDescription>{row.drilldownFilters.projectIds.length} project scope item(s) · {row.current.entryCount.toLocaleString()} current entries · {row.current.units.length ? `units: ${row.current.units.join(", ")}` : "no units"} · mixed units: {row.current.unitVaried ? "yes" : "no"}</CardDescription>
                            </div>
                            <div className="flex flex-col items-end gap-1">
                              <DrilldownLinks label="Current entries" filters={row.drilldownFilters} />
                              {row.previousDrilldownFilters && <DrilldownLinks label="Previous entries" filters={row.previousDrilldownFilters} />}
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent className="p-0"><ComparisonRows currency={currencyGroup.currency} row={row} /></CardContent>
                      </Card>
                    )) : <Card><CardContent className="flex min-h-36 items-center justify-center text-sm text-muted-foreground">No comparison rows for this currency.</CardContent></Card>}
                  </section>
                );
              })}
            </div>
          ) : <Card><CardContent className="flex min-h-48 flex-col items-center justify-center text-center text-muted-foreground"><BarChart3 className="mb-2 h-9 w-9 opacity-30" /><p className="font-medium text-foreground">No comparison data matches these filters.</p></CardContent></Card>
        )}
      </AccessState>
    </div>
  );
}