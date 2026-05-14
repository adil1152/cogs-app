import { useEffect, useMemo, useState } from "react";
import {
  useListProjects,
  useGetAggregateReport,
  useGetTrendsReport,
  useListVisibleServices,
  getListProjectsQueryKey,
  getGetAggregateReportQueryKey,
  getGetTrendsReportQueryKey,
  getListVisibleServicesQueryKey,
} from "@workspace/api-client-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { AppLayout, PageHeader } from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MultiSelect } from "@/components/ui/multi-select";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ServiceDrilldownDialog,
  type ServiceDrilldownTarget,
} from "@/components/ServiceDrilldownDialog";
import { downloadCsv } from "@/lib/csv";
import { formatCurrency, formatNumber, daysAgoISO, todayISO } from "@/lib/format";
import { buildUrl, readSearch, useSyncUrlParams } from "@/lib/return-to";
import { Download } from "lucide-react";
import { ServiceBreakdownRows } from "@/components/ServiceBreakdownRows";
import { useLocation } from "wouter";

export default function Reports() {
  const [, navigate] = useLocation();
  // Filters hydrate from URL on mount so the page is bookmarkable and so
  // "Back to Reports" from a drilled-into entry restores the same view.
  const [from, setFrom] = useState<string>(
    () => readSearch().get("from") ?? daysAgoISO(29),
  );
  const [to, setTo] = useState<string>(
    () => readSearch().get("to") ?? todayISO(),
  );
  const [projectIds, setProjectIds] = useState<string[]>(() => {
    const v = readSearch().get("projectIds");
    return v ? v.split(",").filter(Boolean) : [];
  });
  const [serviceIds, setServiceIds] = useState<string[]>(() => {
    const v = readSearch().get("serviceIds");
    return v ? v.split(",").filter(Boolean) : [];
  });
  const [statuses, setStatuses] = useState<string[]>(() => {
    const v = readSearch().get("statuses");
    return v ? v.split(",").filter(Boolean) : [];
  });
  const [drilldown, setDrilldown] = useState<ServiceDrilldownTarget | null>(null);

  useSyncUrlParams("/reports", { from, to, projectIds, serviceIds, statuses });
  const returnUrl = buildUrl("/reports", { from, to, projectIds, serviceIds, statuses });

  const { data: projects } = useListProjects({
    query: { queryKey: getListProjectsQueryKey() },
  });

  const projectIdsParam =
    projectIds.length > 0 ? { projectIds: projectIds.join(",") } : {};
  const serviceIdsParam =
    serviceIds.length > 0 ? { serviceIds: serviceIds.join(",") } : {};
  const statusesParam =
    statuses.length > 0 && statuses.length < 3
      ? { statuses: statuses.join(",") }
      : {};

  const { data: services } = useListVisibleServices(projectIdsParam, {
    query: { queryKey: getListVisibleServicesQueryKey(projectIdsParam) },
  });

  // Drop any selected service that is no longer available after the project
  // filter changes.
  useEffect(() => {
    if (!services) return;
    const available = new Set(services.map((s) => s.id));
    setServiceIds((prev) => {
      const next = prev.filter((id) => available.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [services]);

  const filterParams = {
    from,
    to,
    ...projectIdsParam,
    ...serviceIdsParam,
    ...statusesParam,
  };

  const statusOptions = [
    { value: "draft", label: "Draft" },
    { value: "pending", label: "Pending approval" },
    { value: "approved", label: "Approved" },
  ];

  const { data: agg } = useGetAggregateReport(filterParams, {
    query: { queryKey: getGetAggregateReportQueryKey(filterParams) },
  });

  const { data: trends } = useGetTrendsReport(filterParams, {
    query: { queryKey: getGetTrendsReportQueryKey(filterParams) },
  });

  const projectOptions = useMemo(
    () =>
      (projects ?? []).map((p) => ({
        value: p.id,
        label: p.name,
        hint: p.location,
      })),
    [projects],
  );

  const serviceOptions = useMemo(
    () =>
      (services ?? []).map((s) => ({
        value: s.id,
        label: s.name,
        hint: s.projectName,
      })),
    [services],
  );

  function exportProjectsCsv() {
    if (!agg) return;
    downloadCsv(
      `report-projects-${from}-to-${to}.csv`,
      ["Project", "Location", "Mandays", "Total cost", "SAR/manday"],
      agg.projectBreakdown.map((p) => [
        p.projectName,
        p.location,
        p.totalMandays,
        p.totalCost,
        p.totalMandays ? p.costPerManday : "",
      ]),
    );
  }

  function exportServicesCsv() {
    if (!agg) return;
    downloadCsv(
      `report-services-${from}-to-${to}.csv`,
      ["Project", "Service", "Kind", "Cost (SAR)", "Mandays", "SAR/manday"],
      agg.serviceBreakdown.map((s) => [
        s.projectName,
        s.serviceName,
        s.kind,
        s.totalCost,
        s.totalMandayContribution,
        s.totalMandayContribution > 0 ? s.costPerManday : "",
      ]),
    );
  }

  const serviceTotals = (agg?.serviceBreakdown ?? []).reduce(
    (acc, s) => ({
      cost: acc.cost + s.totalCost,
      mandays: acc.mandays + s.totalMandayContribution,
    }),
    { cost: 0, mandays: 0 },
  );
  const serviceAvg =
    serviceTotals.mandays > 0 ? serviceTotals.cost / serviceTotals.mandays : 0;

  return (
    <AppLayout>
      <PageHeader
        title="Reports"
        subtitle="Aggregate spend and trends across the projects you can see."
      />

      <div className="px-8 py-6 space-y-6">
        <Card>
          <CardContent className="pt-5">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  From
                </Label>
                <Input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  data-testid="input-from"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  To
                </Label>
                <Input
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  data-testid="input-to"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Projects
                </Label>
                <MultiSelect
                  options={projectOptions}
                  selected={projectIds}
                  onChange={setProjectIds}
                  placeholder="All projects"
                  searchPlaceholder="Search projects…"
                  allLabel="All projects"
                  emptyText="No projects."
                  data-testid="select-projects"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Services
                </Label>
                <MultiSelect
                  options={serviceOptions}
                  selected={serviceIds}
                  onChange={setServiceIds}
                  placeholder="All services"
                  searchPlaceholder="Search services…"
                  allLabel="All services"
                  emptyText={
                    projectIds.length > 0
                      ? "No services in selected projects."
                      : "No services."
                  }
                  disabled={serviceOptions.length === 0}
                  data-testid="select-services"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Status
                </Label>
                <MultiSelect
                  options={statusOptions}
                  selected={statuses}
                  onChange={setStatuses}
                  placeholder="All statuses"
                  searchPlaceholder="Filter…"
                  allLabel="All statuses"
                  emptyText="No statuses."
                  data-testid="select-statuses"
                />
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs text-muted-foreground">
                {projectIds.length === 0
                  ? `All ${projectOptions.length} projects`
                  : `${projectIds.length} of ${projectOptions.length} projects`}
                {" · "}
                {serviceIds.length === 0
                  ? `All ${serviceOptions.length} services`
                  : `${serviceIds.length} of ${serviceOptions.length} services`}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setFrom(daysAgoISO(6));
                    setTo(todayISO());
                  }}
                >
                  7 days
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setFrom(daysAgoISO(29));
                    setTo(todayISO());
                  }}
                >
                  30 days
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setFrom(daysAgoISO(89));
                    setTo(todayISO());
                  }}
                >
                  90 days
                </Button>
                {(projectIds.length > 0 || serviceIds.length > 0 || statuses.length > 0) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setProjectIds([]);
                      setServiceIds([]);
                      setStatuses([]);
                    }}
                    data-testid="button-clear-filters"
                  >
                    Clear filters
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Kpi label="Total cost" value={formatCurrency(agg?.kpi.totalCost ?? 0)} accent />
          <Kpi label="Total mandays" value={formatNumber(agg?.kpi.totalMandays ?? 0, 1)} />
          <Kpi
            label="SAR / manday"
            value={agg?.kpi.totalMandays ? formatCurrency(agg?.kpi.costPerManday ?? 0) : "—"}
          />
          <Kpi label="Entries" value={formatNumber(agg?.kpi.entryCount ?? 0, 0)} />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-72">
              {trends && trends.points.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={trends.points}
                    margin={{ top: 5, right: 12, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11 }}
                      stroke="hsl(var(--muted-foreground))"
                    />
                    <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                    <Tooltip
                      contentStyle={{
                        background: "hsl(var(--popover))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: 6,
                        fontSize: 12,
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="totalCost"
                      name="Total cost"
                      stroke="hsl(var(--accent))"
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="costPerManday"
                      name="SAR/manday"
                      stroke="hsl(var(--chart-3))"
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full grid place-items-center text-sm text-muted-foreground">
                  No data in this range.
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-base">Services breakdown</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                One row per (project × service). Click a row to drill down to its
                entries.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={exportServicesCsv}
              disabled={!agg || agg.serviceBreakdown.length === 0}
              data-testid="button-export-services"
            >
              <Download className="mr-2 h-3.5 w-3.5" /> CSV
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {agg && agg.serviceBreakdown.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Project</TableHead>
                    <TableHead>Service</TableHead>
                    <TableHead className="text-right">Cost (SAR)</TableHead>
                    <TableHead className="text-right">Mandays</TableHead>
                    <TableHead className="text-right">SAR / manday</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {agg.serviceBreakdown.map((s) => (
                    <ServiceBreakdownRows
                      key={`${s.projectId}-${s.serviceId}`}
                      row={s}
                      onOpen={() =>
                        setDrilldown({
                          serviceId: s.serviceId,
                          serviceName: s.serviceName,
                          projectId: s.projectId,
                          projectName: s.projectName,
                          from,
                          to,
                          scopeToProject: true,
                          returnTo: returnUrl,
                        })
                      }
                      testId={`report-service-row-${s.projectId}-${s.serviceId}`}
                    />
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={2} className="font-medium">
                      Totals · {agg.serviceBreakdown.length} service
                      {agg.serviceBreakdown.length === 1 ? "" : "s"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">
                      {formatCurrency(serviceTotals.cost)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">
                      {formatNumber(serviceTotals.mandays, 2)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">
                      {serviceTotals.mandays > 0
                        ? formatCurrency(serviceAvg)
                        : "—"}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            ) : (
              <div className="px-6 py-10 text-sm text-muted-foreground text-center">
                No service data.
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">By project</CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={exportProjectsCsv}
                disabled={!agg}
                data-testid="button-export-projects"
              >
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
                      <TableRow
                        key={p.projectId}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => navigate(`/projects/${p.projectId}/summary`)}
                        data-testid={`report-project-row-${p.projectId}`}
                      >
                        <TableCell>
                          <div className="font-medium">{p.projectName}</div>
                          <div className="text-xs text-muted-foreground">{p.location}</div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatNumber(p.totalMandays, 1)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(p.totalCost)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {p.totalMandays ? formatCurrency(p.costPerManday) : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="px-6 py-10 text-sm text-muted-foreground text-center">
                  No project data.
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <ServiceDrilldownDialog
        target={drilldown}
        onClose={() => setDrilldown(null)}
      />
    </AppLayout>
  );
}

function Kpi({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <Card className={accent ? "border-accent/40 bg-accent/5" : ""}>
      <CardContent className="pt-5">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
          {label}
        </div>
        <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}
