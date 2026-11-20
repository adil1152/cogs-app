import { useCallback, useState } from "react";
import {
  getMisExportReportUrl,
  type MisExportReportParams,
} from "@workspace/api-client-react";

function filenameFromDisposition(disposition: string | null, fallback: string) {
  const utf8 = disposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const plain = disposition?.match(/filename="?([^";]+)"?/i)?.[1];
  if (utf8) return decodeURIComponent(utf8);
  return plain || fallback;
}

/**
 * Downloads report binaries directly so response headers and HTTP failures are
 * handled before a browser download is started.
 */
export function useMisReportDownload() {
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const download = useCallback(async (params: MisExportReportParams) => {
    setIsDownloading(true);
    setDownloadError(null);

    try {
      const response = await fetch(getMisExportReportUrl(params), {
        method: "GET",
        credentials: "same-origin",
      });
      if (!response.ok) {
        let detail = `Export failed (${response.status} ${response.statusText}).`;
        try {
          const body = await response.json() as { error?: string; message?: string };
          detail = body.error || body.message || detail;
        } catch {
          // A non-JSON error still has the useful HTTP status above.
        }
        throw new Error(detail);
      }

      const blob = await response.blob();
      if (blob.size === 0) throw new Error("The export was empty. Please adjust the report filters and try again.");

      const filename = filenameFromDisposition(
        response.headers.get("content-disposition"),
        `mis-${params.reportType}.${params.format}`,
      );
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : "Unable to download this report.");
    } finally {
      setIsDownloading(false);
    }
  }, []);

  return { download, isDownloading, downloadError, clearDownloadError: () => setDownloadError(null) };
}