import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import {
  db,
  misEntriesTable,
  misProjectsTable,
  misProjectTabsTable,
  misServicesTable,
  misTabsTable,
} from "@workspace/db";
import { can, canAccessProject, type MisAccess } from "./access";
import { dateString, strictDate, xlsxWorkbook } from "./helpers";
import { analyticsPdf as professionalAnalyticsPdf } from "./exports/pdf";
import { analyticsXlsx } from "./exports/xlsx";
import type { AnalyticsExportData } from "./exports/model";

export const ANALYTICS_GROUPS = [
  "date",
  "project",
  "projectCode",
  "type",
  "service",
  "month",
  "year",
] as const;
export type AnalyticsGroup = (typeof ANALYTICS_GROUPS)[number];
export const ANALYTICS_VIEWS = ["daily", "weekly", "monthly", "custom"] as const;
export type AnalyticsView = (typeof ANALYTICS_VIEWS)[number];
export const ANALYTICS_MODES = ["analytics", "project", "service", "type", "dynamic"] as const;
export type AnalyticsMode = (typeof ANALYTICS_MODES)[number];
export const ANALYTICS_STATUSES = ["draft", "submitted", "approved", "rejected", "returned", "cancelled"] as const;
export type AnalyticsStatus = (typeof ANALYTICS_STATUSES)[number];
export type AnalyticsStatusSelection = AnalyticsStatus | "all";
export const ANALYTICS_REPORT_TYPES = [
  "income",
  "cost",
  "expense",
  "salary",
  "summary",
  "project-profitability",
  "project-comparison",
  "period-comparison",
  "service-tab-comparison",
] as const;
export type AnalyticsReportType = (typeof ANALYTICS_REPORT_TYPES)[number];
export type AnalyticsFormat = "csv" | "xlsx" | "pdf";

export interface AnalyticsPeriod {
  id: string;
  label: string;
  from: string;
  to: string;
}

export interface AnalyticsFilters {
  projectIds: string[];
  projectCode: string | null;
  tabIds: string[];
  serviceIds: string[];
  serviceCodes: string[];
  types: string[];
  /** Optional report category; summary/comparison reports retain all classes. */
  reportType: AnalyticsReportType;
  /** Optional free-text search over the scoped project/tab/service snapshot. */
  search: string | null;
  /** Optional ISO-4217 currency restriction; omitted means separate groups. */
  currency: string | null;
  from: string | null;
  to: string | null;
  /** `statuses` is authoritative; `status` preserves the legacy scalar. */
  status: AnalyticsStatusSelection;
  statuses: AnalyticsStatus[];
  compareFrom: string | null;
  compareTo: string | null;
  groupBy: AnalyticsGroup[];
  view: AnalyticsView;
  mode: AnalyticsMode;
  page: number;
  pageSize: number;
  periodComparison: boolean;
  periods: AnalyticsPeriod[];
  /**
   * Resolved server-side because service codes are intentionally scoped before
   * the aggregate. An empty array means a requested code matched no permitted
   * service and must remain an empty result, not an unrestricted query.
   */
  resolvedServiceIds?: string[];
}

export interface ParsedAnalyticsQuery {
  filters: AnalyticsFilters;
  format?: AnalyticsFormat;
}

export class AnalyticsQueryError extends Error {
  readonly status = 400;
}

export class AnalyticsAuthorizationError extends Error {
  readonly status = 403;
}

function scalar(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.length === 1 && typeof value[0] === "string") return value[0];
  return undefined;
}

function list(value: unknown, field: string): string[] {
  if (value == null) return [];
  const values = Array.isArray(value) ? value : [value];
  const result: string[] = [];
  for (const item of values) {
    if (typeof item !== "string") throw new AnalyticsQueryError(`${field} must be a comma-separated string`);
    for (const part of item.split(",")) {
      const trimmed = part.trim();
      if (!trimmed) throw new AnalyticsQueryError(`${field} contains an empty value`);
      result.push(trimmed);
    }
  }
  return [...new Set(result)];
}

function dateParameter(value: unknown, field: string): string | null {
  if (value == null || value === "") return null;
  const text = scalar(value);
  const date = strictDate(text);
  if (!date) throw new AnalyticsQueryError(`${field} must be a real calendar date in YYYY-MM-DD format`);
  return date;
}

function textParameter(value: unknown, field: string, maxLength: number): string | null {
  if (value == null || value === "") return null;
  const text = scalar(value);
  if (text == null) throw new AnalyticsQueryError(`${field} must be a single string`);
  if (text.length > maxLength) throw new AnalyticsQueryError(`${field} is too long`);
  const trimmed = text.trim();
  return trimmed || null;
}

function currencyParameter(value: unknown): string | null {
  const text = textParameter(value, "currency", 3);
  if (text == null) return null;
  if (!/^[A-Za-z]{3}$/.test(text)) {
    throw new AnalyticsQueryError("currency must be a three-letter ISO code");
  }
  return text.toUpperCase();
}

function reportTypeParameter(value: unknown): AnalyticsReportType {
  if (value == null || value === "") return "summary";
  const text = scalar(value)?.trim().toLowerCase();
  if (!text || !(ANALYTICS_REPORT_TYPES as readonly string[]).includes(text)) {
    throw new AnalyticsQueryError("reportType is invalid");
  }
  return text as AnalyticsReportType;
}

function enumParameter<T extends readonly string[]>(value: unknown, values: T, field: string, fallback: T[number]): T[number] {
  const text = scalar(value) ?? fallback;
  if (!(values as readonly string[]).includes(text)) throw new AnalyticsQueryError(`${field} is invalid`);
  return text as T[number];
}

function booleanParameter(value: unknown, field: string, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (Array.isArray(value) && value.length === 1) return booleanParameter(value[0], field, fallback);
  const text = scalar(value);
  if (text == null || text === "") return fallback;
  const normalized = text.toLowerCase();
  if (["true", "1", "on"].includes(normalized)) return true;
  if (["false", "0", "off"].includes(normalized)) return false;
  throw new AnalyticsQueryError(`${field} must be true or false`);
}

function periodParameter(value: unknown): AnalyticsPeriod[] {
  const direct = Array.isArray(value) && value.every((item) => item && typeof item === "object" && !Array.isArray(item))
    ? value
    : null;
  if (direct) return parsePeriodItems(direct);
  const text = scalar(value);
  if (text == null || text === "") throw new AnalyticsQueryError("periods must be a JSON array");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AnalyticsQueryError("periods must be valid JSON");
  }
  if (!Array.isArray(parsed)) throw new AnalyticsQueryError("periods must be a JSON array");
  return parsePeriodItems(parsed);
}

function parsePeriodItems(parsed: unknown[]): AnalyticsPeriod[] {
  if (parsed.length < 3) throw new AnalyticsQueryError("periods must contain at least three periods");
  if (parsed.length > 24) throw new AnalyticsQueryError("periods must contain no more than 24 periods");
  const ids = new Set<string>();
  return parsed.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new AnalyticsQueryError(`periods[${index}] must be an object`);
    }
    const item = value as Record<string, unknown>;
    if (typeof item.id !== "string" || !item.id.trim() || item.id.length > 128) {
      throw new AnalyticsQueryError(`periods[${index}].id must be a non-empty string`);
    }
    const id = item.id.trim();
    if (ids.has(id)) throw new AnalyticsQueryError("period IDs must be unique");
    ids.add(id);
    // The attachment makes the label optional. Using the stable ID as a
    // fallback keeps every period serializable without inventing data.
    const label = typeof item.label === "string" && item.label.trim() ? item.label.trim() : id;
    if (label.length > 200) throw new AnalyticsQueryError(`periods[${index}].label is too long`);
    const from = strictDate(item.from);
    const to = strictDate(item.to);
    if (!from || !to) throw new AnalyticsQueryError(`periods[${index}] must contain real YYYY-MM-DD dates`);
    if (from > to) throw new AnalyticsQueryError(`periods[${index}].from must be no later than to`);
    return { id, label, from, to };
  });
}

function integerParameter(value: unknown, field: string, fallback: number, min: number, max: number): number {
  const text = scalar(value);
  if (text == null || text === "") return fallback;
  if (!/^\d+$/.test(text)) throw new AnalyticsQueryError(`${field} must be an integer`);
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new AnalyticsQueryError(`${field} is outside its allowed range`);
  return parsed;
}

/**
 * Parse without a zod schema so this additive route does not require changes
 * to the generated API package owned by the core MIS implementation.
 */
export function parseAnalyticsQuery(raw: Record<string, unknown>, exportRequest = false): ParsedAnalyticsQuery {
  const projectIds = list(raw.projectIds, "projectIds");
  const tabIds = list(raw.tabIds, "tabIds");
  const serviceIds = list(raw.serviceIds, "serviceIds");
  const serviceCodes = list(raw.serviceCodes, "serviceCodes");
  const types = list(raw.types ?? raw.type ?? raw.entryType, "types");
  const reportType = reportTypeParameter(raw.reportType);
  const search = textParameter(raw.search, "search", 200);
  const currency = currencyParameter(raw.currency);
  const from = dateParameter(raw.from, "from");
  const to = dateParameter(raw.to, "to");
  const compareFrom = dateParameter(raw.compareFrom, "compareFrom");
  const compareTo = dateParameter(raw.compareTo, "compareTo");
  if ((from == null) !== (to == null)) throw new AnalyticsQueryError("from and to must be supplied together");
  if (from && to && from > to) throw new AnalyticsQueryError("from must be no later than to");
  if ((compareFrom == null) !== (compareTo == null)) throw new AnalyticsQueryError("compareFrom and compareTo must be supplied together");
  if (compareFrom && compareTo && compareFrom > compareTo) throw new AnalyticsQueryError("compareFrom must be no later than compareTo");

  const view = enumParameter(raw.view, ANALYTICS_VIEWS, "view", "monthly");
  const mode = enumParameter(raw.mode, ANALYTICS_MODES, "mode", "analytics");
  const periodComparison = booleanParameter(raw.periodComparison, "periodComparison", false);
  const statusValues = raw.status == null ? [] : list(raw.status, "status");
  const statuses = statusValues.includes("all")
    ? [...ANALYTICS_STATUSES]
    : statusValues.length
      ? statusValues.map((item) => {
        if (!(ANALYTICS_STATUSES as readonly string[]).includes(item)) throw new AnalyticsQueryError("status is invalid");
        return item as AnalyticsStatus;
      })
      : ["approved" as AnalyticsStatus];
  const status: AnalyticsStatusSelection = statusValues.includes("all")
    ? "all"
    : statuses.length === 1 ? statuses[0] : "all";
  const periods = periodComparison ? periodParameter(raw.periods) : [];
  const suppliedGroupBy = list(raw.groupBy, "groupBy");
  if (suppliedGroupBy.some((item) => !(ANALYTICS_GROUPS as readonly string[]).includes(item))) {
    throw new AnalyticsQueryError("groupBy contains an unsupported dimension");
  }
  if (new Set(suppliedGroupBy).size !== suppliedGroupBy.length) throw new AnalyticsQueryError("groupBy dimensions must be unique");
  let groupBy = suppliedGroupBy as AnalyticsGroup[];
  if (!groupBy.length && mode !== "dynamic") {
    groupBy = mode === "project" ? ["project"] : mode === "service" ? ["service"] : mode === "type" ? ["type"] : [];
  }
  if (mode === "dynamic" && !groupBy.length) throw new AnalyticsQueryError("dynamic mode requires groupBy");
  if (view === "custom" && !periodComparison && (!from || !to)) throw new AnalyticsQueryError("custom view requires from and to");

  const formatValue = scalar(raw.format);
  let format: AnalyticsFormat | undefined;
  if (exportRequest) {
    if (!formatValue || !(["csv", "xlsx", "pdf"] as string[]).includes(formatValue)) throw new AnalyticsQueryError("format must be csv, xlsx, or pdf");
    format = formatValue as AnalyticsFormat;
  } else if (formatValue != null) {
    throw new AnalyticsQueryError("format is only valid for exports");
  }

  return {
    format,
    filters: {
      projectIds,
      projectCode: scalar(raw.projectCode)?.trim() || null,
      tabIds,
      serviceIds,
      serviceCodes,
      types,
      reportType,
      search,
      currency,
      from,
      to,
      status,
      statuses,
      compareFrom,
      compareTo,
      groupBy,
      view,
      mode,
      page: integerParameter(raw.page, "page", 1, 1, 2_000_000_000),
      pageSize: integerParameter(raw.pageSize, "pageSize", 50, 1, 500),
      periodComparison,
      periods,
    },
  };
}

interface ScopeResult {
  projectIds: string[];
  filters: AnalyticsFilters;
}

/**
 * Resolve every explicit identifier before constructing the aggregate query.
 * This is deliberately stricter than the existing entry list, which safely
 * intersects stale project picker values.
 */
export async function resolveAnalyticsScope(access: MisAccess, filters: AnalyticsFilters, requireExport = false): Promise<ScopeResult> {
  const projectRows = await db.select({ id: misProjectsTable.id }).from(misProjectsTable);
  const permitted = new Set(projectRows
    .map((row) => row.id)
    .filter((projectId) => canAccessProject(access, projectId)
      && can(access, "reports", projectId)
      && can(access, "financial", projectId)));
  if (filters.projectIds.some((projectId) => !permitted.has(projectId))) {
    throw new AnalyticsAuthorizationError("One or more requested projects are not permitted");
  }
  const projectIds = filters.projectIds.length ? filters.projectIds : [...permitted];
  if (!projectIds.length) {
    // A genuinely empty MIS installation is a valid empty analytics scope for
    // a global reports+financial administrator. It must not become a false
    // 403 or generate `IN ()` SQL.
    if (projectRows.length === 0 && can(access, "reports") && can(access, "financial")) {
      if (filters.tabIds.length || filters.serviceIds.length) {
        throw new AnalyticsAuthorizationError("One or more requested tabs or services are not permitted");
      }
      return {
        projectIds: [],
        filters: { ...filters, resolvedServiceIds: filters.serviceCodes.length ? [] : undefined },
      };
    }
    throw new AnalyticsAuthorizationError("Reports and financial permissions are required for at least one project");
  }
  // Export scope is checked after the complete reports+financial scope is
  // computed. Omitted projectIds therefore cannot silently narrow an export
  // to projects which happen to have export permission.
  if (requireExport && projectIds.some((projectId) => !can(access, "export", projectId))) {
    throw new AnalyticsAuthorizationError("Export permission is required for every included project");
  }

  if (filters.tabIds.length) {
    const tabs = await db.select({ id: misTabsTable.id, allowReporting: misTabsTable.allowReporting })
      .from(misTabsTable).where(inArray(misTabsTable.id, filters.tabIds));
    if (tabs.length !== filters.tabIds.length || tabs.some((tab) => !tab.allowReporting)) {
      throw new AnalyticsAuthorizationError("One or more requested tabs are not permitted reporting tabs");
    }
    const assignments = await db.select({ tabId: misProjectTabsTable.tabId })
      .from(misProjectTabsTable)
      .where(and(inArray(misProjectTabsTable.projectId, projectIds), inArray(misProjectTabsTable.tabId, filters.tabIds), eq(misProjectTabsTable.enabled, true)));
    const assigned = new Set(assignments.map((row) => row.tabId));
    if (filters.tabIds.some((tabId) => !assigned.has(tabId))) {
      throw new AnalyticsAuthorizationError("One or more requested tabs are not enabled in the permitted project scope");
    }
  }

  const visibleServiceRows = await db.select({ id: misServicesTable.id, name: misServicesTable.name, code: misServicesTable.code, projectId: misServicesTable.projectId })
    .from(misServicesTable)
    .innerJoin(misTabsTable, eq(misTabsTable.id, misServicesTable.tabId))
    .innerJoin(misProjectTabsTable, and(eq(misProjectTabsTable.projectId, misServicesTable.projectId), eq(misProjectTabsTable.tabId, misServicesTable.tabId)))
    .where(and(
      inArray(misServicesTable.projectId, projectIds),
      eq(misTabsTable.allowReporting, true),
      eq(misProjectTabsTable.enabled, true),
    ));
  const visibleServices = new Set(visibleServiceRows.map((row) => row.id));
  if (filters.serviceIds.some((serviceId) => !visibleServices.has(serviceId))) {
    throw new AnalyticsAuthorizationError("One or more requested services are not permitted reporting services");
  }
  const matchedCodes = filters.serviceCodes.length
    ? visibleServiceRows.filter((row) => filters.serviceCodes.some((code) => code.toLowerCase() === row.code.toLowerCase())).map((row) => row.id)
    : null;
  let resolvedServiceIds: string[] | undefined;
  if (filters.serviceIds.length && matchedCodes) {
    const codes = new Set(matchedCodes);
    resolvedServiceIds = filters.serviceIds.filter((serviceId) => codes.has(serviceId));
  } else if (filters.serviceIds.length) {
    resolvedServiceIds = filters.serviceIds;
  } else if (matchedCodes) {
    resolvedServiceIds = matchedCodes;
  }

  return { projectIds, filters: { ...filters, resolvedServiceIds } };
}

export interface AggregateRecord {
  currency: string;
  project_id: string | null;
  project_name: string | null;
  project_code: string | null;
  project_ids: string[] | null;
  tab_id: string | null;
  tab_name: string | null;
  tab_ids: string[] | null;
  type: string | null;
  service_ids: string[] | null;
  service_code: string | null;
  service_name: string | null;
  period_start: string | Date | null;
  period_end: string | Date | null;
  date_start: string | Date | null;
  date_end: string | Date | null;
  month_start: string | Date | null;
  month_end: string | Date | null;
  year_start: string | Date | null;
  year_end: string | Date | null;
  total_amount: string | number;
  total_quantity: string | number;
  total_income: string | number;
  total_cost: string | number;
  total_expenses: string | number;
  total_salaries: string | number;
  rate_min: string | number | null;
  rate_max: string | number | null;
  rate_varied: boolean;
  units: string[] | null;
  entry_count: number | string;
  calculate_percent_against_income?: boolean | null;
  service_order?: number | string | null;
}

/**
 * The assignment join is part of the aggregate scope, not merely a metadata
 * validation. An entry left behind after a tab is disabled must disappear
 * from totals, groups, and trends alike.
 */
export const ANALYTICS_SCOPE_JOIN_SQL =
  "INNER JOIN mis_project_tabs pt ON pt.project_id = e.project_id AND pt.tab_id = e.tab_id AND pt.enabled IS TRUE";

interface DateRange {
  from: string | null;
  to: string | null;
}

const raw = (value: string): SQL => sql.raw(value);
const values = (items: string[]): SQL => sql.join(items.map((item) => sql`${item}`), sql`, `);
const text = (value: unknown): string | null => {
  if (value == null) return null;
  if (value instanceof Date) return dateString(value);
  return String(value);
};
const numberValue = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

function dateBucket(view: AnalyticsView, range: DateRange, fixed: "date" | "month" | "year"): { start: SQL; end: SQL } {
  if (view === "custom" && fixed === "date") {
    return { start: sql`${range.from}::date`, end: sql`${range.to}::date` };
  }
  const expression = fixed === "month"
    ? raw("date_trunc('month', e.from_date)::date")
    : fixed === "year"
      ? raw("date_trunc('year', e.from_date)::date")
      : view === "weekly"
        ? raw("date_trunc('week', e.from_date)::date")
        : view === "monthly"
          ? raw("date_trunc('month', e.from_date)::date")
          : raw("e.from_date");
  const end = fixed === "year"
    ? sql`(${expression} + INTERVAL '1 year' - INTERVAL '1 day')::date`
    : fixed === "month" || view === "monthly"
      ? sql`(${expression} + INTERVAL '1 month' - INTERVAL '1 day')::date`
      : view === "weekly"
        ? sql`(${expression} + INTERVAL '6 days')::date`
        : expression;
  const start = range.from ? sql`GREATEST(${expression}, ${range.from}::date)` : expression;
  const boundedEnd = range.to ? sql`LEAST(${end}, ${range.to}::date)` : end;
  return { start, end: boundedEnd };
}

function dimensionsFor(filters: AnalyticsFilters, trend: boolean): AnalyticsGroup[] {
  return trend ? ["date"] : filters.groupBy;
}

async function aggregateRows(filters: AnalyticsFilters, projectIds: string[], range: DateRange, trend = false): Promise<AggregateRecord[]> {
  if (!projectIds.length || (filters.resolvedServiceIds && !filters.resolvedServiceIds.length)) return [];
  const dimensions = dimensionsFor(filters, trend);
  const selectFields: SQL[] = [
    raw("e.currency AS currency"),
    raw("ARRAY_AGG(DISTINCT e.project_id)::text[] AS project_ids"),
    raw("ARRAY_AGG(DISTINCT e.tab_id)::text[] AS tab_ids"),
    raw("ARRAY_AGG(DISTINCT e.service_id)::text[] AS service_ids"),
    raw("COALESCE(SUM(e.amount), 0)::numeric AS total_amount"),
    raw("COALESCE(SUM(e.quantity), 0)::numeric AS total_quantity"),
    raw("COALESCE(SUM(CASE WHEN e.financial_class = 'income' THEN e.amount ELSE 0 END), 0)::numeric AS total_income"),
    raw("COALESCE(SUM(CASE WHEN e.financial_class = 'cost' THEN e.amount ELSE 0 END), 0)::numeric AS total_cost"),
    raw("COALESCE(SUM(CASE WHEN e.financial_class = 'expense' THEN e.amount ELSE 0 END), 0)::numeric AS total_expenses"),
    raw("COALESCE(SUM(CASE WHEN e.financial_class = 'salary' THEN e.amount ELSE 0 END), 0)::numeric AS total_salaries"),
     raw("MIN(e.rate)::numeric AS rate_min"),
    raw("MAX(e.rate)::numeric AS rate_max"),
    raw("(COUNT(DISTINCT e.rate) > 1) AS rate_varied"),
    raw("ARRAY_AGG(DISTINCT e.unit ORDER BY e.unit)::text[] AS units"),
    raw("COUNT(*)::int AS entry_count"),
      raw("CASE WHEN BOOL_AND(e.calculate_percent_against_income IS TRUE) THEN TRUE WHEN BOOL_OR(e.calculate_percent_against_income IS TRUE) THEN NULL ELSE FALSE END AS calculate_percent_against_income"),
  ];
  const groupFields: SQL[] = [raw("e.currency")];
  const orderFields: SQL[] = [raw("e.currency")];

  for (const dimension of dimensions) {
    if (dimension === "date" || dimension === "month" || dimension === "year") {
      const bucket = dateBucket(filters.view, range, dimension === "date" ? "date" : dimension);
      const prefix = dimension === "date" ? "date" : dimension;
      selectFields.push(sql`${bucket.start} AS ${raw(`${prefix}_start`)}`, sql`${bucket.end} AS ${raw(`${prefix}_end`)}`);
      // Repeating a parameterized expression generates different $n bindings.
      // PostgreSQL cannot equate those expressions for GROUP BY; use the
      // whitelisted SELECT aliases so each date bound is bound only once.
      groupFields.push(raw(`${prefix}_start`), raw(`${prefix}_end`));
      orderFields.push(raw(`${prefix}_start`));
    } else if (dimension === "project") {
      selectFields.push(raw("e.project_id AS project_id"), raw("p.name AS project_name"), raw("p.code AS project_code"));
      groupFields.push(raw("e.project_id"), raw("p.name"), raw("p.code"));
      orderFields.push(raw("p.name"), raw("e.project_id"));
    } else if (dimension === "projectCode") {
      selectFields.push(raw("MIN(p.name) AS project_name"), raw("p.code AS project_code"));
      groupFields.push(raw("p.code"));
      orderFields.push(raw("p.code"));
    } else if (dimension === "type") {
      // `type` remains the stable entry enum used by filters, while the
      // configured tab identity keeps separate custom categories that all
      // persist as `other` in mis_entries.
      selectFields.push(raw("e.type AS type"), raw("t.id AS tab_id"), raw("t.name AS tab_name"));
      groupFields.push(raw("e.type"), raw("t.id"), raw("t.name"));
      orderFields.push(raw("t.name"), raw("e.type"), raw("t.id"));
    } else if (dimension === "service") {
      // Group on the stable code so the same service compares across projects.
      selectFields.push(raw("LOWER(s.code) AS service_code"), raw("MIN(s.name) AS service_name"), raw("MIN(s.sequence) AS service_order"));
      groupFields.push(raw("LOWER(s.code)"));
      // Service order is persisted per project and is the canonical ordering
      // used by entry/report surfaces. Code is a deterministic tie-breaker
      // when a cross-project service group has different sequence values.
      orderFields.push(raw("MIN(s.sequence)"), raw("LOWER(s.code)"));
    }
  }

  const conditions: SQL[] = [
    raw("e.deleted_at IS NULL"),
    raw("t.allow_reporting IS TRUE"),
    sql`e.status IN (${values(filters.statuses)})`,
    sql`e.project_id IN (${values(projectIds)})`,
  ];
  if (["income", "cost", "expense", "salary"].includes(filters.reportType)) {
    // Category report types follow the persisted financial class, not the
    // tab's entry type (for example a custom "other" tab can be expense).
    conditions.push(sql`e.financial_class = ${filters.reportType}`);
  }
  if (filters.projectCode) conditions.push(sql`p.code ILIKE ${`%${filters.projectCode}%`}`);
  if (filters.search) {
    const term = `%${filters.search}%`;
    conditions.push(sql`(
      p.name ILIKE ${term}
      OR p.code ILIKE ${term}
      OR t.name ILIKE ${term}
      OR s.name ILIKE ${term}
      OR s.code ILIKE ${term}
      OR e.project_name ILIKE ${term}
      OR e.tab_name ILIKE ${term}
      OR e.service_name ILIKE ${term}
      OR COALESCE(e.remarks, '') ILIKE ${term}
    )`);
  }
  if (filters.currency) conditions.push(sql`e.currency = ${filters.currency}`);
  if (filters.tabIds.length) conditions.push(sql`e.tab_id IN (${values(filters.tabIds)})`);
  if (filters.resolvedServiceIds) conditions.push(sql`e.service_id IN (${values(filters.resolvedServiceIds)})`);
  if (filters.types.length) conditions.push(sql`e.type IN (${values(filters.types)})`);
  if (range.from) conditions.push(sql`e.from_date >= ${range.from}::date`);
  if (range.to) conditions.push(sql`e.to_date <= ${range.to}::date`);

  const query = sql`
    SELECT ${sql.join(selectFields, sql`, `)}
    FROM mis_entries e
    INNER JOIN mis_projects p ON p.id = e.project_id
    INNER JOIN mis_tabs t ON t.id = e.tab_id
    INNER JOIN mis_services s ON s.id = e.service_id
    ${raw(ANALYTICS_SCOPE_JOIN_SQL)}
    WHERE ${sql.join(conditions, sql` AND `)}
    GROUP BY ${sql.join(groupFields, sql`, `)}
    ORDER BY ${sql.join(orderFields, sql`, `)}
  `;
  const result = await db.execute(query);
  return result.rows as unknown as AggregateRecord[];
}

export interface AnalyticsMetricSet {
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
  /** Null means the effective category/service setting disables this value. */
  percentageAgainstIncome?: number | null;
}

const metricDifferenceKeys = [
  "totalIncome", "totalCost", "totalExpenses", "totalSalaries", "grossProfit",
  "netProfit", "profitMargin", "totalAmount", "quantity", "entryCount",
] as const;
type MetricDifferenceKey = (typeof metricDifferenceKeys)[number];
export type AnalyticsMetricDifference = Record<MetricDifferenceKey, number>;
export type AnalyticsMetricPercentDifference = Record<MetricDifferenceKey, number | null>;

function contribution(value: number, denominator: number): number {
  return denominator === 0 ? 0 : (value / denominator) * 100;
}

function publicMetrics(row: AggregateRecord, denominator: AggregateRecord): AnalyticsMetricSet {
  const totalIncome = numberValue(row.total_income);
  const totalCost = numberValue(row.total_cost);
  const totalExpenses = numberValue(row.total_expenses);
  const totalSalaries = numberValue(row.total_salaries);
  const totalAmount = numberValue(row.total_amount);
  const quantity = numberValue(row.total_quantity);
  const grossProfit = totalIncome - totalCost - totalExpenses - totalSalaries;
  const netProfit = grossProfit;
  const denominatorIncome = numberValue(denominator.total_income);
  const denominatorCost = numberValue(denominator.total_cost);
  const denominatorExpenses = numberValue(denominator.total_expenses);
  const denominatorSalaries = numberValue(denominator.total_salaries);
  const denominatorAmount = numberValue(denominator.total_amount);
  const percentageEnabled = row.calculate_percent_against_income === true;
  return {
    totalIncome,
    totalCost,
    totalExpenses,
    totalSalaries,
    grossProfit,
    netProfit,
    profitMargin: totalIncome === 0 ? 0 : (netProfit / totalIncome) * 100,
    totalAmount,
    quantity,
    weightedRate: quantity === 0 ? null : totalAmount / quantity,
    rateMin: row.rate_min == null ? null : numberValue(row.rate_min),
    rateMax: row.rate_max == null ? null : numberValue(row.rate_max),
    rateVaried: Boolean(row.rate_varied),
    units: row.units ?? [],
    unitVaried: (row.units ?? []).length > 1,
    entryCount: Math.trunc(numberValue(row.entry_count)),
    contributionPercent: contribution(totalAmount, denominatorAmount),
    incomeContributionPercent: contribution(totalIncome, denominatorIncome),
    costContributionPercent: contribution(totalCost, denominatorCost),
    expensesContributionPercent: contribution(totalExpenses, denominatorExpenses),
    salariesContributionPercent: contribution(totalSalaries, denominatorSalaries),
    percentageAgainstIncome: percentageEnabled ? contribution(totalAmount, denominatorIncome) : null,
  };
}

function zeroRecord(currency: string, template?: AggregateRecord): AggregateRecord {
  return {
    currency,
    project_id: template?.project_id ?? null,
    project_name: template?.project_name ?? null,
    project_code: template?.project_code ?? null,
    project_ids: template?.project_ids ?? [],
    tab_id: template?.tab_id ?? null,
    tab_name: template?.tab_name ?? null,
    tab_ids: template?.tab_ids ?? [],
    type: template?.type ?? null,
    service_ids: template?.service_ids ?? [],
    service_code: template?.service_code ?? null,
    service_name: template?.service_name ?? null,
    period_start: template?.period_start ?? null,
    period_end: template?.period_end ?? null,
    date_start: template?.date_start ?? null,
    date_end: template?.date_end ?? null,
    month_start: template?.month_start ?? null,
    month_end: template?.month_end ?? null,
    year_start: template?.year_start ?? null,
    year_end: template?.year_end ?? null,
    total_amount: 0,
    total_quantity: 0,
    total_income: 0,
    total_cost: 0,
    total_expenses: 0,
    total_salaries: 0,
    rate_min: null,
    rate_max: null,
    rate_varied: false,
    units: [],
    entry_count: 0,
    calculate_percent_against_income: false,
    service_order: null,
  };
}

function dimensionKey(row: AggregateRecord, dimensions: AnalyticsGroup[]): string {
  const values: (string | null)[] = [row.currency];
  for (const dimension of dimensions) {
    values.push(
      dimension === "date" || dimension === "month" || dimension === "year" ? text(periodValue(row, dimension).start)
        : dimension === "project" ? row.project_id
          : dimension === "projectCode" ? row.project_code
            : dimension === "type" ? `${row.type ?? ""}:${row.tab_id ?? ""}`
              : row.service_code,
    );
  }
  return JSON.stringify(values);
}

function periodValue(row: AggregateRecord, dimension: "date" | "month" | "year"): { start: string | Date | null; end: string | Date | null } {
  if (dimension === "date") return { start: row.date_start ?? row.period_start, end: row.date_end ?? row.period_end };
  if (dimension === "month") return { start: row.month_start ?? row.period_start, end: row.month_end ?? row.period_end };
  return { start: row.year_start ?? row.period_start, end: row.year_end ?? row.period_end };
}

function sortKey(row: AggregateRecord, dimensions: AnalyticsGroup[]): string {
  return [
    row.currency,
    ...dimensions.map((dimension) => dimension === "service"
      ? `${String(Math.trunc(numberValue(row.service_order ?? 2_147_483_647))).padStart(12, "0")}:${row.service_code ?? ""}`
      : dimensionKey(row, [dimension])),
  ].join("\u0000");
}

export function mergeAnalyticsRecords(current: AggregateRecord[], previous: AggregateRecord[], dimensions: AnalyticsGroup[]): Array<{ current: AggregateRecord; previous: AggregateRecord | null }> {
  const map = new Map<string, { current: AggregateRecord; previous: AggregateRecord | null }>();
  for (const row of current) map.set(dimensionKey(row, dimensions), { current: row, previous: null });
  for (const row of previous) {
    const key = dimensionKey(row, dimensions);
    const existing = map.get(key);
    if (existing) existing.previous = row;
    else map.set(key, { current: zeroRecord(row.currency, row), previous: row });
  }
  return [...map.values()].sort((left, right) => sortKey(left.current, dimensions).localeCompare(sortKey(right.current, dimensions)));
}

export function metricDifference(current: AnalyticsMetricSet, previous: AnalyticsMetricSet): AnalyticsMetricDifference {
  return Object.fromEntries(metricDifferenceKeys.map((key) => [key, current[key] - previous[key]])) as AnalyticsMetricDifference;
}

export function metricPercentDifference(current: AnalyticsMetricSet, previous: AnalyticsMetricSet): AnalyticsMetricPercentDifference {
  return Object.fromEntries(metricDifferenceKeys.map((key) => [
    key,
    previous[key] === 0 ? null : ((current[key] - previous[key]) / previous[key]) * 100,
  ])) as AnalyticsMetricPercentDifference;
}

function rowDimensions(row: AggregateRecord) {
  const projectIds = row.project_ids ?? [];
  const tabIds = row.tab_ids ?? [];
  const serviceIds = row.service_ids ?? [];
  return {
    projectId: row.project_id ?? (projectIds.length === 1 ? projectIds[0] : null),
    projectIds,
    projectName: row.project_name,
    projectCode: row.project_code,
    tabId: row.tab_id ?? (tabIds.length === 1 ? tabIds[0] : null),
    tabIds,
    tabName: row.tab_name,
    type: row.type,
    serviceId: serviceIds.length === 1 ? serviceIds[0] : null,
    serviceIds,
    serviceCode: row.service_code,
    serviceName: row.service_name,
    serviceOrder: row.service_order == null ? null : numberValue(row.service_order),
    calculatePercentAgainstIncome: row.calculate_percent_against_income === true,
    periodStart: text(row.date_start ?? row.month_start ?? row.year_start ?? row.period_start),
    periodEnd: text(row.date_end ?? row.month_end ?? row.year_end ?? row.period_end),
  };
}

export interface AnalyticsDrilldownFilters {
  projectIds: string[];
  tabIds: string[];
  serviceIds: string[];
  entryType: string | null;
  status: AnalyticsStatusSelection;
  statuses: AnalyticsStatus[];
  currency: string;
  search: string | null;
  from: string | null;
  to: string | null;
  startFrom: string | null;
  startTo: string | null;
}

export function analyticsDrilldownFilters(
  row: AggregateRecord,
  filters: AnalyticsFilters,
  usePreviousRange = false,
): AnalyticsDrilldownFilters {
  const start = text(row.date_start ?? row.month_start ?? row.year_start ?? row.period_start);
  const end = text(row.date_end ?? row.month_end ?? row.year_end ?? row.period_end);
  const from = usePreviousRange ? filters.compareFrom : filters.from;
  const to = usePreviousRange ? filters.compareTo : filters.to;
  return {
    projectIds: row.project_ids ?? [],
    tabIds: row.tab_ids ?? [],
    serviceIds: row.service_ids ?? [],
    entryType: row.type,
    status: filters.status,
    statuses: filters.statuses,
    currency: row.currency,
    search: filters.search,
    // from/to remain the complete report range. startFrom/startTo are the
    // period-start bucket selectors added to the Entries endpoint.
    from,
    to,
    startFrom: start,
    startTo: end,
  };
}

function comparisonShape(
  current: AggregateRecord,
  previous: AggregateRecord | null,
  currentTotal: AggregateRecord,
  previousTotal: AggregateRecord | null,
) {
  const currentMetrics = publicMetrics(current, currentTotal);
  if (!previousTotal || !previous) {
    return { current: currentMetrics, previous: null, difference: null, percentageDifference: null };
  }
  const previousMetrics = publicMetrics(previous, previousTotal);
  return {
    current: currentMetrics,
    previous: previousMetrics,
    difference: metricDifference(currentMetrics, previousMetrics),
    percentageDifference: metricPercentDifference(currentMetrics, previousMetrics),
  };
}

function normalizedFilterResponse(filters: AnalyticsFilters, projectIds: string[]) {
  return {
    projectIds,
    projectCode: filters.projectCode,
    tabIds: filters.tabIds,
    serviceIds: filters.serviceIds,
    serviceCodes: filters.serviceCodes,
    types: filters.types,
    reportType: filters.reportType,
    search: filters.search,
    currency: filters.currency,
    from: filters.from,
    to: filters.to,
    status: filters.status,
    statuses: filters.statuses,
    groupBy: filters.groupBy,
    view: filters.view,
    mode: filters.mode,
    page: filters.page,
    pageSize: filters.pageSize,
    compareFrom: filters.compareFrom,
    compareTo: filters.compareTo,
    periodComparison: filters.periodComparison,
    periods: filters.periods,
  };
}

export interface AnalyticsPeriodResult {
  period: AnalyticsPeriod;
  totalsByCurrency: AnalyticsEnvelope["totalsByCurrency"];
  rows: Array<Record<string, unknown>>;
  trend: Array<Record<string, unknown>>;
  pagination: { page: number; pageSize: number; total: number; pageCount: number };
}

export interface AnalyticsEnvelope {
  filters: ReturnType<typeof normalizedFilterResponse>;
  dateBasis: "period_start";
  totalsByCurrency: Array<{
    currency: string;
    current: AnalyticsMetricSet;
    previous: AnalyticsMetricSet | null;
    difference: AnalyticsMetricDifference | null;
    percentageDifference: AnalyticsMetricPercentDifference | null;
  }>;
  rows: Array<Record<string, unknown>>;
  trend: Array<Record<string, unknown>>;
  pagination: { page: number; pageSize: number; total: number; pageCount: number };
  /** Additive only; omitted for legacy single-period/current-previous calls. */
  periods?: AnalyticsPeriodResult[];
}

/** Currency totals must never inherit the requested grouped dimensions. */
export function analyticsTotalsFilters(filters: AnalyticsFilters): AnalyticsFilters {
  return { ...filters, groupBy: [] };
}

/**
 * Run all analytics as database aggregates. The export flag only skips the
 * final grouped-row slice; it does not change filters or authorization.
 */
async function runAnalyticsRange(
  filters: AnalyticsFilters,
  projectIds: string[],
  exportAll: boolean,
): Promise<Omit<AnalyticsEnvelope, "periods">> {
  const currentRange: DateRange = { from: filters.from, to: filters.to };
  const previousRange: DateRange = { from: filters.compareFrom, to: filters.compareTo };
  const hasComparison = Boolean(filters.compareFrom && filters.compareTo);
  const dimensions = filters.groupBy;
  const [currentTotals, currentGroups, currentTrend, previousTotals, previousGroups, previousTrend] = await Promise.all([
    aggregateRows(analyticsTotalsFilters(filters), projectIds, currentRange),
    aggregateRows(filters, projectIds, currentRange),
    aggregateRows(filters, projectIds, currentRange, true),
    hasComparison ? aggregateRows(analyticsTotalsFilters(filters), projectIds, previousRange) : Promise.resolve([]),
    hasComparison ? aggregateRows(filters, projectIds, previousRange) : Promise.resolve([]),
    hasComparison ? aggregateRows(filters, projectIds, previousRange, true) : Promise.resolve([]),
  ]);

  // currentTotals and currentGroups intentionally use separate aggregate
  // queries: one is the currency total and one is the requested grouping.
  // Both are SQL GROUP BY queries, so no transaction rows are loaded.
  const totalsCurrent = currentTotals;
  const totalsPrevious = previousTotals;
  const currentByCurrency = new Map(totalsCurrent.map((row) => [row.currency, row]));
  const previousByCurrency = new Map(totalsPrevious.map((row) => [row.currency, row]));
  const currencies = [...new Set([
    ...totalsCurrent.map((row) => row.currency),
    ...totalsPrevious.map((row) => row.currency),
    ...currentGroups.map((row) => row.currency),
    ...previousGroups.map((row) => row.currency),
    ...currentTrend.map((row) => row.currency),
    ...previousTrend.map((row) => row.currency),
  ])].sort();
  const totalRows = currencies.map((currency) => {
    const current = currentByCurrency.get(currency) ?? zeroRecord(currency);
    const previous = hasComparison ? (previousByCurrency.get(currency) ?? zeroRecord(currency)) : null;
    return {
      currency,
      ...comparisonShape(current, previous, current, previous),
    };
  });
  const groupRows = mergeAnalyticsRecords(currentGroups, previousGroups, dimensions);
  const trendRows = mergeAnalyticsRecords(currentTrend, previousTrend, ["date"]);
  const rowTotalByCurrency = new Map(currencies.map((currency) => [
    currency,
    {
      current: currentByCurrency.get(currency) ?? zeroRecord(currency),
      previous: hasComparison ? (previousByCurrency.get(currency) ?? zeroRecord(currency)) : null,
    },
  ]));

  const buildRow = (pair: { current: AggregateRecord; previous: AggregateRecord | null }, trend = false) => {
    const representative = pair.current;
    const total = rowTotalByCurrency.get(representative.currency) ?? { current: zeroRecord(representative.currency), previous: null };
    const shape = comparisonShape(pair.current, hasComparison ? pair.previous : null, total.current, total.previous);
    const previousFilters = pair.previous ? analyticsDrilldownFilters(pair.previous, filters, true) : null;
    // A comparison-only group has a zero current aggregate. Its primary
    // drill-down must still open the previous period; both are retained when
    // the group exists in both ranges.
    const primaryFilters = pair.previous && numberValue(pair.current.entry_count) === 0
      ? previousFilters!
      : analyticsDrilldownFilters(representative, filters);
    return {
      currency: representative.currency,
      ...rowDimensions(representative),
      ...shape,
      drilldownFilters: primaryFilters,
      ...(previousFilters ? { previousDrilldownFilters: previousFilters } : {}),
      ...(trend ? { trend: true } : {}),
    };
  };
  const allRows = groupRows.map((row) => buildRow(row));
  const allTrend = trendRows.map((row) => buildRow(row, true));
  const total = allRows.length;
  const offset = (filters.page - 1) * filters.pageSize;
  const rows = exportAll ? allRows : allRows.slice(offset, offset + filters.pageSize);

  return {
    filters: normalizedFilterResponse(filters, projectIds),
    dateBasis: "period_start",
    totalsByCurrency: totalRows,
    rows,
    trend: allTrend,
    pagination: {
      page: filters.page,
      pageSize: filters.pageSize,
      total,
      pageCount: total ? Math.ceil(total / filters.pageSize) : 0,
    },
  };
}

/**
 * Resolve authorization once, then run every selected period against that
 * immutable scope. This prevents a period from becoming an authorization
 * oracle and guarantees identical filters/security for all period queries.
 */
export async function runAnalytics(access: MisAccess, input: AnalyticsFilters, exportAll = false, requireExport = false): Promise<AnalyticsEnvelope> {
  const scope = await resolveAnalyticsScope(access, input, requireExport);
  if (!scope.filters.periodComparison) {
    return runAnalyticsRange(scope.filters, scope.projectIds, exportAll);
  }

  const periodResults = await Promise.all(scope.filters.periods.map(async (period) => {
    const periodFilters: AnalyticsFilters = {
      ...scope.filters,
      periodComparison: false,
      periods: [],
      from: period.from,
      to: period.to,
      // Multi-period mode is not a current/previous request. The endpoint
      // must never accidentally compare a selected period with stale legacy
      // compareFrom/compareTo values.
      compareFrom: null,
      compareTo: null,
    };
    const range = await runAnalyticsRange(periodFilters, scope.projectIds, exportAll);
    return {
      period,
      totalsByCurrency: range.totalsByCurrency,
      rows: range.rows.map((row) => ({ ...row, periodId: period.id, periodLabel: period.label })),
      trend: range.trend.map((row) => ({ ...row, periodId: period.id, periodLabel: period.label })),
      pagination: range.pagination,
    };
  }));

  // Do not synthesize a cross-period total: such a total would be ambiguous
  // for overlapping windows and would also risk combining currency groups.
  const normalized = normalizedFilterResponse(scope.filters, scope.projectIds);
  return {
    filters: normalized,
    dateBasis: "period_start",
    totalsByCurrency: [],
    rows: [],
    trend: [],
    pagination: {
      page: scope.filters.page,
      pageSize: scope.filters.pageSize,
      total: 0,
      pageCount: 0,
    },
    periods: periodResults,
  };
}

function spreadsheetText(value: unknown): string {
  const textValue = String(value ?? "");
  return /^[=+\-@]/.test(textValue) ? `'${textValue}` : textValue;
}
function csvValue(value: unknown): string {
  const textValue = typeof value === "number" ? String(value) : spreadsheetText(value);
  return /[",\n]/.test(textValue) ? `"${textValue.replaceAll('"', '""')}"` : textValue;
}

const exportMetricKeys = [
  "totalIncome", "totalCost", "totalExpenses", "totalSalaries", "grossProfit",
  "netProfit", "profitMargin", "totalAmount", "quantity", "weightedRate",
  "rateMin", "rateMax", "rateVaried", "units", "unitVaried", "entryCount",
  "contributionPercent", "incomeContributionPercent", "costContributionPercent",
  "expensesContributionPercent", "salariesContributionPercent", "percentageAgainstIncome",
] as const;

function exportRow(kind: string, row: Record<string, unknown>, period?: AnalyticsPeriod): unknown[] {
  const current = row.current as Record<string, unknown>;
  const previous = row.previous as Record<string, unknown> | null;
  const difference = row.difference as Record<string, unknown> | null;
  const percentageDifference = row.percentageDifference as Record<string, unknown> | null;
  const filters = row.drilldownFilters as Record<string, unknown>;
  return [
    kind,
    row.currency,
    row.projectId,
    row.projectName,
    row.projectCode,
    row.tabName,
    row.type,
    row.serviceCode,
    row.serviceName,
    row.periodStart,
    row.periodEnd,
    ...exportMetricKeys.map((key) => current[key]),
    ...exportMetricKeys.map((key) => previous?.[key] ?? null),
    ...exportMetricKeys.map((key) => difference?.[key] ?? null),
    ...exportMetricKeys.map((key) => percentageDifference?.[key] ?? null),
    JSON.stringify(filters),
    ...(period ? [period.id, period.label, period.from, period.to] : []),
  ];
}

export function analyticsExportRows(data: AnalyticsEnvelope): unknown[][] {
  const metricHeaders = ["current", "previous", "difference", "percentage_difference"]
    .flatMap((prefix) => exportMetricKeys.map((key) => `${prefix}_${key}`));
  const baseHeader = [
    "row_type", "currency", "project_id", "project_name", "project_code", "tab_name", "type",
    "service_code", "service_name", "period_start", "period_end", ...metricHeaders, "drilldown_filters",
  ];
  const multiPeriod = Boolean(data.periods?.length);
  const header = multiPeriod
    ? [...baseHeader, "period_id", "period_label", "period_from", "period_to"]
    : baseHeader;
  const rows: unknown[][] = [header];
  const exportRange = (
    totals: AnalyticsEnvelope["totalsByCurrency"],
    grouped: Array<Record<string, unknown>>,
    trend: Array<Record<string, unknown>>,
    period?: AnalyticsPeriod,
  ) => {
    if (period) {
      // A marker preserves an explicitly selected empty period in CSV exports.
      rows.push(["period", ...Array(baseHeader.length - 1).fill(null), period.id, period.label, period.from, period.to]);
    }
    for (const item of totals) {
      const base = {
        currency: item.currency,
        current: item.current,
        previous: item.previous,
        difference: item.difference,
        percentageDifference: item.percentageDifference,
        projectId: null, projectName: null, projectCode: null, type: null,
        tabName: null,
        serviceCode: null, serviceName: null, periodStart: null, periodEnd: null,
        drilldownFilters: {},
      };
      rows.push(exportRow("currency_total", base, period));
    }
    for (const row of grouped) rows.push(exportRow("group", row, period));
    for (const row of trend) rows.push(exportRow("trend", row, period));
  };
  if (multiPeriod) {
    for (const item of data.periods ?? []) {
      exportRange(item.totalsByCurrency, item.rows, item.trend, item.period);
    }
  } else {
    exportRange(data.totalsByCurrency, data.rows, data.trend);
  }
  return rows;
}

export function analyticsCsv(data: AnalyticsEnvelope): string {
  return analyticsExportRows(data).map((row) => row.map(csvValue).join(",")).join("\r\n");
}

export function analyticsPdf(data: AnalyticsEnvelope): Promise<Buffer> {
  return professionalAnalyticsPdf(data as unknown as AnalyticsExportData);
}

export { analyticsXlsx };

export { xlsxWorkbook };