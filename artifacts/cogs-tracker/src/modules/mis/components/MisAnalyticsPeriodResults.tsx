import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MisAnalyticsCharts, type MisAnalyticsChartPeriod } from "./MisAnalyticsCharts";
import {
  analyticsEntryHrefs,
  type MisAnalyticsMetricKey,
  type MisAnalyticsDrilldownFilters,
  type MisAnalyticsPeriod,
  type MisAnalyticsPeriodResult,
  type MisAnalyticsRow,
} from "../hooks/useMisAnalyticsQuery";

const METRICS: Array<{ key: Extract<MisAnalyticsMetricKey, "totalIncome" | "totalCost" | "totalExpenses" | "totalSalaries" | "netProfit" | "profitMargin">; label: string; percent?: boolean }> = [
  { key: "totalIncome", label: "Income" },
  { key: "totalCost", label: "Cost" },
  { key: "totalExpenses", label: "Expenses" },
  { key: "totalSalaries", label: "Salary" },
  { key: "netProfit", label: "Net profit" },
  { key: "profitMargin", label: "Net margin", percent: true },
];

function value(value: number | undefined, currency: string, percent = false) {
  if (value === undefined || !Number.isFinite(value)) return "—";
  if (percent) return `${value.toFixed(1)}%`;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

function periodCurrency(period: MisAnalyticsPeriodResult, currency: string) {
  return period.totalsByCurrency.find((group) => group.currency === currency);
}

function DrilldownLinks({ filters }: { filters: MisAnalyticsRow["drilldownFilters"] }) {
  const links = analyticsEntryHrefs(filters);
  return links.length === 1
    ? <Link href={links[0].href} className="inline-flex items-center text-xs font-medium text-primary hover:underline">Open entries <ArrowRight className="ml-1 h-3 w-3" /></Link>
    : <details className="text-xs"><summary className="cursor-pointer font-medium text-primary">Open entries ({links.length})</summary><div className="mt-1 flex flex-col gap-1">{links.map((link) => <Link key={link.href} href={link.href} className="text-primary hover:underline">{link.label}</Link>)}</div></details>;
}

export function MisAnalyticsPeriodResults({
  periods,
  onRowClick,
  onPeriodClick,
  periodDrilldownFilters,
  page,
  onPageChange,
}: {
  periods: MisAnalyticsPeriodResult[];
  onRowClick?: (row: MisAnalyticsRow) => void;
  onPeriodClick?: (period: MisAnalyticsPeriod, currency: string) => void;
  periodDrilldownFilters?: (period: MisAnalyticsPeriod, currency: string) => MisAnalyticsDrilldownFilters;
  page?: number;
  onPageChange?: (page: number) => void;
}) {
  const [activePeriod, setActivePeriod] = useState<string | null>(null);
  const currencies = [...new Set(periods.flatMap((period) => period.totalsByCurrency.map((group) => group.currency)))].sort();
  const pageCount = Math.max(1, ...periods.map((period) => period.pagination.pageCount));
  if (!periods.length) return null;
  if (!currencies.length) {
    return <Card><CardContent className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">No data matches the selected comparison periods.</CardContent></Card>;
  }
  return (
    <div className="space-y-6">
      <p className="text-xs text-muted-foreground">Each period is an independent server aggregate. Currencies remain separate and empty periods stay empty.</p>
      {currencies.map((currency) => {
        const firstGroup = periods.map((period) => periodCurrency(period, currency)).find(Boolean);
        if (!firstGroup) return null;
        const chartPeriods: MisAnalyticsChartPeriod[] = periods.flatMap((period) => {
          const group = periodCurrency(period, currency);
          return group ? [{
             period: period.period,
            label: period.period.label,
            currencyGroup: group,
            trend: period.trend.filter((row) => row.currency === currency),
          }] : [];
        });
        const allRows = periods.flatMap((period) => period.rows.filter((row) => row.currency === currency));
        return (
          <section key={currency} className="space-y-4" aria-label={`${currency} period comparison`}>
            <div>
              <h2 className="text-xl font-semibold">{currency} period comparison</h2>
              <p className="text-sm text-muted-foreground">Income, cost, expenses, salary, net profit, and margin use the API's authoritative metric sets.</p>
            </div>
            <Card>
              <CardHeader><CardTitle>Side-by-side metrics</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto p-0">
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="border-y bg-muted/40 text-left text-muted-foreground">
                    <tr><th className="px-4 py-3 font-medium">Metric</th>{periods.map((period) => <th key={period.period.id} className={`px-4 py-3 text-right font-medium ${activePeriod === period.period.id ? "bg-primary/10 text-foreground" : ""}`}><button type="button" className="hover:underline" onClick={() => { setActivePeriod((current) => current === period.period.id ? null : period.period.id); onPeriodClick?.(period.period, currency); }}>{period.period.label}</button>{periodDrilldownFilters && periodCurrency(period, currency) && <div className="mt-1"><DrilldownLinks filters={periodDrilldownFilters(period.period, currency)} /></div>}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y">
                    {METRICS.map((metric) => (
                      <tr key={metric.key}>
                        <td className="px-4 py-2 font-medium">{metric.label}</td>
                        {periods.map((period) => {
                          const group = periodCurrency(period, currency);
                          return <td key={period.period.id} className={`px-4 py-2 text-right ${activePeriod === period.period.id ? "bg-primary/5" : ""}`}>{value(group?.current[metric.key], currency, metric.percent)}</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
            <MisAnalyticsCharts
              currencyGroup={firstGroup}
              trend={firstGroup ? periods[0].trend.filter((row) => row.currency === currency) : []}
              periods={chartPeriods}
              onPointClick={onRowClick}
              onPeriodClick={onPeriodClick}
            />
            {allRows.length > 0 && (
              <Card>
                <CardHeader><CardTitle>Grouped period rows</CardTitle><CardDescription>Rows are server-grouped; click a row to cross-filter the visible analysis or open its exact entries.</CardDescription></CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[720px] text-sm">
                      <thead className="border-y bg-muted/40 text-left text-muted-foreground"><tr><th className="px-4 py-3 font-medium">Period / group</th><th className="px-4 py-3 text-right font-medium">Income</th><th className="px-4 py-3 text-right font-medium">Cost</th><th className="px-4 py-3 text-right font-medium">Net profit</th><th className="px-4 py-3 text-right font-medium">Entries</th><th className="px-4 py-3" /></tr></thead>
                      <tbody className="divide-y">
                        {allRows.map((row, index) => (
                          <tr key={`${row.currency}-${row.periodStart}-${row.projectId}-${row.serviceCode}-${index}`} className="hover:bg-muted/30">
                            <td className="px-4 py-2"><button type="button" className="text-left font-medium hover:underline" onClick={() => onRowClick?.(row)}>{row.periodStart && row.periodEnd ? `${row.periodStart} – ${row.periodEnd}` : "Selected range"}{row.projectName ? ` · ${row.projectName}` : ""}</button></td>
                            <td className="px-4 py-2 text-right">{value(row.current.totalIncome, currency)}</td>
                            <td className="px-4 py-2 text-right">{value(row.current.totalCost, currency)}</td>
                            <td className="px-4 py-2 text-right">{value(row.current.netProfit, currency)}</td>
                            <td className="px-4 py-2 text-right">{row.current.entryCount.toLocaleString()}</td>
                            <td className="px-4 py-2 text-right"><DrilldownLinks filters={row.drilldownFilters} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}
          </section>
        );
      })}
      {page && onPageChange && pageCount > 1 && (
        <div className="flex items-center justify-between rounded-lg border bg-card px-4 py-3 text-sm text-muted-foreground">
          <span>Page {page} of {pageCount}</span>
          <span className="flex gap-2">
            <button type="button" className="rounded-md border px-3 py-1.5 hover:bg-muted disabled:opacity-50" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>Previous</button>
            <button type="button" className="rounded-md border px-3 py-1.5 hover:bg-muted disabled:opacity-50" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>Next</button>
          </span>
        </div>
      )}
    </div>
  );
}
