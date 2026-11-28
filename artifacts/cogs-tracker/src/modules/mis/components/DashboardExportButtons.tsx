import { MisExportDashboardFormat, type MisExportDashboardParams } from "@workspace/api-client-react";
import { AlertCircle, FileSpreadsheet, FileText, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMisDashboardExport } from "../hooks/useMisDashboardExport";

const FORMATS = [
  { format: MisExportDashboardFormat.pdf, label: "PDF", icon: FileText },
  { format: MisExportDashboardFormat.xlsx, label: "Excel", icon: FileSpreadsheet },
] as const;

export function DashboardExportButtons({
  params,
  disabledReason,
}: {
  params: Omit<MisExportDashboardParams, "format">;
  /** When set, both buttons are disabled and this text explains why. */
  disabledReason?: string | null;
}) {
  const { download, busyFormat, error, clearError } = useMisDashboardExport();
  const busy = busyFormat !== null;
  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Download report">
        {FORMATS.map(({ format, label, icon: Icon }) => (
          <Button
            key={format}
            variant="outline"
            disabled={Boolean(disabledReason) || busy}
            title={disabledReason ?? `Download ${label}`}
            aria-busy={busyFormat === format}
            data-testid={`dashboard-export-${format}`}
            onClick={() => void download({ ...params, format })}
          >
            {busyFormat === format ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Icon className="mr-2 h-4 w-4" />}
            {busyFormat === format ? "Preparing..." : label}
          </Button>
        ))}
      </div>
      {disabledReason && <p className="max-w-xs text-xs text-muted-foreground sm:text-right">{disabledReason}</p>}
      {error && (
        <div role="alert" className="flex max-w-sm items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1">{error}</span>
          <button type="button" onClick={clearError} aria-label="Dismiss export error" className="shrink-0"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}
    </div>
  );
}
