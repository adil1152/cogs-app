/**
 * Presentation-only data structures for MIS exports.
 *
 * The report and analytics queries own filtering, authorization, and
 * calculations.  This module deliberately accepts their already-scoped
 * aggregates and only reshapes them for a human-readable workbook or PDF.
 */

export interface PresentationTotals {
  income: number;
  cost: number;
  expenses: number;
  salaries: number;
  /** The scoped amount aggregate used by analytics percentage analysis. */
  totalAmount: number;
  /** Null is the API's explicit disabled value; it is never rendered as 0%. */
  percentageAgainstIncome?: number | null;
  grossProfit: number;
  netProfit: number;
  profitMargin: number;
  entryCount: number;
}

/** The full analytics metric surface emitted by the existing CSV exporter. */
export const ANALYTICS_METRIC_KEYS = [
  "totalIncome", "totalCost", "totalExpenses", "totalSalaries", "grossProfit",
  "netProfit", "profitMargin", "totalAmount", "quantity", "weightedRate",
  "rateMin", "rateMax", "rateVaried", "units", "unitVaried", "entryCount",
  "contributionPercent", "incomeContributionPercent", "costContributionPercent",
  "expensesContributionPercent", "salariesContributionPercent",
  "percentageAgainstIncome",
] as const;
export type AnalyticsMetricKey = (typeof ANALYTICS_METRIC_KEYS)[number];
export interface AnalyticsMetricBundle {
  current: Record<string, unknown>;
  previous: Record<string, unknown> | null;
  difference: Record<string, unknown> | null;
  percentageDifference: Record<string, unknown> | null;
}

export interface PresentationRow {
  section: string;
  projectId?: string | null;
  tabId?: string | null;
  projectName: string | null;
  projectNumber: string | null;
  tabName: string | null;
  type?: string | null;
  serviceId?: string | null;
  serviceCode?: string | null;
  serviceName: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  periodId?: string | null;
  periodLabel?: string | null;
  current: PresentationTotals;
  comparison: PresentationTotals | null;
  /**
   * This is deliberately nullable.  A false configuration is different from
   * a zero percentage and must be omitted from a report rather than rendered
   * as 0%.
   */
  calculatePercentAgainstIncome?: boolean | null;
  drilldownFilters?: Record<string, unknown> | null;
  previousDrilldownFilters?: Record<string, unknown> | null;
  analytics?: AnalyticsMetricBundle;
}

export interface PresentationCurrency {
  currency: string;
  periodId?: string | null;
  periodLabel?: string | null;
  periodFrom?: string | null;
  periodTo?: string | null;
  current: PresentationTotals;
  comparison: PresentationTotals | null;
  rows: PresentationRow[];
  trend: PresentationRow[];
  analytics?: AnalyticsMetricBundle;
  percentageConfiguration?: PercentageConfiguration | null;
}

export interface PresentationPeriod {
  id: string;
  label: string;
  from: string;
  to: string;
  currencies: PresentationCurrency[];
}

export interface PercentageConfiguration {
  /** Explicit default from the resolved category/type configuration. */
  default?: boolean;
  /** Optional resolved flags keyed by the corresponding scoped dimension. */
  byProjectId?: Record<string, boolean>;
  byType?: Record<string, boolean>;
  byTabId?: Record<string, boolean>;
  byServiceId?: Record<string, boolean>;
  byServiceCode?: Record<string, boolean>;
}

export interface PresentationMetadata {
  title?: string;
  reportType?: string;
  projectName?: string | null;
  projectNumber?: string | null;
  from?: string | null;
  to?: string | null;
  compareFrom?: string | null;
  compareTo?: string | null;
  generatedAt?: string;
  filters?: Record<string, unknown>;
  periods?: PresentationPeriod[];
  percentageConfiguration?: PercentageConfiguration | null;
}

export interface PresentationModel {
  title: string;
  metadata: Required<Pick<PresentationMetadata, "generatedAt">> & Omit<PresentationMetadata, "generatedAt">;
  currencies: PresentationCurrency[];
  periods?: PresentationPeriod[];
}

const EMPTY_TOTALS: PresentationTotals = {
  income: 0,
  cost: 0,
  expenses: 0,
  salaries: 0,
  totalAmount: 0,
  percentageAgainstIncome: null,
  grossProfit: 0,
  netProfit: 0,
  profitMargin: 0,
  entryCount: 0,
};

function finite(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateText(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function totals(value: unknown): PresentationTotals {
  const source = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return {
    income: finite(source.income ?? source.totalIncome),
    cost: finite(source.cost ?? source.totalCost),
    expenses: finite(source.expenses ?? source.totalExpenses),
    salaries: finite(source.salaries ?? source.totalSalaries),
    totalAmount: finite(source.totalAmount ?? source.amount),
    percentageAgainstIncome: source.percentageAgainstIncome == null ? null : finite(source.percentageAgainstIncome),
    grossProfit: finite(source.grossProfit),
    netProfit: finite(source.netProfit),
    profitMargin: finite(source.profitMargin),
    entryCount: Math.trunc(finite(source.entryCount)),
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function analyticsBundle(
  current: unknown,
  previous: unknown,
  difference: unknown,
  percentageDifference: unknown,
): AnalyticsMetricBundle {
  return {
    current: record(current),
    previous: previous == null ? null : record(previous),
    difference: difference == null ? null : record(difference),
    percentageDifference: percentageDifference == null ? null : record(percentageDifference),
  };
}

function sectionName(type: unknown, tabName: unknown): string {
  const normalized = String(type ?? "").toLowerCase();
  if (normalized === "income") return "Income";
  if (normalized === "cost") return "Cost";
  if (normalized === "expense" || normalized === "expenses") return "Expenses";
  if (normalized === "salary" || normalized === "salaries") return "Salaries";
  const custom = String(tabName ?? "").trim();
  return custom || "Other / Custom";
}

function readableReportType(reportType: string | undefined): string {
  if (!reportType) return "Management report";
  return reportType
    .split("-")
    .map((part) => part ? part[0].toUpperCase() + part.slice(1) : part)
    .join(" ");
}

function metadata(value: PresentationMetadata | undefined, reportType?: string): PresentationModel["metadata"] {
  const input = value ?? {};
  return {
    ...input,
    reportType: input.reportType ?? reportType,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
  };
}

function resolvedProjectFilters(
  filters: Record<string, unknown> | undefined,
  projectNames: string[],
  projectNumbers: string[],
): Record<string, unknown> | undefined {
  const selected = filters?.projectIds;
  if (!Array.isArray(selected) || selected.length === 0) return filters;
  return {
    ...filters,
    ...(projectNames.length ? { projectNames } : {}),
    ...(projectNumbers.length ? { projectNumbers } : {}),
  };
}

/**
 * Structural type for the existing standard report response.  Keeping this
 * local avoids changing the generated API package for presentation details.
 */
export interface StandardReportData {
  reportType: string;
  currencyGroups: Array<{
    currency: string;
    currentTotals: unknown;
    comparisonTotals: unknown;
    groups: Array<{
      projectId?: string | null;
      tabId?: string | null;
      projectName: string | null;
      projectCode?: string | null;
      tabName: string | null;
      type?: string | null;
      serviceId?: string | null;
      serviceCode?: string | null;
      serviceName: string | null;
      serviceOrder?: number | null;
      periodStart: unknown;
      periodEnd: unknown;
      currentTotals: unknown;
      comparisonTotals: unknown;
      calculatePercentAgainstIncome?: boolean | null;
      calculatePercentageAgainstIncome?: boolean | null;
    }>;
  }>;
}

function explicitPercentageFlag(source: Record<string, unknown>): boolean | null {
  const keys = [
    "calculatePercentAgainstIncome",
    "calculatePercentageAgainstIncome",
    "percentageAgainstIncomeEnabled",
    "percentageConfigured",
  ];
  for (const key of keys) {
    if (typeof source[key] === "boolean") return source[key] as boolean;
  }
  if (typeof source.percentAgainstIncome === "boolean") return source.percentAgainstIncome;
  if (typeof source.percentageAgainstIncome === "number") return true;
  const current = record(source.current);
  for (const key of keys) {
    if (typeof current[key] === "boolean") return current[key] as boolean;
  }
  return typeof current.percentAgainstIncome === "boolean" ? current.percentAgainstIncome as boolean : null;
}

function normalizeFlagMap(map: Record<string, boolean> | undefined, key: string | null | undefined): boolean | null {
  if (!map || !key) return null;
  if (Object.prototype.hasOwnProperty.call(map, key)) return Boolean(map[key]);
  const lowered = key.toLowerCase();
  const aliases = lowered === "expense" ? ["expenses"] : lowered === "expenses" ? ["expense"] : lowered === "salary" ? ["salaries"] : lowered === "salaries" ? ["salary"] : [];
  const match = Object.entries(map).find(([candidate]) => [lowered, ...aliases].includes(candidate.toLowerCase()));
  return match ? Boolean(match[1]) : null;
}

/**
 * Resolve the persisted percentage flag without treating a missing setting as
 * a false/zero metric.  The legacy exporter had no configuration in its
 * payload; preserving its chart categories is preferable until the API sends
 * an explicit resolved configuration.
 */
export function percentageEnabled(
  row: PresentationRow,
  configuration?: PercentageConfiguration | null,
  legacyDefault = true,
): boolean {
  if (row.calculatePercentAgainstIncome != null) return row.calculatePercentAgainstIncome;
  const explicit = explicitPercentageFlag(row.analytics?.current ?? {});
  if (explicit != null) return explicit;
  const byProject = normalizeFlagMap(configuration?.byProjectId, row.projectId);
  if (byProject != null) return byProject;
  const byService = normalizeFlagMap(configuration?.byServiceId, row.serviceId);
  if (byService != null) return byService;
  const byCode = normalizeFlagMap(configuration?.byServiceCode, row.serviceCode);
  if (byCode != null) return byCode;
  const byTab = normalizeFlagMap(configuration?.byTabId, row.tabId);
  if (byTab != null) return byTab;
  const byType = normalizeFlagMap(configuration?.byType, row.type);
  if (byType != null) return byType;
  if (configuration?.default != null) return configuration.default;
  return legacyDefault;
}

export function percentageAmount(row: PresentationRow): number {
  switch (String(row.type ?? "").toLowerCase()) {
    case "income": return row.current.income;
    case "cost": return row.current.cost;
    case "expense":
    case "expenses": return row.current.expenses;
    case "salary":
    case "salaries": return row.current.salaries;
    default: return row.current.totalAmount;
  }
}

export function incomePercentage(amount: number, income: number): number {
  return income === 0 ? 0 : (amount / income) * 100;
}

export interface PercentageLine {
  label: string;
  amount: number;
  percent: number;
  enabled: boolean;
}

/**
 * Category-level percentage values are always scoped to this currency view.
 * Callers must pass a period currency (rather than a cross-currency rollup)
 * so denominators remain per-currency and per-period.
 */
export function percentageLines(
  currency: PresentationCurrency,
  configuration?: PercentageConfiguration | null,
  legacyDefault = true,
): PercentageLine[] {
  const rows = currency.rows.filter((row) => percentageEnabled(row, configuration, legacyDefault));
  const grouped = new Map<string, { amount: number; enabled: boolean }>();
  for (const row of rows) {
    const type = String(row.type ?? row.section ?? "other").toLowerCase();
    const label = row.section || "Other / Custom";
    const key = `${type}\u0000${label}`;
    const existing = grouped.get(key);
    if (existing) existing.amount += percentageAmount(row);
    else grouped.set(key, { amount: percentageAmount(row), enabled: true });
  }
  // A currency total can have no detail rows (for example a totals-only
  // response). In that case use its configured financial classes directly.
  if (!grouped.size) {
    const fallback: Array<[string, number, string]> = [
      ["Income", currency.current.income, "income"],
      ["Cost", currency.current.cost, "cost"],
      ["Expenses", currency.current.expenses, "expense"],
      ["Salaries", currency.current.salaries, "salary"],
    ];
    for (const [label, amount, type] of fallback) {
      const synthetic = {
        section: label,
        projectName: null,
        projectNumber: null,
        tabName: label,
        serviceName: label,
        periodStart: null,
        periodEnd: null,
        current: { ...EMPTY_TOTALS, income: type === "income" ? amount : 0, cost: type === "cost" ? amount : 0, expenses: type === "expense" ? amount : 0, salaries: type === "salary" ? amount : 0 },
        comparison: null,
        type,
      } as PresentationRow;
      if (percentageEnabled(synthetic, configuration, legacyDefault)) grouped.set(`${type}\u0000${label}`, { amount, enabled: true });
    }
  }
  return [...grouped.entries()].map(([key, item]) => {
    const [, label] = key.split("\u0000");
    return { label, amount: item.amount, percent: incomePercentage(item.amount, currency.current.income), enabled: item.enabled };
  });
}

export function standardPresentation(data: StandardReportData, input?: PresentationMetadata): PresentationModel {
  const currencies = data.currencyGroups.map((group) => {
    const rows = group.groups.map((row) => ({
      section: sectionName(row.type, row.tabName),
      projectId: row.projectId ?? null,
      tabId: row.tabId ?? null,
      projectName: row.projectName,
      projectNumber: row.projectCode ?? null,
      tabName: row.tabName,
      type: row.type ?? null,
      serviceId: row.serviceId ?? null,
      serviceCode: row.serviceCode ?? null,
      serviceName: row.serviceName,
      periodStart: dateText(row.periodStart),
      periodEnd: dateText(row.periodEnd),
      current: totals(row.currentTotals),
      comparison: row.comparisonTotals == null ? null : totals(row.comparisonTotals),
      calculatePercentAgainstIncome: row.calculatePercentAgainstIncome ?? row.calculatePercentageAgainstIncome ?? null,
    }));
    const periodRows = rows.filter((row) => row.periodStart != null);
    // Comparison reports commonly group by project or service rather than
    // date. Reuse the vector trend presentation as a comparison chart in
    // that case; no values are re-aggregated here.
    const trend = periodRows.length ? periodRows : rows.length > 1 ? rows : [];
    return {
      currency: group.currency,
      current: totals(group.currentTotals),
      comparison: group.comparisonTotals == null ? null : totals(group.comparisonTotals),
      rows,
      trend,
    };
  });
  const allRows = currencies.flatMap((group) => group.rows);
  const projectNames = [...new Set(allRows.map((row) => row.projectName).filter((value): value is string => Boolean(value)))];
  const projectNumbers = [...new Set(allRows.map((row) => row.projectNumber).filter((value): value is string => Boolean(value)))];
  const inputMetadata = input ?? {};
  return {
    title: inputMetadata.title ?? `QNC MIS — ${readableReportType(data.reportType)}`,
    metadata: metadata({
      ...inputMetadata,
      reportType: inputMetadata.reportType ?? data.reportType,
      projectName: inputMetadata.projectName ?? (projectNames.length === 1 ? projectNames[0] : null),
      projectNumber: inputMetadata.projectNumber ?? (projectNumbers.length === 1 ? projectNumbers[0] : null),
      filters: resolvedProjectFilters(inputMetadata.filters, projectNames, projectNumbers),
    }, data.reportType),
    currencies,
  };
}

/** Public metric payload from analytics.ts (all fields are JSON numbers/null). */
export interface AnalyticsMetricPayload {
  totalIncome?: number;
  totalCost?: number;
  totalExpenses?: number;
  totalSalaries?: number;
  grossProfit?: number;
  netProfit?: number;
  profitMargin?: number;
  totalAmount?: number;
  quantity?: number;
  weightedRate?: number | null;
  rateMin?: number | null;
  rateMax?: number | null;
  rateVaried?: boolean;
  units?: string[];
  unitVaried?: boolean;
  entryCount?: number;
  contributionPercent?: number;
  incomeContributionPercent?: number;
  costContributionPercent?: number;
  expensesContributionPercent?: number;
  salariesContributionPercent?: number;
  /** Null is the authoritative disabled value. */
  percentageAgainstIncome?: number | null;
}

export interface AnalyticsExportData {
  filters: {
    projectIds: string[];
    projectCode: string | null;
    tabIds: string[];
    serviceIds: string[];
    serviceCodes: string[];
    types: string[];
    from: string | null;
    to: string | null;
    status: string;
    groupBy: string[];
    view: string;
    mode: string;
    compareFrom: string | null;
    compareTo: string | null;
    statuses?: string[];
    periodComparison?: boolean;
    periods?: Array<{ id: string; label: string; from: string; to: string }>;
    page?: number;
    pageSize?: number;
    resolvedServiceIds?: string[];
  };
  dateBasis?: "period_start";
  totalsByCurrency: Array<{
    currency: string;
    current: AnalyticsMetricPayload;
    previous: AnalyticsMetricPayload | null;
    difference?: Record<string, unknown> | null;
    percentageDifference?: Record<string, unknown> | null;
  }>;
  rows: Array<Record<string, unknown>>;
  trend: Array<Record<string, unknown>>;
  pagination?: { page: number; pageSize: number; total: number; pageCount: number };
  /**
   * Exact additive response shape emitted by analytics.ts:
   * { period, totalsByCurrency, rows, trend, pagination }.
   * Pagination is intentionally not consumed by presentation, but remains
   * part of the accepted contract so exports cannot silently reinterpret a
   * period result as a legacy current/previous response.
   */
  periods?: Array<{
    period: { id: string; label: string; from: string; to: string };
    totalsByCurrency: AnalyticsExportData["totalsByCurrency"];
    rows: Array<Record<string, unknown>>;
    trend: Array<Record<string, unknown>>;
    pagination?: { page: number; pageSize: number; total: number; pageCount: number };
  }>;
}

function analyticsPercentageConfiguration(input?: PresentationMetadata): PercentageConfiguration | null {
  return input?.percentageConfiguration
    ?? null;
}

function analyticsRow(row: Record<string, unknown>): PresentationRow {
  const current = totals(row.current);
  const previous = row.previous == null ? null : totals(row.previous);
  const rowPeriod = record(row.period);
  return {
    section: sectionName(row.type, row.tabName),
    projectId: typeof row.projectId === "string" ? row.projectId : null,
    tabId: typeof row.tabId === "string" ? row.tabId : null,
    projectName: typeof row.projectName === "string" ? row.projectName : null,
    projectNumber: typeof row.projectCode === "string" ? row.projectCode : null,
    tabName: typeof row.tabName === "string" ? row.tabName : null,
    type: typeof row.type === "string" ? row.type : null,
    serviceId: typeof row.serviceId === "string" ? row.serviceId : null,
    serviceCode: typeof row.serviceCode === "string" ? row.serviceCode : null,
    serviceName: typeof row.serviceName === "string" ? row.serviceName : null,
    periodStart: dateText(row.periodStart),
    periodEnd: dateText(row.periodEnd),
    periodId: typeof row.periodId === "string" ? row.periodId : typeof rowPeriod.id === "string" ? rowPeriod.id : null,
    periodLabel: typeof row.periodLabel === "string" ? row.periodLabel : typeof rowPeriod.label === "string" ? rowPeriod.label : null,
    current,
    comparison: previous,
    calculatePercentAgainstIncome: explicitPercentageFlag(row),
    drilldownFilters: (row.drilldownFilters as Record<string, unknown> | null) ?? null,
    previousDrilldownFilters: (row.previousDrilldownFilters as Record<string, unknown> | null) ?? null,
    analytics: analyticsBundle(row.current, row.previous, row.difference, row.percentageDifference),
  };
}

export function analyticsPresentation(data: AnalyticsExportData, input?: PresentationMetadata): PresentationModel {
  const periodInput = data.periods;
  const inputMetadata = input ?? {};
  const resolvedPercentageConfiguration = analyticsPercentageConfiguration(inputMetadata);
  if (periodInput?.length) {
    const periods = periodInput.map((period) => {
      const descriptor = period.period;
      const periodCurrencies = analyticsCurrencyPresentation(
        period.totalsByCurrency,
        period.rows,
        period.trend,
        {
          ...inputMetadata,
          from: descriptor.from,
          to: descriptor.to,
          periods: undefined,
          percentageConfiguration: resolvedPercentageConfiguration,
        },
      );
      return {
        id: descriptor.id,
        label: descriptor.label,
        from: descriptor.from,
        to: descriptor.to,
        currencies: periodCurrencies.map((currency) => ({
          ...currency,
          periodId: descriptor.id,
          periodLabel: descriptor.label,
          periodFrom: descriptor.from,
          periodTo: descriptor.to,
          rows: currency.rows.map((row) => ({
            ...row,
            periodId: row.periodId ?? descriptor.id,
            periodLabel: row.periodLabel ?? descriptor.label,
          })),
          trend: currency.trend.map((row) => ({
            ...row,
            periodId: row.periodId ?? descriptor.id,
            periodLabel: row.periodLabel ?? descriptor.label,
          })),
        })),
      };
    });
    const allRows = periods.flatMap((period) => period.currencies.flatMap((currency) => currency.rows));
    const projectNames = [...new Set(allRows.map((row) => row.projectName).filter((value): value is string => Boolean(value)))];
    const projectNumbers = [...new Set(allRows.map((row) => row.projectNumber).filter((value): value is string => Boolean(value)))];
    return {
      title: inputMetadata.title ?? "QNC MIS — Advanced Analytics",
      metadata: metadata({
        ...inputMetadata,
        from: inputMetadata.from ?? periods[0]?.from ?? null,
        to: inputMetadata.to ?? periods[periods.length - 1]?.to ?? null,
        periods,
        percentageConfiguration: resolvedPercentageConfiguration,
        projectName: inputMetadata.projectName ?? (projectNames.length === 1 ? projectNames[0] : null),
        projectNumber: inputMetadata.projectNumber ?? (projectNumbers.length === 1 ? projectNumbers[0] : null),
        filters: resolvedProjectFilters(inputMetadata.filters ?? data.filters, projectNames, projectNumbers),
      }, "analytics"),
      // The API's additive multi-period envelope intentionally leaves the
      // legacy top-level currency arrays empty. Export consumers use periods.
      currencies: [],
      periods,
    };
  }
  return analyticsPresentationSingle(data, inputMetadata);
}

function analyticsCurrencyPresentation(
  totalsByCurrency: AnalyticsExportData["totalsByCurrency"],
  rowsInput: Array<Record<string, unknown>>,
  trendInput: Array<Record<string, unknown>>,
  input: PresentationMetadata,
): PresentationCurrency[] {
  const byCurrency = new Map<string, PresentationCurrency>();
  for (const item of totalsByCurrency) {
    byCurrency.set(item.currency, {
      currency: item.currency,
      current: totals(item.current),
      comparison: item.previous == null ? null : totals(item.previous),
      rows: [],
      trend: [],
      analytics: analyticsBundle(item.current, item.previous, item.difference, item.percentageDifference),
      percentageConfiguration: input.percentageConfiguration ?? null,
    });
  }
  for (const row of rowsInput) {
    const currency = String(row.currency ?? "");
    const group = byCurrency.get(currency) ?? {
      currency,
      current: { ...EMPTY_TOTALS },
      comparison: null,
      rows: [],
      trend: [],
      analytics: analyticsBundle(null, null, null, null),
      percentageConfiguration: input.percentageConfiguration ?? null,
    };
    group.rows.push(analyticsRow(row));
    byCurrency.set(currency, group);
  }
  for (const row of trendInput) {
    const currency = String(row.currency ?? "");
    const group = byCurrency.get(currency) ?? {
      currency,
      current: { ...EMPTY_TOTALS },
      comparison: null,
      rows: [],
      trend: [],
      analytics: analyticsBundle(null, null, null, null),
      percentageConfiguration: input.percentageConfiguration ?? null,
    };
    group.trend.push(analyticsRow(row));
    byCurrency.set(currency, group);
  }
  return [...byCurrency.values()].sort((left, right) => left.currency.localeCompare(right.currency));
}

function analyticsPresentationSingle(data: AnalyticsExportData, inputMetadata: PresentationMetadata): PresentationModel {
  const resolvedPercentageConfiguration = analyticsPercentageConfiguration(inputMetadata);
  const currencies = analyticsCurrencyPresentation(data.totalsByCurrency, data.rows, data.trend, inputMetadata);
  const allRows = currencies.flatMap((group) => group.rows);
  const projectNames = [...new Set(allRows.map((row) => row.projectName).filter((value): value is string => Boolean(value)))];
  const projectNumbers = [...new Set(allRows.map((row) => row.projectNumber).filter((value): value is string => Boolean(value)))];
  return {
    title: inputMetadata.title ?? "QNC MIS — Advanced Analytics",
    metadata: metadata({
      ...inputMetadata,
      from: inputMetadata.from ?? data.filters.from,
      to: inputMetadata.to ?? data.filters.to,
      compareFrom: inputMetadata.compareFrom ?? data.filters.compareFrom,
      compareTo: inputMetadata.compareTo ?? data.filters.compareTo,
      percentageConfiguration: resolvedPercentageConfiguration,
      projectName: inputMetadata.projectName ?? (projectNames.length === 1 ? projectNames[0] : null),
      projectNumber: inputMetadata.projectNumber ?? (projectNumbers.length === 1 ? projectNumbers[0] : null),
      filters: resolvedProjectFilters(inputMetadata.filters ?? data.filters, projectNames, projectNumbers),
    }, "analytics"),
    currencies,
  };
}

export function percentDifference(current: number, comparison: number | null): number | null {
  if (comparison == null || comparison === 0) return null;
  return ((current - comparison) / comparison) * 100;
}

export const KPI_DEFINITIONS = [
  ["Total Income", "income"],
  ["Total Cost", "cost"],
  ["Total Expenses", "expenses"],
  ["Total Salaries", "salaries"],
  ["Gross Profit", "grossProfit"],
  ["Net Profit", "netProfit"],
  ["Profit Margin", "profitMargin"],
] as const;
