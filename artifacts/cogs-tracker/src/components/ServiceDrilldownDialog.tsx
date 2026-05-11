import { useLocation } from "wouter";
import {
  useListServiceEntries,
  getListServiceEntriesQueryKey,
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { downloadCsv } from "@/lib/csv";
import { formatCurrency, formatNumber, formatDate } from "@/lib/format";
import { buildUrl } from "@/lib/return-to";
import { Download } from "lucide-react";

export interface ServiceDrilldownTarget {
  serviceId: string;
  serviceName: string;
  projectId: string;
  projectName: string;
  from: string;
  to: string;
  /**
   * When set, only entries from this single project are listed (Project Summary
   * use case). When unset, the dialog spans every visible project (Reports
   * use case) and we still scope to the clicked service.
   */
  scopeToProject?: boolean;
  /**
   * When set, clicking through to an entry appends `?returnTo=<this>` so the
   * entry page can show a "Back to <report>" button.
   */
  returnTo?: string;
}

interface Props {
  target: ServiceDrilldownTarget | null;
  onClose: () => void;
}

export function ServiceDrilldownDialog({ target, onClose }: Props) {
  const [, navigate] = useLocation();

  const params = target
    ? {
        from: target.from,
        to: target.to,
        serviceIds: target.serviceId,
        ...(target.scopeToProject ? { projectIds: target.projectId } : {}),
      }
    : { from: "", to: "" };

  const { data: rows, isLoading } = useListServiceEntries(params, {
    query: {
      enabled: !!target,
      queryKey: getListServiceEntriesQueryKey(params),
    },
  });

  const totals = (rows ?? []).reduce(
    (acc, r) => ({
      cost: acc.cost + r.cost,
      mandays: acc.mandays + r.mandayContribution,
      count: acc.count + 1,
    }),
    { cost: 0, mandays: 0, count: 0 },
  );
  const avg = totals.mandays > 0 ? totals.cost / totals.mandays : 0;

  function exportCsv() {
    if (!target || !rows) return;
    downloadCsv(
      `service-${target.serviceName}-${target.from}-to-${target.to}.csv`,
      [
        "Date",
        "Project",
        "Location",
        "Entry #",
        "Cost (SAR)",
        "Mandays",
        "SAR/manday",
      ],
      rows.map((r) => [
        r.entryDate,
        r.projectName,
        r.location,
        r.sequenceCode ?? "",
        r.cost,
        r.mandayContribution,
        r.mandayContribution > 0 ? r.costPerManday : "",
      ]),
    );
  }

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>{target?.serviceName ?? "Service"}</span>
            {target?.scopeToProject ? (
              <Badge variant="secondary" className="text-xs font-normal">
                {target.projectName}
              </Badge>
            ) : null}
          </DialogTitle>
          <DialogDescription>
            {target ? (
              <>
                Entries containing this service from {formatDate(target.from)}{" "}
                to {formatDate(target.to)}.
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-6 max-h-[60vh] overflow-y-auto border-y">
          <Table>
            <TableHeader className="sticky top-0 bg-background z-10">
              <TableRow>
                <TableHead>Date</TableHead>
                {!target?.scopeToProject && <TableHead>Project</TableHead>}
                <TableHead>Location</TableHead>
                <TableHead>Entry #</TableHead>
                <TableHead className="text-right">Cost (SAR)</TableHead>
                <TableHead className="text-right">Mandays</TableHead>
                <TableHead className="text-right">SAR / manday</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(rows ?? []).map((r) => (
                <TableRow
                  key={`${r.entryId}-${r.serviceId}`}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => {
                    onClose();
                    navigate(
                      buildUrl(
                        `/projects/${r.projectId}/entries/${r.entryId}`,
                        target?.returnTo ? { returnTo: target.returnTo } : {},
                      ),
                    );
                  }}
                  data-testid={`drilldown-row-${r.entryId}`}
                >
                  <TableCell className="font-medium">
                    {formatDate(r.entryDate)}
                  </TableCell>
                  {!target?.scopeToProject && (
                    <TableCell>{r.projectName}</TableCell>
                  )}
                  <TableCell>{r.location}</TableCell>
                  <TableCell className="text-xs text-muted-foreground tabular-nums">
                    {r.sequenceCode ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(r.cost)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatNumber(r.mandayContribution, 2)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.mandayContribution > 0
                      ? formatCurrency(r.costPerManday)
                      : "—"}
                  </TableCell>
                </TableRow>
              ))}
              {!isLoading && (rows ?? []).length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={target?.scopeToProject ? 6 : 7}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    No entries with this service in the selected range.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
            {(rows ?? []).length > 0 && (
              <TableFooter>
                <TableRow>
                  <TableCell
                    colSpan={target?.scopeToProject ? 3 : 4}
                    className="font-medium"
                  >
                    Totals · {totals.count} entr{totals.count === 1 ? "y" : "ies"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">
                    {formatCurrency(totals.cost)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">
                    {formatNumber(totals.mandays, 2)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">
                    {totals.mandays > 0 ? formatCurrency(avg) : "—"}
                  </TableCell>
                </TableRow>
              </TableFooter>
            )}
          </Table>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={exportCsv}
            disabled={!rows || rows.length === 0}
            data-testid="button-drilldown-csv"
          >
            <Download className="mr-2 h-3.5 w-3.5" /> CSV
          </Button>
          <Button size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
