import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  useListProjects,
  useGetProjectEntryMatrix,
  getListProjectsQueryKey,
  getGetProjectEntryMatrixQueryKey,
} from "@workspace/api-client-react";
import { AppLayout, PageHeader } from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ProjectCombobox } from "@/components/ProjectCombobox";
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
  ServiceDrilldownDialog,
  type ServiceDrilldownTarget,
} from "@/components/ServiceDrilldownDialog";
import {
  formatCurrency,
  formatNumber,
  formatDate,
  daysAgoISO,
  todayISO,
} from "@/lib/format";
import { buildUrl, readSearch, useSyncUrlParams } from "@/lib/return-to";
import { Download, SlidersHorizontal, Lock, ChevronsUpDown } from "lucide-react";
import { ColorDot } from "@/components/ColorDot";
import { tintBgStyle } from "@/lib/serviceColor";
import { SortableHead, sortRows, useSortState } from "@/components/SortableHead";

type Metric = "cost" | "mandays" | "avg";

const METRIC_LABEL: Record<Metric, string> = {
  cost: "Cost (SAR)",
  mandays: "Mandays",
  avg: "SAR / manday",
};

type CompMetric = "qty" | "cost" | "mandays" | "avg";

/** One rendered column inside a service group: a service-level metric or a component (meal / sub-service) value. */
interface SvcCol {
  type: "metric" | "comp";
  metric?: Metric;
  compKey?: string;
  compName?: string;
  compMetric?: CompMetric;
  label: string;
  sortKey: string;
}

interface CellLike {
  cost: number;
  mandayContribution: number;
  costPerManday: number;
  components?: {
    key: string;
    name: string;
    kind: "meal" | "sub";
    qty?: number | null;
    cost?: number | null;
    mandays: number;
  }[];
}

function svcColValue(c: CellLike | undefined, col: SvcCol): number | null {
  if (!c) return null;
  if (col.type === "metric") {
    if (col.metric === "cost") return c.cost;
    if (col.metric === "mandays") return c.mandayContribution;
    return c.mandayContribution > 0 ? c.costPerManday : null;
  }
  const comp = (c.components ?? []).find((x) => x.key === col.compKey);
  if (!comp) return null;
  if (col.compMetric === "qty") return comp.qty ?? null;
  if (col.compMetric === "cost") return comp.cost ?? null;
  if (col.compMetric === "mandays") return comp.mandays;
  return comp.cost != null && comp.mandays > 0 ? comp.cost / comp.mandays : null;
}

function svcColFormat(v: number | null, col: SvcCol): string {
  if (v == null) return "—";
  const metric = col.type === "metric" ? col.metric : col.compMetric;
  if (metric === "qty") return formatNumber(v, 0);
  if (metric === "mandays") return formatNumber(v, 2);
  return formatCurrency(v);
}

export default function EntryWiseReport() {
  const [, navigate] = useLocation();
  // Hydrate filters from the URL on mount so that "Back to Entry-wise report"
  // from an entry page restores the exact same view, and so the page can be
  // bookmarked / shared.
  const [projectId, setProjectId] = useState<string>(
    () => readSearch().get("projectId") ?? "",
  );
  const [from, setFrom] = useState<string>(
    () => readSearch().get("from") ?? daysAgoISO(29),
  );
  const [to, setTo] = useState<string>(
    () => readSearch().get("to") ?? todayISO(),
  );

  // Mirror current filter state back into the URL (replace, no history spam).
  useSyncUrlParams("/reports/entry-wise", { projectId, from, to });

  // The "back to here" link we hand to entry pages and the drilldown dialog.
  const returnUrl = buildUrl("/reports/entry-wise", { projectId, from, to });

  const [hiddenServices, setHiddenServices] = useState<Set<string>>(new Set());
  const [metrics, setMetrics] = useState<Set<Metric>>(
    new Set(["cost", "mandays", "avg"]),
  );
  const [fullBreakdown, setFullBreakdown] = useState(true);
  const [drilldown, setDrilldown] = useState<ServiceDrilldownTarget | null>(
    null,
  );

  const { data: allProjects } = useListProjects({
    query: { queryKey: getListProjectsQueryKey() },
  });
  const projects = useMemo(
    () => (allProjects ?? []).filter((p) => p.currentUserCanViewSummary),
    [allProjects],
  );

  const params = { from, to };
  const matrixQuery = useGetProjectEntryMatrix(projectId, params, {
    query: {
      enabled: !!projectId,
      queryKey: getGetProjectEntryMatrixQueryKey(projectId, params),
    },
  });
  const matrix = matrixQuery.data;

  const visibleServices = useMemo(
    () => (matrix?.services ?? []).filter((s) => !hiddenServices.has(s.id)),
    [matrix, hiddenServices],
  );
  const visibleMetrics: Metric[] = useMemo(
    () => (["cost", "mandays", "avg"] as Metric[]).filter((m) => metrics.has(m)),
    [metrics],
  );
  const grandTotalCost = useMemo(
    () => (matrix?.entries ?? []).reduce((sum, e) => sum + e.totalCost, 0),
    [matrix],
  );

  // Per-service list of rendered columns: the service-level metrics, plus —
  // when "Full breakdown" is on — one column set per component (meal types
  // of food services, sub-services of group services). The component list
  // comes from serviceTotals so every entry row shares the same columns.
  const colsByService = useMemo(() => {
    const map = new Map<string, SvcCol[]>();
    for (const s of visibleServices) {
      const cols: SvcCol[] = visibleMetrics.map((m) => ({
        type: "metric" as const,
        metric: m,
        label: METRIC_LABEL[m],
        sortKey: `svc|${s.id}|${m}`,
      }));
      if (fullBreakdown) {
        const comps =
          matrix?.serviceTotals.find((t) => t.serviceId === s.id)
            ?.components ?? [];
        for (const comp of comps) {
          const push = (cm: CompMetric, label: string) =>
            cols.push({
              type: "comp",
              compKey: comp.key,
              compName: comp.name,
              compMetric: cm,
              label,
              sortKey: `cmp|${s.id}|${cm}|${comp.key}`,
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
      map.set(s.id, cols);
    }
    return map;
  }, [visibleServices, visibleMetrics, fullBreakdown, matrix, metrics]);

  const hasComponents = useMemo(
    () =>
      (matrix?.serviceTotals ?? []).some(
        (t) => (t.components ?? []).length > 0,
      ),
    [matrix],
  );

  // Sort keys: "seq", "date", "location", "total", or "svc|<serviceId>|<metric>".
  const sorter = useSortState<string>();
  const sortedEntries = useMemo(
    () =>
      sortRows(matrix?.entries ?? [], sorter.sort, (e, key) => {
        if (key === "seq") return e.sequenceCode ?? e.entryId;
        if (key === "date") return e.entryDate;
        if (key === "location") return e.location;
        if (key === "total") return e.totalCost;
        if (key.startsWith("svc|")) {
          const sep = key.lastIndexOf("|");
          const serviceId = key.slice(4, sep);
          const metric = key.slice(sep + 1) as Metric;
          const c = e.costs.find((x) => x.serviceId === serviceId);
          if (!c) return null;
          if (metric === "cost") return c.cost;
          if (metric === "mandays") return c.mandayContribution;
          return c.mandayContribution > 0 ? c.costPerManday : null;
        }
        if (key.startsWith("cmp|")) {
          const parts = key.split("|");
          const serviceId = parts[1];
          const compMetric = parts[2] as CompMetric;
          const compKey = parts.slice(3).join("|");
          const c = e.costs.find((x) => x.serviceId === serviceId);
          return svcColValue(c, {
            type: "comp",
            compKey,
            compMetric,
            label: "",
            sortKey: key,
          });
        }
        return null;
      }),
    [matrix, sorter.sort],
  );

  function toggleService(id: string) {
    setHiddenServices((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleMetric(m: Metric) {
    setMetrics((prev) => {
      const next = new Set(prev);
      if (next.has(m)) next.delete(m);
      else next.add(m);
      return next;
    });
  }

  function showAllServices() {
    setHiddenServices(new Set());
  }
  function hideAllServices() {
    setHiddenServices(new Set((matrix?.services ?? []).map((s) => s.id)));
  }

  async function exportXlsx() {
    if (!matrix) return;
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    wb.creator = "QNC COGS Tracker";
    wb.created = new Date();
    const ws = wb.addWorksheet("Entry-wise report");

    const serviceColStarts: number[] = [];
    let nextCol = 4;
    visibleServices.forEach((svc) => {
      serviceColStarts.push(nextCol);
      nextCol += (colsByService.get(svc.id) ?? []).length;
    });
    const totalCols = nextCol;
    const totalColIdx = totalCols;

    // Title block
    ws.mergeCells(1, 1, 1, totalCols);
    const titleCell = ws.getCell(1, 1);
    titleCell.value = `Entry-wise report — ${matrix.project.name}`;
    titleCell.font = { size: 14, bold: true };
    titleCell.alignment = { horizontal: "left", vertical: "middle" };

    ws.mergeCells(2, 1, 2, totalCols);
    ws.getCell(2, 1).value = `Date range: ${formatDate(matrix.range.from)} — ${formatDate(matrix.range.to)}`;

    ws.mergeCells(3, 1, 3, totalCols);
    ws.getCell(3, 1).value = `Generated: ${new Date().toLocaleString()}`;

    // Header row 1: service group headers
    const headerRow1Idx = 5;
    const headerRow2Idx = 6;
    ws.getCell(headerRow1Idx, 1).value = "#";
    ws.getCell(headerRow1Idx, 2).value = "Date";
    ws.getCell(headerRow1Idx, 3).value = "Location";
    ws.mergeCells(headerRow1Idx, 1, headerRow2Idx, 1);
    ws.mergeCells(headerRow1Idx, 2, headerRow2Idx, 2);
    ws.mergeCells(headerRow1Idx, 3, headerRow2Idx, 3);

    visibleServices.forEach((svc, i) => {
      const cols = colsByService.get(svc.id) ?? [];
      const startCol = serviceColStarts[i];
      const endCol = startCol + cols.length - 1;
      if (cols.length > 1) {
        ws.mergeCells(headerRow1Idx, startCol, headerRow1Idx, endCol);
      }
      const groupCell = ws.getCell(headerRow1Idx, startCol);
      groupCell.value = svc.name;
      groupCell.alignment = { horizontal: "center" };
      cols.forEach((col, j) => {
        ws.getCell(headerRow2Idx, startCol + j).value = col.label;
      });
    });

    // Entry total column header (rightmost, spanning both header rows)
    ws.mergeCells(headerRow1Idx, totalColIdx, headerRow2Idx, totalColIdx);
    ws.getCell(headerRow1Idx, totalColIdx).value = "Entry total (SAR)";
    ws.getCell(headerRow1Idx, totalColIdx).alignment = {
      horizontal: "center",
      vertical: "middle",
    };

    // Style headers
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
    matrix.entries.forEach((entry) => {
      ws.getCell(rowIdx, 1).value =
        entry.sequenceCode ?? entry.entryId.slice(0, 6);
      ws.getCell(rowIdx, 2).value = formatDate(entry.entryDate);
      ws.getCell(rowIdx, 3).value = entry.location;
      visibleServices.forEach((svc, i) => {
        const cols = colsByService.get(svc.id) ?? [];
        const startCol = serviceColStarts[i];
        const cell = entry.costs.find((c) => c.serviceId === svc.id);
        cols.forEach((col, j) => {
          const c = ws.getCell(rowIdx, startCol + j);
          const v = svcColValue(cell, col);
          c.value = v;
          c.numFmt =
            (col.type === "comp" ? col.compMetric : col.metric) === "qty"
              ? "#,##0"
              : "#,##0.00";
        });
      });
      const totalCell = ws.getCell(rowIdx, totalColIdx);
      totalCell.value = entry.totalCost;
      totalCell.numFmt = '#,##0.00';
      totalCell.font = { bold: true };
      rowIdx++;
    });

    // Totals row
    const totalsRow = rowIdx;
    ws.getCell(totalsRow, 1).value = "Totals";
    ws.mergeCells(totalsRow, 1, totalsRow, 3);
    visibleServices.forEach((svc, i) => {
      const cols = colsByService.get(svc.id) ?? [];
      const startCol = serviceColStarts[i];
      const t = matrix.serviceTotals.find((x) => x.serviceId === svc.id);
      const totalCell: CellLike | undefined = t
        ? {
            cost: t.totalCost,
            mandayContribution: t.totalMandayContribution,
            costPerManday: t.costPerManday,
            components: t.components,
          }
        : undefined;
      cols.forEach((col, j) => {
        const c = ws.getCell(totalsRow, startCol + j);
        c.value = svcColValue(totalCell, col);
        c.numFmt =
          (col.type === "comp" ? col.compMetric : col.metric) === "qty"
            ? "#,##0"
            : "#,##0.00";
      });
    });
    const grandTotalCell = ws.getCell(totalsRow, totalColIdx);
    grandTotalCell.value = grandTotalCost;
    grandTotalCell.numFmt = '#,##0.00';
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
    ws.getColumn(1).width = 14;
    ws.getColumn(2).width = 14;
    ws.getColumn(3).width = 22;
    for (let c = 4; c <= totalCols; c++) {
      ws.getColumn(c).width = 16;
    }

    // Freeze the first three columns (#, Date, Location) and header rows
    ws.views = [
      {
        state: "frozen",
        xSplit: 3,
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
    a.download = `entry-wise-${matrix.project.name.replace(/\s+/g, "-")}-${matrix.range.from}_${matrix.range.to}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const projectName = matrix?.project.name ?? "—";

  return (
    <AppLayout>
      <div className="space-y-6">
        <PageHeader
          title="Entry-wise report"
          subtitle="Pick a project to see every daily entry with all of its services laid out side-by-side. Click any service value to drill into the contributing entries."
        />

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Filters</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-[1fr_auto_auto_auto] items-end">
              <div className="space-y-1.5">
                <Label htmlFor="ew-project">Project</Label>
                <ProjectCombobox
                  projects={projects ?? []}
                  value={projectId}
                  testidPrefix="ew-project"
                  onSelect={setProjectId}
                  trigger={
                    <Button
                      id="ew-project"
                      variant="outline"
                      role="combobox"
                      className="w-full justify-between font-normal"
                      data-testid="ew-project"
                    >
                      <span className="truncate">
                        {(projects ?? []).find((p) => p.id === projectId)
                          ?.name ?? "Select a project…"}
                      </span>
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ew-from">From</Label>
                <Input
                  id="ew-from"
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  data-testid="ew-from"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ew-to">To</Label>
                <Input
                  id="ew-to"
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  data-testid="ew-to"
                />
              </div>
              <div className="flex gap-2">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      disabled={!matrix}
                      data-testid="ew-columns"
                    >
                      <SlidersHorizontal className="h-4 w-4 mr-2" />
                      Columns
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="end"
                    className="w-72 max-h-[70vh] overflow-y-auto"
                  >
                    <div className="space-y-3">
                      <div>
                        <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-2">
                          Metrics
                        </div>
                        <div className="space-y-2">
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
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
                            Services
                          </div>
                          <div className="flex gap-1 text-xs">
                            <button
                              type="button"
                              onClick={showAllServices}
                              className="text-primary hover:underline"
                            >
                              All
                            </button>
                            <span className="text-muted-foreground">·</span>
                            <button
                              type="button"
                              onClick={hideAllServices}
                              className="text-primary hover:underline"
                            >
                              None
                            </button>
                          </div>
                        </div>
                        <div className="space-y-2">
                          {(matrix?.services ?? []).map((s) => (
                            <label
                              key={s.id}
                              className="flex items-center gap-2 text-sm cursor-pointer"
                            >
                              <Checkbox
                                checked={!hiddenServices.has(s.id)}
                                onCheckedChange={() => toggleService(s.id)}
                              />
                              <ColorDot color={(s as any).color} name={s.name} />
                              <span className="flex-1">{s.name}</span>
                              <span className="text-xs text-muted-foreground capitalize">
                                {s.kind}
                              </span>
                            </label>
                          ))}
                          {(matrix?.services ?? []).length === 0 && (
                            <div className="text-xs text-muted-foreground">
                              No services on this project.
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
                <Button
                  variant={fullBreakdown ? "default" : "outline"}
                  onClick={() => setFullBreakdown((v) => !v)}
                  disabled={!matrix || !hasComponents}
                  title="Expand food services into meal types and group services into sub-services"
                  data-testid="ew-breakdown"
                >
                  Full breakdown
                </Button>
                <Button
                  onClick={exportXlsx}
                  disabled={
                    !matrix ||
                    matrix.entries.length === 0 ||
                    visibleMetrics.length === 0
                  }
                  data-testid="ew-export"
                >
                  <Download className="h-4 w-4 mr-2" />
                  Excel
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {!projectId ? (
          <Card>
            <CardContent className="py-16 text-center text-sm text-muted-foreground">
              Choose a project above to generate the report.
            </CardContent>
          </Card>
        ) : matrixQuery.isLoading ? (
          <Card>
            <CardContent className="py-16 text-center text-sm text-muted-foreground">
              Loading…
            </CardContent>
          </Card>
        ) : matrixQuery.isError ? (
          <Card>
            <CardContent className="py-16 text-center text-sm text-destructive">
              Couldn't load the report. You may not have summary access to this
              project.
            </CardContent>
          </Card>
        ) : !matrix ? null : (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {projectName} ·{" "}
                <span className="text-muted-foreground font-normal">
                  {formatDate(matrix.range.from)} → {formatDate(matrix.range.to)}
                </span>
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                {matrix.entries.length} entr
                {matrix.entries.length === 1 ? "y" : "ies"} ·{" "}
                {visibleServices.length} of {matrix.services.length} service
                {matrix.services.length === 1 ? "" : "s"} shown
              </p>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              {matrix.entries.length === 0 ? (
                <div className="px-6 py-12 text-center text-sm text-muted-foreground">
                  No entries in this date range.
                </div>
              ) : visibleServices.length === 0 || visibleMetrics.length === 0 ? (
                <div className="px-6 py-12 text-center text-sm text-muted-foreground">
                  All columns are hidden — pick at least one service and one
                  metric from the Columns menu.
                </div>
              ) : (
                <Table className="min-w-max">
                  <TableHeader>
                    <TableRow>
                      <SortableHead
                        sortKey="seq"
                        sort={sorter.sort}
                        onSort={sorter.toggleSort}
                        firstDir="asc"
                        rowSpan={2}
                        className="align-bottom whitespace-nowrap sticky left-0 bg-background z-20"
                        style={{ minWidth: 110, width: 110 }}
                      >
                        #
                      </SortableHead>
                      <SortableHead
                        sortKey="date"
                        sort={sorter.sort}
                        onSort={sorter.toggleSort}
                        firstDir="asc"
                        rowSpan={2}
                        className="align-bottom whitespace-nowrap sticky bg-background z-20"
                        style={{ left: 110, minWidth: 110, width: 110 }}
                      >
                        Date
                      </SortableHead>
                      <SortableHead
                        sortKey="location"
                        sort={sorter.sort}
                        onSort={sorter.toggleSort}
                        firstDir="asc"
                        rowSpan={2}
                        className="align-bottom whitespace-nowrap sticky bg-background z-20 border-r border-border shadow-[inset_-1px_0_0_0_var(--border)]"
                        style={{ left: 220, minWidth: 200, width: 200 }}
                      >
                        Location
                      </SortableHead>
                      {visibleServices.map((s) => (
                        <TableHead
                          key={s.id}
                          colSpan={(colsByService.get(s.id) ?? []).length}
                          className="text-center border-l border-border whitespace-nowrap"
                          style={tintBgStyle((s as any).color, 0.18, s.name)}
                        >
                          <div className="font-medium inline-flex items-center justify-center gap-1.5">
                            <ColorDot color={(s as any).color} name={s.name} />
                            {s.name}
                          </div>
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-normal">
                            {s.kind}
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
                        Entry total
                      </SortableHead>
                    </TableRow>
                    <TableRow>
                      {visibleServices.map((s) =>
                        (colsByService.get(s.id) ?? []).map((col, idx) => (
                          <SortableHead
                            key={`${s.id}-${col.sortKey}`}
                            sortKey={col.sortKey}
                            sort={sorter.sort}
                            onSort={sorter.toggleSort}
                            align="right"
                            className={
                              "text-right text-[11px] whitespace-nowrap " +
                              (idx === 0 ? "border-l border-border " : "") +
                              (col.type === "comp"
                                ? "text-muted-foreground font-normal"
                                : "")
                            }
                          >
                            {col.label}
                          </SortableHead>
                        )),
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedEntries.map((e) => (
                      <TableRow
                        key={e.entryId}
                        data-testid={`ew-row-${e.entryId}`}
                      >
                        <TableCell
                          className="font-mono text-xs whitespace-nowrap sticky left-0 bg-background z-10 cursor-pointer hover:underline"
                          onClick={() =>
                            navigate(
                              buildUrl(
                                `/projects/${matrix.project.id}/entries/${e.entryId}`,
                                { returnTo: returnUrl },
                              ),
                            )
                          }
                        >
                          <span className="inline-flex items-center gap-1">
                            {e.isLocked && (
                              <Lock className="h-3 w-3 text-muted-foreground" />
                            )}
                            {e.sequenceCode ?? e.entryId.slice(0, 6)}
                          </span>
                        </TableCell>
                        <TableCell
                          className="whitespace-nowrap sticky bg-background z-10"
                          style={{ left: 110, minWidth: 110, width: 110 }}
                        >
                          {formatDate(e.entryDate)}
                        </TableCell>
                        <TableCell
                          className="whitespace-nowrap sticky bg-background z-10 border-r border-border shadow-[inset_-1px_0_0_0_var(--border)]"
                          style={{ left: 220, minWidth: 200, width: 200 }}
                        >
                          {e.location}
                        </TableCell>
                        {visibleServices.map((s) => {
                          const c = e.costs.find((x) => x.serviceId === s.id);
                          return (colsByService.get(s.id) ?? []).map(
                            (col, idx) => {
                              const value = svcColFormat(
                                svcColValue(c, col),
                                col,
                              );
                              return (
                                <TableCell
                                  key={`${e.entryId}-${s.id}-${col.sortKey}`}
                                  className={
                                    "text-right tabular-nums whitespace-nowrap " +
                                    (idx === 0
                                      ? "border-l border-border "
                                      : "") +
                                    (col.type === "comp"
                                      ? "text-muted-foreground "
                                      : "") +
                                    (c && col.type === "metric"
                                      ? "cursor-pointer hover:bg-muted/50"
                                      : !c
                                        ? "text-muted-foreground"
                                        : "")
                                  }
                                  style={tintBgStyle(
                                    (s as any).color,
                                    col.type === "comp" ? 0.03 : 0.06,
                                    s.name,
                                  )}
                                  onClick={() => {
                                    if (!c || col.type !== "metric") return;
                                    setDrilldown({
                                      serviceId: s.id,
                                      serviceName: s.name,
                                      projectId: matrix.project.id,
                                      projectName: matrix.project.name,
                                      from: matrix.range.from,
                                      to: matrix.range.to,
                                      scopeToProject: true,
                                      returnTo: returnUrl,
                                    });
                                  }}
                                >
                                  {value}
                                </TableCell>
                              );
                            },
                          );
                        })}
                        <TableCell className="text-right tabular-nums font-semibold whitespace-nowrap border-l-2 border-border bg-muted/30">
                          {formatCurrency(e.totalCost)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell
                        colSpan={3}
                        className="font-semibold sticky left-0 bg-muted/40 z-10 border-r border-border"
                      >
                        Totals
                      </TableCell>
                      {visibleServices.map((s) => {
                        const t = matrix.serviceTotals.find(
                          (x) => x.serviceId === s.id,
                        );
                        const totalCell: CellLike | undefined = t
                          ? {
                              cost: t.totalCost,
                              mandayContribution: t.totalMandayContribution,
                              costPerManday: t.costPerManday,
                              components: t.components,
                            }
                          : undefined;
                        return (colsByService.get(s.id) ?? []).map(
                          (col, idx) => (
                            <TableCell
                              key={`tot-${s.id}-${col.sortKey}`}
                              className={
                                "text-right tabular-nums whitespace-nowrap " +
                                (idx === 0 ? "border-l border-border " : "") +
                                (col.type === "comp"
                                  ? "text-muted-foreground"
                                  : "font-semibold")
                              }
                              style={tintBgStyle(
                                (s as any).color,
                                col.type === "comp" ? 0.06 : 0.12,
                                s.name,
                              )}
                            >
                              {svcColFormat(svcColValue(totalCell, col), col)}
                            </TableCell>
                          ),
                        );
                      })}
                      <TableCell className="text-right tabular-nums font-bold whitespace-nowrap border-l-2 border-border bg-muted/50">
                        {formatCurrency(grandTotalCost)}
                      </TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <ServiceDrilldownDialog
        target={drilldown}
        onClose={() => setDrilldown(null)}
      />
    </AppLayout>
  );
}
