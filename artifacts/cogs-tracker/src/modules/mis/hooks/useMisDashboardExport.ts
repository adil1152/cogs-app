import { useCallback, useState } from "react";
import {
  getMisExportDashboardUrl,
  type MisExportDashboardFormat,
  type MisExportDashboardParams,
} from "@workspace/api-client-react";

function filenameFromDisposition(disposition: string | null, fallback: string) {
  const utf8 = disposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const plain = disposition?.match(/filename="?([^";]+)"?/i)?.[1];
  if (utf8) return decodeURIComponent(utf8);
  return plain || fallback;
}

/** Downloads server-generated dashboard PDF/XLSX files; totals are never sent from the client. */
export function useMisDashboardExport() {
  const [busyFormat, setBusyFormat] = useState<MisExportDashboardFormat | null>(null);
  const [error, setError] = useState<string | null>(null);

  const download = useCallback(async (params: MisExportDashboardParams) => {
    setBusyFormat(params.format);
    setError(null);
    try {
      const response = await fetch(getMisExportDashboardUrl(params), { method: "GET", credentials: "include" });
      if (!response.ok) {
        let detail = `Export failed (${response.status} ${response.statusText}).`;
        try {
          const body = await response.json() as { error?: string; message?: string };
          detail = body.error || body.message || detail;
        } catch {
          // Non-JSON error bodies still report the HTTP status.
        }
        throw new Error(detail);
      }
      const blob = await response.blob();
      if (blob.size === 0) throw new Error("The export was empty. Please try again.");
      const filename = filenameFromDisposition(response.headers.get("content-disposition"), `mis-${params.view}.${params.format}`);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to download this export.");
    } finally {
      setBusyFormat(null);
    }
  }, []);

  return { download, busyFormat, error, clearError: () => setError(null) };
}
