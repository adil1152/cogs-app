import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@workspace/replit-auth-web";

export type MisAnalyticsMode = "analytics" | "project" | "service" | "type" | "dynamic";
export type MisAnalyticsGroupBy = "date" | "project" | "projectCode" | "type" | "service" | "month" | "year";
export type MisAnalyticsView = "daily" | "weekly" | "monthly" | "custom";
export type MisAnalyticsStatus = "draft" | "submitted" | "approved" | "rejected" | "cancelled";
export type MisAnalyticsStatusFilter = MisAnalyticsStatus | "all";
export type MisAnalyticsFormat = "csv" | "xlsx" | "pdf";
export type MisAnalyticsReportType =
  | "income"
  | "cost"
  | "expense"
  | "salary"
  | "summary"
  | "project-profitability"
  | "project-comparison"
  | "period-comparison"
  | "service-tab-comparison";

/** The descriptor sent to the additive multi-period analytics contract. */
export interface MisAnalyticsPeriod {
  id: string;
  label: string;
  from: string;
  to: string;
}

/**
 * These are the normalized query parameters accepted by the additive analytics
 * route. List values are serialized as repeated query parameters, which the
 * server accepts alongside its comma-separated form.
 */
export interface MisAnalyticsParams {
  /** Omit this for the existing single-period/current-vs-previous behavior. */
  periodComparison?: boolean;
  /** Required by the server when periodComparison is true (3..24 items). */
  periods?: MisAnalyticsPeriod[];
  mode?: MisAnalyticsMode;
  reportType?: MisAnalyticsReportType;
  projectIds?: string[];
  projectCode?: string;
  tabIds?: string[];
  serviceIds?: string[];
  serviceCodes?: string[];
  types?: string[];
  /** Kept for callers migrating from the entry/report APIs. */
  type?: string[];
  /** Kept for callers migrating from the entry/report APIs. */
  entryType?: string[];
  search?: string;
  currency?: string;
  from?: string;
  to?: string;
  status?: MisAnalyticsStatusFilter | MisAnalyticsStatusFilter[];
  compareFrom?: string;
  compareTo?: string;
  groupBy?: MisAnalyticsGroupBy[];
  view?: MisAnalyticsView;
  page?: number;
  pageSize?: number;
}

export interface MisAnalyticsMetricSet {
  totalIncome: number;
  totalCost: number;
  totalExpenses: number;
  totalSalaries: number;
  grossProfit: number;
  netProfit: number;
  profitMargin: number;
  totalAmount: number;
  quantity: number;
  weightedRate: number | null;
  rateMin: number | null;
  rateMax: number | null;
  rateVaried: boolean;
  units: string[];
  unitVaried: boolean;
  entryCount: number;
  contributionPercent: number;
  incomeContributionPercent: number;
  costContributionPercent: number;
  expensesContributionPercent: number;
  salariesContributionPercent: number;
}

export type MisAnalyticsMetricKey =
  | "totalIncome"
  | "totalCost"
  | "totalExpenses"
  | "totalSalaries"
  | "grossProfit"
  | "netProfit"
  | "profitMargin"
  | "totalAmount"
  | "quantity"
  | "weightedRate"
  | "rateMin"
  | "rateMax"
  | "rateVaried"
  | "units"
  | "unitVaried"
  | "entryCount"
  | "contributionPercent"
  | "incomeContributionPercent"
  | "costContributionPercent"
  | "expensesContributionPercent"
  | "salariesContributionPercent";

export type MisAnalyticsDifference = Record<
  "totalIncome" | "totalCost" | "totalExpenses" | "totalSalaries" | "grossProfit" |
  "netProfit" | "profitMargin" | "totalAmount" | "quantity" | "entryCount",
  number
>;

export type MisAnalyticsPercentageDifference = Record<
  "totalIncome" | "totalCost" | "totalExpenses" | "totalSalaries" | "grossProfit" |
  "netProfit" | "profitMargin" | "totalAmount" | "quantity" | "entryCount",
  number | null
>;

export interface MisAnalyticsDrilldownFilters {
  projectIds: string[];
  tabIds: string[];
  serviceIds: string[];
  entryType: string | null;
  status: MisAnalyticsStatusFilter;
  /** Authoritative multi-status selection for the Entries endpoint. */
  statuses: MisAnalyticsStatus[];
  currency: string;
  from: string | null;
  to: string | null;
  /** Inclusive period-start bounds for the selected aggregate bucket. */
  startFrom: string | null;
  startTo: string | null;
}

export interface MisAnalyticsRow {
  currency: string;
  projectId: string | null;
  projectIds: string[];
  projectName: string | null;
  projectCode: string | null;
  tabId: string | null;
  tabIds: string[];
  tabName?: string | null;
  type: string | null;
  serviceId: string | null;
  serviceIds: string[];
  serviceCode: string | null;
  serviceName: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  current: MisAnalyticsMetricSet;
  previous: MisAnalyticsMetricSet | null;
  difference: MisAnalyticsDifference | null;
  percentageDifference: MisAnalyticsPercentageDifference | null;
  drilldownFilters: MisAnalyticsDrilldownFilters;
  previousDrilldownFilters?: MisAnalyticsDrilldownFilters | null;
  trend?: boolean;
}

export interface MisAnalyticsCurrencyTotals {
  currency: string;
  current: MisAnalyticsMetricSet;
  previous: MisAnalyticsMetricSet | null;
  difference: MisAnalyticsDifference | null;
  percentageDifference: MisAnalyticsPercentageDifference | null;
}

export interface MisAnalyticsFilters {
  projectIds: string[];
  projectCode: string | null;
  tabIds: string[];
  serviceIds: string[];
  serviceCodes: string[];
  types: string[];
  from: string | null;
  to: string | null;
  /** Normalized status selection. `all` is explicit, never an omitted default. */
  statuses: MisAnalyticsStatusFilter[];
  /** Legacy normalized single-status field retained by the server when applicable. */
  status?: MisAnalyticsStatusFilter;
  groupBy: MisAnalyticsGroupBy[];
  view: MisAnalyticsView;
  mode: MisAnalyticsMode;
  page: number;
  pageSize: number;
  compareFrom: string | null;
  compareTo: string | null;
  periodComparison?: boolean;
  periods?: MisAnalyticsPeriod[];
  reportType?: MisAnalyticsReportType;
  search?: string | null;
  currency?: string | null;
}

export interface MisAnalyticsPeriodResult {
  period: MisAnalyticsPeriod;
  totalsByCurrency: MisAnalyticsCurrencyTotals[];
  rows: MisAnalyticsRow[];
  trend: MisAnalyticsRow[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    pageCount: number;
  };
}

export interface MisAnalyticsEnvelope {
  filters: MisAnalyticsFilters;
  dateBasis: "period_start";
  totalsByCurrency: MisAnalyticsCurrencyTotals[];
  rows: MisAnalyticsRow[];
  trend: MisAnalyticsRow[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    pageCount: number;
  };
  /** Present only for periodComparison=true. Items preserve request order. */
  periods?: MisAnalyticsPeriodResult[];
}

const ANALYTICS_PATH = "/api/mis/analytics";

function artifactApiUrl(path: string) {
  const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
  return `${base}${path}`;
}

function appendParams(search: URLSearchParams, params: object) {
  const values = params as Record<string, unknown>;
  Object.entries(values).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    if (key === "periods") {
      // The contract deliberately uses one JSON array parameter rather than
      // repeated object-shaped query parameters.
      search.append(key, JSON.stringify(value));
    } else if (Array.isArray(value)) {
      value.forEach((item) => search.append(key, String(item)));
    } else {
      search.append(key, String(value));
    }
  });
}

/**
 * Build an Entries URL from the server-provided drilldown contract.  Keep the
 * original report window in `from`/`to`, while using `startFrom`/`startTo` for
 * the selected period-start bucket.  Entry filters use singular tab/service
 * fields, so callers should use analyticsEntryHrefs when a row spans several
 * dimensions.
 */
export function analyticsEntryHref(
  filters: MisAnalyticsDrilldownFilters,
  tabId?: string,
  serviceId?: string,
) {
  const search = new URLSearchParams();
  if (filters.projectIds.length) search.set("projectIds", filters.projectIds.join(","));
  if (tabId) search.set("tabId", tabId);
  if (serviceId) search.set("serviceId", serviceId);
  if (filters.entryType) search.set("entryType", filters.entryType);
  // Entries accepts the authoritative multi-status query parameter. Do not
  // collapse an explicit selection to the legacy scalar `status=all`.
  if (filters.statuses?.length) search.set("statuses", filters.statuses.join(","));
  else if (filters.status && filters.status !== "all") search.set("statuses", filters.status);
  if (filters.currency) search.set("currency", filters.currency);
  if (filters.from) search.set("from", filters.from);
  if (filters.to) search.set("to", filters.to);
  if (filters.startFrom) search.set("startFrom", filters.startFrom);
  if (filters.startTo) search.set("startTo", filters.startTo);
  const query = search.toString();
  return `/entries${query ? `?${query}` : ""}`;
}

export function analyticsEntryHrefs(filters: MisAnalyticsDrilldownFilters) {
  const tabs: Array<string | undefined> = filters.tabIds.length ? filters.tabIds : [undefined];
  const services: Array<string | undefined> = filters.serviceIds.length ? filters.serviceIds : [undefined];
  return tabs.flatMap((tabId) => services.map((serviceId) => ({
    href: analyticsEntryHref(filters, tabId, serviceId),
    label: [tabId ? `tab ${tabId}` : null, serviceId ? `service ${serviceId}` : null].filter(Boolean).join(" · ") || "Open entries",
  })));
}

async function analyticsError(response: Response, fallback: string) {
  try {
    const body = await response.json() as { error?: string; message?: string };
    return body.error || body.message || fallback;
  } catch {
    return `${fallback} (${response.status} ${response.statusText})`;
  }
}

export function useMisAnalytics(params: MisAnalyticsParams, options?: { enabled?: boolean }) {
  const { user } = useAuth();
  const userId = user?.id ?? "";
  return useQuery({
    // The endpoint is the stable cache namespace. Including the user prevents
    // one signed-in user from receiving another user's permission-scoped data.
    queryKey: [ANALYTICS_PATH, userId, params],
    queryFn: async ({ signal }): Promise<MisAnalyticsEnvelope> => {
      const search = new URLSearchParams();
      appendParams(search, params);
      const query = search.toString();
      const response = await fetch(`${artifactApiUrl(ANALYTICS_PATH)}${query ? `?${query}` : ""}`, {
        method: "GET",
        credentials: "same-origin",
        signal,
      });
      if (!response.ok) throw new Error(await analyticsError(response, "Failed to load MIS analytics."));
      return response.json() as Promise<MisAnalyticsEnvelope>;
    },
    enabled: Boolean(userId) && options?.enabled !== false,
  });
}

export function useMisAnalyticsExport() {
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const download = useCallback(async (params: MisAnalyticsParams & { format: MisAnalyticsFormat }) => {
    setIsDownloading(true);
    setDownloadError(null);
    try {
      const search = new URLSearchParams();
      appendParams(search, params);
      const response = await fetch(`${artifactApiUrl(`${ANALYTICS_PATH}/export`)}?${search.toString()}`, {
        method: "GET",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error(await analyticsError(response, "MIS analytics export failed."));
      const blob = await response.blob();
      if (!blob.size) throw new Error("The MIS analytics export was empty.");

      const contentDisposition = response.headers.get("content-disposition");
      const encodedName = contentDisposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
      const plainName = contentDisposition?.match(/filename="?([^";]+)"?/i)?.[1];
      const filename = encodedName
        ? decodeURIComponent(encodedName)
        : plainName || `mis-analytics.${params.format}`;
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : "Unable to download MIS analytics.");
    } finally {
      setIsDownloading(false);
    }
  }, []);

  return {
    download,
    isDownloading,
    downloadError,
    clearDownloadError: () => setDownloadError(null),
  };
}
