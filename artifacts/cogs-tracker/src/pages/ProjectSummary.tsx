import { useState } from "react";
import { Link, useRoute } from "wouter";
import {
  useGetProject,
  useGetProjectSummary,
  getGetProjectQueryKey,
  getGetProjectSummaryQueryKey,
} from "@workspace/api-client-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell,
} from "recharts";
import { AppLayout, PageHeader } from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { downloadCsv } from "@/lib/csv";
import { formatCurrency, formatNumber, formatDate, daysAgoISO, todayISO } from "@/lib/format";
import { ArrowLeft, Download, Lock } from "lucide-react";

const CHART_COLORS = ["hsl(var(--accent))", "hsl(var(--chart-3))", "hsl(var(--chart-4))", "hsl(var(--chart-5))", "hsl(var(--primary))"];

export default function ProjectSummary() {
  const [, params] = useRoute("/projects/:id/summary");
  const id = params?.id ?? "";
  const [from, setFrom] = useState(daysAgoISO(29));
  const [to, setTo] = useState(todayISO());

  const { data: project } = useGetProject(id, {
    query: { enabled: !!id, queryKey: getGetProjectQueryKey(id) },
  });
  const params2 = { from, to };
  const { data: summary, error, isLoading } = useGetProjectSummary(id, params2, {
    query: { enabled: !!id, queryKey: getGetProjectSummaryQueryKey(id, params2), retry: false },
  });

  const isForbidden = (error as any)?.status === 403;

  function handleExport() {
    if (!summary) return;
    downloadCsv(
      `${project?.name ?? "project"}-summary-${from}-to-${to}.csv`,
      ["Date", "Location", "Total mandays", "Total cost", "Cost/manday"],
      summary.dailyEntries.map((e) => [
        e.entryDate, e.location, e.totalMandays, e.totalCost, e.totalMandays ? e.costPerManday : "",
      ]),
    );
  }

  return (
    <AppLayout>
      <PageHeader
        title={project ? `${project.name} — summary` : "Summary"}
        subtitle={`${formatDate(from)} → ${formatDate(to)}`}
        actions={
          <div className="flex gap-2">
            <Link href={`/projects/${id}`}><Button variant="outline"><ArrowLeft className="mr-2 h-4 w-4" /> Project</Button></Link>
            <Button onClick={handleExport} disabled={!summary} data-testid="button-export-summary">
              <Download className="mr-2 h-4 w-4" /> CSV
            </Button>
          </div>
        }
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
            <div className="ml-auto flex gap-2">
              <Button variant="outline" size="sm" onClick={() => { setFrom(daysAgoISO(6)); setTo(todayISO()); }}>7 days</Button>
              <Button variant="outline" size="sm" onClick={() => { setFrom(daysAgoISO(29)); setTo(todayISO()); }}>30 days</Button>
              <Button variant="outline" size="sm" onClick={() => { setFrom(daysAgoISO(89)); setTo(todayISO()); }}>90 days</Button>
            </div>
          </CardContent>
        </Card>

        {isForbidden ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Lock className="h-6 w-6 mx-auto mb-3 text-muted-foreground" />
              <div className="font-medium">You don't have access to this summary.</div>
              <p className="text-sm text-muted-foreground mt-1">
                Ask an admin to grant you "View summary" permission on this project.
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Kpi label="Total cost" value={formatCurrency(summary?.kpi.totalCost ?? 0)} accent />
              <Kpi label="Total mandays" value={formatNumber(summary?.kpi.totalMandays ?? 0, 1)} />
              <Kpi label="$ / manday" value={summary?.kpi.totalMandays ? formatCurrency(summary?.kpi.costPerManday ?? 0) : "—"} />
              <Kpi label="Entries" value={formatNumber(summary?.kpi.entryCount ?? 0, 0)} />
            </div>
            <Card>
              <CardHeader><CardTitle className="text-base">Service breakdown</CardTitle></CardHeader>
              <CardContent>
                <div className="h-64">
                  {summary && summary.serviceBreakdown.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart layout="vertical" data={summary.serviceBreakdown} margin={{ top: 5, right: 12, left: 8, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis type="number" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                        <YAxis type="category" dataKey="serviceName" width={110} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                        <Tooltip
                          contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 12 }}
                          formatter={(v: number) => formatCurrency(v)}
                        />
                        <Bar dataKey="totalCost">
                          {summary.serviceBreakdown.map((_, i) => (
                            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-full grid place-items-center text-sm text-muted-foreground">
                      {isLoading ? "Loading…" : "No service spend in this range."}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Daily entries</CardTitle></CardHeader>
              <CardContent className="p-0">
                {summary && summary.dailyEntries.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Location</TableHead>
                        <TableHead className="text-right">Mandays</TableHead>
                        <TableHead className="text-right">Total cost</TableHead>
                        <TableHead className="text-right">$ / manday</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {summary.dailyEntries.map((e) => (
                        <TableRow key={e.id}>
                          <TableCell className="font-medium">{formatDate(e.entryDate)}</TableCell>
                          <TableCell>{e.location}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatNumber(e.totalMandays, 1)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatCurrency(e.totalCost)}</TableCell>
                          <TableCell className="text-right tabular-nums">{e.totalMandays ? formatCurrency(e.costPerManday) : "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="px-6 py-12 text-center text-sm text-muted-foreground">No entries in this range.</div>
                )}
              </CardContent>
            </Card>
          </>
        )}
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
