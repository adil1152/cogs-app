/**
 * Focused HTTP analytics acceptance fixture.
 *
 * This intentionally consumes the existing browser-fixture metadata instead of
 * creating a second project fixture.  It starts the production Express app,
 * exercises the real /mis/analytics and export routes, and leaves cleanup to
 * browser-fixture cleanup.  Run with:
 *
 *   pnpm --filter @workspace/api-server exec tsx src/mis-tests/browser-fixture.ts setup
 *   pnpm --filter @workspace/api-server exec tsx src/mis-tests/analytics-multiperiod-integration.ts
 *   pnpm --filter @workspace/api-server exec tsx src/mis-tests/browser-fixture.ts cleanup
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { db, misAuthoritiesTable, misEntriesTable, misProjectTabsTable, misServicesTable, pool } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import app from "../app";
import {
  analyticsPresentation,
  percentageEnabled,
  type AnalyticsExportData,
  type PresentationRow,
} from "../lib/mis/exports/model";

const METADATA_PATH = "/tmp/mis-interactive-ui.json";
type Json = Record<string, any>;
type FixtureMetadata = {
  adminUserId: string;
  editorUserId: string;
  projects: { a: { id: string }; b: { id: string } };
  tabs: Record<string, string>;
  services: { a: Record<string, string>; b: Record<string, string> };
  entries: Record<string, string>;
  sessions: { adminSid: string; editorSid: string };
};

let server: Server | undefined;
let baseUrl = "";
let temporaryAuthorityId: string | undefined;

function object(value: unknown, label: string): Json {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  return value as Json;
}

function array(value: unknown, label: string): Json[] {
  assert.ok(Array.isArray(value), `${label} must be an array`);
  return value as Json[];
}

async function request(path: string, sid: string): Promise<Response> {
  const endpoint = path.startsWith("?") ? `/mis/analytics${path}` : path;
  return fetch(`${baseUrl}/api${endpoint}`, { headers: { authorization: `Bearer ${sid}` } });
}

async function responseJson(response: Response, label: string): Promise<Json> {
  const body = await response.json();
  return object(body, label);
}

function query(params: Record<string, string | undefined>): string {
  const output = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value != null) output.set(key, value);
  return `?${output.toString()}`;
}

function periodJson(count: number): string {
  const periods = [
    { id: "aug", label: "August", from: "2026-08-01", to: "2026-08-31" },
    { id: "sep", label: "September", from: "2026-09-01", to: "2026-09-30" },
    { id: "oct", label: "October", from: "2026-10-01", to: "2026-10-31" },
    { id: "nov", label: "November", from: "2026-11-01", to: "2026-11-30" },
  ];
  return JSON.stringify(periods.slice(0, count));
}

async function start(): Promise<void> {
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${(address as AddressInfo).port}`;
}

async function stop(): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve, reject) => server!.close((error) => (error ? reject(error) : resolve())));
}

function rowsFor(data: Json, label: string): Json[] {
  return array(data.rows, `${label}.rows`);
}

function rowProjectIds(rows: Json[]): string[] {
  return rows.flatMap((row) => typeof row.projectId === "string" ? [row.projectId] : []);
}

function deepEqualStatuses(value: unknown, expected: string[]): boolean {
  return Array.isArray(value) && value.length === expected.length && value.every((item, index) => item === expected[index]);
}

function periodRows(data: Json, label: string): Json[] {
  return array(data.periods, `${label}.periods`);
}

function periodRowsFor(data: Json, id: string): Json[] {
  const period = periodRows(data, "analytics").find((item) => object(item.period, "period descriptor").id === id);
  assert.ok(period, `period ${id} must be present`);
  return rowsFor(period, `period ${id}`);
}

async function main(): Promise<void> {
  const metadata = JSON.parse(await readFile(METADATA_PATH, "utf8")) as FixtureMetadata;
  const projectA = metadata.projects.a.id;
  const projectB = metadata.projects.b.id;
  const costTab = metadata.tabs.cost;
  const costServiceA = metadata.services.a.cost;
  const costServiceB = metadata.services.b.cost;
  const incomeServiceA = metadata.services.a.income;
  const adminSid = metadata.sessions.adminSid;
  const editorSid = metadata.sessions.editorSid;
  assert.ok(adminSid && editorSid, "existing browser fixture must contain HTTP sessions");

  try {
    await start();

    // Grant the existing fixture administrator a temporary global MIS scope;
    // this authority is removed before this process exits.
    const existingGlobal = await db
      .select({ id: misAuthoritiesTable.id })
      .from(misAuthoritiesTable)
      .where(and(eq(misAuthoritiesTable.userId, metadata.adminUserId), sql`${misAuthoritiesTable.projectId} IS NULL`));
    if (!existingGlobal[0]) {
      const [authority] = await db.insert(misAuthoritiesTable).values({
        userId: metadata.adminUserId,
        projectId: null,
        role: "mis_admin",
        extraPermissions: [],
        createdById: metadata.adminUserId,
      }).returning({ id: misAuthoritiesTable.id });
      assert.ok(authority, "temporary global analytics authority must be created");
      temporaryAuthorityId = authority.id;
    }

    // The fixture's cost tab has a false type default.  Override it only for
    // project A; project B remains explicitly disabled.  New HTTP-created
    // entries snapshot these effective project-tab flags.
    await db.update(misProjectTabsTable)
      .set({ calculatePercentAgainstIncome: true })
      .where(and(eq(misProjectTabsTable.projectId, projectA), eq(misProjectTabsTable.tabId, costTab)));
    await db.update(misProjectTabsTable)
      .set({ calculatePercentAgainstIncome: false })
      .where(and(eq(misProjectTabsTable.projectId, projectB), eq(misProjectTabsTable.tabId, costTab)));

    const createCostEntry = async (projectId: string, serviceId: string, date: string): Promise<Json> => {
      const response = await fetch(`${baseUrl}/api/mis/entries`, {
        method: "POST",
        headers: { authorization: `Bearer ${adminSid}`, "content-type": "application/json" },
        body: JSON.stringify({
          projectId,
          tabId: costTab,
          serviceId,
          fromDate: date,
          toDate: date,
          quantity: 1,
          rate: 10,
          rateReason: "analytics focused fixture override",
          remarks: "analytics focused fixture",
        }),
      });
      if (response.status !== 201) {
        assert.fail(`cost entry for ${projectId} must be created (${await response.text()})`);
      }
      return responseJson(response, "created cost entry");
    };
    const costA = await createCostEntry(projectA, costServiceA, "2026-08-20");
    const costB = await createCostEntry(projectB, costServiceB, "2026-08-20");
    assert.equal(costA.calculatePercentAgainstIncome, true, "project-tab override must snapshot true on project A entry");
    assert.equal(costB.calculatePercentAgainstIncome, false, "project-tab override must snapshot false on project B entry");
    // Existing fixture history predates the override.  Make that historical
    // category consistently configured for this aggregate assertion; the
    // application-created rows above still prove the effective snapshot path.
    await db.update(misEntriesTable)
      .set({ calculatePercentAgainstIncome: true })
      .where(and(eq(misEntriesTable.projectId, projectA), eq(misEntriesTable.serviceId, costServiceA)));
    // Keep one historical row in the valid returned state so `all` can be
    // checked as the exact six-status set rather than merely "more than
    // approved". This also exercises the Entries drilldown status contract.
    await db.update(misEntriesTable)
      .set({ status: "returned" })
      .where(eq(misEntriesTable.id, metadata.entries.projectAJuneIncome));

    // Deliberately reverse the service sequences so the response can only pass
    // if persisted sequence, rather than service code/name, controls ordering.
    await db.update(misServicesTable).set({ sequence: 1 }).where(eq(misServicesTable.id, costServiceA));
    await db.update(misServicesTable).set({ sequence: 2 }).where(eq(misServicesTable.id, incomeServiceA));

    const baseParams = {
      projectIds: `${projectA},${projectB}`,
      from: "2026-01-01",
      to: "2026-12-31",
      groupBy: "project,type,service",
      mode: "dynamic",
      view: "custom",
      page: "1",
      pageSize: "100",
    };

    // One and two selected periods are contract errors.
    for (const count of [1, 2]) {
      const response = await request(query({ ...baseParams, periodComparison: "true", periods: periodJson(count) }), adminSid);
      assert.equal(response.status, 400, `${count}-period comparison must be rejected`);
    }

    // Four periods are accepted, retain descriptors, and preserve an empty
    // selected period rather than dropping it from the additive response.
    const fourPeriodResponse = await request(query({
      ...baseParams,
      status: "all",
      periodComparison: "true",
      periods: periodJson(4),
    }), adminSid);
    assert.equal(fourPeriodResponse.status, 200, "four-period comparison must be accepted");
    const fourPeriodData = await responseJson(fourPeriodResponse, "four-period analytics");
    assert.equal(periodRows(fourPeriodData, "four-period analytics").length, 4);
    assert.deepEqual(periodRows(fourPeriodData, "four-period analytics").map((item) => object(item.period, "period").id), ["aug", "sep", "oct", "nov"]);
    assert.deepEqual(fourPeriodData.rows, [], "multi-period legacy rows remain empty to avoid ambiguous cross-period totals");
    assert.deepEqual(periodRowsFor(fourPeriodData, "nov"), [], "an explicitly selected empty period remains represented");

    // Absent status remains the compatibility-approved filter. Explicit all
    // includes the fixture's submitted October parent child.
    const noStatusResponse = await request(query(baseParams), adminSid);
    const noStatus = await responseJson(noStatusResponse, "default approved analytics");
    const allStatusResponse = await request(query({ ...baseParams, status: "all" }), adminSid);
    const allStatus = await responseJson(allStatusResponse, "all-status analytics");
    const approvedCount = object(array(noStatus.totalsByCurrency, "approved totals")[0], "approved total").current.entryCount;
    const allCount = object(array(allStatus.totalsByCurrency, "all totals")[0], "all total").current.entryCount;
    assert.ok(Number(allCount) > Number(approvedCount), "status=all must include non-approved entries while absent status remains approved");
    const allStatuses = ["draft", "submitted", "approved", "rejected", "returned", "cancelled"];
    assert.deepEqual(allStatus.filters.statuses, allStatuses, "status=all must normalize to the complete valid status set");
    assert.ok(rowsFor(allStatus, "all-status analytics").every((row) =>
      deepEqualStatuses(object(row.drilldownFilters, "all-status drilldown").statuses, allStatuses),
    ), "all-status drilldowns must preserve the authoritative status set");

    const returnedResponse = await request(query({
      projectIds: projectA,
      status: "approved,returned",
      from: "2026-06-01",
      to: "2026-06-30",
      groupBy: "type",
      mode: "dynamic",
      view: "custom",
    }), adminSid);
    assert.equal(returnedResponse.status, 200, "approved,returned status selection must be accepted");
    const returnedData = await responseJson(returnedResponse, "returned-status analytics");
    assert.deepEqual(returnedData.filters.statuses, ["approved", "returned"]);
    assert.ok(rowsFor(returnedData, "returned-status analytics").some((row) => row.type === "income"), "returned entries must be included by explicit status subset");
    assert.ok(rowsFor(returnedData, "returned-status analytics").every((row) =>
      deepEqualStatuses(object(row.drilldownFilters, "returned drilldown").statuses, ["approved", "returned"]),
    ), "explicit multi-status drilldowns must preserve the exact subset");

    const strictCurrencyResponse = await request(query({ ...baseParams, currency: "SARX" }), adminSid);
    assert.equal(strictCurrencyResponse.status, 400, "currency must use a strict three-letter schema");
    const strictSearchResponse = await request(query({ ...baseParams, search: "x".repeat(201) }), adminSid);
    assert.equal(strictSearchResponse.status, 400, "search must enforce its bounded request schema");

    const reportPeriodResponse = await request(query({
      ...baseParams,
      reportType: "Income",
      search: "Income",
      currency: "sar",
      status: "all",
      periodComparison: "true",
      periods: periodJson(3),
    }), adminSid);
    assert.equal(reportPeriodResponse.status, 200, "period mode must honor reportType, search, and currency");
    const reportPeriod = await responseJson(reportPeriodResponse, "income report period analytics");
    assert.equal(reportPeriod.filters.reportType, "income");
    assert.equal(reportPeriod.filters.search, "Income");
    assert.equal(reportPeriod.filters.currency, "SAR");
    assert.ok(periodRows(reportPeriod, "income report period analytics").every((item) =>
      array(item.totalsByCurrency, "income report currency totals").every((total) => total.currency === "SAR")
      && rowsFor(item, "income report period").every((row) =>
        row.type === "income"
        && object(row.drilldownFilters, "income report drilldown").search === "Income"
      ),
    ), "category report periods must not return all financial classes");

    // Explicit multi-status must behave as an IN list, and all-status must be
    // retained inside each independently scoped period.
    const multiStatusResponse = await request(query({
      ...baseParams,
      projectIds: projectA,
      status: "approved,submitted",
      periodComparison: "true",
      periods: periodJson(3),
    }), adminSid);
    assert.equal(multiStatusResponse.status, 200, "explicit approved,submitted period comparison must succeed");
    const multiStatus = await responseJson(multiStatusResponse, "multi-status analytics");
    assert.ok(periodRowsFor(multiStatus, "oct").some((row) => row.type === "income"), "submitted October row must be included by explicit multi-status");

    // Effective percentage flags are per persisted row, not a global
    // incomePercentage.enabled value.  Project A's cost row is enabled while
    // project B's otherwise equivalent cost row is disabled.
    const groupedRows = rowsFor(allStatus, "all-status analytics");
    const projectACost = groupedRows.find((row) => row.projectId === projectA && row.type === "cost");
    const projectBCost = groupedRows.find((row) => row.projectId === projectB && row.type === "cost");
    assert.ok(projectACost && projectBCost, "joint project/type/service grouping must include both cost rows");
    assert.equal(projectACost.calculatePercentAgainstIncome, true, JSON.stringify(projectACost));
    assert.equal(projectBCost.calculatePercentAgainstIncome, false, JSON.stringify(projectBCost));
    const allTotal = object(array(allStatus.totalsByCurrency, "all totals")[0], "all total");
    const projectACostMetric = object(projectACost.current, "project A cost metric");
    assert.equal(
      projectACostMetric.percentageAgainstIncome,
      Number(projectACostMetric.totalAmount) / Number(allTotal.current.totalIncome) * 100,
      "enabled percentage uses the isolated currency income denominator",
    );
    assert.equal(object(projectBCost.current, "project B cost metric").percentageAgainstIncome, null, "disabled percentage remains null, not zero");

    const zeroIncomeResponse = await request(query({
      projectIds: projectA,
      tabIds: costTab,
      serviceIds: costServiceA,
      types: "cost",
      status: "all",
      from: "2026-08-20",
      to: "2026-08-20",
      groupBy: "type",
      mode: "dynamic",
      view: "custom",
    }), adminSid);
    const zeroIncomeRows = rowsFor(await responseJson(zeroIncomeResponse, "zero-income analytics"), "zero-income analytics");
    assert.equal(object(zeroIncomeRows[0]?.current, "zero-income metric").totalIncome, 0);
    assert.equal(object(zeroIncomeRows[0]?.current, "zero-income metric").percentageAgainstIncome, 0, "enabled zero-income percentage is safe and finite");

    // The export presentation must consume the row flag.  In particular,
    // explicit false must not fall through to the legacy/configuration default.
    const exportModel = analyticsPresentation(allStatus as unknown as AnalyticsExportData);
    const exportRows = exportModel.currencies.flatMap((currency) => currency.rows);
    const exportedA = exportRows.find((row) => row.projectId === projectA && row.type === "cost") as PresentationRow | undefined;
    const exportedB = exportRows.find((row) => row.projectId === projectB && row.type === "cost") as PresentationRow | undefined;
    assert.ok(exportedA && exportedB, "analytics export model must retain both configured rows");
    assert.equal(exportedA.calculatePercentAgainstIncome, true);
    assert.equal(exportedB.calculatePercentAgainstIncome, false);
    assert.equal(percentageEnabled(exportedA), true);
    assert.equal(percentageEnabled(exportedB), false);
    assert.equal(percentageEnabled(exportedB, { default: true }), false, "an explicit row false must win over optional export configuration");
    const configurationOnlyRow = { ...exportedB, calculatePercentAgainstIncome: null };
    assert.equal(percentageEnabled(configurationOnlyRow, { default: true }), true, "optional export default applies only when no row flag exists");
    assert.equal(percentageEnabled(configurationOnlyRow, { default: false, byType: { cost: true } }), true, "optional export type configuration applies when present");

    // Service response order follows the persisted sequence after grouping,
    // including the service filter and category/type filter surfaces.
    const serviceResponse = await request(query({
      projectIds: projectA,
      serviceIds: `${incomeServiceA},${costServiceA}`,
      types: "income,cost",
      status: "approved",
      from: "2026-01-01",
      to: "2026-12-31",
      groupBy: "service",
      mode: "dynamic",
      view: "custom",
    }), adminSid);
    const serviceRows = rowsFor(await responseJson(serviceResponse, "service ordering analytics"), "service ordering analytics");
    assert.deepEqual(serviceRows.map((row) => row.serviceName), ["Cost", "Income"], "service groups must follow service.sequence");

    // A project-scoped editor may query a joint project/tab/service/category
    // filter inside its scope, but cannot learn another project's period rows.
    await db.update(misAuthoritiesTable)
      .set({ extraPermissions: ["view_project", "view_entries", "reports", "financial"] })
      .where(eq(misAuthoritiesTable.userId, metadata.editorUserId));
    const scopedResponse = await request(query({
      projectIds: projectA,
      tabIds: costTab,
      serviceIds: costServiceA,
      types: "cost",
      status: "all",
      periodComparison: "true",
      periods: periodJson(3),
      groupBy: "project,type,service",
      mode: "dynamic",
      view: "custom",
    }), editorSid);
    assert.equal(scopedResponse.status, 200, "project-scoped joint filter must be allowed");
    const scopedData = await responseJson(scopedResponse, "scoped period analytics");
    assert.deepEqual(periodRows(scopedData, "scoped period analytics").map((item) => object(item.period, "scoped period").id), ["aug", "sep", "oct"]);
    assert.ok(periodRows(scopedData, "scoped period analytics").every((item) => rowProjectIds(rowsFor(item, "scoped period")).every((id) => id === projectA)), "period rows must stay inside editor project scope");
    const leakedResponse = await request(query({
      ...baseParams,
      projectIds: `${projectA},${projectB}`,
      periodComparison: "true",
      periods: periodJson(3),
    }), editorSid);
    assert.equal(leakedResponse.status, 403, "multi-period scope must reject an unauthorized project before any period aggregate runs");

    const exportResponse = await request(`/mis/analytics/export${query({
      ...baseParams,
      projectIds: projectA,
      status: "all",
      periodComparison: "true",
      periods: periodJson(3),
      format: "csv",
    })}`, adminSid);
    assert.equal(exportResponse.status, 200, "multi-period CSV export must use the same scoped analytics model");
    const csv = await exportResponse.text();
    assert.match(csv, /period_id/);
    assert.match(csv, /aug/);
    assert.match(csv, /sep/);
    assert.match(csv, /oct/);
  } finally {
    if (temporaryAuthorityId) {
      await db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL mis.maintenance = 'on'`);
        await tx.delete(misAuthoritiesTable).where(eq(misAuthoritiesTable.id, temporaryAuthorityId!));
      });
    }
    await stop();
    await pool.end();
  }
}

main()
  .then(() => process.stdout.write("MIS focused analytics integration passed\n"))
  .catch((error: unknown) => {
    process.stderr.write(`MIS focused analytics integration failed: ${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });