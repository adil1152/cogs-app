import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { zip } from "./xlsx";

/**
 * MIS Dashboard / MIS Overview Report exports.
 *
 * Every value rendered here comes from the server-computed dashboard payload
 * (the same computation the dashboard view uses). Nothing is inferred: when
 * the payload omits adjusted net profit or an Overhead / OP section because the
 * user lacks permission, the export omits it too.
 */

export interface DashboardExportTotals {
  income: number; cost: number; expenses: number; salaries: number;
  grossProfit: number; netProfit: number; profitMargin: number; entryCount: number;
}
interface ChargeSection { total: number; services: Array<{ name: string; percentage: number; amount: number }> }
export interface DashboardExportPayload {
  currencyGroups: Array<{
    currency: string;
    totals: DashboardExportTotals;
    adjustedNetProfit?: number;
    byService?: Array<{ serviceName: string; tabName: string; financialClass: string; totals: DashboardExportTotals }>;
    byProject: Array<{ projectName: string; totals: DashboardExportTotals }>;
    byTab: Array<{ tabName: string; type: string; financialClass?: string; totals: DashboardExportTotals }>;
    byPeriod: Array<{ fromDate: string; toDate: string; totals: DashboardExportTotals }>;
  }>;
  percentageAdjustments?: Array<{ currency: string; overhead?: ChargeSection; opExpense?: ChargeSection }>;
  recentEntries: Array<{ projectName: string; tabName: string; serviceName: string; fromDate: string; toDate: string; amount: number; currency: string; status: string }>;
}
export interface DashboardExportContext {
  view: "dashboard" | "overview";
  generatedAt: Date;
  from: string | null;
  to: string | null;
  status: string;
  /** null means all permitted projects. */
  projects: string[] | null;
  category: string | null;
  service: string | null;
}

type Group = DashboardExportPayload["currencyGroups"][number];
interface ChargeSummary { kind: "overhead" | "opExpense"; label: string; percentage: number; total: number; services: Array<{ name: string; percentage: number; amount: number }> }

const SERVICE_SECTIONS = [
  { cls: "income", title: "Income by service", key: "income" },
  { cls: "cost", title: "Cost by service", key: "cost" },
  { cls: "expense", title: "Expenses by service", key: "expenses" },
  { cls: "salary", title: "Salaries by service", key: "salaries" },
] as const;
const RECENT_LIMIT = 8;

const round = (value: number) => Number((Number.isFinite(value) ? value : 0).toFixed(6));
const pct = (part: number, whole: number) => whole ? part / whole * 100 : 0;

/** Same aggregation the dashboard page shows: per currency and kind, services merged by name. */
export function summarizeCharges(payload: DashboardExportPayload, currency: string): ChargeSummary[] {
  const out: ChargeSummary[] = [];
  for (const kind of ["overhead", "opExpense"] as const) {
    const sections = (payload.percentageAdjustments ?? []).filter((row) => row.currency === currency).map((row) => row[kind]).filter((section): section is ChargeSection => Boolean(section));
    if (!sections.length) continue;
    const services = new Map<string, { name: string; percentage: number; amount: number }>();
    let total = 0; let percentage = 0;
    for (const section of sections) {
      total += section.total;
      for (const service of section.services) {
        const name = service.name.trim();
        const key = name.toLocaleLowerCase("en-US");
        const line = services.get(key) ?? { name, percentage: 0, amount: 0 };
        line.amount += service.amount; line.percentage += service.percentage; percentage += service.percentage;
        services.set(key, line);
      }
    }
    out.push({
      kind, label: kind === "overhead" ? "Overhead" : "OP Expense", total: round(total), percentage: round(percentage),
      services: [...services.values()].map((line) => ({ ...line, amount: round(line.amount), percentage: round(line.percentage) })).sort((a, b) => a.name.localeCompare(b.name)),
    });
  }
  return out;
}

export interface KpiLine { label: string; value: number; kind: "money" | "percent" | "integer"; note: string }
export function dashboardKpis(group: Group): KpiLine[] {
  const t = group.totals;
  const adjusted = group.adjustedNetProfit;
  const net = adjusted ?? t.netProfit;
  return [
    { label: "Income", value: t.income, kind: "money", note: group.currency },
    { label: "Cost", value: t.cost, kind: "money", note: group.currency },
    { label: "Expenses", value: t.expenses, kind: "money", note: group.currency },
    { label: "Salaries", value: t.salaries, kind: "money", note: group.currency },
    { label: "Gross profit", value: t.grossProfit, kind: "money", note: "Income - Cost - Expenses - Salaries" },
    { label: "Gross profit %", value: pct(t.grossProfit, t.income), kind: "percent", note: "Gross profit / income" },
    { label: "Net profit", value: net, kind: "money", note: adjusted === undefined ? "Before OH / OP (restricted access)" : "After Overhead & OP Expense" },
    { label: "Profit margin", value: adjusted === undefined ? t.profitMargin : pct(net, t.income), kind: "percent", note: adjusted === undefined ? "Before OH / OP / income" : "Adjusted net profit / income" },
    { label: "Entries", value: t.entryCount, kind: "integer", note: "Matching entries" },
  ];
}

function title(context: DashboardExportContext) { return context.view === "overview" ? "MIS Overview Report" : "MIS Dashboard"; }
function stamp(date: Date) { return `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 16)} UTC`; }
function statusText(status: string) { return status === "all" ? "All statuses" : status.charAt(0).toUpperCase() + status.slice(1); }
function contextLines(context: DashboardExportContext): Array<[string, string]> {
  return [
    ["Period", context.from && context.to ? `${context.from} to ${context.to}` : "All available periods"],
    ["Status", statusText(context.status)],
    ["Projects", context.projects?.length ? context.projects.join(", ") : "All permitted projects"],
    ["Category", context.category ?? "All reporting categories"],
    ["Service", context.service ?? "All services"],
    ["Generated", stamp(context.generatedAt)],
  ];
}
function money(value: number) {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number.isFinite(value) ? value : 0);
}
function percentText(value: number) { return `${(Number.isFinite(value) ? value : 0).toFixed(1)}%`; }
function cap(value: string) { return value ? value.charAt(0).toUpperCase() + value.slice(1) : value; }

/* ----------------------------------------------------------------- PDF -- */

const NAVY = "#16324f";
const BLUE = "#2f6f9f";
const TINT = "#eef3f8";
const ALT = "#f6f9fc";
const LINE = "#c9d6e3";
const INK = "#17212b";
const MUTED = "#5b6b7a";
const POS = "#1f7a4d";
const NEG = "#b23b3b";

function logoPath(): string | null {
  return [process.env.MIS_LOGO_PATH, join(process.cwd(), "artifacts/cogs-tracker/public/qnc-logo.png"), join(process.cwd(), "../cogs-tracker/public/qnc-logo.png"), join(process.cwd(), "attached_assets/QNC-logo----_1777990467727.png")]
    .filter((value): value is string => Boolean(value)).find((path) => existsSync(path)) ?? null;
}

interface Column { label: string; width: number; align?: "left" | "right" }

export function dashboardPdf(payload: DashboardExportPayload, context: DashboardExportContext): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4", margin: 36, bufferPages: true,
    info: { Title: `QNC ${title(context)}`, Author: "QNC MIS", Subject: title(context), CreationDate: context.generatedAt },
  });
  const fontPath = process.env.MIS_PDF_FONT_PATH ?? "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";
  const boldPath = fontPath.replace(/DejaVuSans\.ttf$/, "DejaVuSans-Bold.ttf");
  const hasFont = existsSync(fontPath);
  const regular = () => { if (hasFont) doc.font(fontPath); else doc.font("Helvetica"); };
  const bold = () => { if (hasFont && existsSync(boldPath)) doc.font(boldPath); else if (hasFont) doc.font(fontPath); else doc.font("Helvetica-Bold"); };
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => { doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject); });

  const left = 36;
  const width = doc.page.width - 72;
  const bottom = () => doc.page.height - 50;
  const logo = logoPath();
  let y = 36;

  const runningHeader = () => {
    regular();
    doc.fillColor(NAVY).fontSize(9).text(`QNC  |  ${title(context)}`, left, 22, { width, lineBreak: false });
    doc.fillColor(MUTED).fontSize(8).text(context.from && context.to ? `${context.from} to ${context.to}` : "All periods", left, 22, { width, align: "right", lineBreak: false });
    doc.strokeColor(LINE).lineWidth(0.5).moveTo(left, 36).lineTo(left + width, 36).stroke();
    y = 46;
  };
  const ensure = (space: number) => { if (y + space > bottom()) { doc.addPage(); runningHeader(); return true; } return false; };

  // Cover header.
  doc.rect(0, 0, doc.page.width, 6).fill(NAVY);
  let titleX = left;
  if (logo) { try { doc.image(logo, left, 24, { fit: [86, 40] }); titleX = left + 100; } catch { titleX = left; } }
  bold(); doc.fillColor(NAVY).fontSize(20).text(title(context), titleX, 26, { width: width - (titleX - left) });
  regular(); doc.fillColor(MUTED).fontSize(9).text(context.view === "overview"
    ? "Dashboard totals with income, cost, expense and salary breakdowns by service. Currencies stay separate."
    : "Financial aggregates remain separate for each currency.", titleX, 52, { width: width - (titleX - left) });
  y = 78;
  const lines = contextLines(context);
  doc.fontSize(8);
  const lineHeights = lines.map(([, value]) => doc.heightOfString(value, { width: width - 100 }));
  const boxHeight = lineHeights.reduce((sum, h) => sum + h + 4, 0) + 14;
  doc.roundedRect(left, y, width, boxHeight, 4).fill(TINT);
  let cy = y + 8;
  lines.forEach(([label, value], index) => {
    bold(); doc.fillColor(NAVY).fontSize(8).text(label.toUpperCase(), left + 10, cy, { width: 80 });
    regular(); doc.fillColor(INK).fontSize(8).text(value, left + 90, cy, { width: width - 100 });
    cy += lineHeights[index] + 4;
  });
  y += boxHeight + 16;

  const sectionTitle = (text: string, sub?: string) => {
    ensure(sub ? 56 : 44);
    bold(); doc.fillColor(NAVY).fontSize(11).text(text, left, y, { width });
    y += 15;
    if (sub) { regular(); doc.fillColor(MUTED).fontSize(7.5).text(sub, left, y, { width }); y += doc.heightOfString(sub, { width }) + 3; }
    y += 2;
  };

  const table = (columns: Column[], rows: string[][], total?: string[], empty = "No rows match these filters.") => {
    const scale = width / columns.reduce((sum, column) => sum + column.width, 0);
    const widths = columns.map((column) => column.width * scale);
    const header = () => {
      doc.rect(left, y, width, 18).fill(BLUE);
      let x = left;
      bold();
      columns.forEach((column, index) => { doc.fillColor("#ffffff").fontSize(7.5).text(column.label, x + 5, y + 5, { width: widths[index] - 10, align: column.align ?? "left", lineBreak: false }); x += widths[index]; });
      y += 18;
    };
    const rowHeight = (cells: string[]) => { doc.fontSize(8); return Math.max(17, ...cells.map((value, index) => doc.heightOfString(value, { width: widths[index] - 10 }) + 8)); };
    const draw = (cells: string[], fill: string | null, strong: boolean) => {
      const h = rowHeight(cells);
      if (ensure(h)) header();
      if (fill) doc.rect(left, y, width, h).fill(fill);
      let x = left;
      if (strong) bold(); else regular();
      cells.forEach((value, index) => {
        const negative = (columns[index].align === "right") && /^-\d/.test(value);
        doc.fillColor(negative ? NEG : INK).fontSize(8).text(value, x + 5, y + 4.5, { width: widths[index] - 10, align: columns[index].align ?? "left" });
        x += widths[index];
      });
      doc.strokeColor(LINE).lineWidth(0.4).moveTo(left, y + h).lineTo(left + width, y + h).stroke();
      y += h;
    };
    ensure(40);
    header();
    if (!rows.length) { draw([empty, ...columns.slice(1).map(() => "")], null, false); }
    rows.forEach((cells, index) => draw(cells, index % 2 === 1 ? ALT : null, false));
    if (total) draw(total, TINT, true);
    y += 12;
  };

  const kpiGrid = (group: Group) => {
    const kpis = dashboardKpis(group).filter((kpi) => kpi.label !== "Entries");
    const cols = 3; const gap = 8; const cardW = (width - gap * (cols - 1)) / cols; const cardH = 46;
    const rowsNeeded = Math.ceil(kpis.length / cols);
    ensure(rowsNeeded * (cardH + gap));
    kpis.forEach((kpi, index) => {
      const x = left + (index % cols) * (cardW + gap);
      const top = y + Math.floor(index / cols) * (cardH + gap);
      doc.roundedRect(x, top, cardW, cardH, 4).fill(TINT);
      doc.rect(x, top, 3, cardH).fill(kpi.label.startsWith("Net") || kpi.label.startsWith("Gross") ? POS : BLUE);
      bold(); doc.fillColor(MUTED).fontSize(7).text(kpi.label.toUpperCase(), x + 10, top + 6, { width: cardW - 16, lineBreak: false });
      const value = kpi.kind === "money" ? `${money(kpi.value)} ${group.currency}` : kpi.kind === "percent" ? percentText(kpi.value) : kpi.value.toLocaleString("en-US");
      doc.fillColor(kpi.value < 0 ? NEG : INK).fontSize(12).text(value, x + 10, top + 17, { width: cardW - 16, lineBreak: false });
      regular(); doc.fillColor(MUTED).fontSize(6.5).text(kpi.note, x + 10, top + 34, { width: cardW - 16, lineBreak: false });
    });
    y += rowsNeeded * (cardH + gap) + 4;
  };

  if (!payload.currencyGroups.length) {
    sectionTitle("No reporting data matches these filters", "Try another period or add reporting-enabled project categories and services.");
  }
  payload.currencyGroups.forEach((group, groupIndex) => {
    if (groupIndex > 0) { doc.addPage(); runningHeader(); }
    ensure(80);
    doc.rect(left, y, width, 24).fill(NAVY);
    bold(); doc.fillColor("#ffffff").fontSize(12).text(`${group.currency}`, left + 10, y + 6, { width: 120, lineBreak: false });
    regular(); doc.fontSize(7.5).text("Values are not combined across currencies", left, y + 8, { width: width - 10, align: "right", lineBreak: false });
    y += 32;
    kpiGrid(group);
    regular(); doc.fillColor(MUTED).fontSize(7).text("Net profit and profit margin include selected-project Overhead and OP Expense only when access to both sections covers every selected project. Breakdowns show recorded amounts before these charges.", left, y, { width });
    y += 22;

    const charges = summarizeCharges(payload, group.currency);
    if (charges.length) {
      sectionTitle(`Overall Overhead & OP Expense (${group.currency})`, "Percentages from all selected projects are added together and applied to their combined income for the selected dates and statuses. Only authorized charges are shown.");
      charges.forEach((charge) => table(
        [{ label: `${charge.label} service`, width: 5 }, { label: "Percentage", width: 2, align: "right" }, { label: `Amount (${group.currency})`, width: 3, align: "right" }],
        charge.services.map((line) => [line.name, `${line.percentage}%`, money(line.amount)]),
        [`${charge.label} total`, `${charge.percentage}%`, money(charge.total)],
        "No active services.",
      ));
    }

    if (context.view === "overview") {
      sectionTitle(`Service breakdown (${group.currency})`, "Selected-project services grouped by their category financial class. Amounts are recorded values before Overhead and OP Expense.");
      for (const section of SERVICE_SECTIONS) {
        const rows = (group.byService ?? []).filter((row) => row.financialClass === section.cls);
        const subtotal = rows.reduce((sum, row) => sum + row.totals[section.key], 0);
        ensure(60);
        bold(); doc.fillColor(BLUE).fontSize(9).text(section.title, left, y); y += 13;
        table(
          [{ label: "Service", width: 4 }, { label: "Category", width: 3 }, { label: `Amount (${group.currency})`, width: 2.4, align: "right" }],
          rows.map((row) => [row.serviceName, row.tabName, money(row.totals[section.key])]),
          ["Subtotal", "", money(subtotal)],
          `No ${section.title.split(" ")[0].toLowerCase()} services match these filters.`,
        );
      }
    }

    sectionTitle(`By project (${group.currency})`);
    const projectTotal = group.byProject.reduce((sum, row) => ({ income: sum.income + row.totals.income, net: sum.net + row.totals.netProfit }), { income: 0, net: 0 });
    table(
      [{ label: "Project", width: 4.5 }, { label: "Income", width: 2.2, align: "right" }, { label: "Gross profit", width: 2.2, align: "right" }, { label: "Net profit", width: 2.2, align: "right" }],
      group.byProject.map((row) => [row.projectName, money(row.totals.income), money(row.totals.grossProfit), money(row.totals.netProfit)]),
      group.byProject.length ? ["Total", money(projectTotal.income), money(group.byProject.reduce((sum, row) => sum + row.totals.grossProfit, 0)), money(projectTotal.net)] : undefined,
      "No project totals match these filters.",
    );
    sectionTitle(`By category (${group.currency})`, "Reporting-enabled categories only.");
    table(
      [{ label: "Category", width: 4 }, { label: "Type", width: 1.8 }, { label: "Net profit", width: 2.4, align: "right" }],
      [...group.byTab].sort((a, b) => {
        const order: Record<string, number> = { income: 0, cost: 1, expense: 2, salary: 3 };
        return (order[a.financialClass ?? a.type] ?? 4) - (order[b.financialClass ?? b.type] ?? 4) || a.tabName.localeCompare(b.tabName);
      }).map((row) => [row.tabName, cap(row.type), money(row.totals.netProfit)]),
      undefined, "No reporting category totals match these filters.",
    );
  });


  const range = doc.bufferedPageRange();
  for (let index = 0; index < range.count; index += 1) {
    doc.switchToPage(index);
    doc.page.margins.bottom = 0;
    doc.strokeColor(LINE).lineWidth(0.5).moveTo(left, doc.page.height - 34).lineTo(left + width, doc.page.height - 34).stroke();
    regular();
    doc.fillColor(MUTED).fontSize(7).text(`QNC MIS  |  Confidential management report  |  Generated ${stamp(context.generatedAt)}`, left, doc.page.height - 26, { width, lineBreak: false });
    doc.text(`Page ${index + 1} of ${range.count}`, left, doc.page.height - 26, { width, align: "right", lineBreak: false });
  }
  doc.end();
  return done;
}

/* ---------------------------------------------------------------- XLSX -- */

type Value = string | number | null;
interface XCell { v: Value; s: number }
interface Sheet { name: string; rows: XCell[][]; widths: number[]; freeze: number; merges: string[]; filter?: string }

const S = {
  default: 0, title: 1, subtitle: 2, label: 3, header: 4, text: 5, textAlt: 6, textTotal: 7,
  int: 8, intAlt: 9, intTotal: 10, pct: 11, pctAlt: 12, pctTotal: 13, section: 14, value: 15, note: 16,
} as const;
const BASE_STYLE_COUNT = 17;

function esc(value: unknown) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}
function safe(value: string) { return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value; }
function col(index: number) { let out = ""; let n = index + 1; while (n > 0) { const r = (n - 1) % 26; out = String.fromCharCode(65 + r) + out; n = Math.floor((n - 1) / 26); } return out; }

export function dashboardXlsx(payload: DashboardExportPayload, context: DashboardExportContext): Buffer {
  const currencies = [...new Set([...payload.currencyGroups.map((group) => group.currency), ...payload.recentEntries.map((entry) => entry.currency)])].sort();
  const moneyStyle = (currency: string, variant: 0 | 1 | 2) => BASE_STYLE_COUNT + currencies.indexOf(currency) * 3 + variant;
  const c = (v: Value, s: number = S.default): XCell => ({ v, s });
  const zebra = (index: number, base: number, alt: number) => index % 2 === 1 ? alt : base;
  const head = (sheetTitle: string, columns: number): XCell[][] => [
    [c(`QNC  |  ${title(context)}  |  ${sheetTitle}`, S.title), ...Array.from({ length: columns - 1 }, () => c(null, S.title))],
    [c(`Period ${context.from ?? "all"} to ${context.to ?? "all"}  |  ${statusText(context.status)}  |  Generated ${stamp(context.generatedAt)}`, S.subtitle)],
  ];

  // Summary sheet: context, KPIs, OH/OP and (overview) services per currency.
  const summary: XCell[][] = head("Summary", 5);
  summary.push([]);
  for (const [label, value] of contextLines(context)) summary.push([c(label, S.label), c(value, S.value)]);
  summary.push([]);
  if (!payload.currencyGroups.length) summary.push([c("No reporting data matches these filters.", S.note)]);
  for (const group of payload.currencyGroups) {
    summary.push([c(`${group.currency} - financial summary (not combined across currencies)`, S.section)]);
    summary.push([c("Measure", S.header), c("Value", S.header), c("Currency", S.header), c("Basis", S.header)]);
    dashboardKpis(group).forEach((kpi, index) => {
      const style = kpi.kind === "money" ? moneyStyle(group.currency, index % 2 === 1 ? 1 : 0) : kpi.kind === "percent" ? zebra(index, S.pct, S.pctAlt) : zebra(index, S.int, S.intAlt);
      summary.push([c(kpi.label, zebra(index, S.text, S.textAlt)), c(kpi.kind === "percent" ? round(kpi.value / 100) : kpi.value, style), c(kpi.kind === "money" ? group.currency : "", zebra(index, S.text, S.textAlt)), c(kpi.note, zebra(index, S.text, S.textAlt))]);
    });
    summary.push([]);
    const charges = summarizeCharges(payload, group.currency);
    if (charges.length) {
      summary.push([c(`${group.currency} - Overall Overhead & OP Expense`, S.section)]);
      summary.push([c("Charge", S.header), c("Service", S.header), c("Percentage", S.header), c("Amount", S.header)]);
      for (const charge of charges) {
        charge.services.forEach((line, index) => summary.push([c(charge.label, zebra(index, S.text, S.textAlt)), c(line.name, zebra(index, S.text, S.textAlt)), c(round(line.percentage / 100), zebra(index, S.pct, S.pctAlt)), c(line.amount, moneyStyle(group.currency, index % 2 === 1 ? 1 : 0))]));
        summary.push([c(`${charge.label} total`, S.textTotal), c("", S.textTotal), c(round(charge.percentage / 100), S.pctTotal), c(charge.total, moneyStyle(group.currency, 2))]);
      }
      summary.push([]);
    }
    if (context.view === "overview") {
      summary.push([c(`${group.currency} - Service breakdown (before Overhead & OP Expense)`, S.section)]);
      summary.push([c("Class", S.header), c("Service", S.header), c("Category", S.header), c("Amount", S.header), c("Entries", S.header)]);
      for (const section of SERVICE_SECTIONS) {
        const rows = (group.byService ?? []).filter((row) => row.financialClass === section.cls);
        rows.forEach((row, index) => summary.push([c(section.title, zebra(index, S.text, S.textAlt)), c(row.serviceName, zebra(index, S.text, S.textAlt)), c(row.tabName, zebra(index, S.text, S.textAlt)), c(row.totals[section.key], moneyStyle(group.currency, index % 2 === 1 ? 1 : 0)), c(row.totals.entryCount, zebra(index, S.int, S.intAlt))]));
        summary.push([c(`${section.title} subtotal`, S.textTotal), c(rows.length ? "" : "No matching services", S.textTotal), c("", S.textTotal), c(round(rows.reduce((sum, row) => sum + row.totals[section.key], 0)), moneyStyle(group.currency, 2)), c(rows.reduce((sum, row) => sum + row.totals.entryCount, 0), S.intTotal)]);
      }
      summary.push([]);
    }
  }

  const tableSheet = (name: string, headers: string[], widths: number[], build: (group: Group) => { rows: Array<(variant: 0 | 1) => XCell[]>; total?: XCell[] }): Sheet => {
    const rows = head(name, headers.length);
    rows.push([]);
    rows.push(headers.map((label) => c(label, S.header)));
    const headerRow = rows.length;
    for (const group of payload.currencyGroups) {
      const built = build(group);
      built.rows.forEach((make, index) => rows.push(make((index % 2) as 0 | 1)));
      if (built.total) rows.push(built.total);
    }
    return { name, rows, widths, freeze: headerRow, merges: [`A1:${col(headers.length - 1)}1`], filter: `A${headerRow}:${col(headers.length - 1)}${Math.max(rows.length, headerRow)}` };
  };
  const t = (v: Value, variant: 0 | 1) => c(v, variant ? S.textAlt : S.text);
  const n = (v: number, variant: 0 | 1) => c(v, variant ? S.intAlt : S.int);
  const projects = tableSheet("By project", ["Currency", "Project", "Income", "Cost", "Expenses", "Salaries", "Gross profit", "Net profit", "Entries"], [11, 36, 17, 17, 17, 17, 17, 17, 10], (group) => {
    const sum = (key: keyof DashboardExportTotals) => round(group.byProject.reduce((total, row) => total + row.totals[key], 0));
    const m = (v: number, variant: 0 | 1) => c(v, moneyStyle(group.currency, variant));
    return {
      rows: group.byProject.map((row) => (v) => [t(group.currency, v), t(row.projectName, v), m(row.totals.income, v), m(row.totals.cost, v), m(row.totals.expenses, v), m(row.totals.salaries, v), m(row.totals.grossProfit, v), m(row.totals.netProfit, v), n(row.totals.entryCount, v)]),
      total: group.byProject.length ? [c(group.currency, S.textTotal), c(`${group.currency} total`, S.textTotal), ...(["income", "cost", "expenses", "salaries", "grossProfit", "netProfit"] as const).map((key) => c(sum(key), moneyStyle(group.currency, 2))), c(sum("entryCount"), S.intTotal)] : undefined,
    };
  });
  const categories = tableSheet("By category", ["Currency", "Category", "Type", "Income", "Cost", "Expenses", "Salaries", "Net profit", "Entries"], [11, 30, 12, 17, 17, 17, 17, 17, 10], (group) => {
    const m = (v: number, variant: 0 | 1) => c(v, moneyStyle(group.currency, variant));
    return { rows: group.byTab.map((row) => (v) => [t(group.currency, v), t(row.tabName, v), t(cap(row.type), v), m(row.totals.income, v), m(row.totals.cost, v), m(row.totals.expenses, v), m(row.totals.salaries, v), m(row.totals.netProfit, v), n(row.totals.entryCount, v)]) };
  });
  const periods = tableSheet("By period", ["Currency", "From", "To", "Income", "Cost", "Expenses", "Salaries", "Net profit", "Entries"], [11, 13, 13, 17, 17, 17, 17, 17, 10], (group) => {
    const m = (v: number, variant: 0 | 1) => c(v, moneyStyle(group.currency, variant));
    return { rows: group.byPeriod.map((row) => (v) => [t(group.currency, v), t(row.fromDate, v), t(row.toDate, v), m(row.totals.income, v), m(row.totals.cost, v), m(row.totals.expenses, v), m(row.totals.salaries, v), m(row.totals.netProfit, v), n(row.totals.entryCount, v)]) };
  });
  const recentRows = head("Recent entries", 8);
  recentRows.push([]);
  recentRows.push(["Project", "Category", "Service", "From", "To", "Status", "Amount", "Currency"].map((label) => c(label, S.header)));
  const recentHeader = recentRows.length;
  payload.recentEntries.slice(0, RECENT_LIMIT).forEach((entry, index) => {
    const v = (index % 2) as 0 | 1;
    recentRows.push([t(entry.projectName, v), t(entry.tabName, v), t(entry.serviceName, v), t(entry.fromDate, v), t(entry.toDate, v), t(cap(entry.status), v), c(entry.amount, moneyStyle(entry.currency, v)), t(entry.currency, v)]);
  });

  const sheets: Sheet[] = [
    { name: "Summary", rows: summary, widths: [34, 30, 24, 40, 12], freeze: 2, merges: ["A1:E1"] },
    projects, categories, periods,
    { name: "Recent entries", rows: recentRows, widths: [30, 22, 26, 12, 12, 12, 17, 10], freeze: recentHeader, merges: ["A1:H1"] },
  ];

  const sheetXml = (sheet: Sheet) => {
    const lastCol = col(Math.max(sheet.widths.length, 1) - 1);
    const body = sheet.rows.map((row, r) => `<row r="${r + 1}"${r === 0 ? ' ht="26" customHeight="1"' : ""}>${row.map((cellValue, k) => {
      const ref = `${col(k)}${r + 1}`;
      if (cellValue.v == null || cellValue.v === "") return cellValue.s ? `<c r="${ref}" s="${cellValue.s}"/>` : "";
      if (typeof cellValue.v === "number") return `<c r="${ref}" s="${cellValue.s}"><v>${Number.isFinite(cellValue.v) ? cellValue.v : 0}</v></c>`;
      return `<c r="${ref}" s="${cellValue.s}" t="inlineStr"><is><t xml:space="preserve">${esc(safe(cellValue.v))}</t></is></c>`;
    }).join("")}</row>`).join("");
    const cols = sheet.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("");
    const pane = `<pane ySplit="${sheet.freeze}" topLeftCell="A${sheet.freeze + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${sheet.freeze + 1}" sqref="A${sheet.freeze + 1}"/>`;
    const filter = sheet.filter ? `<autoFilter ref="${sheet.filter}"/>` : "";
    const merges = sheet.merges.length ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map((ref) => `<mergeCell ref="${ref}"/>`).join("")}</mergeCells>` : "";
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><dimension ref="A1:${lastCol}${Math.max(sheet.rows.length, 1)}"/><sheetViews><sheetView workbookViewId="0" showGridLines="0">${pane}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="16"/><cols>${cols}</cols><sheetData>${body}</sheetData>${filter}${merges}<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>`;
  };

  const moneyFormats = currencies.map((currency, index) => {
    const code = currency.replace(/[^A-Za-z]/g, "").slice(0, 6) || "CUR";
    return { id: 170 + index, code: `#,##0.00 "${code}";[Red]-#,##0.00 "${code}";0.00 "${code}"` };
  });
  const border = 'borderId="1"';
  const xf = (numFmt: number, font: number, fill: number, extra = "", align = "") => `<xf numFmtId="${numFmt}" fontId="${font}" fillId="${fill}" ${extra} applyNumberFormat="1" applyFont="1" applyFill="1"${align ? ` applyAlignment="1">${align}</xf>` : "/>"}`;
  const baseXfs = [
    xf(0, 0, 0, 'borderId="0"'),
    xf(0, 1, 2, 'borderId="0"', '<alignment vertical="center"/>'),
    xf(0, 4, 0, 'borderId="0"'),
    xf(0, 3, 0, 'borderId="0"'),
    xf(0, 5, 5, border, '<alignment vertical="center" wrapText="1"/>'),
    xf(0, 0, 0, border),
    xf(0, 0, 3, border),
    xf(0, 3, 4, border),
    xf(166, 0, 0, border),
    xf(166, 0, 3, border),
    xf(166, 3, 4, border),
    xf(165, 0, 0, border),
    xf(165, 0, 3, border),
    xf(165, 3, 4, border),
    xf(0, 2, 0, 'borderId="0"'),
    xf(0, 0, 0, 'borderId="0"', '<alignment wrapText="1" vertical="top"/>'),
    xf(0, 4, 0, 'borderId="0"'),
  ];
  const moneyXfs = moneyFormats.flatMap((format) => [xf(format.id, 0, 0, border), xf(format.id, 0, 3, border), xf(format.id, 3, 4, border)]);
  const allXfs = [...baseXfs, ...moneyXfs];
  const numFmts = [{ id: 165, code: "0.0%;[Red]-0.0%" }, { id: 166, code: "#,##0;[Red]-#,##0" }, ...moneyFormats];
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="${numFmts.length}">${numFmts.map((format) => `<numFmt numFmtId="${format.id}" formatCode="${esc(format.code)}"/>`).join("")}</numFmts><fonts count="6"><font><sz val="10"/><color rgb="FF17212B"/><name val="Calibri"/></font><font><b/><sz val="15"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="12"/><color rgb="FF16324F"/><name val="Calibri"/></font><font><b/><sz val="10"/><color rgb="FF16324F"/><name val="Calibri"/></font><font><i/><sz val="9"/><color rgb="FF5B6B7A"/><name val="Calibri"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="6"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF16324F"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF4F8FB"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDCE8F2"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF2F6F9F"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFC9D6E3"/></left><right style="thin"><color rgb="FFC9D6E3"/></right><top style="thin"><color rgb="FFC9D6E3"/></top><bottom style="thin"><color rgb="FFC9D6E3"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${allXfs.length}">${allXfs.join("")}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

  const sheetName = (name: string) => esc(name.slice(0, 31));
  const files: [string, string][] = [
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`],
    ["docProps/core.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>QNC ${esc(title(context))}</dc:title><dc:creator>QNC MIS</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${context.generatedAt.toISOString()}</dcterms:created></cp:coreProperties>`],
    ["docProps/app.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>QNC MIS</Application></Properties>`],
    ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${sheets.map((sheet, i) => `<sheet name="${sheetName(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets><definedNames>${sheets.map((sheet, i) => sheet.filter ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${sheetName(sheet.name)}'!$${sheet.filter.replace(/([A-Z]+)(\d+):([A-Z]+)(\d+)/, "$1$$$2:$$$3$$$4")}</definedName>` : "").join("")}</definedNames></workbook>`],
    ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ["xl/styles.xml", styles],
    ...sheets.map((sheet, i): [string, string] => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(sheet)]),
  ];
  return zip(files);
}
