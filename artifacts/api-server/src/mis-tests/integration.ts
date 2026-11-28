/**
 * MIS integration verification.
 *
 * This is deliberately a standalone executable rather than a production test
 * route. It uses normal session authentication against an in-process instance
 * of the production app, creates only rows in `mis_*` tables, and records
 * every fixture ID for targeted cleanup. It never updates users, sessions
 * belonging to other callers, COGS tables, or existing MIS grants.
 *
 * Run after the MIS migration and router have been applied:
 *   pnpm --filter @workspace/api-server exec tsx src/mis-tests/integration.ts
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import {
  db,
  misAuditLogTable,
  misAuthoritiesTable,
  misEntriesTable,
  misEntryParentsTable,
  misProjectsTable,
  misProjectTabsTable,
  misServicesTable,
  misTabsTable,
  usersTable,
} from "@workspace/db";
import type { AuthUser } from "@workspace/api-zod";
import app from "../app";
import { createSession, deleteSession } from "../lib/auth";

type JsonObject = Record<string, unknown>;
type FixtureIds = {
  authorities: string[];
  projects: string[];
  tabs: string[];
  services: string[];
  entries: string[];
  parents: string[];
  sessions: string[];
};

const fixtureIds: FixtureIds = {
  authorities: [],
  projects: [],
  tabs: [],
  services: [],
  entries: [],
  parents: [],
  sessions: [],
};

let baseUrl = "";
let server: Server | undefined;

function testPrefix(): string {
  return `MIT${Date.now().toString(36)}`;
}

function errorMessage(value: unknown): string {
  if (value && typeof value === "object" && "error" in value) {
    return String((value as JsonObject).error);
  }
  return JSON.stringify(value);
}

function asObject(value: unknown, label: string): JsonObject {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  return value as JsonObject;
}

function asArray(value: unknown, label: string): unknown[] {
  assert.ok(Array.isArray(value), `${label} must be an array`);
  return value;
}

function idOf(value: unknown, label: string): string {
  const id = asObject(value, label).id;
  assert.equal(typeof id, "string", `${label}.id must be a string`);
  return id as string;
}

function expectStatus(response: Response, expected: number | number[], label: string): void {
  const allowed = Array.isArray(expected) ? expected : [expected];
  assert.ok(
    allowed.includes(response.status),
    `${label}: expected ${allowed.join(" or ")}, received ${response.status}`,
  );
}

async function json(response: Response, label: string): Promise<JsonObject> {
  const value: unknown = await response.json();
  return asObject(value, label);
}

async function request(
  method: string,
  path: string,
  session?: string,
  body?: unknown,
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (session) headers.authorization = `Bearer ${session}`;
  if (body !== undefined) headers["content-type"] = "application/json";

  // Session values are intentionally never logged, interpolated into errors,
  // or returned from this helper.
  return fetch(`${baseUrl}/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function authUser(
  row: typeof usersTable.$inferSelect,
  role: "admin" | "user" = row.role === "admin" ? "admin" : "user",
): AuthUser {
  return {
    id: row.id,
    email: row.email,
    firstName: row.firstName,
    lastName: row.lastName,
    mobile: row.mobile,
    profileImageUrl: row.profileImageUrl,
    role,
  };
}

async function sessionFor(user: typeof usersTable.$inferSelect, role?: "admin" | "user"): Promise<string> {
  const sid = await createSession({ user: authUser(user, role) });
  fixtureIds.sessions.push(sid);
  return sid;
}

async function addFixtureAuthority(
  userId: string,
  role: "mis_admin" | "mis_manager" | "project_manager" | "finance" | "data_entry" | "viewer" | "custom",
  projectId: string | null,
  createdById: string,
  extraPermissions: string[] = [],
): Promise<string> {
  const [row] = await db
    .insert(misAuthoritiesTable)
    .values({ userId, role, projectId, createdById, extraPermissions })
    .returning({ id: misAuthoritiesTable.id });
  assert.ok(row, "fixture authority insert must return an ID");
  fixtureIds.authorities.push(row.id);
  return row.id;
}

async function removeFixtureAuthority(id: string): Promise<void> {
  await db.delete(misAuthoritiesTable).where(eq(misAuthoritiesTable.id, id));
}

function projectInput(prefix: string, suffix: string, currency: string): JsonObject {
  return {
    name: `${prefix} Project ${suffix}`,
    code: `${prefix}${suffix}`.slice(0, 32),
    managerId: null,
    status: "active",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    currency,
    reportingSettings: {
      defaultEntryStatus: "approved",
      preventDuplicatePeriods: true,
    },
  };
}

function tabInput(prefix: string, suffix: string, type: string, financialClass: string): JsonObject {
  return {
    name: `${prefix} ${suffix}`,
    code: `${prefix}${suffix}`.slice(0, 32),
    description: `${suffix} integration fixture`,
    type,
    financialClass,
    rateEnabled: type !== "expense" && type !== "salary",
    calculatePercentAgainstIncome: type === "income" || type === "other",
    sequence: suffix === "Income" ? 10 : 20,
    active: true,
    allowEntry: true,
    allowReporting: true,
  };
}

function serviceInput(tabId: string, name: string, defaultRate: number): JsonObject {
  return {
    tabId,
    name,
    description: "Integration-only service",
    unit: "unit",
    defaultRate,
    active: true,
    sequence: 1,
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
  };
}

function entryInput(
  projectId: string,
  tabId: string,
  serviceId: string,
  fromDate: string,
  toDate: string,
  quantity: number,
  rate: number,
  remarks = "integration entry",
): JsonObject {
  return { projectId, tabId, serviceId, fromDate, toDate, quantity, rate, remarks };
}

function amountEntryInput(
  projectId: string,
  tabId: string,
  serviceId: string,
  fromDate: string,
  toDate: string,
  amount: number,
  remarks = "integration amount entry",
): JsonObject {
  return {
    projectId, tabId, serviceId, fromDate, toDate, amount,
    calculationMode: "amount", remarks,
  };
}

async function createProject(session: string, input: JsonObject): Promise<JsonObject> {
  const response = await request("POST", "/mis/projects", session, input);
  expectStatus(response, 201, "create MIS project");
  const value = await json(response, "created project");
  fixtureIds.projects.push(idOf(value, "created project"));
  return value;
}

async function createTab(session: string, input: JsonObject): Promise<JsonObject> {
  const response = await request("POST", "/mis/tabs", session, input);
  expectStatus(response, 201, "create MIS tab");
  const value = await json(response, "created tab");
  fixtureIds.tabs.push(idOf(value, "created tab"));
  return value;
}

async function createService(session: string, projectId: string, input: JsonObject): Promise<JsonObject> {
  const response = await request("POST", `/mis/projects/${projectId}/services`, session, input);
  expectStatus(response, 201, "create MIS service");
  const value = await json(response, "created service");
  fixtureIds.services.push(idOf(value, "created service"));
  return value;
}

async function createEntry(session: string, input: JsonObject): Promise<JsonObject> {
  const response = await request("POST", "/mis/entries", session, input);
  expectStatus(response, 201, "create MIS entry");
  const value = await json(response, "created entry");
  fixtureIds.entries.push(idOf(value, "created entry"));
  return value;
}

async function action(session: string, entryId: string, name: string): Promise<JsonObject> {
  const response = await request("POST", `/mis/entries/${entryId}/action`, session, {
    action: name,
    remarks: `${name} from integration test`,
  });
  expectStatus(response, 200, `entry ${name}`);
  return json(response, `entry ${name}`);
}

async function cleanup(): Promise<void> {
  // The database audit trigger is append-only in normal runtime paths.
  // Fixture cleanup is explicit maintenance, not application behavior.
  await db.execute(sql`SET mis.maintenance = 'on'`);
  try {
  // Audit history deliberately has no entity FK, so remove every audit row
  // tied to a tracked fixture before removing any parent record.
  const ownedEntityIds = [
    ...fixtureIds.authorities,
    ...fixtureIds.projects,
    ...fixtureIds.tabs,
    ...fixtureIds.services,
    ...fixtureIds.entries,
    ...fixtureIds.parents,
  ];
  if (ownedEntityIds.length) {
    await db.delete(misAuditLogTable).where(
      or(
        inArray(misAuditLogTable.entryId, fixtureIds.entries.length ? fixtureIds.entries : [""]),
        inArray(misAuditLogTable.entityId, ownedEntityIds),
        inArray(misAuditLogTable.projectId, fixtureIds.projects.length ? fixtureIds.projects : [""]),
      ),
    );
  }
  if (fixtureIds.entries.length) {
    await db.delete(misEntriesTable).where(inArray(misEntriesTable.id, fixtureIds.entries));
  }
  if (fixtureIds.parents.length) {
    await db.delete(misEntryParentsTable).where(inArray(misEntryParentsTable.id, fixtureIds.parents));
  }
  if (fixtureIds.authorities.length) {
    await db.delete(misAuthoritiesTable).where(inArray(misAuthoritiesTable.id, fixtureIds.authorities));
  }
  if (fixtureIds.services.length) {
    await db.delete(misServicesTable).where(inArray(misServicesTable.id, fixtureIds.services));
  }
  if (fixtureIds.projects.length && fixtureIds.tabs.length) {
    await db.delete(misProjectTabsTable).where(
      and(
        inArray(misProjectTabsTable.projectId, fixtureIds.projects),
        inArray(misProjectTabsTable.tabId, fixtureIds.tabs),
      ),
    );
  }
  if (fixtureIds.projects.length) {
    await db.delete(misProjectsTable).where(inArray(misProjectsTable.id, fixtureIds.projects));
  }
  if (fixtureIds.tabs.length) {
    await db.delete(misTabsTable).where(inArray(misTabsTable.id, fixtureIds.tabs));
  }
    await Promise.allSettled(fixtureIds.sessions.map((sid) => deleteSession(sid)));
  } finally {
    await db.execute(sql`RESET mis.maintenance`);
  }
}

async function startServer(): Promise<void> {
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string", "test server must have a TCP address");
  baseUrl = `http://127.0.0.1:${(address as AddressInfo).port}`;
}

async function stopServer(): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server!.close((error) => (error ? reject(error) : resolve()));
  });
}

async function main(): Promise<void> {
  const existingUsers = await db.select().from(usersTable);
  const grantedUserIds = new Set(
    (await db.select({ userId: misAuthoritiesTable.userId }).from(misAuthoritiesTable))
      .map((row) => row.userId),
  );
  const [actor, limited] = existingUsers.filter((user) => !grantedUserIds.has(user.id));
  assert.ok(
    actor && limited,
    "MIS integration requires two existing users with no pre-existing MIS authority; this script never creates or changes users",
  );

  let actorSession = "";
  let limitedSession = "";
  let cogsAdminWithoutMisSession = "";
  try {
    await startServer();
    actorSession = await sessionFor(actor);
    limitedSession = await sessionFor(limited);
    // This session carries a COGS-admin snapshot for a real, otherwise
    // ungranted user. It exercises that COGS admin is not an MIS bypass.
    cogsAdminWithoutMisSession = await sessionFor(limited, "admin");
    const prefix = testPrefix();

    let response = await request("GET", "/mis/me");
    expectStatus(response, 401, "MIS requires authentication");

    response = await request("GET", "/mis/me", cogsAdminWithoutMisSession);
    expectStatus(response, 200, "COGS admin can resolve MIS membership");
    let membership = await json(response, "COGS-admin MIS membership");
    assert.equal(membership.hasAccess, false, "COGS admin without MIS authority must not gain MIS access");

    const existingGlobalAdmins = (await db.select({ id: misAuthoritiesTable.id }).from(misAuthoritiesTable)
      .where(and(eq(misAuthoritiesTable.role, "mis_admin"), sql`${misAuthoritiesTable.projectId} IS NULL`))).length;
    const bootstrapAdminId = await addFixtureAuthority(actor.id, "mis_admin", null, actor.id);
    response = await request("GET", "/mis/me", actorSession);
    expectStatus(response, 200, "MIS admin membership");
    membership = await json(response, "MIS admin membership");
    assert.equal(membership.hasAccess, true);
    assert.equal(membership.globalAccess, true);
    assert.ok(asArray(membership.permissions, "MIS admin permissions").includes("authorities"));

    response = await request("GET", "/mis/users?search=", actorSession);
    expectStatus(response, 200, "MIS user picker");
    const picker = await json(response, "MIS user picker");
    assert.ok(Array.isArray(picker.items) && typeof picker.total === "number");

    const invalidId = "00000000-0000-4000-8000-000000000001";
    response = await request("POST", "/mis/authorities", actorSession, {
      userId: invalidId,
      projectId: null,
      role: "viewer",
      extraPermissions: [],
    });
    expectStatus(response, [400, 404], "invalid authority user reference");
    assert.equal(typeof (await json(response, "invalid user error")).error, "string");

    response = await request("POST", "/mis/authorities", actorSession, {
      userId: limited.id,
      projectId: invalidId,
      role: "viewer",
      extraPermissions: [],
    });
    expectStatus(response, [400, 404], "invalid authority project reference");

    if (existingGlobalAdmins === 0) {
      response = await request("DELETE", `/mis/authorities/${bootstrapAdminId}`, actorSession);
      expectStatus(response, 409, "last MIS admin preservation");
    }

    response = await request("POST", "/mis/authorities", actorSession, {
      userId: limited.id,
      projectId: null,
      role: "mis_admin",
      extraPermissions: [],
    });
    expectStatus(response, 201, "create second MIS admin");
    const secondAdmin = await json(response, "second MIS admin");
    const secondAdminId = idOf(secondAdmin, "second MIS admin");
    fixtureIds.authorities.push(secondAdminId);
    response = await request("DELETE", `/mis/authorities/${secondAdminId}`, actorSession);
    expectStatus(response, 200, "revoke non-last MIS admin");

    const incomeTab = await createTab(actorSession, tabInput(prefix, "Income", "income", "income"));
    const costTab = await createTab(actorSession, tabInput(prefix, "Cost", "cost", "cost"));
    const expenseTab = await createTab(actorSession, tabInput(prefix, "Expense", "expense", "expense"));
    const salaryTab = await createTab(actorSession, tabInput(prefix, "Salary", "salary", "salary"));
    const otherTab = await createTab(actorSession, tabInput(prefix, "Other", "other", "expense"));
    const incomeTabId = idOf(incomeTab, "income tab");
    const costTabId = idOf(costTab, "cost tab");
    const expenseTabId = idOf(expenseTab, "expense tab");
    const salaryTabId = idOf(salaryTab, "salary tab");
    const otherTabId = idOf(otherTab, "other tab");
    assert.equal(incomeTab.calculatePercentAgainstIncome, true, "income type default percentage flag");
    assert.equal(expenseTab.rateEnabled, false, "expense type must default to amount mode");
    assert.equal(salaryTab.rateEnabled, false, "salary type must default to amount mode");
    const usdProject = await createProject(actorSession, projectInput(prefix, "USD", "USD"));
    const eurProject = await createProject(actorSession, projectInput(prefix, "EUR", "EUR"));
    const usdProjectId = idOf(usdProject, "USD project");
    const eurProjectId = idOf(eurProject, "EUR project");

    response = await request("PUT", `/mis/projects/${usdProjectId}/tabs`, actorSession, {
      assignments: [
        { tabId: incomeTabId, enabled: true, sequence: 10, calculatePercentAgainstIncome: false },
        { tabId: costTabId, enabled: false, sequence: 20 },
        { tabId: expenseTabId, enabled: true, sequence: 30 },
        { tabId: salaryTabId, enabled: true, sequence: 40 },
        { tabId: otherTabId, enabled: true, sequence: 50 },
      ],
    });
    expectStatus(response, 200, "assign USD project tabs");
    response = await request("PUT", `/mis/projects/${eurProjectId}/tabs`, actorSession, {
      assignments: [
        { tabId: incomeTabId, enabled: false, sequence: 10 },
        { tabId: costTabId, enabled: true, sequence: 20 },
        { tabId: expenseTabId, enabled: false, sequence: 30 },
        { tabId: salaryTabId, enabled: false, sequence: 40 },
        { tabId: otherTabId, enabled: false, sequence: 50 },
      ],
    });
    expectStatus(response, 200, "assign EUR project tabs");
    response = await request("GET", `/mis/projects/${usdProjectId}/tabs`, actorSession);
    expectStatus(response, 200, "read USD project tabs");
    const usdTabs = asArray(await response.json(), "USD project tabs").map((item) => asObject(item, "USD project tab"));
    assert.equal(usdTabs.find((item) => item.tabId === incomeTabId)?.enabled, true);
    assert.equal(usdTabs.find((item) => item.tabId === costTabId)?.enabled, false);
    assert.equal(usdTabs.find((item) => item.tabId === incomeTabId)?.calculatePercentAgainstIncome, false);
    response = await request("GET", `/mis/projects/${eurProjectId}/tabs`, actorSession);
    expectStatus(response, 200, "read EUR project tabs");
    const eurTabs = asArray(await response.json(), "EUR project tabs").map((item) => asObject(item, "EUR project tab"));
    assert.equal(eurTabs.find((item) => item.tabId === incomeTabId)?.enabled, false);
    assert.equal(eurTabs.find((item) => item.tabId === costTabId)?.enabled, true);

    const usdService = await createService(actorSession, usdProjectId, serviceInput(incomeTabId, `${prefix} Revenue`, 12.34));
    const strictOutsideService = await createService(actorSession, usdProjectId, serviceInput(incomeTabId, `${prefix} Outside`, 1));
    const strictInsideService = await createService(actorSession, usdProjectId, serviceInput(incomeTabId, `${prefix} Inside`, 1));
    const eurService = await createService(actorSession, eurProjectId, serviceInput(costTabId, `${prefix} Expense`, 10));
    const usdExpenseService = await createService(actorSession, usdProjectId, serviceInput(expenseTabId, `${prefix} Operating Expense`, 1));
    const usdSalaryService = await createService(actorSession, usdProjectId, serviceInput(salaryTabId, `${prefix} Salary`, 1));
    const usdOtherService = await createService(actorSession, usdProjectId, serviceInput(otherTabId, `${prefix} Other`, 5));
    const usdServiceId = idOf(usdService, "USD service");
    const strictOutsideServiceId = idOf(strictOutsideService, "outside service");
    const strictInsideServiceId = idOf(strictInsideService, "inside service");
    const eurServiceId = idOf(eurService, "EUR service");
    const usdExpenseServiceId = idOf(usdExpenseService, "USD expense service");
    const usdSalaryServiceId = idOf(usdSalaryService, "USD salary service");
    const usdOtherServiceId = idOf(usdOtherService, "USD other service");

    response = await request("PATCH", `/mis/services/${usdServiceId}`, actorSession, {
      ...serviceInput(incomeTabId, `${prefix} Revenue Updated`, 12.34),
      sequence: 9,
    });
    expectStatus(response, 200, "update USD service");
    response = await request("GET", `/mis/projects/${eurProjectId}/services`, actorSession);
    expectStatus(response, 200, "read EUR services after USD update");
    const eurServices = asArray(await response.json(), "EUR services").map((item) => asObject(item, "EUR service"));
    assert.equal(eurServices.length, 1, "project-local service changes must not affect another project");
    assert.equal(eurServices[0]?.id, eurServiceId);
    assert.equal(eurServices[0]?.name, `${prefix} Expense`);
    response = await request("GET", `/mis/projects/${usdProjectId}/services`, actorSession);
    expectStatus(response, 200, "read USD service calculation flags");
    const usdServices = asArray(await response.json(), "USD services").map((item) => asObject(item, "USD service"));
    assert.equal(usdServices.find((item) => item.id === usdServiceId)?.calculatePercentAgainstIncome, false);
    assert.equal(usdServices.find((item) => item.id === usdExpenseServiceId)?.calculationMode, "amount");
    assert.equal(usdServices.find((item) => item.id === usdSalaryServiceId)?.calculationMode, "amount");
    assert.equal(usdServices.find((item) => item.id === usdOtherServiceId)?.calculatePercentAgainstIncome, true);

    // Reordering is an atomic complete permutation, not a partial sequence
    // update. The endpoint returns the persisted order used by entry services.
    const originalServiceOrder = usdServices.map((item) => item.id);
    response = await request("POST", `/mis/projects/${usdProjectId}/services/reorder`, actorSession, {
      serviceIds: [...originalServiceOrder].reverse(),
    });
    expectStatus(response, 200, "reorder USD services");
    const reorderedServices = asArray(await response.json(), "reordered USD services").map((item) => asObject(item, "reordered service"));
    assert.deepEqual(reorderedServices.map((item) => item.id), [...originalServiceOrder].reverse());
    response = await request("GET", `/mis/projects/${usdProjectId}/services`, actorSession);
    expectStatus(response, 200, "read reordered USD services");
    assert.deepEqual(
      asArray(await response.json(), "persisted USD services").map((item) => idOf(item, "persisted service")),
      [...originalServiceOrder].reverse(),
    );
    response = await request("POST", `/mis/projects/${usdProjectId}/services/reorder`, limitedSession, {
      serviceIds: originalServiceOrder,
    });
    expectStatus(response, 403, "service reorder permission");
    response = await request("POST", `/mis/projects/${usdProjectId}/services/reorder`, actorSession, {
      serviceIds: originalServiceOrder.slice(0, -1),
    });
    expectStatus(response, 400, "service reorder complete permutation");
    response = await request("POST", `/mis/projects/${usdProjectId}/services/reorder`, actorSession, {
      serviceIds: [...originalServiceOrder.slice(0, -1), originalServiceOrder[0]],
    });
    expectStatus(response, 400, "service reorder duplicate permutation");
    response = await request("POST", `/mis/projects/${usdProjectId}/services/reorder`, actorSession, {
      serviceIds: [...originalServiceOrder.slice(0, -1), randomUUID()],
    });
    expectStatus(response, 400, "service reorder unknown service");

    const projectManagerGrant = await addFixtureAuthority(limited.id, "project_manager", usdProjectId, actor.id);
    response = await request("GET", "/mis/projects?page=1&pageSize=100", limitedSession);
    expectStatus(response, 200, "scoped project manager project list");
    const scopedProjects = await json(response, "scoped projects");
    const scopedIds = asArray(scopedProjects.items, "scoped project items").map((item) => idOf(item, "scoped project"));
    assert.ok(scopedIds.includes(usdProjectId));
    assert.ok(!scopedIds.includes(eurProjectId), "scoped manager must not receive another project");
    response = await request("GET", `/mis/projects/${eurProjectId}`, limitedSession);
    expectStatus(response, [403, 404], "scoped project manager cannot read another project");

    await removeFixtureAuthority(projectManagerGrant);
    const emptyCustomGrant = await addFixtureAuthority(limited.id, "custom", usdProjectId, actor.id);
    response = await request("GET", "/mis/me", limitedSession);
    expectStatus(response, 200, "empty custom grant membership");
    membership = await json(response, "empty custom grant membership");
    assert.equal(membership.hasAccess, false, "custom grant with no effective permissions must not count as MIS access");
    assert.deepEqual(membership.projectIds, [], "empty custom grant must not create project scope");
    response = await request("GET", `/mis/projects/${usdProjectId}`, limitedSession);
    expectStatus(response, 403, "empty custom grant project read denial");
    await removeFixtureAuthority(emptyCustomGrant);

    const viewProjectGrant = await addFixtureAuthority(limited.id, "custom", usdProjectId, actor.id, ["view_project"]);
    response = await request("GET", `/mis/projects/${usdProjectId}`, limitedSession);
    expectStatus(response, 200, "custom view_project grant");
    response = await request("GET", `/mis/projects/${eurProjectId}`, limitedSession);
    expectStatus(response, 403, "custom view_project scope isolation");
    response = await request("GET", "/mis/entries?page=1&pageSize=100", limitedSession);
    expectStatus(response, 403, "custom view_project does not imply view_entries");
    await removeFixtureAuthority(viewProjectGrant);

    const viewEntriesGrant = await addFixtureAuthority(limited.id, "custom", usdProjectId, actor.id, ["view_entries"]);
    response = await request("GET", "/mis/entries?page=1&pageSize=100", limitedSession);
    expectStatus(response, 200, "custom view_entries grant");
    response = await request("GET", `/mis/projects/${usdProjectId}`, limitedSession);
    expectStatus(response, 403, "custom view_entries does not imply view_project");
    await removeFixtureAuthority(viewEntriesGrant);

    const legacyEntriesAliasGrant = await addFixtureAuthority(limited.id, "custom", usdProjectId, actor.id, ["entries"]);
    response = await request("GET", "/mis/entries?page=1&pageSize=100", limitedSession);
    expectStatus(response, 200, "legacy entries extra permission alias");
    const legacyAliasEntry = await createEntry(limitedSession, entryInput(
      usdProjectId, incomeTabId, strictInsideServiceId, "2026-06-09", "2026-06-09", 1, 1,
    ));
    response = await request("GET", `/mis/entries/${idOf(legacyAliasEntry, "legacy alias entry")}`, limitedSession);
    expectStatus(response, 200, "legacy entries alias grants entry read");
    await removeFixtureAuthority(legacyEntriesAliasGrant);

    const createOnlyGrant = await addFixtureAuthority(limited.id, "custom", usdProjectId, actor.id, ["create_entries"]);
    const createOnlyEntry = await createEntry(limitedSession, entryInput(
      usdProjectId, incomeTabId, strictInsideServiceId, "2026-06-10", "2026-06-10", 1, 1,
    ));
    response = await request("GET", `/mis/entries/${idOf(createOnlyEntry, "create-only entry")}`, limitedSession);
    expectStatus(response, 403, "custom create_entries does not imply view_entries");
    await removeFixtureAuthority(createOnlyGrant);

    const editOnlySource = await createEntry(actorSession, entryInput(
      usdProjectId, incomeTabId, strictInsideServiceId, "2026-06-11", "2026-06-11", 1, 1,
    ));
    const editOnlyGrant = await addFixtureAuthority(limited.id, "custom", usdProjectId, actor.id, ["edit_entries"]);
    response = await request("PATCH", `/mis/entries/${idOf(editOnlySource, "edit-only source")}`, limitedSession, entryInput(
      usdProjectId, incomeTabId, strictInsideServiceId, "2026-06-11", "2026-06-11", 2, 1, "edited by custom grant",
    ));
    expectStatus(response, 200, "custom edit_entries grant");
    response = await request("GET", `/mis/entries/${idOf(editOnlySource, "edit-only source")}`, limitedSession);
    expectStatus(response, 403, "custom edit_entries does not imply view_entries");
    await removeFixtureAuthority(editOnlyGrant);

    const deleteOnlySource = await createEntry(actorSession, entryInput(
      usdProjectId, incomeTabId, strictInsideServiceId, "2026-06-12", "2026-06-12", 1, 1,
    ));
    const deleteOnlyGrant = await addFixtureAuthority(limited.id, "custom", usdProjectId, actor.id, ["delete_entries"]);
    response = await request("DELETE", `/mis/entries/${idOf(deleteOnlySource, "delete-only source")}`, limitedSession);
    expectStatus(response, 200, "custom delete_entries grant");
    response = await request("GET", `/mis/entries/${idOf(deleteOnlySource, "delete-only source")}`, actorSession);
    expectStatus(response, 404, "custom delete_entries removes the entry");
    await removeFixtureAuthority(deleteOnlyGrant);

    const batchGrant = await addFixtureAuthority(limited.id, "custom", usdProjectId, actor.id, ["create_entries", "edit_entries", "view_entries"]);
    response = await request("POST", "/mis/entries/bulk", limitedSession, {
      projectId: usdProjectId,
      fromDate: "2026-07-01",
      toDate: "2026-07-01",
      action: "draft",
      lines: [
        { serviceId: strictInsideServiceId, quantity: null },
        { serviceId: usdServiceId, quantity: 0, rate: 12.34, remarks: "explicit zero" },
      ],
    });
    expectStatus(response, 201, "bulk blank and zero entries");
    const bulkResult = await json(response, "bulk blank and zero response");
    const bulkParent = asObject(bulkResult.parent, "bulk parent");
    fixtureIds.parents.push(idOf(bulkParent, "bulk parent"));
    const bulkItems = asArray(bulkResult.items, "bulk items").map((item) => asObject(item, "bulk item"));
    assert.equal(bulkItems.length, 1, "bulk must skip only omitted/null quantities");
    assert.equal(bulkItems[0]?.quantity, 0, "bulk must preserve explicit zero quantity");
    assert.equal(bulkItems[0]?.parentId, bulkParent.id, "bulk child must reference its parent");
    assert.equal(typeof bulkParent.bulkNumber, "string", "bulk parent must have an immutable bulk number");
    fixtureIds.entries.push(...bulkItems.map((item) => idOf(item, "bulk item")));

    response = await request("POST", "/mis/entries/bulk", limitedSession, {
      projectId: usdProjectId,
      fromDate: "2026-08-01",
      toDate: "2026-08-01",
      action: "draft",
      lines: [
        { serviceId: strictInsideServiceId, quantity: 1, rate: 1 },
        { serviceId: "missing-service", quantity: 1, rate: 1 },
      ],
    });
    expectStatus(response, 400, "bulk invalid line is atomic");
    response = await request("GET", "/mis/entries?projectIds=" + usdProjectId + "&from=2026-08-01&to=2026-08-01&page=1&pageSize=100", actorSession);
    expectStatus(response, 200, "bulk atomicity verification query");
    assert.equal(asArray((await json(response, "bulk atomicity entries")).items, "bulk atomicity items").length, 0);

    response = await request("POST", "/mis/entries/bulk", limitedSession, {
      projectId: usdProjectId,
      fromDate: "2026-09-01",
      toDate: "2026-09-01",
      action: "draft",
      lines: [
        { serviceId: strictInsideServiceId, quantity: 1, rate: 1 },
        { serviceId: strictInsideServiceId, quantity: 2, rate: 1 },
      ],
    });
    expectStatus(response, 201, "bulk duplicate service lines remain atomic under one parent");
    const duplicateBulk = await json(response, "duplicate bulk response");
    fixtureIds.parents.push(idOf(duplicateBulk.parent, "duplicate bulk parent"));
    const duplicateBulkItems = asArray(duplicateBulk.items, "duplicate bulk items");
    fixtureIds.entries.push(...duplicateBulkItems.map((item) => idOf(item, "duplicate bulk item")));
    assert.equal(duplicateBulkItems.length, 2, "bulk service lines remain children of one atomic parent");
    response = await request("GET", "/mis/entries?projectIds=" + usdProjectId + "&from=2026-09-01&to=2026-09-01&page=1&pageSize=100", actorSession);
    expectStatus(response, 200, "bulk duplicate rollback query");
    assert.equal(asArray((await json(response, "bulk duplicate entries")).items, "bulk duplicate items").length, 2);
    response = await request("POST", "/mis/entries/bulk", limitedSession, {
      projectId: usdProjectId,
      fromDate: "2026-09-02",
      toDate: "2026-09-02",
      action: "draft",
      lines: [{ serviceId: usdExpenseServiceId, amount: 50, calculationMode: "amount" }],
    });
    expectStatus(response, 201, "amount bulk parent");
    const amountBulk = await json(response, "amount bulk response");
    const amountParent = asObject(amountBulk.parent, "amount bulk parent");
    const amountParentId = idOf(amountParent, "amount bulk parent");
    fixtureIds.parents.push(amountParentId);
    const amountChildren = asArray(amountBulk.items, "amount bulk children").map((item) => asObject(item, "amount bulk child"));
    assert.equal(amountChildren[0]?.calculationMode, "amount");
    assert.equal(amountChildren[0]?.quantity, null);
    fixtureIds.entries.push(...amountChildren.map((item) => idOf(item, "amount bulk child")));
    response = await request("PATCH", `/mis/entries/parents/${amountParentId}`, limitedSession, {
      fromDate: "2026-09-02",
      toDate: "2026-09-02",
      lines: [{ id: idOf(amountChildren[0], "amount bulk child"), serviceId: usdExpenseServiceId, amount: 60, calculationMode: "amount" }],
    });
    expectStatus(response, 200, "edit amount bulk parent");
    const editedAmountParent = await json(response, "edited amount bulk parent");
    const editedAmountChild = asObject(asArray(editedAmountParent.items, "edited amount bulk children")[0], "edited amount bulk child");
    assert.equal(editedAmountChild.calculationMode, "amount");
    assert.equal(editedAmountChild.amount, 60);
    assert.equal(editedAmountChild.quantity, null);
    assert.equal(editedAmountChild.rate, null);
    response = await request("POST", "/mis/entries/bulk", limitedSession, {
      projectId: usdProjectId,
      fromDate: "2026-09-03",
      toDate: "2026-09-03",
      action: "draft",
      lines: originalServiceOrder.slice(0, 2).map((serviceId) => {
        const service = usdServices.find((item) => item.id === serviceId);
        return service?.calculationMode === "amount"
          ? { serviceId, amount: 1, calculationMode: "amount" }
          : { serviceId, quantity: 1, rate: Number(service?.defaultRate) };
      }),
    });
    expectStatus(response, 201, "service-order parent");
    const orderParentResponse = await json(response, "service-order parent response");
    const orderParentId = idOf(orderParentResponse.parent, "service-order parent");
    fixtureIds.parents.push(orderParentId);
    fixtureIds.entries.push(...asArray(orderParentResponse.items, "service-order children").map((item) => idOf(item, "service-order child")));
    response = await request("GET", `/mis/entries/parents/${orderParentId}`, actorSession);
    expectStatus(response, 200, "service-order parent detail");
    const orderDetail = await json(response, "service-order parent detail response");
    assert.deepEqual(
      asArray(orderDetail.items, "ordered parent children").map((item) => asObject(item, "ordered parent child").serviceId),
      reorderedServices.map((item) => item.id).filter((serviceId) => originalServiceOrder.slice(0, 2).includes(serviceId)),
      "parent children must follow persisted service sequence with stable ID tie-break",
    );
    const salaryEntry = await createEntry(limitedSession, amountEntryInput(
      usdProjectId, salaryTabId, usdSalaryServiceId, "2026-02-01", "2026-02-01", 1234.567891,
    ));
    assert.equal(salaryEntry.calculationMode, "amount", "salary must persist direct-amount mode");
    assert.equal(salaryEntry.amount, 1234.567891, "salary must persist actual amount without rate multiplication");
    assert.equal(salaryEntry.quantity, null);
    assert.equal(salaryEntry.rate, null);
    response = await request("PATCH", `/mis/entries/${idOf(salaryEntry, "salary entry")}`, limitedSession, amountEntryInput(
      usdProjectId, salaryTabId, usdSalaryServiceId, "2026-02-01", "2026-02-01", 1400,
    ));
    expectStatus(response, 200, "amount mode salary edit");
    const editedSalary = await json(response, "edited salary");
    assert.equal(editedSalary.amount, 1400);
    assert.equal(editedSalary.quantity, null);
    assert.equal(editedSalary.rate, null);
    const expenseEntry = await createEntry(limitedSession, amountEntryInput(
      usdProjectId, expenseTabId, usdExpenseServiceId, "2026-02-02", "2026-02-02", 0,
    ));
    assert.equal(expenseEntry.calculationMode, "amount", "expense must persist direct-amount mode");
    assert.equal(expenseEntry.amount, 0, "zero direct amount must be accepted");
    response = await request("POST", "/mis/entries", limitedSession, amountEntryInput(
      usdProjectId, expenseTabId, usdExpenseServiceId, "2026-02-03", "2026-02-03", -1,
    ));
    expectStatus(response, 400, "negative amount validation");
    response = await request("POST", "/mis/entries", limitedSession, entryInput(
      usdProjectId, incomeTabId, usdServiceId, "2026-02-03", "2026-02-03", -1, 12.34,
    ));
    expectStatus(response, 400, "negative quantity validation");

    // Income and cost retain the quantity × rate path, including exact
    // six-decimal rounding and explicit zero quantity.
    const roundedIncome = await createEntry(limitedSession, entryInput(
      usdProjectId, incomeTabId, usdServiceId, "2026-02-04", "2026-02-04", 2.5, 12.34,
    ));
    assert.equal(roundedIncome.calculationMode, "quantity_rate");
    assert.equal(roundedIncome.amount, 30.85);
    const zeroIncome = await createEntry(limitedSession, entryInput(
      usdProjectId, incomeTabId, usdServiceId, "2026-02-05", "2026-02-05", 0, 12.34,
    ));
    assert.equal(zeroIncome.amount, 0, "zero quantity must be accepted");
    response = await request("GET", `/mis/entries?projectIds=${usdProjectId}&statuses=draft%2Creturned&page=1&pageSize=100`, actorSession);
    expectStatus(response, 200, "CSV entry status subset filter");
    const subsetEntries = asArray((await json(response, "CSV entry status subset")).items, "CSV status entries").map((item) => asObject(item, "CSV status entry"));
    assert.ok(subsetEntries.every((item) => item.status === "draft" || item.status === "returned"));
    response = await request("GET", `/mis/entries?projectIds=${usdProjectId}&status=draft&page=1&pageSize=100`, actorSession);
    expectStatus(response, 200, "legacy scalar entry status filter");
    response = await request("GET", `/mis/entries?projectIds=${usdProjectId}&statuses=draft%2Cnot-a-status&page=1&pageSize=100`, actorSession);
    expectStatus(response, 400, "invalid CSV entry status filter");
    const roundedCost = await createEntry(actorSession, entryInput(
      eurProjectId, costTabId, eurServiceId, "2026-02-06", "2026-02-06", 2.5, 10,
    ));
    assert.equal(roundedCost.calculationMode, "quantity_rate");
    assert.equal(roundedCost.amount, 25);
    await removeFixtureAuthority(batchGrant);

    const rateGrant = await addFixtureAuthority(limited.id, "custom", usdProjectId, actor.id, ["create_entries", "rate_override"]);
    response = await request("POST", "/mis/entries", limitedSession, entryInput(
      usdProjectId, incomeTabId, usdServiceId, "2026-06-20", "2026-06-20", 1, 20,
    ));
    expectStatus(response, 400, "rate override reason required");
    const rateEntry = await createEntry(limitedSession, {
      ...entryInput(usdProjectId, incomeTabId, usdServiceId, "2026-06-20", "2026-06-20", 1, 20),
      rateReason: "Approved integration override",
    });
    const rateEntryId = idOf(rateEntry, "rate override entry");
    response = await request("GET", `/mis/entries/${rateEntryId}/history`, actorSession);
    expectStatus(response, 200, "rate override audit history");
    const rateHistory = asArray(await response.json(), "rate override history").map((item) => asObject(item, "rate override audit"));
    const rateAudit = rateHistory.find((item) => item.action === "CREATE");
    assert.ok(rateAudit, "rate override create audit must exist");
    const rateAuditValues = asObject(rateAudit.newValues, "rate override audit values");
    const rateAuditDetail = asObject(rateAuditValues.rateAudit, "rate override audit detail");
    assert.equal(rateAuditDetail.originalRate, 12.34);
    assert.equal(rateAuditDetail.newRate, 20);
    assert.equal(rateAuditDetail.reason, "Approved integration override");
    await action(actorSession, rateEntryId, "submit");
    await action(actorSession, rateEntryId, "approve");
    await removeFixtureAuthority(rateGrant);

    let dataEntryGrant = await addFixtureAuthority(limited.id, "data_entry", usdProjectId, actor.id);
    response = await request("POST", "/mis/entries", limitedSession, entryInput(
      usdProjectId, incomeTabId, usdServiceId, "2026-03-15", "2026-03-15", 1, 99,
    ));
    expectStatus(response, 403, "data entry rate override denial");

    const outsideEntry = await createEntry(limitedSession, entryInput(
      usdProjectId, incomeTabId, strictOutsideServiceId, "2026-03-01", "2026-03-31", 1, 1,
    ));
    const insideEntry = await createEntry(limitedSession, entryInput(
      usdProjectId, incomeTabId, strictInsideServiceId, "2026-03-12", "2026-03-14", 1, 1,
    ));
    response = await request("GET", "/mis/entries?from=2026-03-10&to=2026-03-20&status=draft&page=1&pageSize=100", limitedSession);
    expectStatus(response, 200, "strict date containment entry filter");
    const contained = await json(response, "contained entries");
    const containedIds = asArray(contained.items, "contained entry items").map((item) => idOf(item, "contained entry"));
    assert.ok(containedIds.includes(idOf(insideEntry, "inside entry")));
    assert.ok(!containedIds.includes(idOf(outsideEntry, "outside entry")), "overlapping-but-not-contained entry leaked into date filter");
    response = await request("GET", "/mis/entries?startFrom=2026-03-12&startTo=2026-03-12&status=draft&page=1&pageSize=100", limitedSession);
    expectStatus(response, 200, "period-start entry filter");
    const periodStartEntries = asArray((await json(response, "period-start entries")).items, "period-start entry items").map((item) => asObject(item, "period-start entry"));
    const periodStartIds = periodStartEntries.map((item) => idOf(item, "period-start entry"));
    assert.ok(periodStartIds.includes(idOf(insideEntry, "inside entry")));
    assert.ok(!periodStartIds.includes(idOf(outsideEntry, "outside entry")), "period-start filter must compare only entry.fromDate");

    const mainEntry = await createEntry(limitedSession, entryInput(
      usdProjectId, incomeTabId, usdServiceId, "2026-03-15", "2026-03-15", 2.5, 12.34, "before audit",
    ));
    const mainEntryId = idOf(mainEntry, "main entry");
    assert.equal(mainEntry.amount, 30.85, "server must calculate decimal quantity × rate");
    const mainSnapshot = {
      calculationMode: mainEntry.calculationMode,
      rateEnabled: mainEntry.rateEnabled,
      calculatePercentAgainstIncome: mainEntry.calculatePercentAgainstIncome,
    };
    response = await request("PATCH", `/mis/entries/${mainEntryId}`, limitedSession, entryInput(
      usdProjectId, incomeTabId, usdServiceId, "2026-03-15", "2026-03-15", 2.5, 12.34, "after audit",
    ));
    expectStatus(response, 200, "update draft entry");
    const editedMainEntry = await json(response, "edited draft entry");
    assert.deepEqual({
      calculationMode: editedMainEntry.calculationMode,
      rateEnabled: editedMainEntry.rateEnabled,
      calculatePercentAgainstIncome: editedMainEntry.calculatePercentAgainstIncome,
    }, mainSnapshot, "legacy quantity-rate snapshots must remain unchanged after parent-independent edits");
    await action(limitedSession, mainEntryId, "submit");
    response = await request("POST", `/mis/entries/${mainEntryId}/action`, limitedSession, { action: "approve", remarks: "not authorized" });
    expectStatus(response, 403, "data entry approval denial");
    const approved = await action(actorSession, mainEntryId, "approve");
    assert.equal(approved.status, "approved");

    response = await request("PATCH", `/mis/entries/${mainEntryId}`, limitedSession, entryInput(
      usdProjectId, incomeTabId, usdServiceId, "2026-03-15", "2026-03-15", 2.5, 12.34,
    ));
    expectStatus(response, [403, 409], "approved entry is locked for edit");
    response = await request("DELETE", `/mis/entries/${mainEntryId}`, limitedSession);
    expectStatus(response, 403, "approved entry deletion denial");
    response = await request("GET", `/mis/entries/${mainEntryId}/history`, actorSession);
    expectStatus(response, 200, "approved entry history");
    const history = asArray(await response.json(), "entry history").map((item) => asObject(item, "history item"));
    const updateAudit = history.find((item) => item.action === "UPDATE");
    assert.ok(updateAudit, "history must include UPDATE audit");
    assert.ok(updateAudit.oldValues && updateAudit.newValues, "update history must include before and after values");
    assert.ok(history.some((item) => item.action === "SUBMIT"));
    assert.ok(history.some((item) => item.action === "APPROVE"));

    const resetEntry = await createEntry(limitedSession, entryInput(
      usdProjectId, incomeTabId, strictInsideServiceId, "2026-04-01", "2026-04-01", 1, 1,
    ));
    const resetEntryId = idOf(resetEntry, "reset entry");
    await action(limitedSession, resetEntryId, "submit");
    const rejected = await action(actorSession, resetEntryId, "reject");
    assert.equal(rejected.status, "rejected");
    response = await request("POST", `/mis/entries/${resetEntryId}/action`, limitedSession, { action: "reset", remarks: "not authorized" });
    expectStatus(response, 403, "data entry reset denial");
    const reset = await action(actorSession, resetEntryId, "reset");
    assert.equal(reset.status, "draft");
    await action(limitedSession, resetEntryId, "submit");
    const cancelled = await action(actorSession, resetEntryId, "cancel");
    assert.equal(cancelled.status, "cancelled");

    const eurEntry = await createEntry(actorSession, entryInput(
      eurProjectId, costTabId, eurServiceId, "2026-03-15", "2026-03-15", 1, 10,
    ));
    const eurEntryId = idOf(eurEntry, "EUR entry");
    response = await request("GET", `/mis/entries?projectIds=${usdProjectId},${eurProjectId}&currency=USD&startFrom=2026-03-15&startTo=2026-03-15&page=1&pageSize=100`, actorSession);
    expectStatus(response, 200, "currency entry filter");
    const currencyEntries = asArray((await json(response, "currency entries")).items, "currency entry items").map((item) => asObject(item, "currency entry"));
    assert.ok(currencyEntries.length > 0);
    assert.ok(currencyEntries.every((item) => item.currency === "USD"), "currency filter must not mix currency drilldown results");
    await action(actorSession, eurEntryId, "submit");
    await action(actorSession, eurEntryId, "approve");
    const customEntry = await createEntry(actorSession, entryInput(
      usdProjectId, otherTabId, usdOtherServiceId, "2026-03-16", "2026-03-16", 2, 5,
    ));
    await action(actorSession, idOf(customEntry, "custom entry"), "submit");
    await action(actorSession, idOf(customEntry, "custom entry"), "approve");

    const reportQuery = `?projectIds=${usdProjectId},${eurProjectId}&from=2026-03-01&to=2026-03-31`;
    for (const reportType of [
      "income", "cost", "expense", "salary", "summary", "project-profitability",
      "project-comparison", "period-comparison", "service-tab-comparison",
    ]) {
      response = await request("GET", `/mis/reports${reportQuery}&reportType=${reportType}`, actorSession);
      expectStatus(response, 200, `${reportType} report`);
      const report = await json(response, `${reportType} report`);
      assert.equal(report.reportType, reportType);
      const groups = asArray(report.currencyGroups, `${reportType} currency groups`).map((item) => asObject(item, "currency group"));
      assert.ok(groups.some((group) => group.currency === "USD"));
      assert.ok(groups.some((group) => group.currency === "EUR"));
      assert.ok(groups.every((group) => group.currentTotals && !("amount" in group)), "reports must expose separated totals, not a mixed amount");
    }
    response = await request("GET", `/mis/reports?projectIds=${eurProjectId}&from=2026-03-01&to=2026-03-31&reportType=summary`, actorSession);
    expectStatus(response, 200, "zero-income report");
    const zeroIncomeReport = await json(response, "zero-income report");
    const eurGroup = asArray(zeroIncomeReport.currencyGroups, "zero-income groups")
      .map((item) => asObject(item, "zero-income group"))
      .find((item) => item.currency === "EUR");
    assert.ok(eurGroup, "EUR zero-income group must be present");
    assert.equal(asObject(eurGroup.currentTotals, "EUR totals").income, 0);
    assert.equal(asObject(eurGroup.currentTotals, "EUR totals").profitMargin, 0);
    response = await request("GET", `/mis/reports?projectIds=${usdProjectId}&from=2026-03-01&to=2026-03-31&reportType=service-tab-comparison`, actorSession);
    expectStatus(response, 200, "custom percentage standard report");
    const customReport = await json(response, "custom percentage standard report body");
    const customCurrency = asObject(asArray(customReport.currencyGroups, "custom currency groups")[0], "custom currency group");
    const customGroup = asArray(customCurrency.groups, "custom report groups")
      .map((item) => asObject(item, "custom report group"))
      .find((item) => item.type === "other");
    assert.equal(customGroup?.calculatePercentAgainstIncome, true, "custom group must expose effective percentage config");
    assert.ok(Number(asObject(customGroup?.currentTotals, "custom group totals").totalAmount) > 0, "custom group must expose totalAmount");

    for (const [format, signature] of [
      ["xlsx", "PK"],
      ["pdf", "%PDF"],
    ] as const) {
      response = await request("GET", `/mis/reports/export${reportQuery}&reportType=summary&format=${format}`, actorSession);
      expectStatus(response, 200, `${format} export`);
      assert.equal((await response.text()).slice(0, signature.length), signature, `${format} export signature`);
    }
    response = await request("GET", `/mis/reports/export${reportQuery}&reportType=summary&format=csv`, actorSession);
    expectStatus(response, 200, "CSV export");
    const csv = await response.text();
    assert.match(csv, /^[^\r\n]+(?:\r?\n)/, "CSV export must begin with a header line");
    assert.ok(!csv.trimStart().startsWith("{"), "CSV export must not be a JSON envelope");

    response = await request("GET", `/mis/dashboard?projectIds=${usdProjectId},${eurProjectId}&from=2026-03-01&to=2026-03-31`, actorSession);
    expectStatus(response, 200, "MIS dashboard");
    const dashboard = await json(response, "MIS dashboard");
    assert.ok(asArray(dashboard.currencyGroups, "dashboard currency groups").length >= 2);
    assert.ok(Array.isArray(dashboard.recentEntries));

    const analyticsQuery = `?projectIds=${usdProjectId},${eurProjectId}&from=2026-03-01&to=2026-12-31&compareFrom=2026-03-01&compareTo=2026-03-31&groupBy=project,type&mode=dynamic&view=custom&page=1&pageSize=50`;
    // Bound date buckets must not repeat parameter expressions in GROUP BY:
    // PostgreSQL treats separate $n bindings as distinct expressions.
    for (const view of ["daily", "weekly", "monthly", "custom"]) {
      const boundedQuery = analyticsQuery.replace("view=custom", `view=${view}`)
        .replace("groupBy=project,type", "groupBy=date,project,type,service");
      const boundedResponse = await request("GET", `/mis/analytics${boundedQuery}`, actorSession);
      expectStatus(boundedResponse, 200, `Bounded ${view} analytics grouping`);
    }
    response = await request("GET", `/mis/analytics${analyticsQuery}`, actorSession);
    expectStatus(response, 200, "HTTP MIS analytics");
    const analytics = await json(response, "HTTP MIS analytics");
    assert.equal(analytics.dateBasis, "period_start");
    const analyticsTotals = asArray(analytics.totalsByCurrency, "analytics totals").map((item) => asObject(item, "analytics currency total"));
    assert.ok(analyticsTotals.some((item) => item.currency === "USD"));
    assert.ok(analyticsTotals.some((item) => item.currency === "EUR"));
    const analyticsUsd = analyticsTotals.find((item) => item.currency === "USD");
    assert.ok(analyticsUsd, "analytics USD totals must exist");
    const analyticsPreviousUsd = asObject(analyticsUsd.previous, "analytics previous USD totals");
    assert.ok(Number(analyticsPreviousUsd.entryCount) > 0, "HTTP analytics must include previous currency totals");
    assert.ok(asArray(analytics.rows, "analytics rows").length > 0);
    const analyticsIncomeRow = asArray(analytics.rows, "analytics rows")
      .map((item) => asObject(item, "analytics row"))
      .find((item) => item.projectId === usdProjectId && item.type === "income");
    assert.equal(analyticsIncomeRow?.calculatePercentAgainstIncome, false, "project-tab override must affect analytics rows");

    const mixedRateQuery = `?projectIds=${usdProjectId}&serviceCodes=${encodeURIComponent(String(usdService.code))}&from=2026-03-01&to=2026-12-31&groupBy=service&mode=dynamic&view=custom`;
    response = await request("GET", `/mis/analytics${mixedRateQuery}`, actorSession);
    expectStatus(response, 200, "HTTP analytics mixed-rate grouping");
    const mixedRateRows = asArray((await json(response, "mixed-rate analytics")).rows, "mixed-rate rows").map((item) => asObject(item, "mixed-rate row"));
    assert.ok(mixedRateRows.some((item) => asObject(item.current, "mixed-rate metrics").rateVaried === true), "analytics must expose mixed rates and weighted-rate metrics");

    await removeFixtureAuthority(dataEntryGrant);
    const analyticsScopedGrant = await addFixtureAuthority(limited.id, "project_manager", usdProjectId, actor.id);
    response = await request("GET", `/mis/analytics?projectIds=${usdProjectId}`, limitedSession);
    expectStatus(response, 200, "scoped HTTP analytics");
    response = await request("GET", `/mis/analytics?projectIds=${eurProjectId}`, limitedSession);
    expectStatus(response, 403, "scoped HTTP analytics isolation");
    await removeFixtureAuthority(analyticsScopedGrant);
    dataEntryGrant = await addFixtureAuthority(limited.id, "data_entry", usdProjectId, actor.id);

    for (const [format, signature] of [
      ["xlsx", "PK"],
      ["pdf", "%PDF"],
    ] as const) {
      response = await request("GET", `/mis/analytics/export${analyticsQuery}&format=${format}`, actorSession);
      expectStatus(response, 200, `analytics ${format} export`);
      assert.equal((await response.text()).slice(0, signature.length), signature, `analytics ${format} export signature`);
    }
    response = await request("GET", `/mis/analytics/export${analyticsQuery}&format=csv`, actorSession);
    expectStatus(response, 200, "analytics CSV export");
    assert.match(await response.text(), /^row_type,currency,/, "analytics CSV export header");

    response = await request("GET", `/mis/analytics?projectIds=${usdProjectId}&tabIds=${incomeTabId}`, actorSession);
    expectStatus(response, 200, "analytics enabled project-tab assignment");
    response = await request("PUT", `/mis/projects/${usdProjectId}/tabs`, actorSession, {
      assignments: [
        { tabId: incomeTabId, enabled: false, sequence: 10 },
        { tabId: costTabId, enabled: false, sequence: 20 },
      ],
    });
    expectStatus(response, 200, "disable analytics project-tab assignment");
    response = await request("GET", `/mis/analytics?projectIds=${usdProjectId}&tabIds=${incomeTabId}`, actorSession);
    expectStatus(response, 403, "analytics excludes disabled project-tab assignment");
    response = await request("PUT", `/mis/projects/${usdProjectId}/tabs`, actorSession, {
      assignments: [
        { tabId: incomeTabId, enabled: true, sequence: 10 },
        { tabId: costTabId, enabled: false, sequence: 20 },
      ],
    });
    expectStatus(response, 200, "restore analytics project-tab assignment");

    response = await request("GET", `/mis/entries?projectIds=${eurProjectId}&page=1&pageSize=100`, limitedSession);
    expectStatus(response, 200, "scoped entries do not leak");
    const hiddenEntries = await json(response, "scoped entry list");
    assert.equal(asArray(hiddenEntries.items, "scoped entry items").length, 0, "scoped user received another project's entries");

    // A saved draft rate remains editable after an administrator changes the
    // service default; it is historical draft data, not a fresh override.
    const historicalDraft = await createEntry(limitedSession, entryInput(
      usdProjectId, incomeTabId, usdServiceId, "2026-05-01", "2026-05-01", 1, 12.34,
    ));
    const historicalDraftId = idOf(historicalDraft, "historical draft");
    response = await request("PATCH", `/mis/services/${usdServiceId}`, actorSession, {
      ...serviceInput(incomeTabId, `${prefix} Revenue Updated`, 13),
      sequence: 9,
    });
    expectStatus(response, 200, "change service default after draft");
    response = await request("PATCH", `/mis/entries/${historicalDraftId}`, limitedSession, entryInput(
      usdProjectId, incomeTabId, usdServiceId, "2026-05-01", "2026-05-01", 1, 12.34,
    ));
    expectStatus(response, 200, "retain saved historical draft rate");

    // Viewer/report scope is sufficient for operational reports, but never for
    // profit-bearing reports or a financial dashboard.
    await removeFixtureAuthority(dataEntryGrant);
    await addFixtureAuthority(limited.id, "viewer", usdProjectId, actor.id);
    response = await request("GET", `/mis/entries?projectIds=${usdProjectId}&page=1&pageSize=100`, limitedSession);
    expectStatus(response, 200, "legacy viewer entry listing");
    response = await request("GET", `/mis/reports?projectIds=${usdProjectId}&from=2026-03-01&to=2026-03-31&reportType=income`, limitedSession);
    expectStatus(response, 200, "viewer operational report");
    const operational = await json(response, "viewer operational report");
    const operationalTotals = asObject(asArray(operational.currencyGroups, "operational groups")[0], "operational group").currentTotals;
    assert.equal(asObject(operationalTotals, "operational totals").netProfit, 0, "operational reports redact profit");
    response = await request("GET", `/mis/reports?projectIds=${usdProjectId}&from=2026-03-01&to=2026-03-31&reportType=summary`, limitedSession);
    expectStatus(response, 403, "viewer summary report requires financial");
    response = await request("GET", `/mis/dashboard?projectIds=${usdProjectId}&from=2026-03-01&to=2026-03-31`, limitedSession);
    expectStatus(response, 200, "viewer dashboard CTA payload");
    assert.equal(asArray((await json(response, "viewer dashboard")).currencyGroups, "viewer dashboard groups").length, 0);

    // Current master reporting eligibility is enforced even for immutable
    // historical entry snapshots.
    response = await request("PATCH", `/mis/tabs/${incomeTabId}`, actorSession, { ...tabInput(prefix, "Income", "income", "income"), allowReporting: false });
    expectStatus(response, 200, "disable income reporting");
    response = await request("GET", `/mis/reports?projectIds=${usdProjectId}&from=2026-03-01&to=2026-03-31&reportType=income`, actorSession);
    expectStatus(response, 200, "report excludes disabled reporting tab");
    const disabledReportingReport = await json(response, "disabled reporting report");
    const disabledReportingGroups = asArray(disabledReportingReport.currencyGroups, "disabled reporting groups");
    assert.ok(disabledReportingGroups.length > 0, "disabled reporting report must retain the selected currency context");
    assert.ok(disabledReportingGroups.every((group) => {
      const value = asObject(group, "disabled reporting currency group");
      const totals = asObject(value.currentTotals, "disabled reporting totals");
      return asArray(value.groups, "disabled reporting group rows").length === 0
        && totals.entryCount === 0
        && totals.totalAmount === 0;
    }), "disabled reporting tab must contribute no report rows or totals");
    await assert.rejects(
      db.delete(misAuditLogTable).where(eq(misAuditLogTable.entryId, mainEntryId)),
      (error: unknown) => /append-only/.test(String(error)) || /append-only/.test(String((error as { cause?: unknown }).cause)),
      "runtime database session cannot delete immutable audit history",
    );

    response = await request("DELETE", `/mis/entries/${mainEntryId}`, actorSession);
    expectStatus(response, 200, "delete approved entry with delete_approved");

    await removeFixtureAuthority(dataEntryGrant);
    // The fixture IDs remain tracked: repeated targeted deletes in cleanup are
    // harmless and protect against later assertion failures.
    void bootstrapAdminId;
  } finally {
    await cleanup();
    await stopServer();
  }
}

main()
  .then(() => {
    process.stdout.write("MIS integration verification passed\n");
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : errorMessage(error);
    process.stderr.write(`MIS integration verification failed: ${message}\n`);
    process.exitCode = 1;
  });