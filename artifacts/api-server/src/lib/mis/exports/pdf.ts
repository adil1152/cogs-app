import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  ANALYTICS_METRIC_KEYS,
  KPI_DEFINITIONS,
  analyticsPresentation,
  incomePercentage,
  percentageAmount,
  percentageEnabled,
  percentageLines,
  standardPresentation,
  type AnalyticsExportData,
  type AnalyticsMetricBundle,
  type PresentationCurrency,
  type PresentationMetadata,
  type PresentationModel,
  type StandardReportData,
  type PercentageConfiguration,
} from "./model";

const navy = "#16324f";
const blue = "#2f6f9f";
const lightBlue = "#e9f0f7";
const grid = "#b5c7d9";
const text = "#17212b";
const classColors = ["#2f6f9f", "#61a6c2", "#89c2d9", "#a9d6e5"];
const DETAIL_COLUMNS = [
  ["Section / scope", 190], ["Period", 74], ["Income", 58], ["Cost", 58], ["Expenses", 58],
  ["Salaries", 58], ["Net profit", 62], ["Margin", 48], ["% income", 54], ["Entries", 42],
] as const;
const DETAIL_WIDTH = DETAIL_COLUMNS.reduce((sum, [, width]) => sum + width, 0);

function number(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: number): string {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function percent(value: number): string {
  return `${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}%`;
}

function logoPath(): string | null {
  const candidates = [
    process.env.MIS_LOGO_PATH,
    join(process.cwd(), "artifacts/cogs-tracker/public/qnc-logo.png"),
    join(process.cwd(), "attached_assets/QNC-logo----_1777990467727.png"),
  ].filter((value): value is string => Boolean(value));
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function titleCase(value: string | undefined): string {
  if (!value) return "Management report";
  return value.split("-").map((part) => part ? part[0].toUpperCase() + part.slice(1) : part).join(" ");
}

function scopeLabel(row: { projectName: string | null; projectNumber: string | null; tabName: string | null; serviceName: string | null; periodStart: string | null; periodEnd: string | null; periodLabel?: string | null }): string {
  return [row.periodLabel, row.projectName, row.projectNumber ? `#${row.projectNumber}` : null, row.tabName, row.serviceName, row.periodStart && row.periodEnd ? `${row.periodStart} – ${row.periodEnd}` : null]
    .filter((value): value is string => Boolean(value))
    .join(" / ") || "Currency total";
}

function metadataLines(model: PresentationModel): string[] {
  const lines = [
    `Project: ${model.metadata.projectName ?? "All permitted projects"}${model.metadata.projectNumber ? `  (#${model.metadata.projectNumber})` : ""}`,
    `Reporting period: ${model.metadata.from && model.metadata.to ? `${model.metadata.from} to ${model.metadata.to}` : "All available periods"}`,
    `Generated: ${model.metadata.generatedAt}`,
  ];
  if (model.periods?.length) {
    lines.splice(1, 0, `Selected periods: ${model.periods.map((period) => `${period.label} (${period.from} to ${period.to})`).join("  |  ")}`);
  }
  if (model.metadata.compareFrom && model.metadata.compareTo) lines.push(`Comparison period: ${model.metadata.compareFrom} to ${model.metadata.compareTo}`);
  if (model.metadata.filters) {
    const valueText = (value: unknown): string => Array.isArray(value)
      ? value.map((item) => item && typeof item === "object" ? JSON.stringify(item) : String(item)).join(", ")
      : value && typeof value === "object" ? JSON.stringify(value) : String(value);
    const filters = Object.entries(model.metadata.filters)
      .filter(([, value]) => value != null && value !== "" && (!Array.isArray(value) || value.length > 0))
      .map(([key, value]) => `${key}: ${valueText(value)}`)
      .join("  |  ");
    if (filters) lines.push(`Filters: ${filters}`);
  }
  return lines;
}

function pdfCurrencies(model: PresentationModel): PresentationCurrency[] {
  if (model.periods?.length) return model.periods.flatMap((period) => period.currencies);
  return model.currencies;
}

function drawBar(document: PDFKit.PDFDocument, currency: PresentationCurrency, x: number, y: number, width: number, height: number): void {
  const periodSuffix = currency.periodLabel ? ` — ${currency.periodLabel}` : "";
  document.fontSize(8).fillColor(navy).text(`${currency.currency}${periodSuffix} — income and operating classes`, x, y, { width, ellipsis: true });
  const chartY = y + 20;
  const chartHeight = height - 40;
  const values = KPI_DEFINITIONS.slice(0, 4).map(([, key]) => number(currency.current[key as keyof typeof currency.current]));
  const max = Math.max(...values.map((value) => Math.abs(value)), 1);
  const baseline = chartY + chartHeight / 2;
  document.strokeColor(grid).lineWidth(0.5).moveTo(x, baseline).lineTo(x + width, baseline).stroke();
  const barWidth = Math.max(14, (width - 35) / values.length - 8);
  values.forEach((value, index) => {
    const barHeight = (Math.abs(value) / max) * ((chartHeight / 2) - 10);
    const barX = x + 18 + index * (barWidth + 8);
    const barY = value < 0 ? baseline : baseline - barHeight;
    document.fillColor(classColors[index]).rect(barX, barY, barWidth, Math.max(barHeight, value === 0 ? 1 : 2)).fill();
    document.fontSize(7).fillColor(text).text(KPI_DEFINITIONS[index][0].replace("Total ", ""), barX - 7, chartY + chartHeight + 3, { width: barWidth + 14, align: "center" });
    document.fontSize(7).fillColor(text).text(money(value), barX - 14, value < 0 ? baseline + barHeight + 2 : barY - 12, { width: barWidth + 28, align: "center" });
  });
}

function drawDonut(
  document: PDFKit.PDFDocument,
  currency: PresentationCurrency,
  x: number,
  y: number,
  width: number,
  height: number,
  configuration?: PercentageConfiguration | null,
  legacyDefault = true,
): void {
  document.fontSize(8).fillColor(navy).text(`${currency.currency}${currency.periodLabel ? ` — ${currency.periodLabel}` : ""} — cost/expense/salary % income`, x, y, { width, ellipsis: true });
  let lines = percentageLines(currency, configuration, legacyDefault)
    .filter((line) => line.label.toLowerCase() !== "income")
    .map((line) => ({ ...line, amount: Math.max(0, line.amount) }))
    .filter((line) => line.amount > 0);
  if (legacyDefault && !lines.length) {
    lines = KPI_DEFINITIONS.slice(1, 4).map(([label, key]) => ({
      label: label.replace("Total ", ""),
      amount: Math.max(0, number(currency.current[key as keyof typeof currency.current])),
      percent: incomePercentage(number(currency.current[key as keyof typeof currency.current]), currency.current.income),
      enabled: true,
    }));
  }
  if (!lines.length) {
    document.fillColor(text).fontSize(8).text("No configured percentage categories in the selected scope.", x, y + 32, { width });
    return;
  }
  const values = lines.map((line) => line.amount);
  const income = currency.current.income;
  const categoryTotal = values.reduce((sum, value) => sum + value, 0);
  const valid = income > 0 && categoryTotal <= income;
  if (!valid) {
    drawActualAmountBar(document, currency, lines, x, y + 15, width, height - 15);
    return;
  }
  const remainder = income - categoryTotal;
  if (remainder > 0) {
    lines.push({ label: "Profit remainder", amount: remainder, percent: incomePercentage(remainder, income), enabled: true });
  }
  const total = lines.reduce((sum, line) => sum + line.amount, 0);
  const centerX = x + width / 2;
  const centerY = y + height / 2 + 7;
  const radius = Math.min(width, height) / 3;
  let angle = -Math.PI / 2;
  lines.forEach((line, index) => {
    const value = line.amount;
    // With no amounts there is intentionally no slice rather than a fake
    // non-zero chart. The labelled "No activity" state below stays truthful.
    const sweep = total === 0 ? 0 : (value / total) * Math.PI * 2;
    if (sweep > 0) {
      // PDFKit exposes primitive path operations rather than an arc helper.
      // A short polygonal sector is still a native vector shape and remains
      // crisp at print resolution.
      const segments = Math.max(8, Math.ceil(sweep * 12));
      document.fillColor(classColors[index % classColors.length]).moveTo(centerX, centerY);
      for (let point = 0; point <= segments; point += 1) {
        const currentAngle = angle + (sweep * point) / segments;
        document.lineTo(centerX + Math.cos(currentAngle) * radius, centerY + Math.sin(currentAngle) * radius);
      }
      document.lineTo(centerX, centerY).fill();
    }
    angle += sweep;
  });
  document.fillColor("#fff").circle(centerX, centerY, radius * 0.56).fill();
  document.fontSize(8).fillColor(text).text(total === 0 ? "No activity" : money(total), centerX - 42, centerY - 5, { width: 84, align: "center" });
  lines.forEach((line, index) => {
    const value = line.amount;
    const legendY = y + height - 33 + index * 10;
    document.fillColor(classColors[index % classColors.length]).rect(x + 5, legendY + 2, 6, 6).fill();
    const share = total === 0 ? 0 : (value / total) * 100;
    document.fillColor(text).fontSize(7).text(`${line.label}: ${money(value)} (${share.toFixed(1)}%; ${incomePercentage(value, income).toFixed(1)}% of income)`, x + 15, legendY, { width: width - 20 });
  });
}

function drawActualAmountBar(
  document: PDFKit.PDFDocument,
  currency: PresentationCurrency,
  lines: Array<{ label: string; amount: number }>,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const denominatorLabel = currency.current.income > 0
    ? "expenses exceed income; % of income shown"
    : "income is zero; percentages are 0%";
  document.fontSize(8).fillColor(navy).text(`${currency.currency} — actual amounts (${denominatorLabel})`, x, y);
  const chartY = y + 17;
  const max = Math.max(...lines.map((line) => Math.abs(line.amount)), 1);
  const barWidth = Math.max(14, (width - 24) / Math.max(lines.length, 1) - 8);
  lines.forEach((line, index) => {
    const barHeight = (Math.abs(line.amount) / max) * Math.max(height - 48, 20);
    const barX = x + 12 + index * (barWidth + 8);
    document.fillColor(classColors[index % classColors.length]).rect(barX, chartY + height - 42 - barHeight, barWidth, Math.max(2, barHeight)).fill();
    document.fillColor(text).fontSize(6.5).text(line.label, barX - 5, chartY + height - 36, { width: barWidth + 10, align: "center" });
    document.fontSize(6).text(`${money(line.amount)} (${incomePercentage(line.amount, currency.current.income).toFixed(1)}%)`, barX - 12, chartY + height - 55 - barHeight, { width: barWidth + 24, align: "center" });
  });
}

function drawTrend(document: PDFKit.PDFDocument, currency: PresentationCurrency, x: number, y: number, width: number, height: number): void {
  document.fontSize(8).fillColor(navy).text(`${currency.currency} — period trend`, x, y, { width, ellipsis: true });
  if (!currency.trend.length) {
    document.fontSize(8).fillColor(text).text("No period buckets in the selected scope.", x, y + 30);
    return;
  }
  const chartY = y + 22;
  const chartHeight = height - 42;
  const values = currency.trend.map((row) => row.current.income);
  const max = Math.max(...values.map((value) => Math.abs(value)), 1);
  document.strokeColor(grid).lineWidth(0.5).moveTo(x, chartY + chartHeight).lineTo(x + width, chartY + chartHeight).stroke();
  const step = currency.trend.length === 1 ? 0 : (width - 16) / (currency.trend.length - 1);
  let previous: { x: number; y: number } | null = null;
  currency.trend.forEach((row, index) => {
    const pointX = x + 8 + step * index;
    const pointY = chartY + chartHeight - (Math.max(0, row.current.income) / max) * (chartHeight - 12);
    if (previous) document.strokeColor(blue).lineWidth(1.5).moveTo(previous.x, previous.y).lineTo(pointX, pointY).stroke();
    document.fillColor(blue).circle(pointX, pointY, 2.5).fill();
    if (index === 0 || index === currency.trend.length - 1) {
      const label = row.periodStart ?? row.projectName ?? row.serviceName ?? "Group";
      document.fontSize(6).fillColor(text).text(label, pointX - 24, chartY + chartHeight + 4, { width: 48, align: "center", ellipsis: true });
    }
    previous = { x: pointX, y: pointY };
  });
}

function drawSummary(document: PDFKit.PDFDocument, currency: PresentationCurrency, x: number, y: number, width: number): number {
  document.fontSize(12).fillColor(navy).text(`Executive summary — ${currency.currency}${currency.periodLabel ? ` — ${currency.periodLabel}` : ""}`, x, y);
  y += 20;
  const cardWidth = (width - 18) / 4;
  KPI_DEFINITIONS.forEach(([label, key], index) => {
    const row = Math.floor(index / 4);
    const column = index % 4;
    const cardX = x + column * (cardWidth + 6);
    const cardY = y + row * 48;
    const current = number(currency.current[key as keyof typeof currency.current]);
    document.fillColor(lightBlue).roundedRect(cardX, cardY, cardWidth, 40, 3).fill();
    document.fillColor(navy).fontSize(7).text(label, cardX + 7, cardY + 6, { width: cardWidth - 14 });
    document.fillColor(text).fontSize(11).text(key === "profitMargin" ? percent(current) : money(current), cardX + 7, cardY + 18, { width: cardWidth - 14 });
    if (currency.comparison) {
      const prior = number(currency.comparison[key as keyof typeof currency.comparison]);
      document.fillColor("#536270").fontSize(6).text(`Prior ${key === "profitMargin" ? percent(prior) : money(prior)}`, cardX + 7, cardY + 32, { width: cardWidth - 14 });
    }
  });
  return y + 96;
}

function drawPercentageSection(
  document: PDFKit.PDFDocument,
  currency: PresentationCurrency,
  x: number,
  y: number,
  width: number,
  configuration?: PercentageConfiguration | null,
  legacyDefault = true,
): number {
  const lines = percentageLines(currency, configuration, legacyDefault).filter((line) => line.enabled);
  if (!lines.length) return y;
  document.fillColor(navy).fontSize(10).text(`Percentage against total income — ${currency.currency}${currency.periodLabel ? ` — ${currency.periodLabel}` : ""}`, x, y);
  y += 16;
  const columns: Array<[string, number]> = [["Category / service", width * 0.5], ["Amount", width * 0.25], ["% of income", width * 0.25]];
  let cursor = x;
  document.fillColor(navy).rect(x, y, width, 17).fill();
  columns.forEach(([label, columnWidth], index) => {
    document.fillColor("#fff").fontSize(7).text(label, cursor + 3, y + 4, { width: columnWidth - 6, align: index === 0 ? "left" : "right" });
    cursor += columnWidth;
  });
  y += 18;
  lines.forEach((line, index) => {
    if (index % 2 === 1) document.fillColor("#f5f8fb").rect(x, y, width, 17).fill();
    cursor = x;
    [line.label, money(line.amount), percent(line.percent)].forEach((value, valueIndex) => {
      const columnWidth = columns[valueIndex][1];
      document.fillColor(text).fontSize(7).text(value, cursor + 3, y + 4, { width: columnWidth - 6, align: valueIndex === 0 ? "left" : "right" });
      cursor += columnWidth;
    });
    y += 17;
  });
  return y + 7;
}

function drawComparisonChart(
  document: PDFKit.PDFDocument,
  title: string,
  categories: string[],
  series: Array<{ name: string; values: number[] }>,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  document.fillColor(navy).fontSize(10).text(title, x, y);
  if (!categories.length || !series.length) return;
  const chartY = y + 18;
  const chartHeight = height - 40;
  const max = Math.max(...series.flatMap((item) => item.values.map((value) => Math.abs(value))), 1);
  const groupWidth = width / categories.length;
  const barWidth = Math.max(4, Math.min(16, (groupWidth - 12) / series.length));
  categories.forEach((category, categoryIndex) => {
    series.forEach((item, seriesIndex) => {
      const value = item.values[categoryIndex] ?? 0;
      const barHeight = Math.abs(value) / max * (chartHeight - 16);
      const barX = x + categoryIndex * groupWidth + 5 + seriesIndex * (barWidth + 2);
      const barY = chartY + chartHeight - barHeight;
      document.fillColor(classColors[seriesIndex % classColors.length]).rect(barX, barY, barWidth, Math.max(1, barHeight)).fill();
    });
    document.fillColor(text).fontSize(6).text(category, x + categoryIndex * groupWidth, chartY + chartHeight + 3, { width: groupWidth - 2, align: "center", ellipsis: true });
  });
  series.forEach((item, index) => {
    const legendX = x + index * Math.min(100, width / Math.max(series.length, 1));
    document.fillColor(classColors[index % classColors.length]).rect(legendX, y + height - 13, 6, 6).fill();
    document.fillColor(text).fontSize(6).text(item.name, legendX + 9, y + height - 15, { width: 90 });
  });
}

function drawDetailHeader(document: PDFKit.PDFDocument, x: number, y: number): void {
  let cursor = x;
  document.fillColor(navy).rect(x, y, DETAIL_WIDTH, 18).fill();
  DETAIL_COLUMNS.forEach(([label, width]) => {
    document.fillColor("#fff").fontSize(7).text(label, cursor + 3, y + 5, { width: width - 6, align: label === "Section / scope" || label === "Period" ? "left" : "right" });
    cursor += width;
  });
}

function detailValues(
  row: PresentationCurrency["rows"][number],
  currency: PresentationCurrency,
  configuration?: PercentageConfiguration | null,
  legacyDefault = true,
): string[] {
  const includePercentage = percentageEnabled(row, configuration, legacyDefault);
  const rowAmount = percentageAmount(row);
  return [
    scopeLabel(row),
    row.periodStart && row.periodEnd ? `${row.periodStart} – ${row.periodEnd}` : "—",
    money(row.current.income),
    money(row.current.cost),
    money(row.current.expenses),
    money(row.current.salaries),
    money(row.current.netProfit),
    percent(row.current.profitMargin),
    includePercentage ? percent(incomePercentage(rowAmount, currency.current.income)) : "—",
    String(row.current.entryCount),
  ];
}

function detailRowHeight(
  document: PDFKit.PDFDocument,
  row: PresentationCurrency["rows"][number],
  currency: PresentationCurrency,
  configuration?: PercentageConfiguration | null,
  legacyDefault = true,
): number {
  document.fontSize(6.5);
  const heights = detailValues(row, currency, configuration, legacyDefault).map((value, index) => document.heightOfString(value, {
    width: DETAIL_COLUMNS[index][1] - 6,
    lineGap: 1,
  }));
  return Math.max(16, Math.ceil(Math.max(...heights) + 7));
}

function drawDetailRow(
  document: PDFKit.PDFDocument,
  row: PresentationCurrency["rows"][number],
  currency: PresentationCurrency,
  x: number,
  y: number,
  shade: boolean,
  configuration?: PercentageConfiguration | null,
  legacyDefault = true,
): number {
  const values = detailValues(row, currency, configuration, legacyDefault);
  const height = detailRowHeight(document, row, currency, configuration, legacyDefault);
  let cursor = x;
  if (shade) document.fillColor("#f5f8fb").rect(x, y, DETAIL_WIDTH, height).fill();
  DETAIL_COLUMNS.forEach(([, width], index) => {
    document.fillColor(text).fontSize(6.5).text(values[index], cursor + 3, y + 4, {
      width: width - 6,
      lineGap: 1,
      align: index < 2 ? "left" : "right",
    });
    cursor += width;
  });
  return height;
}

function drawDetailSubtotal(
  document: PDFKit.PDFDocument,
  section: string,
  totals: { income: number; cost: number; expenses: number; salaries: number; netProfit: number; entryCount: number },
  x: number,
  y: number,
): void {
  const income = totals.income;
  const margin = income === 0 ? 0 : (totals.netProfit / income) * 100;
  const values = [
    `${section} subtotal`, "", money(totals.income), money(totals.cost), money(totals.expenses),
    money(totals.salaries), money(totals.netProfit), percent(margin), "—", String(totals.entryCount),
  ];
  let cursor = x;
  document.fillColor("#eef3f7").rect(x, y, DETAIL_WIDTH, 19).fill();
  DETAIL_COLUMNS.forEach(([, width], index) => {
    document.fillColor(text).fontSize(7).text(values[index], cursor + 3, y + 5, {
      width: width - 6,
      align: index < 2 ? "left" : "right",
      lineBreak: false,
    });
    cursor += width;
  });
}

const ANALYTICS_TABLE_COLUMNS = [
  ["Metric", 210], ["Current", 145], ["Previous", 145], ["Difference", 145], ["% difference", 140],
] as const;
const ANALYTICS_TABLE_WIDTH = ANALYTICS_TABLE_COLUMNS.reduce((sum, [, width]) => sum + width, 0);

function analyticsText(value: unknown): string {
  if (value == null) return "—";
  if (Array.isArray(value)) return value.join(", ") || "—";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isFinite(value) ? value.toLocaleString("en-US", { maximumFractionDigits: 4 }) : "—";
  return String(value);
}

interface AnalyticsAppendixEntry {
  kind: string;
  scope: string;
  bundle: AnalyticsMetricBundle;
  drilldown: Record<string, unknown> | null;
}

function analyticsEntries(currency: PresentationCurrency): AnalyticsAppendixEntry[] {
  const entries: AnalyticsAppendixEntry[] = [];
  if (currency.analytics) entries.push({ kind: "Currency total", scope: "Currency total", bundle: currency.analytics, drilldown: null });
  currency.rows.forEach((row) => {
    if (row.analytics) entries.push({ kind: "Group", scope: scopeLabel(row), bundle: row.analytics, drilldown: row.drilldownFilters ?? null });
  });
  currency.trend.forEach((row) => {
    if (row.analytics) entries.push({ kind: "Trend", scope: `Trend — ${scopeLabel(row)}`, bundle: row.analytics, drilldown: row.drilldownFilters ?? null });
  });
  return entries;
}

function drawAnalyticsTableHeader(document: PDFKit.PDFDocument, x: number, y: number): void {
  let cursor = x;
  document.fillColor(navy).rect(x, y, ANALYTICS_TABLE_WIDTH, 17).fill();
  ANALYTICS_TABLE_COLUMNS.forEach(([label, width], index) => {
    document.fillColor("#fff").fontSize(7).text(label, cursor + 3, y + 4, { width: width - 6, align: index === 0 ? "left" : "right" });
    cursor += width;
  });
}

function analyticsMetricHeight(document: PDFKit.PDFDocument, key: string, bundle: AnalyticsMetricBundle): number {
  const values = [key, bundle.current[key], bundle.previous?.[key], bundle.difference?.[key], bundle.percentageDifference?.[key]].map(analyticsText);
  document.fontSize(6.5);
  const heights = values.map((value, index) => document.heightOfString(value, {
    width: ANALYTICS_TABLE_COLUMNS[index][1] - 6,
    lineGap: 1,
  }));
  return Math.max(15, Math.ceil(Math.max(...heights) + 6));
}

function drawAnalyticsMetric(
  document: PDFKit.PDFDocument,
  key: string,
  bundle: AnalyticsMetricBundle,
  x: number,
  y: number,
  shade: boolean,
): number {
  const height = analyticsMetricHeight(document, key, bundle);
  const values = [key, bundle.current[key], bundle.previous?.[key], bundle.difference?.[key], bundle.percentageDifference?.[key]].map(analyticsText);
  let cursor = x;
  if (shade) document.fillColor("#f5f8fb").rect(x, y, ANALYTICS_TABLE_WIDTH, height).fill();
  ANALYTICS_TABLE_COLUMNS.forEach(([, width], index) => {
    document.fillColor(text).fontSize(6.5).text(values[index], cursor + 3, y + 3, {
      width: width - 6,
      lineGap: 1,
      align: index === 0 ? "left" : "right",
    });
    cursor += width;
  });
  return height;
}

function footer(document: PDFKit.PDFDocument): void {
  const pages = document.bufferedPageRange();
  for (let index = 0; index < pages.count; index += 1) {
    document.switchToPage(index);
    document.page.margins.bottom = 0;
    document.strokeColor(grid).lineWidth(0.5).moveTo(28, document.page.height - 27).lineTo(document.page.width - 28, document.page.height - 27).stroke();
    document.fillColor("#536270").fontSize(7).text("QNC MIS • Confidential management report", 28, document.page.height - 20, { lineBreak: false });
    document.text(`Page ${index + 1} of ${pages.count}`, 28, document.page.height - 20, { width: document.page.width - 56, align: "right", lineBreak: false });
  }
}

async function buildPdf(model: PresentationModel): Promise<Buffer> {
  const document = new PDFDocument({
    size: "A4",
    layout: "landscape",
    margin: 28,
    bufferPages: true,
    info: {
      Title: model.title,
      Author: "QNC MIS",
      Subject: `MIS ${titleCase(model.metadata.reportType)}`,
      Keywords: "QNC, MIS, management information, report",
      CreationDate: new Date(model.metadata.generatedAt),
    },
  });
  const fontPath = process.env.MIS_PDF_FONT_PATH ?? "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";
  if (existsSync(fontPath)) document.font(fontPath);
  const chunks: Buffer[] = [];
  document.on("data", (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve, reject) => {
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
  });
  const logo = logoPath();
  const pageHeader = (first = false) => {
    let y = 26;
    if (logo) {
      try {
        document.image(logo, 28, 22, { fit: [92, 34] });
      } catch {
        // A deployment may omit the optional branding asset; text branding
        // remains complete and the export must still be usable.
      }
    }
    const titleX = logo ? 132 : 28;
    document.fillColor(navy).fontSize(first ? 18 : 12).text(model.title, titleX, first ? 28 : 30, { width: 650 });
    y = first ? 57 : 48;
    if (first) {
      document.fillColor("#536270").fontSize(8).text("Professional management presentation", titleX, y);
      y += 17;
      metadataLines(model).forEach((line) => {
        const lineHeight = document.heightOfString(line, { width: 770 });
        document.fillColor(text).fontSize(7).text(line, titleX, y, { width: 770 });
        y += lineHeight + 2;
      });
      y += 5;
    }
    return y;
  };

  const currencies = pdfCurrencies(model);
  const percentageConfiguration = model.metadata.percentageConfiguration;
  if (!currencies.length) {
    pageHeader(true);
    document.fillColor(text).fontSize(11).text("No records matched the selected scope and filters.", 28, 155);
  } else {
    currencies.forEach((currency, currencyIndex) => {
      if (currencyIndex > 0) document.addPage();
      let y = pageHeader(currencyIndex === 0);
      const currencyPercentageConfiguration = currency.percentageConfiguration ?? percentageConfiguration;
      const currencyLegacyPercentageDefault = currencyPercentageConfiguration == null
        && !currency.rows.some((row) => row.calculatePercentAgainstIncome != null);
      y = drawSummary(document, currency, 28, y, 785);
      const chartY = y + 6;
      drawBar(document, currency, 28, chartY, 250, 145);
      drawDonut(document, currency, 295, chartY, 220, 145, currencyPercentageConfiguration, currencyLegacyPercentageDefault);
      drawTrend(document, currency, 535, chartY, 275, 145);
      y = chartY + 158;

      document.fillColor(navy).fontSize(12).text(`Detailed class and custom sections — ${currency.currency}`, 28, y);
      y += 20;
      const sections = [...new Set(currency.rows.map((row) => row.section))];
      if (!sections.length) {
        document.fillColor(text).fontSize(8).text("No detailed rows in this currency group.", 28, y);
      }
      for (const section of sections) {
        const rows = currency.rows.filter((row) => row.section === section);
        if (y + 38 > document.page.height - 42) {
          document.addPage();
          y = pageHeader(false);
        }
        document.fillColor(blue).fontSize(9).text(section, 28, y);
        y += 14;
        drawDetailHeader(document, 28, y);
        y += 20;
        for (const [rowIndex, row] of rows.entries()) {
          const rowHeight = detailRowHeight(document, row, currency, currencyPercentageConfiguration, currencyLegacyPercentageDefault);
          if (y + rowHeight > document.page.height - 42) {
            document.addPage();
            y = pageHeader(false);
            document.fillColor(blue).fontSize(9).text(`${section} (continued)`, 28, y);
            y += 14;
            drawDetailHeader(document, 28, y);
            y += 20;
          }
          y += drawDetailRow(document, row, currency, 28, y, rowIndex % 2 === 1, currencyPercentageConfiguration, currencyLegacyPercentageDefault);
        }
        const sectionTotals = rows.reduce((sum, row) => ({
          income: sum.income + row.current.income,
          cost: sum.cost + row.current.cost,
          expenses: sum.expenses + row.current.expenses,
          salaries: sum.salaries + row.current.salaries,
          netProfit: sum.netProfit + row.current.netProfit,
          entryCount: sum.entryCount + row.current.entryCount,
        }), { income: 0, cost: 0, expenses: 0, salaries: 0, netProfit: 0, entryCount: 0 });
        if (y + 19 > document.page.height - 42) {
          document.addPage();
          y = pageHeader(false);
          document.fillColor(blue).fontSize(9).text(`${section} subtotal`, 28, y);
          y += 14;
          drawDetailHeader(document, 28, y);
          y += 20;
        }
        drawDetailSubtotal(document, section, sectionTotals, 28, y);
        y += 24;
      }
      y = drawPercentageSection(document, currency, 28, y, 785, currencyPercentageConfiguration, currencyLegacyPercentageDefault);
      if (currency.analytics) {
        const entries = analyticsEntries(currency);
        if (y + 40 > document.page.height - 42) {
          document.addPage();
          y = pageHeader(false);
        }
        document.fillColor(navy).fontSize(12).text(`Analytics metric appendix — ${currency.currency}${currency.periodLabel ? ` — ${currency.periodLabel}` : ""}`, 28, y);
        y += 19;
        for (const entry of entries) {
          const scopeHeight = document.heightOfString(`${entry.kind}: ${entry.scope}`, { width: 785 });
          if (y + scopeHeight + 37 > document.page.height - 42) {
            document.addPage();
            y = pageHeader(false);
            document.fillColor(navy).fontSize(12).text(`Analytics metric appendix — ${currency.currency} (continued)`, 28, y);
            y += 19;
          }
          document.fillColor(blue).fontSize(8).text(`${entry.kind}: ${entry.scope}`, 28, y, { width: 785 });
          y += scopeHeight + 3;
          if (entry.drilldown && Object.keys(entry.drilldown).length) {
            const drilldown = `Drilldown filters: ${JSON.stringify(entry.drilldown)}`;
            const drilldownHeight = document.heightOfString(drilldown, { width: 785 });
            if (y + drilldownHeight + 20 > document.page.height - 42) {
              document.addPage();
              y = pageHeader(false);
              document.fillColor(navy).fontSize(12).text(`Analytics metric appendix — ${currency.currency} (continued)`, 28, y);
              y += 19;
            }
            document.fillColor("#536270").fontSize(6.5).text(drilldown, 28, y, { width: 785 });
            y += drilldownHeight + 3;
          }
          if (y + 17 > document.page.height - 42) {
            document.addPage();
            y = pageHeader(false);
            document.fillColor(navy).fontSize(12).text(`Analytics metric appendix — ${currency.currency} (continued)`, 28, y);
            y += 19;
          }
          drawAnalyticsTableHeader(document, 28, y);
          y += 19;
          for (const [metricIndex, key] of ANALYTICS_METRIC_KEYS.entries()) {
            const metricHeight = analyticsMetricHeight(document, key, entry.bundle);
            if (y + metricHeight > document.page.height - 42) {
              document.addPage();
              y = pageHeader(false);
              document.fillColor(navy).fontSize(12).text(`Analytics metric appendix — ${currency.currency} (continued)`, 28, y);
              y += 19;
              drawAnalyticsTableHeader(document, 28, y);
              y += 19;
            }
            y += drawAnalyticsMetric(document, key, entry.bundle, 28, y, metricIndex % 2 === 1);
          }
          y += 8;
        }
      }
    });

    // Keep period and project comparisons on the same export surface as the
    // period-scoped summaries. The labels are the selected labels, never
    // synthesized dates or data from another currency.
    for (const currencyCode of [...new Set(currencies.map((currency) => currency.currency))]) {
      const periodViews = (model.periods ?? []).flatMap((period) => period.currencies.filter((currency) => currency.currency === currencyCode));
      if (periodViews.length >= 2) {
        document.addPage();
        let comparisonY = pageHeader(false);
        const labels = periodViews.map((currency) => currency.periodLabel ?? currency.periodFrom ?? "Period");
        drawComparisonChart(document, `${currencyCode} — period comparison`, labels, [
          { name: "Income", values: periodViews.map((currency) => currency.current.income) },
          { name: "Cost", values: periodViews.map((currency) => currency.current.cost) },
          { name: "Expenses", values: periodViews.map((currency) => currency.current.expenses) },
          { name: "Salaries", values: periodViews.map((currency) => currency.current.salaries) },
          { name: "Net profit", values: periodViews.map((currency) => currency.current.netProfit) },
        ], 28, comparisonY, 785, 240);
      }
      const projects = new Map<string, { name: string; income: number; cost: number; expenses: number; salaries: number; netProfit: number }>();
      currencies.filter((currency) => currency.currency === currencyCode).forEach((currency) => currency.rows.forEach((row) => {
        const key = row.projectId ?? row.projectName;
        if (!key) return;
        const current = projects.get(key) ?? { name: row.projectName ?? key, income: 0, cost: 0, expenses: 0, salaries: 0, netProfit: 0 };
        current.income += row.current.income;
        current.cost += row.current.cost;
        current.expenses += row.current.expenses;
        current.salaries += row.current.salaries;
        current.netProfit += row.current.netProfit;
        projects.set(key, current);
      }));
      if (projects.size >= 2) {
        document.addPage();
        const comparisonY = pageHeader(false);
        const values = [...projects.values()];
        drawComparisonChart(document, `${currencyCode} — project comparison`, values.map((project) => project.name), [
          { name: "Income", values: values.map((project) => project.income) },
          { name: "Cost", values: values.map((project) => project.cost) },
          { name: "Expenses", values: values.map((project) => project.expenses) },
          { name: "Salaries", values: values.map((project) => project.salaries) },
          { name: "Net profit", values: values.map((project) => project.netProfit) },
        ], 28, comparisonY, 785, 240);
      }
    }
  }
  footer(document);
  document.end();
  return finished;
}

export function reportPdf(data: StandardReportData, metadata?: PresentationMetadata): Promise<Buffer> {
  return buildPdf(standardPresentation(data, metadata));
}

export function analyticsPdf(data: AnalyticsExportData, metadata?: PresentationMetadata): Promise<Buffer> {
  return buildPdf(analyticsPresentation(data, metadata));
}
