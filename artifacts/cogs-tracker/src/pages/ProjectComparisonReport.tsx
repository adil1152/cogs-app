import { useEffect, useMemo, useState } from "react";
import {
  useListProjects,
  useListVisibleServices,
  useGetAggregateReport,
  getListProjectsQueryKey,
  getListVisibleServicesQueryKey,
  getGetAggregateReportQueryKey,
} from "@workspace/api-client-react";
import { AppLayout, PageHeader } from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { MultiSelect } from "@/components/ui/multi-select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
  formatCurrency,
  formatNumber,
  formatDate,
  daysAgoISO,
  todayISO,
} from "@/lib/format";
import { readSearch, useSyncUrlParams } from "@/lib/return-to";
import { Download, SlidersHorizontal } from "lucide-react";
import { ColorDot } from "@/components/ColorDot";
import { tintBgStyle, resolveServiceColor } from "@/lib/serviceColor";
import {
  SortableHead,
  sortRows,
  useSortState,
} from "@/components/SortableHead";

type Metric = "cost" | "mandays" | "avg";

const METRIC_LABEL: Record<Metric, string> = {
  cost: "Cost (SAR)",
  mandays: "Mandays",
  avg: "SAR / manday",
};

function safeAvg(cost: number, mandays: number): number | null {
  return mandays > 0 ? cost / mandays : null;
}

type CompMetric = "qty" | "cost" | "mandays" | "avg";

/** A component (meal type or sub-service) merged by name across projects. */
interface CompCell {
  key: string;
  name: string;
  kind: "meal" | "sub";
  qty: number;
  cost: number;
  mandays: number;
}

/** One rendered column inside a service group. */
interface SvcCol {
  type: "metric" | "comp";
  metric?: Metric;
  compKey?: string;
  compMetric?: CompMetric;
  label: string;
  sortKey: string;
}

function compColValue(
  cell: { totalCost: number; totalMandays: number; components: Map<string, CompCell> } | undefined,
  col: SvcCol,
): number | null {
  if (!cell) return null;
  if (col.type === "metric") {
    if (col.metric === "cost") return cell.totalCost;
    if (col.metric === "mandays") return cell.totalMandays;
    return safeAvg(cell.totalCost, cell.totalMandays);
  }
  const comp = cell.components.get(col.compKey!);
  if (!comp) return null;
  if (col.compMetric === "qty") return comp.qty;
  if (col.compMetric === "cost") return comp.cost;
  if (col.compMetric === "mandays") return comp.mandays;
  return comp.kind === "sub" ? safeAvg(comp.cost, comp.mandays) : null;
}

function compColFormat(v: number | null, col: SvcCol): string {
  if (v == null) return "—";
  const metric = col.type === "metric" ? col.metric : col.compMetric;
  if (metric === "qty") return formatNumber(v, 0);
  if (metric === "mandays") return formatNumber(v, 2);
  return formatCurrency(v);
}

export default function ProjectComparisonReport() {
  // Filters hydrate from URL on mount so the page is bookmarkable / shareable.
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

  useSyncUrlParams("/reports/comparison", {
    from,
    to,
    projectIds,
    serviceIds,
    statuses,
  });
  const [metrics, setMetrics] = useState<Set<Metric>>(
    new Set(["cost", "mandays", "avg"]),
  );
  const [fullBreakdown, setFullBreakdown] = useState(false);

  const { data: projects } = useListProjects({
    query: { queryKey: getListProjectsQueryKey() },
  });
  const visibleProjects = useMemo(
    () => (projects ?? []).filter((p) => p.currentUserCanViewSummary),
    [projects],
  );

  const projectIdsParam =
    projectIds.length > 0 ? { projectIds: projectIds.join(",") } : {};
  const serviceIdsParam =
    serviceIds.length > 0 ? { serviceIds: serviceIds.join(",") } : {};
  const statusesParam =
    statuses.length > 0 && statuses.length < 3
      ? { statuses: statuses.join(",") }
      : {};

  const statusOptions = [
    { value: "draft", label: "Draft" },
    { value: "pending", label: "Pending approval" },
    { value: "approved", label: "Approved" },
  ];

  const { data: services } = useListVisibleServices(projectIdsParam, {
    query: { queryKey: getListVisibleServicesQueryKey(projectIdsParam) },
  });

  // Drop selected services that are no longer available after project filter changes.
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

  const {
    data: agg,
    isLoading,
    isError,
  } = useGetAggregateReport(filterParams, {
    query: { queryKey: getGetAggregateReportQueryKey(filterParams) },
  });

  const projectOptions = useMemo(
    () =>
      visibleProjects.map((p) => ({
        value: p.id,
        label: p.name,
        hint: p.location,
      })),
    [visibleProjects],
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

  // The columns are the unique services that actually appear in the result —
  // grouped by service NAME so the same service across projects collapses into
  // one column group (more useful for cross-project comparison).
  type ServiceColumn = {
    key: string; // service name (lower-cased) used as group key
    label: string; // display name
    kind: string;
    color: string; // resolved hex (defaults via name hash)
  };

  // Services across projects are grouped by (name, kind) so a service named
  // "Lunch" of kind=food in project A merges with "Lunch" of kind=food in
  // project B, but a hypothetical "Lunch" of kind=standard would stay separate.
  function groupKey(name: string, kind: string) {
    return `${name.trim().toLowerCase()}|${kind}`;
  }

  const serviceColumns: ServiceColumn[] = useMemo(() => {
    if (!agg) return [];
    const seen = new Map<string, ServiceColumn>();
    for (const row of agg.serviceBreakdown) {
      const key = groupKey(row.serviceName, row.kind);
      const existing = seen.get(key);
      if (!existing) {
        seen.set(key, {
          key,
          label: row.serviceName,
          kind: row.kind,
          color: resolveServiceColor(
            (row as any).color ?? null,
            row.serviceName,
          ),
        });
      } else if (!existing.color && (row as any).color) {
        existing.color = resolveServiceColor(
          (row as any).color,
          row.serviceName,
        );
      }
    }
    return Array.from(seen.values()).sort(
      (a, b) => a.label.localeCompare(b.label) || a.kind.localeCompare(b.kind),
    );
  }, [agg]);

  type Cell = {
    totalCost: number;
    totalMandays: number;
    components: Map<string, CompCell>;
  };

  // Components merge by (kind, name) so the same meal type or sub-service
  // name collapses into one column across projects.
  function compKeyOf(kind: string, name: string) {
    return `${kind}:${name.trim().toLowerCase()}`;
  }

  function mergeComp(
    target: Map<string, CompCell>,
    comp: {
      name: string;
      kind: "meal" | "sub";
      qty?: number | null;
      cost?: number | null;
      mandays: number;
    },
  ) {
    const key = compKeyOf(comp.kind, comp.name);
    const prev = target.get(key) ?? {
      key,
      name: comp.name,
      kind: comp.kind,
      qty: 0,
      cost: 0,
      mandays: 0,
    };
    prev.qty += comp.qty ?? 0;
    prev.cost += comp.cost ?? 0;
    prev.mandays += comp.mandays;
    target.set(key, prev);
  }

  // Pivot: projectId -> serviceKey -> Cell
  const pivot = useMemo(() => {
    const m = new Map<string, Map<string, Cell>>();
    if (!agg) return m;
    for (const row of agg.serviceBreakdown) {
      const key = groupKey(row.serviceName, row.kind);
      let pmap = m.get(row.projectId);
      if (!pmap) {
        pmap = new Map();
        m.set(row.projectId, pmap);
      }
      const prev = pmap.get(key) ?? {
        totalCost: 0,
        totalMandays: 0,
        components: new Map<string, CompCell>(),
      };
      prev.totalCost += row.totalCost;
      prev.totalMandays += row.totalMandayContribution;
      for (const comp of row.components ?? []) {
        mergeComp(prev.components, comp);
      }
      pmap.set(key, prev);
    }
    return m;
  }, [agg]);

  const projectRows = useMemo(() => agg?.projectBreakdown ?? [], [agg]);

  // Sort keys: "project", "location", "total", or "svc|<serviceKey>|<metric>".
  const sorter = useSortState<string>();
  const sortedProjectRows = useMemo(
    () =>
      sortRows(projectRows, sorter.sort, (proj, key) => {
        if (key === "project") return proj.projectName;
        if (key === "location") return proj.location;
        if (key === "total") return proj.totalCost;
        if (key.startsWith("svc|")) {
          const sep = key.lastIndexOf("|");
          const serviceKey = key.slice(4, sep);
          const metric = key.slice(sep + 1) as Metric;
          const cell = pivot.get(proj.projectId)?.get(serviceKey);
          if (!cell) return null;
          if (metric === "cost") return cell.totalCost;
          if (metric === "mandays") return cell.totalMandays;
          return safeAvg(cell.totalCost, cell.totalMandays);
        }
        if (key.startsWith("cmp|")) {
          // Service key is URI-encoded in the sort key because raw group
          // keys contain "|" themselves.
          const parts = key.split("|");
          const serviceKey = decodeURIComponent(parts[1]);
          const compMetric = parts[2] as CompMetric;
          const compKey = parts.slice(3).join("|");
          const cell = pivot.get(proj.projectId)?.get(serviceKey);
          return compColValue(cell, {
            type: "comp",
            compKey,
            compMetric,
            label: "",
            sortKey: key,
          });
        }
        return null;
      }),
    [projectRows, sorter.sort, pivot],
  );

  const visibleMetrics: Metric[] = useMemo(
    () =>
      (["cost", "mandays", "avg"] as Metric[]).filter((m) => metrics.has(m)),
    [metrics],
  );

  function toggleMetric(m: Metric) {
    setMetrics((prev) => {
      const next = new Set(prev);
      if (next.has(m)) next.delete(m);
      else next.add(m);
      return next;
    });
  }

  // Per-service totals across all visible projects.
  const serviceTotals = useMemo(() => {
    const t = new Map<string, Cell>();
    for (const col of serviceColumns) {
      let cost = 0;
      let mandays = 0;
      const components = new Map<string, CompCell>();
      for (const proj of projectRows) {
        const c = pivot.get(proj.projectId)?.get(col.key);
        if (c) {
          cost += c.totalCost;
          mandays += c.totalMandays;
          for (const comp of c.components.values()) mergeComp(components, comp);
        }
      }
      t.set(col.key, { totalCost: cost, totalMandays: mandays, components });
    }
    return t;
  }, [serviceColumns, projectRows, pivot]);

  // Per-service column list: the service metrics plus — when "Full
  // breakdown" is on — the component columns (union across projects, taken
  // from the cross-project service totals).
  const colsByService = useMemo(() => {
    const map = new Map<string, SvcCol[]>();
    for (const col of serviceColumns) {
      const cols: SvcCol[] = visibleMetrics.map((m) => ({
        type: "metric" as const,
        metric: m,
        label: METRIC_LABEL[m],
        sortKey: `svc|${col.key}|${m}`,
      }));
      if (fullBreakdown) {
        const comps = Array.from(
          serviceTotals.get(col.key)?.components.values() ?? [],
        ).sort(
          (a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name),
        );
        for (const comp of comps) {
          const push = (cm: CompMetric, label: string) =>
            cols.push({
              type: "comp",
              compKey: comp.key,
              compMetric: cm,
              label,
              sortKey: `cmp|${encodeURIComponent(col.key)}|${cm}|${comp.key}`,
            });
          if (comp.kind === "meal") {
            push("qty", `${comp.name} · Qty`);
            if (metrics.has("mandays"))
              push("mandays", `${comp.name} · Mandays`);
          } else {
            if (metrics.has("cost")) push("cost", `${comp.name} · Cost`);
            if (metrics.has("mandays"))
              push("mandays", `${comp.name} · Mandays`);
            if (metrics.has("avg")) push("avg", `${comp.name} · Avg`);
          }
        }
      }
      map.set(col.key, cols);
    }
    return map;
  }, [serviceColumns, visibleMetrics, fullBreakdown, serviceTotals, metrics]);

  const hasComponents = useMemo(
    () =>
      Array.from(serviceTotals.values()).some((t) => t.components.size > 0),
    [serviceTotals],
  );

  const grandTotalCost = useMemo(
    () => projectRows.reduce((sum, p) => sum + p.totalCost, 0),
    [projectRows],
  );
  const grandTotalMandays = useMemo(
    () => projectRows.reduce((sum, p) => sum + p.totalMandays, 0),
    [projectRows],
  );

  async function exportXlsx() {
    if (!agg || projectRows.length === 0 || serviceColumns.length === 0) return;
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    wb.creator = "QNC COGS Tracker";
    wb.created = new Date();
    const ws = wb.addWorksheet("Project comparison");

    const serviceColStarts: number[] = [];
    let nextCol = 3;
    serviceColumns.forEach((col) => {
      serviceColStarts.push(nextCol);
      nextCol += (colsByService.get(col.key) ?? []).length;
    });
    const totalCols = nextCol;

    // Title block
    ws.mergeCells(1, 1, 1, totalCols);
    const titleCell = ws.getCell(1, 1);
    titleCell.value = "Project comparison report";
    titleCell.font = { size: 14, bold: true };

    ws.mergeCells(2, 1, 2, totalCols);
    ws.getCell(2, 1).value =
      `Date range: ${formatDate(agg.range.from)} — ${formatDate(agg.range.to)}`;

    ws.mergeCells(3, 1, 3, totalCols);
    ws.getCell(3, 1).value = `Generated: ${new Date().toLocaleString()}`;

    const headerRow1Idx = 5;
    const headerRow2Idx = 6;
    ws.getCell(headerRow1Idx, 1).value = "Project";
    ws.getCell(headerRow1Idx, 2).value = "Location";
    ws.mergeCells(headerRow1Idx, 1, headerRow2Idx, 1);
    ws.mergeCells(headerRow1Idx, 2, headerRow2Idx, 2);

    serviceColumns.forEach((col, i) => {
      const cols = colsByService.get(col.key) ?? [];
      const startCol = serviceColStarts[i];
      const endCol = startCol + cols.length - 1;
      if (cols.length > 1) {
        ws.mergeCells(headerRow1Idx, startCol, headerRow1Idx, endCol);
      }
      const groupCell = ws.getCell(headerRow1Idx, startCol);
      groupCell.value = col.label;
      groupCell.alignment = { horizontal: "center" };
      cols.forEach((c2, j) => {
        ws.getCell(headerRow2Idx, startCol + j).value = c2.label;
      });
    });

    const totalColIdx = totalCols;
    ws.mergeCells(headerRow1Idx, totalColIdx, headerRow2Idx, totalColIdx);
    ws.getCell(headerRow1Idx, totalColIdx).value = "Project total (SAR)";
    ws.getCell(headerRow1Idx, totalColIdx).alignment = {
      horizontal: "center",
      vertical: "middle",
    };

    // Header styling
    for (let c = 1; c <= totalCols; c++) {
      [headerRow1Idx, headerRow2Idx].forEach((r) => {
        const cell = ws.getCell(r, c);
        cell.font = { bold: true };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFEEF2FF" },
        };
        cell.border = {
          top: { style: "thin", color: { argb: "FFCBD5E1" } },
          left: { style: "thin", color: { argb: "FFCBD5E1" } },
          right: { style: "thin", color: { argb: "FFCBD5E1" } },
          bottom: { style: "thin", color: { argb: "FFCBD5E1" } },
        };
      });
    }

    // Body rows
    let rowIdx = headerRow2Idx + 1;
    projectRows.forEach((proj) => {
      ws.getCell(rowIdx, 1).value = proj.projectName;
      ws.getCell(rowIdx, 2).value = proj.location;
      serviceColumns.forEach((col, i) => {
        const cols = colsByService.get(col.key) ?? [];
        const startCol = serviceColStarts[i];
        const cell = pivot.get(proj.projectId)?.get(col.key);
        cols.forEach((c2, j) => {
          const c = ws.getCell(rowIdx, startCol + j);
          c.value = compColValue(cell, c2);
          c.numFmt =
            (c2.type === "comp" ? c2.compMetric : c2.metric) === "qty"
              ? "#,##0"
              : "#,##0.00";
        });
      });
      const totalCell = ws.getCell(rowIdx, totalColIdx);
      totalCell.value = proj.totalCost;
      totalCell.numFmt = "#,##0.00";
      totalCell.font = { bold: true };
      rowIdx++;
    });

    // Totals row
    const totalsRow = rowIdx;
    ws.getCell(totalsRow, 1).value = "Totals";
    ws.mergeCells(totalsRow, 1, totalsRow, 2);
    serviceColumns.forEach((col, i) => {
      const cols = colsByService.get(col.key) ?? [];
      const startCol = serviceColStarts[i];
      const t = serviceTotals.get(col.key);
      cols.forEach((c2, j) => {
        const c = ws.getCell(totalsRow, startCol + j);
        c.value = compColValue(t, c2);
        c.numFmt =
          (c2.type === "comp" ? c2.compMetric : c2.metric) === "qty"
            ? "#,##0"
            : "#,##0.00";
      });
    });
    const grand = ws.getCell(totalsRow, totalColIdx);
    grand.value = grandTotalCost;
    grand.numFmt = "#,##0.00";
    for (let c = 1; c <= totalCols; c++) {
      const cell = ws.getCell(totalsRow, c);
      cell.font = { bold: true };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFF1F5F9" },
      };
      cell.border = {
        top: { style: "medium", color: { argb: "FF94A3B8" } },
      };
    }

    // Column widths
    ws.getColumn(1).width = 28;
    ws.getColumn(2).width = 22;
    for (let c = 3; c <= totalCols; c++) {
      ws.getColumn(c).width = 16;
    }

    ws.views = [
      {
        state: "frozen",
        xSplit: 2,
        ySplit: headerRow2Idx,
      },
    ];

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `project-comparison-${from}_${to}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <PageHeader
          title="Project comparison"
          subtitle="Compare projects side-by-side across services. Pick a date range, the projects to compare, and (optionally) a subset of services. Each service shows total cost, total mandays, and the average SAR per manday for that project."
        />

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Filters</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-[auto_auto_1fr_1fr_auto] items-end">
              <div className="space-y-1.5">
                <Label htmlFor="cmp-from">From</Label>
                <Input
                  id="cmp-from"
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  data-testid="cmp-from"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cmp-to">To</Label>
                <Input
                  id="cmp-to"
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  data-testid="cmp-to"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Projects</Label>
                <MultiSelect
                  options={projectOptions}
                  selected={projectIds}
                  onChange={setProjectIds}
                  placeholder="All visible projects"
                  searchPlaceholder="Search projects…"
                  data-testid="cmp-projects"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Services</Label>
                <MultiSelect
                  options={serviceOptions}
                  selected={serviceIds}
                  onChange={setServiceIds}
                  placeholder={
                    projectIds.length > 0
                      ? "All services on selected projects"
                      : "All services"
                  }
                  searchPlaceholder="Search services…"
                  data-testid="cmp-services"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <MultiSelect
                  options={statusOptions}
                  selected={statuses}
                  onChange={setStatuses}
                  placeholder="All statuses"
                  searchPlaceholder="Filter…"
                  data-testid="cmp-statuses"
                />
              </div>
              <div className="flex gap-2">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" data-testid="cmp-metrics">
                      <SlidersHorizontal className="h-4 w-4 mr-2" />
                      Metrics
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-56">
                    <div className="space-y-2">
                      <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-2">
                        Show
                      </div>
                      {(["cost", "mandays", "avg"] as Metric[]).map((m) => (
                        <label
                          key={m}
                          className="flex items-center gap-2 text-sm cursor-pointer"
                        >
                          <Checkbox
                            checked={metrics.has(m)}
                            onCheckedChange={() => toggleMetric(m)}
                          />
                          {METRIC_LABEL[m]}
                        </label>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
                <Button
                  variant={fullBreakdown ? "default" : "outline"}
                  onClick={() => setFullBreakdown((v) => !v)}
                  disabled={!agg || !hasComponents}
                  title="Expand food services into meal types and group services into sub-services"
                  data-testid="cmp-breakdown"
                >
                  Full breakdown
                </Button>
                <Button
                  onClick={exportXlsx}
                  disabled={
                    !agg ||
                    projectRows.length === 0 ||
                    serviceColumns.length === 0 ||
                    visibleMetrics.length === 0
                  }
                  data-testid="cmp-export"
                >
                  <Download className="h-4 w-4 mr-2" />
                  Excel
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {isLoading ? (
          <Card>
            <CardContent className="py-16 text-center text-sm text-muted-foreground">
              Loading…
            </CardContent>
          </Card>
        ) : isError ? (
          <Card>
            <CardContent className="py-16 text-center text-sm text-destructive">
              Couldn't load the report.
            </CardContent>
          </Card>
        ) : !agg ? null : (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Comparison ·{" "}
                <span className="text-muted-foreground font-normal">
                  {formatDate(agg.range.from)} → {formatDate(agg.range.to)}
                </span>
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                {projectRows.length} project
                {projectRows.length === 1 ? "" : "s"} · {serviceColumns.length}{" "}
                service
                {serviceColumns.length === 1 ? "" : "s"}
              </p>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              {projectRows.length === 0 ? (
                <div className="px-6 py-12 text-center text-sm text-muted-foreground">
                  No data for the selected filters.
                </div>
              ) : serviceColumns.length === 0 || visibleMetrics.length === 0 ? (
                <div className="px-6 py-12 text-center text-sm text-muted-foreground">
                  No services to display — select at least one service and one
                  metric.
                </div>
              ) : (
                <Table className="min-w-max">
                  <TableHeader>
                    <TableRow>
                      <SortableHead
                        sortKey="project"
                        sort={sorter.sort}
                        onSort={sorter.toggleSort}
                        firstDir="asc"
                        rowSpan={2}
                        className="align-bottom whitespace-nowrap sticky left-0 bg-background z-20"
                        style={{ minWidth: 200, width: 200 }}
                      >
                        Project
                      </SortableHead>
                      <SortableHead
                        sortKey="location"
                        sort={sorter.sort}
                        onSort={sorter.toggleSort}
                        firstDir="asc"
                        rowSpan={2}
                        className="align-bottom whitespace-nowrap sticky bg-background z-20 border-r border-border shadow-[inset_-1px_0_0_0_var(--border)]"
                        style={{ left: 200, minWidth: 160, width: 160 }}
                      >
                        Location
                      </SortableHead>
                      {serviceColumns.map((col) => (
                        <TableHead
                          key={col.key}
                          colSpan={(colsByService.get(col.key) ?? []).length}
                          className="text-center border-l border-border whitespace-nowrap"
                          style={tintBgStyle(col.color, 0.18)}
                        >
                          <div className="font-medium inline-flex items-center justify-center gap-1.5">
                            <ColorDot color={col.color} name={col.label} />
                            {col.label}
                          </div>
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-normal">
                            {col.kind}
                          </div>
                        </TableHead>
                      ))}
                      <SortableHead
                        sortKey="total"
                        sort={sorter.sort}
                        onSort={sorter.toggleSort}
                        align="right"
                        rowSpan={2}
                        className="align-bottom text-right whitespace-nowrap border-l-2 border-border bg-muted/30"
                      >
                        Project total
                      </SortableHead>
                    </TableRow>
                    <TableRow>
                      {serviceColumns.map((col) =>
                        (colsByService.get(col.key) ?? []).map((c2, idx) => (
                          <SortableHead
                            key={`${col.key}-${c2.sortKey}`}
                            sortKey={c2.sortKey}
                            sort={sorter.sort}
                            onSort={sorter.toggleSort}
                            align="right"
                            className={
                              "text-right text-[11px] whitespace-nowrap " +
                              (idx === 0 ? "border-l border-border " : "") +
                              (c2.type === "comp"
                                ? "text-muted-foreground font-normal"
                                : "")
                            }
                          >
                            {c2.label}
                          </SortableHead>
                        )),
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedProjectRows.map((proj) => (
                      <TableRow
                        key={proj.projectId}
                        data-testid={`cmp-row-${proj.projectId}`}
                      >
                        <TableCell
                          className="font-medium whitespace-nowrap sticky left-0 bg-background z-10"
                          style={{ minWidth: 200, width: 200 }}
                        >
                          {proj.projectName}
                        </TableCell>
                        <TableCell
                          className="whitespace-nowrap sticky bg-background z-10 border-r border-border shadow-[inset_-1px_0_0_0_var(--border)]"
                          style={{ left: 200, minWidth: 160, width: 160 }}
                        >
                          {proj.location}
                        </TableCell>
                        {serviceColumns.map((col) => {
                          const cell = pivot.get(proj.projectId)?.get(col.key);
                          return (colsByService.get(col.key) ?? []).map(
                            (c2, idx) => (
                              <TableCell
                                key={`${proj.projectId}-${col.key}-${c2.sortKey}`}
                                className={
                                  "text-right tabular-nums whitespace-nowrap " +
                                  (idx === 0 ? "border-l border-border " : "") +
                                  (c2.type === "comp" || !cell
                                    ? "text-muted-foreground"
                                    : "")
                                }
                                style={tintBgStyle(
                                  col.color,
                                  c2.type === "comp" ? 0.03 : 0.06,
                                )}
                              >
                                {compColFormat(compColValue(cell, c2), c2)}
                              </TableCell>
                            ),
                          );
                        })}
                        <TableCell className="text-right tabular-nums font-semibold whitespace-nowrap border-l-2 border-border bg-muted/30">
                          {formatCurrency(proj.totalCost)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell
                        colSpan={2}
                        className="font-semibold sticky left-0 bg-muted/40 z-10 border-r border-border"
                      >
                        Totals
                      </TableCell>
                      {serviceColumns.map((col) => {
                        const t = serviceTotals.get(col.key);
                        return (colsByService.get(col.key) ?? []).map(
                          (c2, idx) => (
                            <TableCell
                              key={`tot-${col.key}-${c2.sortKey}`}
                              className={
                                "text-right tabular-nums whitespace-nowrap " +
                                (idx === 0 ? "border-l border-border " : "") +
                                (c2.type === "comp"
                                  ? "text-muted-foreground"
                                  : "font-semibold")
                              }
                              style={tintBgStyle(
                                col.color,
                                c2.type === "comp" ? 0.06 : 0.12,
                              )}
                            >
                              {compColFormat(compColValue(t, c2), c2)}
                            </TableCell>
                          ),
                        );
                      })}
                      <TableCell className="text-right tabular-nums font-bold whitespace-nowrap border-l-2 border-border bg-muted/50">
                        {formatCurrency(grandTotalCost)}
                      </TableCell>
                    </TableRow>
                    {metrics.has("avg") && (
                      <TableRow>
                        <TableCell
                          colSpan={2}
                          className="text-xs text-muted-foreground sticky left-0 bg-muted/20 z-10 border-r border-border"
                        >
                          Aggregate SAR / manday
                        </TableCell>
                        <TableCell
                          colSpan={serviceColumns.reduce(
                            (n, col) =>
                              n + (colsByService.get(col.key) ?? []).length,
                            0,
                          )}
                          className="text-right text-xs text-muted-foreground"
                        >
                          {grandTotalMandays > 0
                            ? `${formatCurrency(grandTotalCost / grandTotalMandays)} across ${formatNumber(grandTotalMandays, 2)} mandays`
                            : "—"}
                        </TableCell>
                        <TableCell className="border-l-2 border-border bg-muted/20" />
                      </TableRow>
                    )}
                  </TableFooter>
                </Table>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
