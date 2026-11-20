import { useEffect, useMemo, useState, type ReactNode } from "react";
import { format, startOfMonth } from "date-fns";
import { Link } from "wouter";
import {
  AlertCircle,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Download,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
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
import { defaultAnalyticsPeriods } from "../components/MisAnalyticsPeriods";
import { MisAnalyticsPeriodResults } from "../components/MisAnalyticsPeriodResults";
import { useMisAccess } from "../hooks/useMisAccess";
import {
  useMisAnalytics,
  useMisAnalyticsExport,
  analyticsEntryHrefs,
  type MisAnalyticsGroupBy,
  type MisAnalyticsDrilldownFilters,
  type MisAnalyticsMetricSet,
  type MisAnalyticsParams,
  type MisAnalyticsRow,
} from "../hooks/useMisAnalyticsQuery";

const GROUP_OPTIONS: Array<{ value: MisAnalyticsGroupBy; label: string }> = [
  { value: "date", label: "Date" },
  { value: "project", label: "Project" },
  { value: "projectCode", label: "Project number / code" },
  { value: "type", label: "Type / category" },
  { value: "service", label: "Service code" },
  { value: "month", label: "Month" },
  { value: "year", label: "Year" },
];

function realDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

const DEFAULT_GROUPS: MisAnalyticsGroupBy[] = ["project", "type", "service"];
const VALID_GROUPS = new Set<MisAnalyticsGroupBy>(GROUP_OPTIONS.map((option) => option.value));
const VALID_STATUSES = new Set(["draft", "submitted", "approved", "rejected", "cancelled"]);
const VALID_VIEWS = new Set(["daily", "weekly", "monthly", "custom"]);
const VALID_PERIODS_MAX = 24;

function defaultDynamicReportFilters(): MisAnalyticsFilterValues {
  const today = new Date();
  return {
    ...defaultAnalyticsFilters(),
    from: format(startOfMonth(today), "yyyy-MM-dd"),
    to: format(today, "yyyy-MM-dd"),
  };
}

function safeQueryValue(value: string | null) {
  const trimmed = value?.trim() ?? "";
  return trimmed && trimmed.length <= 200 && !/[\u0000-\u001f\u007f]/.test(trimmed) ? trimmed : "";
}

function queryList(search: URLSearchParams, key: string) {
  return [...new Set(
    search.getAll(key)
      .flatMap((value) => value.split(","))
      .map((value) => safeQueryValue(value))
      .filter(Boolean),
  )];
}

function validQueryDate(value: string | null) {
  return value && realDate(value) ? value : null;
}

function optionalQueryDate(value: string | null) {
  if (value === null || value === "") return { valid: true, value: "" };
  const date = validQueryDate(value);
  return date ? { valid: true, value: date } : { valid: false, value: "" };
}

function parsePage(value: string | null) {
  if (!value || !/^\d+$/.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) && page >= 1 && page <= 2_000_000_000 ? page : 1;
}

function parsePeriods(search: URLSearchParams) {
  const encoded = search.get("periods");
  if (!encoded) return defaultAnalyticsPeriods();
  try {
    const parsed = JSON.parse(encoded) as unknown;
    if (!Array.isArray(parsed) || parsed.length < 3 || parsed.length > VALID_PERIODS_MAX) return defaultAnalyticsPeriods();
    const periods = parsed.filter((period): period is { id: string; label: string; from: string; to: string } =>
      Boolean(period) &&
      typeof period === "object" &&
      typeof (period as { id?: unknown }).id === "string" &&
      typeof (period as { label?: unknown }).label === "string" &&
      typeof (period as { from?: unknown }).from === "string" &&
      typeof (period as { to?: unknown }).to === "string",
    );
    return periods.length === parsed.length ? periods : defaultAnalyticsPeriods();
  } catch {
    return defaultAnalyticsPeriods();
  }
}

function parseDynamicReportState() {
  const filters = defaultDynamicReportFilters();
  const groups = DEFAULT_GROUPS;
  if (typeof window === "undefined") return { filters, groups, page: 1 };

  const search = new URLSearchParams(window.location.search);
  filters.projectIds = queryList(search, "projectIds");
  filters.projectSelection = search.get("projectScope") === "none" ? "none" : filters.projectIds.length ? "selected" : "all";
  filters.projectCode = safeQueryValue(search.get("projectCode"));
  filters.tabIds = queryList(search, "tabIds");
  filters.tabSelection = search.get("tabScope") === "none" ? "none" : filters.tabIds.length ? "selected" : "all";
  filters.serviceIds = queryList(search, "serviceIds");
  filters.serviceSelection = search.get("serviceScope") === "none" ? "none" : filters.serviceIds.length ? "selected" : "all";
  filters.serviceCodes = safeQueryValue(search.get("serviceCodes"));
  filters.types = queryList(search, "types");
  filters.periodComparison = search.get("periodComparison") === "true" || search.get("periodComparison") === "1";
  filters.periods = parsePeriods(search);

  if (search.has("from") || search.has("to")) {
    const from = optionalQueryDate(search.get("from"));
    const to = optionalQueryDate(search.get("to"));
    if (from.valid && to.valid) {
      filters.from = from.value;
      filters.to = to.value;
    }
  }

  const statuses = queryList(search, "status").filter((status) => VALID_STATUSES.has(status));
  if (search.get("status") === "all") filters.statuses = ["all"];
  else if (statuses.length) filters.statuses = statuses as MisAnalyticsFilterValues["statuses"];
  else if (search.get("statusScope") === "none") filters.statuses = [];
  const view = safeQueryValue(search.get("view"));
  if (VALID_VIEWS.has(view)) filters.view = view as MisAnalyticsFilterValues["view"];

  if (search.has("compareFrom") || search.has("compareTo")) {
    const compareFrom = optionalQueryDate(search.get("compareFrom"));
    const compareTo = optionalQueryDate(search.get("compareTo"));
    if (compareFrom.valid && compareTo.valid) {
      filters.compareFrom = compareFrom.value;
      filters.compareTo = compareTo.value;
    }
  }

  const parsedGroups = queryList(search, "groupBy")
    .filter((group): group is MisAnalyticsGroupBy => VALID_GROUPS.has(group as MisAnalyticsGroupBy));
  const uniqueGroups = [...new Set(parsedGroups)];
  return {
    filters,
    groups: uniqueGroups.length ? uniqueGroups : groups,
    page: parsePage(search.get("page")),
  };
}

function dynamicReportSearch(filters: MisAnalyticsFilterValues, groups: MisAnalyticsGroupBy[], page: number) {
  const search = new URLSearchParams();
  const appendList = (key: string, values: string[]) => values.forEach((value) => search.append(key, value));
  appendList("projectIds", filters.projectIds);
  if (filters.projectSelection === "none") search.set("projectScope", "none");
  if (filters.projectCode.trim()) search.set("projectCode", filters.projectCode.trim());
  appendList("tabIds", filters.tabIds);
  if (filters.tabSelection === "none") search.set("tabScope", "none");
  appendList("serviceIds", filters.serviceIds);
  if (filters.serviceSelection === "none") search.set("serviceScope", "none");
  if (filters.serviceCodes.trim()) search.set("serviceCodes", filters.serviceCodes.trim());
  appendList("types", filters.types);
  search.set("from", filters.from);
  search.set("to", filters.to);
  filters.statuses.forEach((status) => search.append("status", status));
  if (!filters.statuses.length) search.set("statusScope", "none");
  search.set("view", filters.view);
  if (filters.periodComparison) {
    search.set("periodComparison", "true");
    search.set("periods", JSON.stringify(filters.periods));
  }
  if (filters.compareFrom || filters.compareTo) {
    search.set("compareFrom", filters.compareFrom);
    search.set("compareTo", filters.compareTo);
  }
  appendList("groupBy", groups);
  search.set("page", String(page));
  return search;
}

function money(value: number | null | undefined, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(Number.isFinite(value ?? NaN) ? value ?? 0 : 0);
  } catch {
    return `${(Number.isFinite(value ?? NaN) ? value ?? 0 : 0).toFixed(2)} ${currency}`;
  }
}

function formatMetric(value: number | null | undefined, currency: string, percent = false, plain = false) {
  if (value === null || value === undefined) return "—";
  if (percent) return `${value.toFixed(1)}%`;
  if (plain) return value.toLocaleString();
  return money(value, currency);
}

function dimensionValue(group: MisAnalyticsGroupBy, row: MisAnalyticsRow) {
  if (group === "project") return row.projectName || row.projectId || "Project";
  if (group === "projectCode") return row.projectCode || "Project code";
  if (group === "type") return row.tabName || row.type || "Type";
  if (group === "service") return row.serviceCode ? `${row.serviceCode}${row.serviceName ? ` · ${row.serviceName}` : ""}` : "Service";
  if (row.periodStart && row.periodEnd && row.periodStart !== row.periodEnd) return `${row.periodStart} – ${row.periodEnd}`;
  return row.periodStart || "Selected range";
}

function AccessState({ query, children }: { query: ReturnType<typeof useMisAccess>; children: ReactNode }) {
  if (query.isLoading) return <Card><CardContent className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Checking MIS report access…</CardContent></Card>;
  if (query.error) return <Card><CardContent className="flex min-h-40 flex-col items-center justify-center gap-3 text-center"><AlertCircle className="h-8 w-8 text-destructive" /><p className="text-sm text-destructive">{query.error instanceof Error ? query.error.message : "Unable to check access."}</p><Button variant="outline" size="sm" onClick={() => void query.refetch()}><RefreshCw className="mr-2 h-4 w-4" />Retry access check</Button></CardContent></Card>;
  if (!query.data?.hasAccess) return <Card><CardContent className="flex min-h-40 flex-col items-center justify-center text-center"><AlertCircle className="mb-2 h-8 w-8 text-amber-600" /><p className="font-medium">MIS report access is pending</p><p className="mt-1 text-sm text-muted-foreground">Reports and financial permission must be granted together on each included project.</p></CardContent></Card>;
  return <>{children}</>;
}

function GroupMetricTable({ currency, row }: { currency: string; row: MisAnalyticsRow }) {
  const metrics: Array<{ key: keyof MisAnalyticsMetricSet; label: string; percent?: boolean }> = [
    { key: "totalIncome", label: "Income" },
    { key: "totalCost", label: "Cost" },
    { key: "totalExpenses", label: "Expenses" },
    { key: "totalSalaries", label: "Salaries" },
    { key: "grossProfit", label: "Gross profit" },
    { key: "netProfit", label: "Net profit" },
    { key: "profitMargin", label: "Profit margin", percent: true },
    { key: "quantity", label: "Quantity" },
    { key: "weightedRate", label: "Weighted rate" },
  ];
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] text-sm">
        <thead className="border-y bg-muted/40 text-left text-muted-foreground"><tr><th className="px-3 py-2 font-medium">Metric</th><th className="px-3 py-2 text-right font-medium">Current</th><th className="px-3 py-2 text-right font-medium">Previous</th><th className="px-3 py-2 text-right font-medium">Difference</th><th className="px-3 py-2 text-right font-medium">Percentage difference</th></tr></thead>
        <tbody className="divide-y">
          {metrics.map(({ key, label, percent }) => (
            <tr key={key}>
              <td className="px-3 py-2 font-medium">{label}</td>
              <td className="px-3 py-2 text-right">{formatMetric(row.current[key] as number | null, currency, percent, key === "quantity")}</td>
              <td className="px-3 py-2 text-right">{formatMetric(row.previous?.[key] as number | null, currency, percent, key === "quantity")}</td>
              <td className="px-3 py-2 text-right">{formatMetric(row.difference?.[key as keyof NonNullable<typeof row.difference>] as number | null, currency, percent, key === "quantity")}</td>
              <td className="px-3 py-2 text-right">{row.percentageDifference?.[key as keyof NonNullable<typeof row.percentageDifference>] == null ? "—" : `${Number(row.percentageDifference?.[key as keyof NonNullable<typeof row.percentageDifference>]).toFixed(1)}%`}</td>
            </tr>
          ))}
          <tr className="bg-muted/20"><td className="px-3 py-2 font-medium">Units / rate variance</td><td className="px-3 py-2 text-right">{row.current.units.length ? row.current.units.join(", ") : "—"} · rate varied: {row.current.rateVaried ? "yes" : "no"}</td><td className="px-3 py-2 text-right">{row.previous?.units.length ? row.previous.units.join(", ") : "—"}</td><td className="px-3 py-2 text-right">Mixed units: {row.current.unitVaried ? "yes" : "no"}</td><td className="px-3 py-2 text-right">Entries: {row.current.entryCount.toLocaleString()}</td></tr>
        </tbody>
      </table>
    </div>
  );
}

function DrilldownLinks({
  label,
  filters,
}: {
  label: string;
  filters: MisAnalyticsDrilldownFilters;
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

export default function DynamicReport() {
  const accessQuery = useMisAccess();
  const [initialState] = useState(parseDynamicReportState);
  const [groups, setGroups] = useState<MisAnalyticsGroupBy[]>(initialState.groups);
  const [filters, setFilters] = useState<MisAnalyticsFilterValues>(initialState.filters);
  const [page, setPage] = useState(initialState.page);
  const pageSize = 25;
  const { download, isDownloading, downloadError } = useMisAnalyticsExport();
  const access = accessQuery.data;
  const invalidPeriod = filters.periods.some((period) =>
    !period.id.trim() ||
    !period.label.trim() ||
    !realDate(period.from) ||
    !realDate(period.to) ||
    period.from > period.to,
  );
  const dateError = filters.periodComparison
    ? filters.periods.length < 3
      ? "Enable period comparison with at least three periods."
      : invalidPeriod
        ? "Every comparison period needs a label and a real chronological date range."
        : null
    : Boolean(filters.from) !== Boolean(filters.to) || (filters.from && filters.to && (!realDate(filters.from) || !realDate(filters.to) || filters.from > filters.to))
      ? "Report dates must be a complete, real calendar range."
      : Boolean(filters.compareFrom) !== Boolean(filters.compareTo) || (filters.compareFrom && filters.compareTo && (!realDate(filters.compareFrom) || !realDate(filters.compareTo) || filters.compareFrom > filters.compareTo))
        ? "Comparison dates must be a complete, real calendar range."
        : filters.view === "custom" && (!filters.from || !filters.to)
          ? "Custom period view requires both dates."
          : null;
  const params = useMemo<MisAnalyticsParams>(() => ({
    mode: "dynamic",
    groupBy: groups,
    page,
    pageSize,
    ...filterParams(filters),
  }), [filters, groups, page]);
  const canRequest = filters.projectSelection !== "none" &&
    filters.tabSelection !== "none" &&
    filters.serviceSelection !== "none" &&
    filters.statuses.length > 0 &&
    canRequestAnalytics(access, filters.projectIds) && groups.length > 0 && !dateError;
  const query = useMisAnalytics(params, { enabled: canRequest });
  const canExport = filters.projectSelection !== "none" &&
    filters.tabSelection !== "none" &&
    filters.serviceSelection !== "none" &&
    filters.statuses.length > 0 &&
    canExportAnalytics(access, filters.projectIds) && !dateError;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const search = dynamicReportSearch(filters, groups, page).toString();
    const nextUrl = `${window.location.pathname}?${search}${window.location.hash}`;
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextUrl !== currentUrl) window.history.replaceState(window.history.state, "", nextUrl);
  }, [filters, groups, page]);

  function updateFilters(next: MisAnalyticsFilterValues) {
    setFilters(next);
    setPage(1);
  }
  function addGroup() {
    const available = GROUP_OPTIONS.find((option) => !groups.includes(option.value));
    if (available) {
      setGroups((current) => [...current, available.value]);
      setPage(1);
    }
  }
  function removeGroup(index: number) {
    setGroups((current) => current.filter((_, currentIndex) => currentIndex !== index));
    setPage(1);
  }
  function moveGroup(index: number, direction: -1 | 1) {
    setGroups((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setPage(1);
  }
  function updateGroup(index: number, group: MisAnalyticsGroupBy) {
    setGroups((current) => current.map((item, currentIndex) => currentIndex === index ? group : item));
    setPage(1);
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div><h1 className="text-3xl font-semibold tracking-tight">Dynamic MIS Report</h1><p className="mt-1 text-muted-foreground">Choose any ordered hierarchy of date, project, project number, type, service, month, or year. The server performs the grouped aggregate and supplies safe drill-down filters.</p></div>
        <div className="flex flex-wrap gap-2">{(["csv", "xlsx", "pdf"] as const).map((format) => <Button key={format} variant="outline" size="sm" disabled={!canExport || isDownloading} onClick={() => void download({ ...params, format })} title={!canExport ? "Export requires reports, financial, and export on every selected project." : undefined}>{isDownloading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}{format === "xlsx" ? "Excel" : format.toUpperCase()}</Button>)}</div>
      </div>

      <AccessState query={accessQuery}>
        <Card>
          <CardHeader><CardTitle>Report filters</CardTitle><CardDescription>All filters map to documented analytics parameters. Complete periods are included only when their from and to dates are inside the selected range; trend dates use period start.</CardDescription></CardHeader>
          <CardContent className="space-y-6">
            <MisAnalyticsFilters value={filters} onChange={updateFilters} access={access} showComparison showView />
            <div className="border-t pt-5">
              <div className="mb-3 flex items-center justify-between"><div><Label>Ordered grouping hierarchy</Label><p className="text-xs text-muted-foreground">Drag order with the arrows; dimensions cannot repeat.</p></div><Button variant="outline" size="sm" onClick={addGroup} disabled={groups.length >= GROUP_OPTIONS.length}><Plus className="mr-2 h-4 w-4" />Add level</Button></div>
              <div className="space-y-2">
                {groups.map((group, index) => (
                  <div key={group} className="flex items-center gap-2">
                    <div className="flex flex-col"><Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => moveGroup(index, -1)} disabled={index === 0} aria-label={`Move ${group} up`}><ChevronUp className="h-3 w-3" /></Button><Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => moveGroup(index, 1)} disabled={index === groups.length - 1} aria-label={`Move ${group} down`}><ChevronDown className="h-3 w-3" /></Button></div>
                    <Select value={group} onValueChange={(value) => updateGroup(index, value as MisAnalyticsGroupBy)}><SelectTrigger className="max-w-xs"><SelectValue /></SelectTrigger><SelectContent>{GROUP_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value} disabled={groups.includes(option.value) && option.value !== group}>{option.label}</SelectItem>)}</SelectContent></Select>
                    <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive" onClick={() => removeGroup(index)} disabled={groups.length === 1} aria-label={`Remove ${group}`}><Trash2 className="h-4 w-4" /></Button>
                    <span className="text-xs text-muted-foreground">Level {index + 1}</span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {dateError && <div role="alert" className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-800"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{dateError}</div>}
        {!dateError && !canRequest && <div role="alert" className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-muted-foreground"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />Every included project needs reports and financial permission on the same grant.</div>}
        {downloadError && <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{downloadError}</div>}
        {query.error && <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{query.error instanceof Error ? query.error.message : "The dynamic report request failed."}</div>}
        {query.isLoading && <Skeleton className="h-[600px] w-full rounded-xl" />}
        {query.data && !query.isLoading && (
          query.data.periods?.length ? (
            <MisAnalyticsPeriodResults periods={query.data.periods} page={page} onPageChange={setPage} />
          ) : query.data.rows.length ? (
            <div className="space-y-6">
              <p className="text-xs text-muted-foreground">Server date basis: <span className="font-medium text-foreground">{query.data.dateBasis}</span>. {query.data.pagination.total.toLocaleString()} merged grouped row(s), including comparison-only groups, across separate currency sections.</p>
              {[...new Set(query.data.rows.map((row) => row.currency))].sort().map((currency) => {
                const rows = query.data.rows.filter((row) => row.currency === currency);
                return (
                  <section key={currency} className="space-y-3" aria-label={`${currency} dynamic report`}>
                    <h2 className="text-xl font-semibold">{currency} grouped results</h2>
                    {rows.map((row, rowIndex) => (
                      <Card key={`${currency}-${rowIndex}-${row.periodStart}-${row.projectId}-${row.serviceCode}`}>
                        <CardHeader className="pb-3">
                          <div className="flex flex-col justify-between gap-2 md:flex-row md:items-start">
                            <div><CardTitle className="text-base">{groups.map((group) => dimensionValue(group, row)).join(" → ")}</CardTitle><CardDescription>{row.periodStart && row.periodEnd ? `${row.periodStart} – ${row.periodEnd}` : "Selected range"} · {row.current.entryCount.toLocaleString()} entries · {row.current.units.length ? row.current.units.join(", ") : "no units"}</CardDescription></div>
                            <div className="flex flex-col items-end gap-1">
                              <DrilldownLinks label="Current entries" filters={row.drilldownFilters} />
                              {row.previousDrilldownFilters && <DrilldownLinks label="Previous entries" filters={row.previousDrilldownFilters} />}
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent className="p-0"><GroupMetricTable currency={currency} row={row} /></CardContent>
                      </Card>
                    ))}
                    {query.data.pagination.pageCount > 1 && (
                      <div className="flex items-center justify-between rounded-lg border bg-card px-4 py-3 text-sm text-muted-foreground"><span>Page {query.data.pagination.page} of {query.data.pagination.pageCount}</span><span className="flex gap-2"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Previous</Button><Button variant="outline" size="sm" disabled={page >= query.data.pagination.pageCount} onClick={() => setPage((current) => current + 1)}>Next</Button></span></div>
                    )}
                  </section>
                );
              })}
            </div>
          ) : <Card><CardContent className="flex min-h-48 flex-col items-center justify-center text-center text-muted-foreground"><p className="font-medium text-foreground">No grouped rows match these filters.</p><p className="mt-1 text-sm">Try a wider fully-contained range, another status, or a different hierarchy.</p></CardContent></Card>
        )}
      </AccessState>
    </div>
  );
}