/**
 * Pure advanced-analytics contract regressions.  This fixture does not seed
 * or mutate projects, entries, grants, or migrations; DB-backed scope tests
 * remain in the integration harness owned by the core MIS route. SQL scope
 * fragments are asserted here so disabled project-tab assignments cannot
 * regress silently.
 */
import assert from "node:assert/strict";
import {
  analyticsExportRows,
  analyticsDrilldownFilters,
  mergeAnalyticsRecords,
  analyticsTotalsFilters,
  ANALYTICS_SCOPE_JOIN_SQL,
  metricDifference,
  metricPercentDifference,
  parseAnalyticsQuery,
  type AggregateRecord,
  type AnalyticsEnvelope,
  type AnalyticsMetricSet,
} from "../lib/mis/analytics";

const parsed = parseAnalyticsQuery({
  groupBy: "date,projectCode,type,service",
  view: "weekly",
  mode: "dynamic",
  from: "2026-09-01",
  to: "2026-09-30",
});
assert.deepEqual(parsed.filters.groupBy, ["date", "projectCode", "type", "service"], "ordered group dimensions are retained");
assert.equal(parsed.filters.status, "approved", "analytics defaults to approved entries");
assert.deepEqual(analyticsTotalsFilters(parsed.filters).groupBy, [], "currency totals remove grouped dimensions");
assert.match(ANALYTICS_SCOPE_JOIN_SQL, /mis_project_tabs/);
assert.match(ANALYTICS_SCOPE_JOIN_SQL, /pt\.enabled IS TRUE/, "aggregates exclude disabled project-tab assignments");

const comparisonParsed = parseAnalyticsQuery({
  groupBy: "month,project",
  mode: "dynamic",
  from: "2026-01-15",
  to: "2026-02-15",
  compareFrom: "2025-01-15",
  compareTo: "2025-02-15",
});
const crossingMonth = {
  currency: "USD",
  project_ids: ["project-1"],
  tab_ids: ["tab-1"],
  tab_id: "tab-1",
  tab_name: "Custom A",
  service_ids: ["service-1"],
  type: "income",
  date_start: "2026-01-15",
  date_end: "2026-01-31",
  period_start: null,
  period_end: null,
} as unknown as AggregateRecord;
const currentDrilldown = analyticsDrilldownFilters(crossingMonth, comparisonParsed.filters);
assert.equal(currentDrilldown.from, "2026-01-15", "drilldown keeps the full report range");
assert.equal(currentDrilldown.to, "2026-02-15", "drilldown keeps the full report range end");
assert.equal(currentDrilldown.startFrom, "2026-01-15", "drilldown adds the period-start lower bound");
assert.equal(currentDrilldown.startTo, "2026-01-31", "drilldown adds the clipped period-start upper bound");
assert.equal(currentDrilldown.currency, "USD");
assert.equal(currentDrilldown.status, "approved");
const previousDrilldown = analyticsDrilldownFilters(crossingMonth, comparisonParsed.filters, true);
assert.equal(previousDrilldown.from, "2025-01-15", "previous drilldown uses the comparison report range");

const grouped = (projectId: string, amount: number): AggregateRecord => ({
  ...crossingMonth,
  project_id: projectId,
  project_ids: [projectId],
  total_amount: amount,
  total_income: amount,
  total_quantity: 1,
  rate_min: amount,
  rate_max: amount,
  entry_count: 1,
});
const mergedGroups = mergeAnalyticsRecords(
  [grouped("current-a", 10), grouped("current-b", 20)],
  [grouped("current-a", 5), grouped("previous-only", 30)],
  ["project"],
);
assert.equal(mergedGroups.length, 3, "current and previous groups are unioned per currency, not collapsed to one previous total");

const customCategory = (tabId: string, tabName: string): AggregateRecord => ({
  ...crossingMonth,
  type: "other",
  tab_id: tabId,
  tab_name: tabName,
  tab_ids: [tabId],
});
const customCategories = mergeAnalyticsRecords(
  [customCategory("custom-a", "Custom A"), customCategory("custom-b", "Custom B")],
  [],
  ["type"],
);
assert.equal(customCategories.length, 2, "custom tabs sharing the other type remain separate groups");

const metric = (income: number, count = 1): AnalyticsMetricSet => ({
  totalIncome: income,
  totalCost: 0,
  totalExpenses: 0,
  totalSalaries: 0,
  grossProfit: income,
  netProfit: income,
  profitMargin: 100,
  totalAmount: income,
  quantity: count,
  weightedRate: income / count,
  rateMin: income / count,
  rateMax: income / count,
  rateVaried: false,
  units: ["unit"],
  unitVaried: false,
  entryCount: count,
  contributionPercent: 100,
  incomeContributionPercent: 100,
  costContributionPercent: 0,
  expensesContributionPercent: 0,
  salariesContributionPercent: 0,
});
const current = metric(25);
const previousZero = metric(0, 0);
assert.equal(metricDifference(current, previousZero).totalIncome, 25, "difference uses current minus previous");
assert.equal(metricPercentDifference(current, previousZero).totalIncome, null, "previous zero has a null percentage difference");

const envelope: AnalyticsEnvelope = {
  filters: parsed.filters as AnalyticsEnvelope["filters"],
  dateBasis: "period_start",
  totalsByCurrency: [],
  rows: Array.from({ length: 3 }, (_, index) => ({
    currency: "USD",
    projectId: `p-${index}`,
    projectName: `Project ${index}`,
    projectCode: `P-${index}`,
    tabName: `Custom Tab ${index}`,
    type: "income",
    serviceCode: "service",
    serviceName: "Service",
    periodStart: null,
    periodEnd: null,
    current,
    previous: null,
    difference: null,
    percentageDifference: null,
    drilldownFilters: { projectIds: [`p-${index}`], tabIds: [], serviceIds: [], entryType: "income", from: null, to: null },
  })),
  trend: [],
  pagination: { page: 1, pageSize: 50, total: 3, pageCount: 1 },
};
const exported = analyticsExportRows(envelope);
assert.equal(exported.length, 4, "exports all grouped rows instead of applying a page slice");
assert.equal(exported[0][5], "tab_name", "exports include the readable tab name column");
assert.equal(exported[1][5], "Custom Tab 0", "group exports retain the configured tab label");