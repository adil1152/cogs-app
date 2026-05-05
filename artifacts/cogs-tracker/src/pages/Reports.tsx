import { useState } from "react";
import {
  useListProjects,
  useGetAggregateReport,
  useGetTrendsReport,
  getListProjectsQueryKey,
  getGetAggregateReportQueryKey,
  getGetTrendsReportQueryKey,
} from "@workspace/api-client-react";
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell,
} from "recharts";
import { AppLayout, PageHeader } from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { downloadCsv } from "@/lib/csv";
import { formatCurrency, formatNumber, daysAgoISO, todayISO } from "@/lib/format";
import { Download } from "lucide-react";

const CHART_COLORS = ["hsl(var(--accent))", "hsl(var(--chart-3))", "hsl(var(--chart-4))", "hsl(var(--chart-5))", "hsl(var(--primary))"];

export default function Reports() {
  const [from, setFrom] = useState(daysAgoISO(29));
  const [to, setTo] = useState(todayISO());
  const [projectId, setProjectId] = useState<string>("all");

  const { data: projects } = useListProjects({ query: { queryKey: getListProjectsQueryKey() } });
  const filterParams = {
    from, to,
    ...(projectId !== "all" ? { projectId } : {}),
  };
  const { data: agg } = useGetAggregateReport(filterParams, {
    query: { queryKey: getGetAggregateReportQueryKey(filterParams) },
  });
  const { data: trends } = useGetTrendsReport(filterParams, {
    query: { queryKey: getGetTrendsReportQueryKey(filterParams) },
  });

  function exportProjectsCsv() {
    if (!agg) return;
    downloadCsv(
      `report-projects-${from}-to-${to}.csv`,
      ["Project", "Location", "Mandays", "Total cost", "$/manday"],
      agg.projectBreakdown.map((p) => [p.projectName, p.location, p.totalMandays, p.totalCost, p.totalMandays ? p.costPerManday : ""]),
    );
  }
  function exportServicesCsv() {
    if (!agg) return;
    downloadCsv(
      `report-services-${from}-to-${to}.csv`,
      ["Service", "Kind", "Total cost", "Manday contribution"],
      agg.serviceBreakdown.map((s) => [s.serviceName, s.kind, s.totalCost, s.totalMandayContribution]),
    );
  }

  return (
    <AppLayout>
      <PageHeader
        title="Reports"
        subtitle="Aggregate spend and trends across the projects you can see."
      />
      <div className="px-8 py-6 space-y-6">
        <Card>
          <CardContent className="pt-5 flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">From</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="input-from" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">To</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} data-testid="input-to" />
            </div>
            <div className="space-y-1.5 min-w-[200px]">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Project</Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger data-testid="select-project"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All projects</SelectItem>
                  {(projects ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="ml-auto flex gap-2">
              <Button variant="outline" size="sm" onClick={() => { setFrom(daysAgoISO(6)); setTo(todayISO()); }}>7 days</Button>
              <Button variant="outline" size="sm" onClick={() => { setFrom(daysAgoISO(29)); setTo(todayISO()); }}>30 days</Button>
              <Button variant="outline" size="sm" onClick={() => { setFrom(daysAgoISO(89)); setTo(todayISO()); }}>90 days</Button>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Kpi label="Total cost" value={formatCurrency(agg?.kpi.totalCost ?? 0)} accent />
          <Kpi label="Total mandays" value={formatNumber(agg?.kpi.totalMandays ?? 0, 1)} />
          <Kpi label="$ / manday" value={agg?.kpi.totalMandays ? formatCurrency(agg?.kpi.costPerManday ?? 0) : "—"} />
          <Kpi label="Entries" value={formatNumber(agg?.kpi.entryCount ?? 0, 0)} />
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">Trend</CardTitle></CardHeader>
          <CardContent>
            <div className="h-72">
              {trends && trends.points.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trends.points} margin={{ top: 5, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                    <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                    <Tooltip
                      contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 12 }}
                    />
                    <Line type="monotone" dataKey="totalCost" name="Total cost" stroke="hsl(var(--accent))" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="costPerManday" name="$/manday" stroke="hsl(var(--chart-3))" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full grid place-items-center text-sm text-muted-foreground">No data in this range.</div>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Service breakdown</CardTitle>
              <Button variant="outline" size="sm" onClick={exportServicesCsv} disabled={!agg} data-testid="button-export-services">
                <Download className="mr-2 h-3.5 w-3.5" /> CSV
              </Button>
            </CardHeader>
            <CardContent>
              <div className="h-64 mb-3">
                {agg && agg.serviceBreakdown.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart layout="vertical" data={agg.serviceBreakdown} margin={{ top: 5, right: 12, left: 8, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis type="number" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                      <YAxis type="category" dataKey="serviceName" width={110} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                      <Tooltip
                        contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 12 }}
                        formatter={(v: number) => formatCurrency(v)}
                      />
                      <Bar dataKey="totalCost">
                        {agg.serviceBreakdown.map((_, i) => (
                          <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full grid place-items-center text-sm text-muted-foreground">No service data.</div>
                )}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">By project</CardTitle>
              <Button variant="outline" size="sm" onClick={exportProjectsCsv} disabled={!agg} data-testid="button-export-projects">
                <Download className="mr-2 h-3.5 w-3.5" /> CSV
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              {agg && agg.projectBreakdown.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Project</TableHead>
                      <TableHead className="text-right">Mandays</TableHead>
                      <TableHead className="text-right">Total cost</TableHead>
                      <TableHead className="text-right">$ / manday</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {agg.projectBreakdown.map((p) => (
                      <TableRow key={p.projectId}>
                        <TableCell>
                          <div className="font-medium">{p.projectName}</div>
                          <div className="text-xs text-muted-foreground">{p.location}</div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumber(p.totalMandays, 1)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatCurrency(p.totalCost)}</TableCell>
                        <TableCell className="text-right tabular-nums">{p.totalMandays ? formatCurrency(p.costPerManday) : "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="px-6 py-10 text-sm text-muted-foreground text-center">No project data.</div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <Card className={accent ? "border-accent/40 bg-accent/5" : ""}>
      <CardContent className="pt-5">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">{label}</div>
        <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}
