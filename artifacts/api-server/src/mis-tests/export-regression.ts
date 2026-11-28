/**
 * Pure export regression fixture. It does not access the database or mutate
 * any grants. The generated files are intentionally written under /tmp so
 * PDF text extraction and XLSX ZIP/XML inspection can be performed by CI.
 */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { reportCsv, reportExportRows, reportPdf } from "../routes/mis";
import { reportXlsx } from "../lib/mis/exports/xlsx";
import { analyticsPdf } from "../lib/mis/exports/pdf";
import { analyticsXlsx } from "../lib/mis/exports/xlsx";
import { ANALYTICS_METRIC_KEYS, percentageLines, standardPresentation } from "../lib/mis/exports/model";

const totals = { income: 1, cost: 2, expenses: 3, salaries: 4, grossProfit: 5, netProfit: 6, profitMargin: 7, entryCount: 8 };
const data = {
  reportType: "period-comparison",
  currencyGroups: [{
    currency: "USD",
    currentTotals: totals,
    comparisonTotals: { ...totals, income: 9 },
    groups: Array.from({ length: 105 }, (_, index) => ({
      projectId: `project-${index}`,
      projectName: index === 104 ? "Résumé =last row" : `Project ${index}`,
      tabId: `tab-${index}`, tabName: `Tab ${index}`,
      serviceId: `service-${index}`, serviceName: index === 1 ? "+formula" : `Service ${index}`,
      projectCode: `QNC-${index}`,
      type: index === 2 ? "expense" : index % 2 ? "other" : "income",
      calculatePercentAgainstIncome: index !== 2,
      periodStart: "2026-01-01", periodEnd: "2026-01-10",
      currentTotals: { ...totals, income: index },
      comparisonTotals: { ...totals, income: index + 1000 },
    })),
  }],
} as Parameters<typeof reportCsv>[0];

const csv = reportCsv(data);
const xlsx = reportXlsx(data, {
  title: "QNC MIS — Regression presentation",
  from: "2026-01-01",
  to: "2026-01-31",
  generatedAt: "2026-02-01T00:00:00.000Z",
  filters: { status: "approved", projectIds: ["project-fixture"] },
});
const pdf = await reportPdf(data);
assert.equal(csv.split("\n").length, 107, "header, currency total, and every one of 105 groups are exported");
assert.equal(csv.split("\r\n")[0], "row_type,currency,project,tab,service,period_start,period_end,current_income,current_cost,current_expenses,current_salaries,current_gross_profit,current_net_profit,current_profit_margin,current_entry_count,comparison_income,comparison_cost,comparison_expenses,comparison_salaries,comparison_gross_profit,comparison_net_profit,comparison_profit_margin,comparison_entry_count", "standard CSV schema remains backwards compatible");
assert.match(csv, /Résumé =last row/);
assert.ok(xlsx.subarray(0, 2).equals(Buffer.from("PK")));
assert.ok(pdf.subarray(0, 4).equals(Buffer.from("%PDF")));
const xlsxText = xlsx.toString("latin1");
assert.match(xlsxText, /xl\/charts\/chart1\.xml/);
assert.match(xlsxText, /xl\/charts\/chart2\.xml/);
assert.match(xlsxText, /<c:f>.*!\$[A-Z]+\$/);
assert.match(xlsxText, /<c:v>Comparison<\/c:v>/);
assert.match(xlsxText, /!\$C\$/);
assert.match(xlsxText, /numFmtId="164"/);
assert.match(xlsxText, /numFmtId="165"/);
assert.match(xlsxText, /state="frozen"/);
assert.match(xlsxText, /autoFilter ref=/);
assert.match(pdf.toString("latin1"), /QNC MIS/);
const pageCount = (buffer: Buffer) => (buffer.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length;
assert.ok(pageCount(pdf) >= 2, "standard export fixture exercises multiple PDF pages");
const standardPercentages = percentageLines(standardPresentation(data).currencies[0]);
assert.doesNotMatch(standardPercentages.map((line) => line.label).join("|"), /Expenses/, "standard exports omit an explicitly disabled category");

const analyticsRows = [
  ...Array.from({ length: 65 }, (_, index) => ({
    currency: "USD", projectId: "project-fixture", projectIds: ["project-fixture"], projectName: "Regression project",
    projectCode: "QNC-REG", tabName: index % 2 ? "Custom section" : "Income", type: index % 2 ? "other" : "income",
    serviceName: `Catering ${index}`, periodStart: "2026-01-01", periodEnd: "2026-01-31",
    current: { totalIncome: 1200 + index, totalCost: 300, totalExpenses: 100, totalSalaries: 200, grossProfit: 900 + index, netProfit: 600 + index, profitMargin: 50, entryCount: 1 },
    previous: null,
  })),
  ...Array.from({ length: 35 }, (_, index) => ({
    currency: "EUR", projectId: "project-fixture", projectIds: ["project-fixture"], projectName: "Regression project",
    projectCode: "QNC-REG", tabName: index % 2 ? "Custom section" : "Income", type: index % 2 ? "other" : "income",
    serviceName: `European catering ${index}`, periodStart: "2026-01-01", periodEnd: "2026-01-31",
    current: { totalIncome: 800 + index, totalCost: 180, totalExpenses: 60, totalSalaries: 120, grossProfit: 620 + index, netProfit: 440 + index, profitMargin: 55, entryCount: 1 },
    previous: null,
  })),
];
const analyticsTrend = ["2026-01-01", "2026-01-08", "2026-01-15", "2026-01-22", "2026-01-29"].flatMap((periodStart, index) => ([
  {
    currency: "USD", projectId: "project-fixture", projectIds: ["project-fixture"], projectName: "Regression project",
    projectCode: "QNC-REG", tabName: "Income", type: "income", serviceName: "Catering", periodStart, periodEnd: periodStart,
    current: { totalIncome: 200 + index * 35, totalCost: 60, totalExpenses: 20, totalSalaries: 30, grossProfit: 140 + index * 35, netProfit: 90 + index * 35, profitMargin: 45 + index, entryCount: 1 },
    previous: null,
  },
  {
    currency: "EUR", projectId: "project-fixture", projectIds: ["project-fixture"], projectName: "Regression project",
    projectCode: "QNC-REG", tabName: "Income", type: "income", serviceName: "European catering", periodStart, periodEnd: periodStart,
    current: { totalIncome: 120 + index * 20, totalCost: 30, totalExpenses: 10, totalSalaries: 15, grossProfit: 90 + index * 20, netProfit: 60 + index * 20, profitMargin: 50 + index, entryCount: 1 },
    previous: null,
  },
]));
const analyticsFixture = {
  filters: {
    projectIds: ["project-fixture"], projectCode: null, tabIds: [], serviceIds: [], serviceCodes: [], types: [],
    from: "2026-01-01", to: "2026-01-31", status: "approved", groupBy: ["month"], view: "monthly", mode: "dynamic",
    compareFrom: "2025-12-01", compareTo: "2025-12-31",
  },
  totalsByCurrency: [{
    currency: "USD",
    current: { totalIncome: 1200, totalCost: 300, totalExpenses: 100, totalSalaries: 200, grossProfit: 900, netProfit: 600, profitMargin: 50, entryCount: 4 },
    previous: { totalIncome: 1000, totalCost: 250, totalExpenses: 90, totalSalaries: 180, grossProfit: 750, netProfit: 480, profitMargin: 48, entryCount: 3 },
   }, {
     currency: "EUR",
     current: { totalIncome: 800, totalCost: 180, totalExpenses: 60, totalSalaries: 120, grossProfit: 620, netProfit: 440, profitMargin: 55, entryCount: 4 },
     previous: { totalIncome: 700, totalCost: 160, totalExpenses: 50, totalSalaries: 110, grossProfit: 540, netProfit: 380, profitMargin: 54, entryCount: 3 },
   }],
   rows: analyticsRows,
   trend: analyticsTrend,
};
const analyticsXlsxFixture = analyticsXlsx(analyticsFixture);
const analyticsPdfFixture = await analyticsPdf(analyticsFixture);
const analyticsXlsxText = analyticsXlsxFixture.toString("latin1");
assert.match(analyticsXlsxText, /xl\/charts\/chart1\.xml/);
assert.match(analyticsXlsxText, /<c:doughnutChart>/);
assert.match(analyticsXlsxText, /<c:lineChart>/);
assert.match(analyticsXlsxText, /<c:showPercent val="1"\/>/);
assert.match(analyticsXlsxText, /<c:plotVisOnly val="0"\/>/, "charts plot hidden Chart Data worksheet ranges");
assert.match(analyticsXlsxText, /<sheet name="Analytics Appendix"/);
assert.match(analyticsXlsxText, /&apos;Chart Data&apos;!/);
assert.doesNotMatch(analyticsXlsxText, /<sheet name="Chart Data" state="hidden"/, "chart data remains visible to reviewers");
assert.doesNotMatch(analyticsXlsxText, /<col min="16" max="27" hidden="1"/, "chart anchors are not placed in hidden main-sheet columns");
for (const metric of ANALYTICS_METRIC_KEYS) assert.match(analyticsXlsxText, new RegExp(`>${metric}<`), `analytics appendix retains ${metric}`);
assert.match(analyticsPdfFixture.toString("latin1"), /QNC MIS/);
assert.ok(pageCount(analyticsPdfFixture) >= 3, "analytics fixture exercises multi-currency and multi-page PDF output");

const selectedPeriods = [
  { id: "jan", label: "January 2026", from: "2026-01-01", to: "2026-01-31" },
  { id: "feb", label: "February 2026", from: "2026-02-01", to: "2026-02-28" },
  { id: "mar", label: "March 2026", from: "2026-03-01", to: "2026-03-31" },
  { id: "apr", label: "April 2026", from: "2026-04-01", to: "2026-04-30" },
] as const;
const multiPeriodFixture = {
  ...analyticsFixture,
  filters: {
    ...analyticsFixture.filters,
    periodComparison: true,
    periods: selectedPeriods,
    projectIds: ["project-jan", "project-feb", "project-mar", "project-apr"],
  },
  periods: selectedPeriods.map((period, index) => ({
    period,
    totalsByCurrency: [{
      currency: "USD",
      current: {
        totalIncome: 1000 + index * 100,
        totalCost: 200 + index * 10,
        totalExpenses: 60 + index * 5,
        totalSalaries: 80 + index * 5,
        grossProfit: 800 + index * 90,
        netProfit: 660 + index * 80,
        profitMargin: 66,
        totalAmount: 1340 + index * 120,
        entryCount: 4,
      },
      previous: null,
      difference: null,
      percentageDifference: null,
    }],
    rows: [
      {
        currency: "USD", projectId: `project-${period.id}`, projectName: `Selected project ${index + 1}`,
        projectCode: `QNC-${index + 1}`, tabName: "Income", type: "income", serviceName: "Selected income",
        periodStart: period.from, periodEnd: period.to, calculatePercentAgainstIncome: true,
        current: { totalIncome: 1000 + index * 100, totalCost: 0, totalExpenses: 0, totalSalaries: 0, totalAmount: 1000 + index * 100, netProfit: 1000 + index * 100, profitMargin: 100, entryCount: 1 },
        previous: null,
      },
      {
        currency: "USD", projectId: `project-${period.id}`, projectName: `Selected project ${index + 1}`,
        projectCode: `QNC-${index + 1}`, tabName: "Cost", type: "cost", serviceName: "Selected cost",
        periodStart: period.from, periodEnd: period.to, calculatePercentAgainstIncome: true,
        current: { totalIncome: 0, totalCost: 200 + index * 10, totalExpenses: 0, totalSalaries: 0, totalAmount: 200 + index * 10, netProfit: -(200 + index * 10), profitMargin: -20, entryCount: 1 },
        previous: null,
      },
      {
        currency: "USD", projectId: `project-${period.id}`, projectName: `Selected project ${index + 1}`,
        projectCode: `QNC-${index + 1}`, tabName: "Expenses", type: "expense", serviceName: "Configured off",
        periodStart: period.from, periodEnd: period.to, calculatePercentAgainstIncome: false,
        current: { totalIncome: 0, totalCost: 0, totalExpenses: 60 + index * 5, totalSalaries: 0, totalAmount: 60 + index * 5, netProfit: -(60 + index * 5), profitMargin: -6, entryCount: 1 },
        previous: null,
      },
    ],
    trend: [],
  })),
} as unknown as Parameters<typeof analyticsXlsx>[0];
const multiPeriodXlsx = analyticsXlsx(multiPeriodFixture);
const multiPeriodPdf = await analyticsPdf(multiPeriodFixture);
const multiPeriodText = multiPeriodXlsx.toString("latin1");
assert.match(multiPeriodText, /period comparison/i, "four selected periods have a native period chart");
assert.match(multiPeriodText, /project comparison/i, "multiple selected projects have a native project chart");
assert.match(multiPeriodText, /January 2026/);
assert.match(multiPeriodText, /% of income/);
assert.doesNotMatch(multiPeriodText, /<sheet name="Chart Data" state="hidden"/);
assert.match(multiPeriodText, /Configured off/);
assert.ok(multiPeriodPdf.subarray(0, 4).equals(Buffer.from("%PDF")));
const threePeriodFixture = {
  ...multiPeriodFixture,
  filters: {
    ...multiPeriodFixture.filters,
    periods: selectedPeriods.slice(0, 3),
    projectIds: ["project-jan", "project-feb", "project-mar"],
  },
  periods: multiPeriodFixture.periods?.slice(0, 3),
} as unknown as Parameters<typeof analyticsXlsx>[0];
const threePeriodXlsx = analyticsXlsx(threePeriodFixture);
const threePeriodPdf = await analyticsPdf(threePeriodFixture);
const threePeriodText = threePeriodXlsx.toString("latin1");
for (const label of ["January 2026", "February 2026", "March 2026"]) assert.match(threePeriodText, new RegExp(label));
assert.match(threePeriodText, /period comparison/i, "three selected periods have a native period chart");
assert.ok(threePeriodPdf.subarray(0, 4).equals(Buffer.from("%PDF")));
await Promise.all([
  writeFile("/tmp/mis-export-regression.csv", csv),
  writeFile("/tmp/mis-export-regression.xlsx", xlsx),
  writeFile("/tmp/mis-export-regression.pdf", pdf),
  writeFile("/tmp/mis-analytics-export-regression.xlsx", analyticsXlsxFixture),
  writeFile("/tmp/mis-analytics-export-regression.pdf", analyticsPdfFixture),
  writeFile("/tmp/mis-multiperiod-export-regression.xlsx", multiPeriodXlsx),
  writeFile("/tmp/mis-multiperiod-export-regression.pdf", multiPeriodPdf),
  writeFile("/tmp/mis-three-period-export-regression.xlsx", threePeriodXlsx),
  writeFile("/tmp/mis-three-period-export-regression.pdf", threePeriodPdf),
]);