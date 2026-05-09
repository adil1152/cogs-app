import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import {
  useGetProject,
  useGetProjectSummary,
  useListProjectServices,
  getGetProjectQueryKey,
  getGetProjectSummaryQueryKey,
  getListProjectServicesQueryKey,
} from "@workspace/api-client-react";
import { AppLayout, PageHeader } from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MultiSelect } from "@/components/ui/multi-select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ServiceDrilldownDialog, type ServiceDrilldownTarget } from "@/components/ServiceDrilldownDialog";
import { downloadCsv } from "@/lib/csv";
import { formatCurrency, formatNumber, formatDate, daysAgoISO, todayISO } from "@/lib/format";
import { ArrowLeft, ArrowRight, Download, Lock } from "lucide-react";

export default function ProjectSummary() {
  const [, params] = useRoute("/projects/:id/summary");
  const id = params?.id ?? "";
  const [, navigate] = useLocation();
  const [from, setFrom] = useState(daysAgoISO(29));
  const [to, setTo] = useState(todayISO());
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [drilldown, setDrilldown] = useState<ServiceDrilldownTarget | null>(null);

  const { data: project } = useGetProject(id, {
    query: { enabled: !!id, queryKey: getGetProjectQueryKey(id) },
  });

  const { data: services } = useListProjectServices(id, {
    query: { enabled: !!id, queryKey: getListProjectServicesQueryKey(id) },
  });

  // Drop selected service IDs that no longer exist on the project.
  useEffect(() => {
    if (!services) return;
    const available = new Set(services.map((s) => s.id));
    setServiceIds((prev) => {
      const next = prev.filter((sid) => available.has(sid));
      return next.length === prev.length ? prev : next;
    });
  }, [services]);

  const queryParams = useMemo(
    () => ({
      from,
      to,
      ...(serviceIds.length > 0 ? { serviceIds: serviceIds.join(",") } : {}),
    }),
    [from, to, serviceIds],
  );

  const { data: summary, error, isLoading } = useGetProjectSummary(id, queryParams, {
    query: {
      enabled: !!id,
      queryKey: getGetProjectSummaryQueryKey(id, queryParams),
      retry: false,
    },
  });

  const isForbidden = (error as { status?: number } | null)?.status === 403;

  const serviceOptions = useMemo(
    () =>
      (services ?? []).map((s) => ({
        value: s.id,
        label: s.name,
        hint: s.kind === "food" ? "Food (meal-weighted)" : "Standard",
      })),
    [services],
  );

  function handleExport() {
    if (!summary) return;
    const filterTag =
      serviceIds.length > 0 ? `-${serviceIds.length}svc` : "";
    downloadCsv(
      `${project?.name ?? "project"}-summary-${from}-to-${to}${filterTag}.csv`,
      ["Date", "Location", "Total mandays", "Total cost", "SAR/manday"],
      summary.dailyEntries.map((e) => [
        e.entryDate, e.location, e.totalMandays, e.totalCost, e.totalMandays ? e.costPerManday : "",
      ]),
    );
  }

  return (
    <AppLayout>
      <PageHeader
        title={project ? `${project.name} — summary` : "Summary"}
        subtitle={`${formatDate(from)} → ${formatDate(to)}${
          serviceIds.length > 0 ? ` · ${serviceIds.length} of ${serviceOptions.length} services` : ""
        }`}
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
          <CardContent className="pt-5">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">From</Label>
                <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="input-from" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">To</Label>
                <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} data-testid="input-to" />
              </div>
              <div className="md:col-span-2 space-y-1.5">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Services</Label>
                <MultiSelect
                  options={serviceOptions}
                  selected={serviceIds}
                  onChange={setServiceIds}
                  placeholder="All services"
                  searchPlaceholder="Search services…"
                  allLabel="All services"
                  emptyText="No services on this project."
                  disabled={serviceOptions.length === 0}
                  data-testid="select-services"
                />
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs text-muted-foreground">
                {serviceIds.length === 0
                  ? `All ${serviceOptions.length} services included`
                  : `${serviceIds.length} of ${serviceOptions.length} services included — totals are recomputed from chosen services only.`}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => { setFrom(daysAgoISO(6)); setTo(todayISO()); }}>7 days</Button>
                <Button variant="outline" size="sm" onClick={() => { setFrom(daysAgoISO(29)); setTo(todayISO()); }}>30 days</Button>
                <Button variant="outline" size="sm" onClick={() => { setFrom(daysAgoISO(89)); setTo(todayISO()); }}>90 days</Button>
                {serviceIds.length > 0 && (
                  <Button variant="ghost" size="sm" onClick={() => setServiceIds([])} data-testid="button-clear-services">
                    Clear services
                  </Button>
                )}
              </div>
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
              <Kpi label="SAR / manday" value={summary?.kpi.totalMandays ? formatCurrency(summary?.kpi.costPerManday ?? 0) : "—"} />
              <Kpi label="Entries" value={formatNumber(summary?.kpi.entryCount ?? 0, 0)} />
            </div>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Services breakdown</CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  Click a service to see every entry it appears in.
                </p>
              </CardHeader>
              <CardContent className="p-0">
                {summary && summary.serviceBreakdown.length > 0 ? (
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
                      {summary.serviceBreakdown.map((s) => (
                        <TableRow
                          key={`${s.projectId}-${s.serviceId}`}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() =>
                            setDrilldown({
                              serviceId: s.serviceId,
                              serviceName: s.serviceName,
                              projectId: s.projectId,
                              projectName: s.projectName,
                              from,
                              to,
                              scopeToProject: true,
                            })
                          }
                          data-testid={`summary-service-row-${s.serviceId}`}
                        >
                          <TableCell>{s.projectName}</TableCell>
                          <TableCell>
                            <div className="font-medium">{s.serviceName}</div>
                            <div className="text-xs text-muted-foreground capitalize">
                              {s.kind}
                            </div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCurrency(s.totalCost)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatNumber(s.totalMandayContribution, 2)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {s.totalMandayContribution > 0
                              ? formatCurrency(s.costPerManday)
                              : "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                    <TableFooter>
                      {(() => {
                        const t = summary.serviceBreakdown.reduce(
                          (a, s) => ({
                            cost: a.cost + s.totalCost,
                            mandays: a.mandays + s.totalMandayContribution,
                          }),
                          { cost: 0, mandays: 0 },
                        );
                        const avg = t.mandays > 0 ? t.cost / t.mandays : 0;
                        return (
                          <TableRow>
                            <TableCell colSpan={2} className="font-medium">
                              Totals · {summary.serviceBreakdown.length} service
                              {summary.serviceBreakdown.length === 1 ? "" : "s"}
                            </TableCell>
                            <TableCell className="text-right tabular-nums font-semibold">
                              {formatCurrency(t.cost)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums font-semibold">
                              {formatNumber(t.mandays, 2)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums font-semibold">
                              {t.mandays > 0 ? formatCurrency(avg) : "—"}
                            </TableCell>
                          </TableRow>
                        );
                      })()}
                    </TableFooter>
                  </Table>
                ) : (
                  <div className="px-6 py-10 text-center text-sm text-muted-foreground">
                    {isLoading ? "Loading…" : "No service spend in this range."}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Daily entries</CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  Click any row to open the entry.
                </p>
              </CardHeader>
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
                        <TableHead className="w-10" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {summary.dailyEntries.map((e) => (
                        <TableRow
                          key={e.id}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => navigate(`/projects/${id}/entries/${e.id}`)}
                          data-testid={`summary-entry-row-${e.id}`}
                        >
                          <TableCell className="font-medium">{formatDate(e.entryDate)}</TableCell>
                          <TableCell>{e.location}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatNumber(e.totalMandays, 1)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatCurrency(e.totalCost)}</TableCell>
                          <TableCell className="text-right tabular-nums">{e.totalMandays ? formatCurrency(e.costPerManday) : "—"}</TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            <ArrowRight className="h-4 w-4 inline" />
                          </TableCell>
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

      <ServiceDrilldownDialog
        target={drilldown}
        onClose={() => setDrilldown(null)}
      />
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
