import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  type MisAnalyticsCurrencyTotals,
  type MisAnalyticsMetricKey,
  type MisAnalyticsPeriod,
  type MisAnalyticsRow,
} from "../hooks/useMisAnalyticsQuery";

type ChartMetric = Extract<
  MisAnalyticsMetricKey,
  "totalIncome" | "totalCost" | "totalExpenses" | "totalSalaries" | "netProfit" | "profitMargin"
>;
type ChartKind = "line" | "bar";

const CHARTS: Array<{ key: ChartMetric; label: string; contribution?: keyof MisAnalyticsCurrencyTotals["current"] }> = [
  { key: "totalIncome", label: "Income", contribution: "incomeContributionPercent" },
  { key: "totalCost", label: "Cost", contribution: "costContributionPercent" },
  { key: "totalExpenses", label: "Expenses", contribution: "expensesContributionPercent" },
  { key: "totalSalaries", label: "Salary", contribution: "salariesContributionPercent" },
  { key: "netProfit", label: "Net margin / profit" },
  { key: "profitMargin", label: "Net margin %" },
];

const DEFAULT_METRICS = CHARTS.map((chart) => chart.key);

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function formatMetric(value: number, key: ChartMetric, currency: string) {
  if (key === "profitMargin") return `${value.toFixed(1)}%`;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

function periodLabel(row: MisAnalyticsRow) {
  if (!row.periodStart) return "Selected range";
  if (row.periodEnd && row.periodEnd !== row.periodStart) return `${row.periodStart} – ${row.periodEnd}`;
  return row.periodStart;
}

export interface MisAnalyticsChartPeriod {
  period: MisAnalyticsPeriod;
  label: string;
  currencyGroup: MisAnalyticsCurrencyTotals;
  trend: MisAnalyticsRow[];
}

export function MisAnalyticsCharts({
  currencyGroup,
  trend,
  periods = [],
  onPointClick,
  onPeriodClick,
}: {
  currencyGroup: MisAnalyticsCurrencyTotals;
  trend: MisAnalyticsRow[];
  periods?: MisAnalyticsChartPeriod[];
  onPointClick?: (row: MisAnalyticsRow) => void;
  onPeriodClick?: (period: MisAnalyticsPeriod, currency: string) => void;
}) {
  const [chartKind, setChartKind] = useState<ChartKind>("line");
  const [selectedMetrics, setSelectedMetrics] = useState<ChartMetric[]>(DEFAULT_METRICS);
  const [visibleSeries, setVisibleSeries] = useState({ current: true, comparison: true });
  const periodMode = periods.length > 0;

  function toggleMetric(metric: ChartMetric) {
    setSelectedMetrics((current) =>
      current.includes(metric)
        ? current.length === 1 ? current : current.filter((item) => item !== metric)
        : [...current, metric],
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm font-medium">Metrics and chart view</p>
          <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Visible metrics">
            {CHARTS.map((chart) => (
              <Button
                key={chart.key}
                type="button"
                size="sm"
                variant={selectedMetrics.includes(chart.key) ? "secondary" : "outline"}
                aria-pressed={selectedMetrics.includes(chart.key)}
                onClick={() => toggleMetric(chart.key)}
              >
                {chart.label}
              </Button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <ToggleGroup type="single" value={chartKind} onValueChange={(value) => value && setChartKind(value as ChartKind)} aria-label="Chart type">
            <ToggleGroupItem value="line" aria-label="Line charts">Line</ToggleGroupItem>
            <ToggleGroupItem value="bar" aria-label="Bar charts">Bar</ToggleGroupItem>
          </ToggleGroup>
          <div className="flex gap-1 text-xs">
            {(["current", "comparison"] as const).map((seriesName) => (
              <Button
                key={seriesName}
                type="button"
                variant="ghost"
                size="sm"
                className="h-8"
                aria-pressed={visibleSeries[seriesName]}
                onClick={() => setVisibleSeries((current) => ({ ...current, [seriesName]: !current[seriesName] }))}
              >
                <span className={`mr-1.5 inline-block h-2.5 w-2.5 rounded-full ${seriesName === "current" ? "bg-primary" : "bg-muted-foreground"}`} />
                {seriesName === "current" ? "Current" : "Previous"}
              </Button>
            ))}
          </div>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {CHARTS.filter((chart) => selectedMetrics.includes(chart.key)).map((chart) => {
          const chartPoints = periodMode
            ? periods.map((period) => ({
              label: period.label,
              value: number(period.currencyGroup.current[chart.key]),
              comparison: undefined,
              period: period.period,
              row: undefined,
            }))
            : trend
              .filter((row) => row.currency === currencyGroup.currency)
              .map((row) => ({
                label: periodLabel(row),
                value: number(row.current[chart.key]),
                comparison: row.previous ? number(row.previous[chart.key]) : undefined,
                row,
              }));
          const currentValue = number(currencyGroup.current[chart.key]);
          const contribution = chart.contribution
            ? number(currencyGroup.current[chart.contribution])
            : undefined;
          const hasComparison = !periodMode && chartPoints.some((point) => point.comparison !== undefined);
          return (
            <Card key={chart.key}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{chart.label}</CardTitle>
                <CardDescription className="flex flex-wrap gap-x-2 gap-y-1">
                  <span>{formatMetric(currentValue, chart.key, currencyGroup.currency)} current</span>
                  {contribution !== undefined && <span>· {contribution.toFixed(1)}% of total</span>}
                  {chart.key === "profitMargin" && <span>· server-calculated safe margin</span>}
                </CardDescription>
              </CardHeader>
              <CardContent className="h-64">
                {chartPoints.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    {chartKind === "bar" ? (
                      <BarChart data={chartPoints} onClick={(state) => {
                        const row = state?.activePayload?.[0]?.payload?.row as MisAnalyticsRow | undefined;
                         if (row) onPointClick?.(row);
                         else {
                           const period = state?.activePayload?.[0]?.payload?.period as MisAnalyticsPeriod | undefined;
                           if (period) onPeriodClick?.(period, currencyGroup.currency);
                         }
                      }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} />
                        <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10 }} />
                        <Tooltip formatter={(value: number) => formatMetric(value, chart.key, currencyGroup.currency)} />
                        {visibleSeries.current && <Bar dataKey="value" name="Current" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} cursor="pointer" />}
                        {hasComparison && visibleSeries.comparison && <Bar dataKey="comparison" name="Previous" fill="hsl(var(--muted-foreground))" radius={[4, 4, 0, 0]} />}
                      </BarChart>
                    ) : (
                      <LineChart data={chartPoints} onClick={(state) => {
                        const row = state?.activePayload?.[0]?.payload?.row as MisAnalyticsRow | undefined;
                         if (row) onPointClick?.(row);
                         else {
                           const period = state?.activePayload?.[0]?.payload?.period as MisAnalyticsPeriod | undefined;
                           if (period) onPeriodClick?.(period, currencyGroup.currency);
                         }
                      }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} />
                        <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10 }} />
                        <Tooltip formatter={(value: number) => formatMetric(value, chart.key, currencyGroup.currency)} />
                        {visibleSeries.current && <Line type="monotone" dataKey="value" name="Current" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3, cursor: "pointer" }} />}
                        {hasComparison && visibleSeries.comparison && <Line type="monotone" dataKey="comparison" name="Previous" stroke="hsl(var(--muted-foreground))" strokeWidth={2} dot={{ r: 3, cursor: "pointer" }} />}
                      </LineChart>
                    )}
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No trend rows for this currency and filter range.</div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}