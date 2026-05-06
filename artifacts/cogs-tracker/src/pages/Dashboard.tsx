import { useMemo } from "react";
import { Link } from "wouter";
import {
  useGetDashboard,
  useGetRecentActivity,
  useGetTrendsReport,
  getGetDashboardQueryKey,
  getGetRecentActivityQueryKey,
  getGetTrendsReportQueryKey,
} from "@workspace/api-client-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
} from "recharts";
import { AppLayout, PageHeader } from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatNumber, formatDate, todayISO } from "@/lib/format";
import { ArrowRight } from "lucide-react";

const CHART_COLORS = ["hsl(var(--accent))", "hsl(var(--chart-3))", "hsl(var(--chart-4))", "hsl(var(--chart-5))", "hsl(var(--primary))"];

function startOfMonthISO(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10);
}

function monthLabel(): string {
  return new Date().toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
}

export default function Dashboard() {
  const { data: dashboard, isLoading } = useGetDashboard({
    query: { queryKey: getGetDashboardQueryKey() },
  });
  const { data: activity } = useGetRecentActivity({
    query: { queryKey: getGetRecentActivityQueryKey() },
  });
  const trendsParams = useMemo(
    () => ({ from: startOfMonthISO(), to: todayISO() }),
    [],
  );
  const { data: trends } = useGetTrendsReport(trendsParams, {
    query: { queryKey: getGetTrendsReportQueryKey(trendsParams) },
  });

  const mtd = dashboard?.monthToDate;

  return (
    <AppLayout>
      <PageHeader
        title="Dashboard"
        subtitle={`Live spend across every project you can see — ${monthLabel()}.`}
        actions={
          <Link href="/reports">
            <Button variant="outline" data-testid="button-reports">
              Open reports <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        }
      />
      <div className="px-8 py-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <KpiCard
            label="Total cost"
            value={formatCurrency(mtd?.totalCost ?? 0)}
            loading={isLoading}
            accent
            testid="kpi-mtd-cost"
          />
          <KpiCard
            label="Mandays"
            value={formatNumber(mtd?.totalMandays ?? 0, 1)}
            loading={isLoading}
            testid="kpi-mtd-mandays"
          />
          <KpiCard
            label="SAR / manday"
            value={
              mtd && mtd.totalMandays
                ? formatCurrency(mtd.costPerManday)
                : "—"
            }
            loading={isLoading}
            testid="kpi-mtd-cpm"
          />
          <KpiCard
            label="Entries"
            value={formatNumber(mtd?.entryCount ?? 0, 0)}
            loading={isLoading}
            testid="kpi-mtd-entries"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">
                Month-to-date trend
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                {trends && trends.points.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trends.points} margin={{ top: 5, right: 12, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                      <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                      <Tooltip
                        contentStyle={{
                          background: "hsl(var(--popover))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: 6,
                          fontSize: 12,
                        }}
                        formatter={(v: number, name: string) =>
                          name === "totalCost" ? [formatCurrency(v), "Total cost"] : [formatNumber(v), "Cost / manday"]
                        }
                      />
                      <Line type="monotone" dataKey="totalCost" stroke="hsl(var(--accent))" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="costPerManday" stroke="hsl(var(--chart-3))" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <Empty>No entries yet this month.</Empty>
                )}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent activity</CardTitle>
            </CardHeader>
            <CardContent className="px-0">
              <ul className="divide-y divide-border">
                {activity && activity.length > 0 ? (
                  activity.slice(0, 8).map((it) => (
                    <li key={it.id} className="hover:bg-muted/40 transition-colors">
                      <Link href={`/projects/${it.projectId}/entries/${it.id}`}>
                        <a className="block px-6 py-3" data-testid={`activity-${it.id}`}>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium truncate">{it.projectName}</span>
                            <span className="text-xs text-muted-foreground tabular-nums">
                              {formatCurrency(it.totalCost)}
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {formatDate(it.entryDate)} · {formatNumber(it.totalMandays, 1)} mandays
                            {it.createdByName ? ` · by ${it.createdByName}` : ""}
                          </div>
                        </a>
                      </Link>
                    </li>
                  ))
                ) : (
                  <li className="px-6 py-8"><Empty>No recent activity yet.</Empty></li>
                )}
              </ul>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Service breakdown — month to date</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                {dashboard && dashboard.serviceBreakdown.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart layout="vertical" data={dashboard.serviceBreakdown} margin={{ top: 5, right: 12, left: 8, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis type="number" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                      <YAxis type="category" dataKey="serviceName" width={110} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                      <Tooltip
                        contentStyle={{
                          background: "hsl(var(--popover))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: 6,
                          fontSize: 12,
                        }}
                        formatter={(v: number) => formatCurrency(v)}
                      />
                      <Bar dataKey="totalCost">
                        {dashboard.serviceBreakdown.map((_, i) => (
                          <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <Empty>No service spend logged yet this month.</Empty>
                )}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Project comparison — month to date</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                {dashboard && dashboard.projectBreakdown.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={dashboard.projectBreakdown} margin={{ top: 5, right: 12, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="projectName" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                      <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                      <Tooltip
                        contentStyle={{
                          background: "hsl(var(--popover))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: 6,
                          fontSize: 12,
                        }}
                        formatter={(v: number) => formatCurrency(v)}
                      />
                      <Bar dataKey="totalCost">
                        {dashboard.projectBreakdown.map((_, i) => (
                          <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <Empty>No project totals yet this month.</Empty>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}

function KpiCard({
  label,
  value,
  loading,
  accent,
  testid,
}: {
  label: string;
  value: string;
  loading?: boolean;
  accent?: boolean;
  testid?: string;
}) {
  return (
    <Card className={accent ? "border-accent/40 bg-accent/5" : ""}>
      <CardContent className="pt-5">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
          {label}
        </div>
        <div
          className="mt-1 text-2xl font-semibold tabular-nums"
          data-testid={testid}
        >
          {loading ? "—" : value}
        </div>
      </CardContent>
    </Card>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full grid place-items-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
