import {
  ANALYTICS_METRIC_KEYS,
  KPI_DEFINITIONS,
  analyticsPresentation,
  incomePercentage,
  percentageAmount,
  percentageEnabled,
  percentageLines,
  standardPresentation,
  type AnalyticsMetricBundle,
  type AnalyticsExportData,
  type PresentationCurrency,
  type PresentationMetadata,
  type PresentationModel,
  type PercentageLine,
  type StandardReportData,
} from "./model";

type Scalar = string | number | null;
interface Cell {
  value: Scalar;
  style?: number;
}
type SheetRow = Cell[];
interface ChartRange {
  kind: "bar" | "doughnut" | "line";
  title: string;
  labelRange: string;
  valueRange: string;
  comparisonRange?: string;
  series?: Array<{ name: string; valueRange: string }>;
  fromCol: number;
  fromRow: number;
  toCol: number;
  toRow: number;
}

const currencyFormat = '#,##0.00;[Red]-#,##0.00';
const integerFormat = '#,##0;[Red]-#,##0';
const percentFormat = '0.00%;[Red]-0.00%';

function xml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/** Spreadsheet formula injection protection for every textual workbook cell. */
function safeText(value: unknown): string {
  const text = String(value ?? "");
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function cell(value: Scalar, style?: number): Cell {
  return { value, style };
}

function colName(index: number): string {
  let output = "";
  let value = index + 1;
  while (value > 0) {
    const remainder = (value - 1) % 26;
    output = String.fromCharCode(65 + remainder) + output;
    value = Math.floor((value - 1) / 26);
  }
  return output;
}

function cellRef(column: number, row: number): string {
  return `${colName(column)}${row}`;
}

function rangeRef(sheet: string, column: number, firstRow: number, lastRow: number): string {
  const quoted = `'${sheet.replaceAll("'", "''")}'`;
  return `${quoted}!$${colName(column)}$${firstRow}:$${colName(column)}$${lastRow}`;
}

function safeLabel(row: { projectName: string | null; tabName: string | null; serviceName: string | null; periodStart: string | null; periodEnd: string | null; periodLabel?: string | null }): string {
  return [row.periodLabel, row.projectName, row.tabName, row.serviceName, row.periodStart && row.periodEnd ? `${row.periodStart} – ${row.periodEnd}` : null]
    .filter((value): value is string => Boolean(value))
    .join(" / ") || "Currency total";
}

function dateRange(model: PresentationModel): string {
  if (model.periods?.length) return model.periods.map((period) => `${period.label} (${period.from} to ${period.to})`).join("  |  ");
  const { from, to } = model.metadata;
  if (from && to) return `${from} to ${to}`;
  return "All available periods";
}

function filterText(model: PresentationModel): string {
  const filters = model.metadata.filters;
  if (!filters) return "None";
  const valueText = (value: unknown): string => Array.isArray(value)
    ? value.map((item) => item && typeof item === "object" ? JSON.stringify(item) : String(item)).join(", ")
    : value && typeof value === "object" ? JSON.stringify(value) : String(value);
  return Object.entries(filters)
    .filter(([, value]) => value != null && value !== "" && (!Array.isArray(value) || value.length > 0))
    .map(([key, value]) => `${key}: ${valueText(value)}`)
    .join("  |  ") || "None";
}

function difference(current: number, comparison: number | null): number | null {
  return comparison == null ? null : current - comparison;
}

function percentDifference(current: number, comparison: number | null): number | null {
  if (comparison == null || comparison === 0) return null;
  return (current - comparison) / comparison;
}

function styleForKpi(key: string): number {
  return key === "profitMargin" ? 7 : key === "entryCount" ? 8 : 6;
}

function addRow(rows: SheetRow[], values: Cell[]): number {
  rows.push(values);
  return rows.length;
}

function heading(rows: SheetRow[], text: string, style = 4): number {
  return addRow(rows, [cell(text, style)]);
}

function metricValue(currency: PresentationCurrency, key: string): number {
  const value = currency.current[key as keyof typeof currency.current];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function comparisonValue(currency: PresentationCurrency, key: string): number | null {
  if (!currency.comparison) return null;
  const value = currency.comparison[key as keyof typeof currency.comparison];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function currencyViews(model: PresentationModel): PresentationCurrency[] {
  if (model.periods?.length) return model.periods.flatMap((period) => period.currencies);
  return model.currencies;
}

function displayPeriod(currency: PresentationCurrency): string | null {
  return currency.periodLabel ?? (currency.periodFrom && currency.periodTo ? `${currency.periodFrom} to ${currency.periodTo}` : null);
}

function classAmount(currency: PresentationCurrency, key: string): number {
  return metricValue(currency, key);
}

function chartDataRange(
  chartDataSheetName: string,
  chartDataRows: SheetRow[],
  header: string[],
  values: Array<Array<Scalar>>,
): { labelRange: string; valueRanges: string[]; startRow: number; endRow: number } {
  const headerRow = chartDataRows.length + 1;
  addRow(chartDataRows, header.map((value) => cell(value, 5)));
  values.forEach((row) => addRow(chartDataRows, row.map((value) => cell(value, typeof value === "number" ? 6 : 0))));
  const endRow = chartDataRows.length;
  const valueRanges = header.slice(1).map((_, index) => rangeRef(chartDataSheetName, index + 1, headerRow + 1, endRow));
  return {
    labelRange: rangeRef(chartDataSheetName, 0, headerRow + 1, endRow),
    valueRanges,
    startRow: headerRow + 1,
    endRow,
  };
}

function addComparisonCharts(
  model: PresentationModel,
  views: PresentationCurrency[],
  rows: SheetRow[],
  chartDataRows: SheetRow[],
  charts: ChartRange[],
  chartDataSheetName: string,
): void {
  const periods = model.periods ?? [];
  const currencies = [...new Set(views.map((currency) => currency.currency))];
  const chartRow = Math.max(rows.length + 1, 2);
  let chartIndex = 0;
  for (const currencyCode of currencies) {
    const periodViews = periods
      .flatMap((period) => period.currencies
        .filter((currency) => currency.currency === currencyCode)
        .map((currency) => ({ ...currency, periodLabel: currency.periodLabel ?? period.label })));
    if (periodViews.length < 2) continue;
    const labels = periodViews.map((currency) => currency.periodLabel ?? currency.periodFrom ?? "Period");
    const data = chartDataRange(
      chartDataSheetName,
      chartDataRows,
      ["Period", "Income", "Cost", "Expenses", "Salaries", "Net profit"],
      periodViews.map((currency, index) => [
        labels[index],
        currency.current.income,
        currency.current.cost,
        currency.current.expenses,
        currency.current.salaries,
        currency.current.netProfit,
      ]),
    );
    charts.push({
      kind: "bar",
      title: `${currencyCode} — period comparison`,
      labelRange: data.labelRange,
      valueRange: data.valueRanges[0],
      series: data.valueRanges.map((valueRange, index) => ({
        name: ["Income", "Cost", "Expenses", "Salaries", "Net profit"][index],
        valueRange,
      })),
      fromCol: 0,
      fromRow: chartRow + chartIndex * 14,
      toCol: 8,
      toRow: chartRow + chartIndex * 14 + 12,
    });
    chartIndex += 1;
  }

  const projectKeys = new Set<string>();
  views.forEach((currency) => currency.rows.forEach((row) => {
    const key = row.projectId ?? row.projectName;
    if (key) projectKeys.add(key);
  }));
  for (const currencyCode of currencies) {
    const projectValues = new Map<string, {
      name: string;
      income: number;
      cost: number;
      expenses: number;
      salaries: number;
      netProfit: number;
    }>();
    views.filter((currency) => currency.currency === currencyCode).forEach((currency) => {
      currency.rows.forEach((row) => {
        const key = row.projectId ?? row.projectName;
        if (!key) return;
        const current = projectValues.get(key) ?? {
          name: row.projectName ?? key,
          income: 0,
          cost: 0,
          expenses: 0,
          salaries: 0,
          netProfit: 0,
        };
        current.income += row.current.income;
        current.cost += row.current.cost;
        current.expenses += row.current.expenses;
        current.salaries += row.current.salaries;
        current.netProfit += row.current.netProfit;
        projectValues.set(key, current);
      });
    });
    if (projectValues.size < 2 || projectKeys.size < 2) continue;
    const projects = [...projectValues.values()];
    const data = chartDataRange(
      chartDataSheetName,
      chartDataRows,
      ["Project", "Income", "Cost", "Expenses", "Salaries", "Net profit"],
      projects.map((project) => [
        project.name,
        project.income,
        project.cost,
        project.expenses,
        project.salaries,
        project.netProfit,
      ]),
    );
    charts.push({
      kind: "bar",
      title: `${currencyCode} — project comparison`,
      labelRange: data.labelRange,
      valueRange: data.valueRanges[0],
      series: data.valueRanges.map((valueRange, index) => ({
        name: ["Income", "Cost", "Expenses", "Salaries", "Net profit"][index],
        valueRange,
      })),
      fromCol: 9,
      fromRow: chartRow + chartIndex * 14,
      toCol: 17,
      toRow: chartRow + chartIndex * 14 + 12,
    });
    chartIndex += 1;
  }
}

function buildWorkbook(model: PresentationModel): Buffer {
  const sheetName = "MIS Report";
  const chartDataSheetName = "Chart Data";
  const rows: SheetRow[] = [];
  const chartDataRows: SheetRow[] = [];
  const charts: ChartRange[] = [];
  const views = currencyViews(model);

  addRow(rows, [cell(model.title, 1)]);
  addRow(rows, [cell("Management information report", 2)]);
  addRow(rows, []);
  addRow(rows, [cell("Project", 3), cell(model.metadata.projectName ?? "All permitted projects", 0), cell("Project number", 3), cell(model.metadata.projectNumber ?? "Multiple / not specified", 0)]);
  addRow(rows, [cell("Reporting period", 3), cell(dateRange(model), 0), cell("Generated", 3), cell(model.metadata.generatedAt, 0)]);
  addRow(rows, [cell("Comparison period", 3), cell(model.metadata.compareFrom && model.metadata.compareTo ? `${model.metadata.compareFrom} to ${model.metadata.compareTo}` : "None", 0), cell("Status", 3), cell(String(model.metadata.filters?.status ?? "Approved"), 0)]);
  addRow(rows, [cell("Selected filters", 3), cell(filterText(model), 0)]);
  addRow(rows, []);

  for (const currency of views) {
    const percentageConfiguration = currency.percentageConfiguration ?? model.metadata.percentageConfiguration;
    const currencyLegacyPercentageDefault = percentageConfiguration == null
      && !currency.rows.some((row) => row.calculatePercentAgainstIncome != null);
    const periodSuffix = displayPeriod(currency) ? ` — ${displayPeriod(currency)}` : "";
    const summaryRow = heading(rows, `Executive summary — ${currency.currency}${periodSuffix}`);
    addRow(rows, [
      cell("KPI", 5), cell("Current", 5), cell("Comparison", 5), cell("Variance", 5), cell("Variance %", 5),
    ]);
    const metricRows = new Map<string, number>();
    for (const [label, key] of [...KPI_DEFINITIONS, ["Entries", "entryCount"] as const]) {
      const rawCurrent = metricValue(currency, key);
      const rawComparison = comparisonValue(currency, key);
      // Excel percentage cells contain a fraction and use a true percentage
      // number format, unlike the API's human-facing percentage points.
      const current = key === "profitMargin" ? rawCurrent / 100 : rawCurrent;
      const comparison = rawComparison == null ? null : key === "profitMargin" ? rawComparison / 100 : rawComparison;
      const variance = comparison == null ? null : current - comparison;
      const percentage = comparison == null || comparison === 0 ? null : variance! / Math.abs(comparison);
      const row = addRow(rows, [
        cell(label, 0),
        cell(current, styleForKpi(key)),
        cell(comparison, styleForKpi(key)),
        cell(variance, styleForKpi(key)),
        cell(percentage, 7),
      ]);
      metricRows.set(key, row);
    }
    const barData = chartDataRange(
      chartDataSheetName,
      chartDataRows,
      ["Class", "Current", "Comparison"],
      KPI_DEFINITIONS.slice(0, 4).map(([label, key]) => [label, classAmount(currency, key), comparisonValue(currency, key)]),
    );
    charts.push({
      kind: "bar",
      title: `${currency.currency}${periodSuffix} — income, cost and operating classes`,
      labelRange: barData.labelRange,
      valueRange: barData.valueRanges[0],
      comparisonRange: currency.comparison ? barData.valueRanges[1] : undefined,
      fromCol: 6,
      fromRow: summaryRow - 1,
      toCol: 12,
      toRow: summaryRow + 11,
    });

    const percentage = percentageLines(currency, percentageConfiguration, currencyLegacyPercentageDefault);
    const income = currency.current.income;
    let donutLines = percentage
      .filter((line) => line.label.toLowerCase() !== "income")
      .map((line) => ({ ...line, amount: Math.max(0, line.amount) }))
      .filter((line) => line.amount > 0);
    if (currencyLegacyPercentageDefault && !donutLines.length) {
      donutLines = KPI_DEFINITIONS.slice(1, 4).map(([label, key]) => ({
        label: label.replace("Total ", ""),
        amount: Math.max(0, metricValue(currency, key)),
        percent: incomePercentage(metricValue(currency, key), currency.current.income),
        enabled: true,
      }));
    }
    const donutTotal = donutLines.reduce((sum, line) => sum + line.amount, 0);
    const donutCanNormalizeToIncome = income > 0 && donutTotal <= income;
    if (donutLines.length && donutCanNormalizeToIncome) {
      const remainder = income - donutTotal;
      const donutValues: Array<Array<Scalar>> = donutLines.map((line) => [line.label, line.amount, incomePercentage(line.amount, income)]);
      if (remainder > 0) donutValues.push(["Profit remainder", remainder, incomePercentage(remainder, income)]);
      const donutData = chartDataRange(chartDataSheetName, chartDataRows, ["Category", "Amount", "% of income"], donutValues);
      charts.push({
        kind: "doughnut",
        title: `${currency.currency}${periodSuffix} — cost, expense and salary (% of income)`,
        labelRange: donutData.labelRange,
        valueRange: donutData.valueRanges[0],
        fromCol: 13,
        fromRow: summaryRow - 1,
        toCol: 19,
        toRow: summaryRow + 11,
      });
    } else if (donutLines.length) {
      // A doughnut would normalize an over-income set to 100% and imply that
      // these classes are percentages of each other. Use an amount bar and
      // retain the honest (possibly >100%) % of income in visible cells.
      const overIncomeData = chartDataRange(
        chartDataSheetName,
        chartDataRows,
        ["Category", "Amount", "% of income"],
        donutLines.map((line) => [line.label, line.amount, incomePercentage(line.amount, income)]),
      );
      charts.push({
        kind: "bar",
        title: `${currency.currency}${periodSuffix} — actual costs against income (${income > 0 ? "over 100%; see % column" : "income is zero; percentages are 0%"})`,
        labelRange: overIncomeData.labelRange,
        valueRange: overIncomeData.valueRanges[0],
        fromCol: 13,
        fromRow: summaryRow - 1,
        toCol: 19,
        toRow: summaryRow + 11,
      });
    }

    if (currency.trend.length) {
      const trendData = chartDataRange(
        chartDataSheetName,
        chartDataRows,
        ["Trend period", "Income", "Cost", "Net profit"],
        currency.trend.map((item) => [safeLabel(item), item.current.income, item.current.cost, item.current.netProfit]),
      );
      charts.push({
        kind: "line",
        title: `${currency.currency}${periodSuffix} — period trend`,
        labelRange: trendData.labelRange,
        valueRange: trendData.valueRanges[0],
        fromCol: 20,
        fromRow: summaryRow - 1,
        toCol: 27,
        toRow: summaryRow + 11,
      });
    }
    addRow(rows, []);
  }

  const detailHeader = rows.length + 1;
  addRow(rows, [
    cell("Section", 5), cell("Project", 5), cell("Project number", 5), cell("Tab / category", 5),
    cell("Service", 5), cell("Period start", 5), cell("Period end", 5), cell("Income", 5),
    cell("Cost", 5), cell("Expenses", 5), cell("Salaries", 5), cell("Gross profit", 5),
    cell("Net profit", 5), cell("Margin", 5), cell("% of income", 5), cell("Entries", 5), cell("Currency", 5),
  ]);
  let lastDetailRow = detailHeader;
  for (const currency of views) {
    const percentageConfiguration = currency.percentageConfiguration ?? model.metadata.percentageConfiguration;
    const currencyLegacyPercentageDefault = percentageConfiguration == null
      && !currency.rows.some((row) => row.calculatePercentAgainstIncome != null);
    for (const item of currency.rows) {
      const margin = item.current.profitMargin / 100;
      const includePercentage = percentageEnabled(item, percentageConfiguration, currencyLegacyPercentageDefault);
      const itemAmount = percentageAmount(item);
      addRow(rows, [
        cell(item.section), cell(item.projectName), cell(item.projectNumber), cell(item.tabName), cell(item.serviceName),
        cell(item.periodStart, 10), cell(item.periodEnd, 10), cell(item.current.income, 6), cell(item.current.cost, 6),
        cell(item.current.expenses, 6), cell(item.current.salaries, 6), cell(item.current.grossProfit, 6),
        cell(item.current.netProfit, 6), cell(margin, 7),
        cell(includePercentage ? incomePercentage(itemAmount, currency.current.income) / 100 : null, 7),
        cell(item.current.entryCount, 8), cell(currency.currency),
      ]);
    }
    // A total row is explicit even for an empty currency section. This is
    // easier to print and keeps the totals visible when a filter yields zero.
    addRow(rows, [
      cell(`${currency.currency} total`, 9), cell(null, 9), cell(null, 9), cell(null, 9), cell(null, 9),
      cell(null, 9), cell(null, 9), cell(currency.current.income, 9), cell(currency.current.cost, 9),
      cell(currency.current.expenses, 9), cell(currency.current.salaries, 9), cell(currency.current.grossProfit, 9),
      cell(currency.current.netProfit, 9), cell(currency.current.profitMargin / 100, 7), cell(null, 7),
      cell(currency.current.entryCount, 8), cell(currency.currency, 9),
    ]);
    lastDetailRow = rows.length;

    const lines = percentageLines(currency, percentageConfiguration, currencyLegacyPercentageDefault)
      .filter((line) => line.enabled);
    if (lines.length) {
      heading(rows, `Percentage against total income — ${currency.currency}${displayPeriod(currency) ? ` — ${displayPeriod(currency)}` : ""}`);
      addRow(rows, [cell("Category / service", 5), cell("Amount", 5), cell("% of income", 5), cell("Configuration", 5)]);
      lines.forEach((line: PercentageLine) => addRow(rows, [
        cell(line.label), cell(line.amount, 6), cell(line.percent / 100, 7), cell("Enabled"),
      ]));
      addRow(rows, []);
    }
  }

  addComparisonCharts(model, views, rows, chartDataRows, charts, chartDataSheetName);

  const sheetXml = worksheetXml(rows, detailHeader, lastDetailRow, charts.length > 0);
  const chartDataXml = worksheetDataXml(chartDataRows);
  const analyticsXml = views.some((currency) => currency.analytics)
    ? analyticsAppendixXml(model, views)
    : null;
  const files: [string, string | Buffer][] = [
    ["[Content_Types].xml", contentTypes(charts.length > 0, charts.length, Boolean(analyticsXml))],
    ["_rels/.rels", rootRelationships()],
    ["docProps/core.xml", coreProperties(model)],
    ["docProps/app.xml", appProperties()],
    ["xl/workbook.xml", workbookXml(sheetName, Boolean(analyticsXml))],
    ["xl/_rels/workbook.xml.rels", workbookRelationships(Boolean(analyticsXml))],
    ["xl/styles.xml", stylesXml()],
    ["xl/worksheets/sheet1.xml", sheetXml],
    ["xl/worksheets/_rels/sheet1.xml.rels", sheetRelationships(charts.length > 0)],
    ["xl/worksheets/sheet2.xml", chartDataXml],
  ];
  if (analyticsXml) files.push(["xl/worksheets/sheet3.xml", analyticsXml]);
  if (charts.length) {
    files.push(["xl/drawings/drawing1.xml", drawingXml(charts)]);
    files.push(["xl/drawings/_rels/drawing1.xml.rels", drawingRelationships(charts.length)]);
    charts.forEach((chart, index) => files.push([`xl/charts/chart${index + 1}.xml`, chartXml(chart, index)]));
  }
  return zip(files);
}

function worksheetXml(rows: SheetRow[], detailHeader: number, detailEnd: number, hasDrawing: boolean): string {
  const widths = [17, 25, 17, 20, 24, 14, 14, 15, 15, 15, 15, 15, 15, 12, 12, 11, 10];
  const cols = widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("");
  const rowXml = rows.map((row, rowIndex) => {
    const values = row.map((item, columnIndex) => {
      if (item.value == null || item.value === "") return "";
      const reference = cellRef(columnIndex, rowIndex + 1);
      if (typeof item.value === "number" && Number.isFinite(item.value)) {
        return `<c r="${reference}" s="${item.style ?? 0}"><v>${item.value}</v></c>`;
      }
      return `<c r="${reference}" s="${item.style ?? 0}" t="inlineStr"><is><t xml:space="preserve">${xml(safeText(item.value))}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${values}</row>`;
  }).join("");
  const filter = detailHeader <= detailEnd ? `<autoFilter ref="A${detailHeader}:Q${detailEnd}"/>` : "";
  const freezeAt = Math.max(1, detailHeader - 1);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetPr><outlinePr summaryBelow="1" summaryRight="1"/></sheetPr><dimension ref="A1:Q${rows.length}"/><sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="${freezeAt}" topLeftCell="A${detailHeader}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${detailHeader}" sqref="A${detailHeader}"/></sheetView></sheetViews><cols>${cols}</cols><sheetData>${rowXml}</sheetData>${filter}<mergeCells count="2"><mergeCell ref="A1:Q1"/><mergeCell ref="A2:Q2"/></mergeCells><pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>${hasDrawing ? '<drawing r="rId1"/>' : ""}</worksheet>`;
}

function worksheetDataXml(rows: SheetRow[]): string {
  const rowXml = rows.map((row, rowIndex) => {
    const values = row.map((item, columnIndex) => {
      if (item.value == null || item.value === "") return "";
      const reference = cellRef(columnIndex, rowIndex + 1);
      if (typeof item.value === "number" && Number.isFinite(item.value)) {
        return `<c r="${reference}" s="${item.style ?? 0}"><v>${item.value}</v></c>`;
      }
      return `<c r="${reference}" s="${item.style ?? 0}" t="inlineStr"><is><t xml:space="preserve">${xml(safeText(item.value))}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${values}</row>`;
  }).join("");
  const lastRow = Math.max(rows.length, 1);
  const lastColumn = rows.reduce((max, row) => Math.max(max, row.length), 1);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${colName(lastColumn - 1)}${lastRow}"/><sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews><sheetData>${rowXml}</sheetData></worksheet>`;
}

const ANALYTICS_PERCENT_POINT_KEYS = new Set([
  "profitMargin", "contributionPercent", "incomeContributionPercent",
  "costContributionPercent", "expensesContributionPercent", "salariesContributionPercent",
  "percentageAgainstIncome",
]);

function analyticsCellValue(value: unknown): Scalar {
  if (value == null) return "—";
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function analyticsCellStyle(key: string, bucket: "current" | "previous" | "difference" | "percentageDifference"): number {
  if (key === "rateVaried" || key === "unitVaried" || key === "units") return 0;
  if (bucket === "percentageDifference") return 7;
  if (ANALYTICS_PERCENT_POINT_KEYS.has(key)) return 12;
  if (key === "entryCount") return 8;
  return 6;
}

function analyticsScope(row: PresentationCurrency["rows"][number]): string {
  return safeLabel(row);
}

function analyticsAppendixXml(model: PresentationModel, views: PresentationCurrency[] = currencyViews(model)): string {
  const rows: SheetRow[] = [[
    cell("Row type", 5), cell("Currency", 5), cell("Scope", 5), cell("Metric", 5),
    cell("Current", 5), cell("Previous", 5), cell("Difference", 5), cell("Percentage difference", 5),
    cell("Drilldown filters", 5),
  ]];
  const appendBundle = (
    rowType: string,
    currency: string,
    scope: string,
    bundle: AnalyticsMetricBundle,
    drilldown: Record<string, unknown> | null = null,
  ) => {
    for (const key of ANALYTICS_METRIC_KEYS) {
      const values = [
        bundle.current[key],
        bundle.previous?.[key],
        bundle.difference?.[key],
        bundle.percentageDifference?.[key],
      ] as const;
      rows.push([
        cell(rowType), cell(currency), cell(scope), cell(key),
        cell(analyticsCellValue(values[0]), analyticsCellStyle(key, "current")),
        cell(analyticsCellValue(values[1]), analyticsCellStyle(key, "previous")),
        cell(analyticsCellValue(values[2]), analyticsCellStyle(key, "difference")),
        cell(analyticsCellValue(values[3]), analyticsCellStyle(key, "percentageDifference")),
        cell(drilldown ? JSON.stringify(drilldown) : "{}"),
      ]);
    }
  };
  for (const currency of views) {
    if (!currency.analytics) continue;
    appendBundle("currency_total", currency.currency, "Currency total", currency.analytics);
    for (const row of currency.rows) {
      if (row.analytics) appendBundle("group", currency.currency, analyticsScope(row), row.analytics, row.drilldownFilters ?? null);
    }
    for (const row of currency.trend) {
      if (row.analytics) appendBundle("trend", currency.currency, `Trend — ${analyticsScope(row)}`, row.analytics, row.drilldownFilters ?? null);
    }
  }
  const rowXml = rows.map((row, rowIndex) => {
    const values = row.map((item, columnIndex) => {
      if (item.value == null || item.value === "") return "";
      const reference = cellRef(columnIndex, rowIndex + 1);
      if (typeof item.value === "number" && Number.isFinite(item.value)) {
        return `<c r="${reference}" s="${item.style ?? 0}"><v>${item.value}</v></c>`;
      }
      return `<c r="${reference}" s="${item.style ?? 0}" t="inlineStr"><is><t xml:space="preserve">${xml(safeText(item.value))}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${values}</row>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:I${rows.length}"/><sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews><cols><col min="1" max="1" width="16" customWidth="1"/><col min="2" max="2" width="11" customWidth="1"/><col min="3" max="3" width="42" customWidth="1"/><col min="4" max="4" width="28" customWidth="1"/><col min="5" max="8" width="16" customWidth="1"/><col min="9" max="9" width="48" customWidth="1"/></cols><sheetData>${rowXml}</sheetData><autoFilter ref="A1:I${rows.length}"/></worksheet>`;
}

function stylesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="4"><numFmt numFmtId="164" formatCode="${xml(currencyFormat)}"/><numFmt numFmtId="165" formatCode="${xml(percentFormat)}"/><numFmt numFmtId="166" formatCode="${xml(integerFormat)}"/><numFmt numFmtId="167" formatCode="0.00&quot;%&quot;"/></numFmts><fonts count="4"><font><sz val="10"/><name val="Aptos"/></font><font><b/><sz val="18"/><color rgb="FFFFFFFF"/><name val="Aptos Display"/></font><font><b/><sz val="11"/><color rgb="FF16324F"/><name val="Aptos"/></font><font><b/><sz val="10"/><color rgb="FF16324F"/><name val="Aptos"/></font></fonts><fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF16324F"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE9F0F7"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDCE8F2"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFB5C7D9"/></left><right style="thin"><color rgb="FFB5C7D9"/></right><top style="thin"><color rgb="FFB5C7D9"/></top><bottom style="thin"><color rgb="FFB5C7D9"/></bottom><diagonal/></border></borders><cellXfs count="13"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="0" borderId="0"/><xf numFmtId="0" fontId="3" fillId="3" borderId="1"/><xf numFmtId="0" fontId="3" fillId="4" borderId="1"/><xf numFmtId="0" fontId="3" fillId="4" borderId="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="1" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="1" applyNumberFormat="1"/><xf numFmtId="166" fontId="0" fillId="0" borderId="1" applyNumberFormat="1"/><xf numFmtId="164" fontId="3" fillId="3" borderId="1" applyNumberFormat="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="1"/><xf numFmtId="14" fontId="0" fillId="0" borderId="1" applyNumberFormat="1"/><xf numFmtId="167" fontId="0" fillId="0" borderId="1" applyNumberFormat="1"/></cellXfs></styleSheet>`;
}

function contentTypes(hasDrawing: boolean, chartCount: number, hasAnalytics: boolean): string {
  const charts = Array.from({ length: chartCount }, (_, index) => `<Override PartName="/xl/charts/chart${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`).join("");
  const analytics = hasAnalytics ? `<Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>${analytics}${hasDrawing ? `<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>` : ""}${charts}</Types>`;
}

function rootRelationships(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
}

function workbookXml(sheetName: string, hasAnalytics: boolean): string {
  const appendix = hasAnalytics ? `<sheet name="Analytics Appendix" sheetId="3" r:id="rId4"/>` : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><fileVersion appName="QNC MIS"/><workbookPr/><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="12000"/></bookViews><sheets><sheet name="${xml(sheetName)}" sheetId="1" r:id="rId1"/><sheet name="Chart Data" sheetId="2" r:id="rId3"/>${appendix}</sheets><calcPr calcMode="auto"/></workbook>`;
}

function workbookRelationships(hasAnalytics: boolean): string {
  const appendix = hasAnalytics ? `<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/>` : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>${appendix}</Relationships>`;
}

function sheetRelationships(hasDrawing: boolean): string {
  if (!hasDrawing) return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>`;
}

function appProperties(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>QNC MIS exports</Application><AppVersion>1.0</AppVersion></Properties>`;
}

function coreProperties(model: PresentationModel): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xml(model.title)}</dc:title><dc:creator>QNC MIS</dc:creator><cp:lastModifiedBy>QNC MIS</cp:lastModifiedBy><dc:description>Professional MIS management report generated ${xml(model.metadata.generatedAt)}</dc:description></cp:coreProperties>`;
}

function drawingXml(charts: ChartRange[]): string {
  const anchors = charts.map((chart, index) => `<xdr:twoCellAnchor><xdr:from><xdr:col>${chart.fromCol}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${chart.fromRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>${chart.toCol}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${chart.toRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${index + 2}" name="Chart ${index + 1}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId${index + 1}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${anchors}</xdr:wsDr>`;
}

function drawingRelationships(count: number): string {
  const relationships = Array.from({ length: count }, (_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${index + 1}.xml"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships}</Relationships>`;
}

function chartXml(chart: ChartRange, index: number): string {
  const chartType = chart.kind === "bar" ? "barChart" : chart.kind === "doughnut" ? "doughnutChart" : "lineChart";
  const series = chart.series
    ? chart.series.map((item, itemIndex) => `<c:ser><c:idx val="${itemIndex}"/><c:order val="${itemIndex}"/><c:tx><c:v>${xml(item.name)}</c:v></c:tx><c:cat>${categoryReference(chart.labelRange)}</c:cat><c:val>${numberReference(item.valueRange, false)}</c:val></c:ser>`).join("")
    : chart.kind === "bar" && chart.comparisonRange
      ? `<c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>Current</c:v></c:tx><c:cat>${categoryReference(chart.labelRange)}</c:cat><c:val>${numberReference(chart.valueRange, false)}</c:val></c:ser><c:ser><c:idx val="1"/><c:order val="1"/><c:tx><c:v>Comparison</c:v></c:tx><c:cat>${categoryReference(chart.labelRange)}</c:cat><c:val>${numberReference(chart.comparisonRange, false)}</c:val></c:ser>`
    : chart.kind === "doughnut"
      ? `<c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>${xml(chart.title)}</c:v></c:tx><c:cat>${categoryReference(chart.labelRange)}</c:cat><c:val>${numberReference(chart.valueRange, true)}</c:val></c:ser>`
      : `<c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>${xml(chart.title)}</c:v></c:tx><c:cat>${categoryReference(chart.labelRange)}</c:cat><c:val>${numberReference(chart.valueRange, false)}</c:val></c:ser>`;
  const chartOptions = chart.kind === "bar"
    ? `<c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>${series}<c:axId val="10000001"/><c:axId val="10000002"/>`
    : chart.kind === "line"
      ? `<c:grouping val="standard"/>${series}<c:axId val="10000001"/><c:axId val="10000002"/>`
      : `<c:varyColors val="1"/><c:firstSliceAng val="0"/><c:holeSize val="55"/>${series}<c:dLbls><c:showLegendKey val="0"/><c:showPercent val="1"/><c:showLeaderLines val="1"/></c:dLbls>`;
  const axes = chart.kind === "doughnut" ? "" : `<c:catAx><c:axId val="10000001"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="10000002"/><c:crosses val="autoZero"/><c:tickLblPos val="low"/></c:catAx><c:valAx><c:axId val="10000002"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:crossAx val="10000001"/><c:crosses val="autoZero"/><c:majorGridlines/><c:numFmt formatCode="#,##0.00" sourceLinked="0"/></c:valAx>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:date1904 val="0"/><c:lang val="en-US"/><c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="1100"/><a:t>${xml(chart.title)}</a:t></a:r></a:p></c:rich></c:tx><c:layout/><c:overlay val="0"/></c:title><c:plotArea><c:layout/><c:${chartType}>${chartOptions}</c:${chartType}>${axes}</c:plotArea><c:legend><c:legendPos val="b"/><c:layout/></c:legend><c:plotVisOnly val="0"/><c:dispBlanksAs val="gap"/></c:chart><c:printSettings><c:headerFooter/><c:pageMargins b="0.75" l="0.25" r="0.25" t="0.75" header="0" footer="0"/><c:pageSetup/></c:printSettings></c:chartSpace>`;
}

function categoryReference(reference: string): string {
  return `<c:strRef><c:f>${xml(reference)}</c:f><c:strCache/></c:strRef>`;
}

function numberReference(reference: string, absolute: boolean): string {
  return `<c:numRef><c:f>${xml(reference)}</c:f><c:numCache><c:formatCode>${absolute ? currencyFormat : currencyFormat}</c:formatCode></c:numCache></c:numRef>`;
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function zip(files: [string, string | Buffer][]): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of files) {
    const nameBytes = Buffer.from(name);
    const body = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const checksum = crc32(body);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(body.length, 18);
    header.writeUInt32LE(body.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    local.push(header, nameBytes, body);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt32LE(checksum, 16);
    directory.writeUInt32LE(body.length, 20);
    directory.writeUInt32LE(body.length, 24);
    directory.writeUInt16LE(nameBytes.length, 28);
    directory.writeUInt32LE(offset, 42);
    central.push(directory, nameBytes);
    offset += header.length + nameBytes.length + body.length;
  }
  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBytes, end]);
}

export function reportXlsx(data: StandardReportData, metadata?: PresentationMetadata): Buffer {
  return buildWorkbook(standardPresentation(data, metadata));
}

export function analyticsXlsx(data: AnalyticsExportData, metadata?: PresentationMetadata): Buffer {
  return buildWorkbook(analyticsPresentation(data, metadata));
}
