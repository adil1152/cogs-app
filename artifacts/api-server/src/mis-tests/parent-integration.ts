/**
 * Focused MIS parent acceptance harness.
 *
 * This is an HTTP-only fixture test. It inserts temporary MIS authorities for
 * otherwise ungranted existing users, scopes the editor to one fixture
 * project, and removes every row/session in a maintenance transaction. It
 * never creates, updates, or deletes users and never prints bearer sessions.
 *
 * Run only after the development MIS migration:
 *   pnpm --filter @workspace/scripts mis:migrate
 *   pnpm --filter @workspace/api-server exec tsx src/mis-tests/parent-integration.ts
 */
import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
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
  sessionsTable,
  usersTable,
} from "@workspace/db";
import type { AuthUser } from "@workspace/api-zod";
import app from "../app";
import { createSession, deleteSession } from "../lib/auth";

type Json = Record<string, any>;
const ids = {
  authorities: [] as string[],
  projects: [] as string[],
  tabs: [] as string[],
  services: [] as string[],
  parents: [] as string[],
  entries: [] as string[],
  sessions: [] as string[],
};
let server: Server | undefined;
let baseUrl = "";
let cases = 0;

function check(label: string, condition: unknown): void {
  cases += 1;
  assert.ok(condition, label);
}
function object(value: unknown, label: string): Json {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  return value as Json;
}
function array(value: unknown, label: string): Json[] {
  assert.ok(Array.isArray(value), `${label} must be an array`);
  return value as Json[];
}
function id(value: unknown, label: string): string {
  const result = object(value, label).id;
  assert.equal(typeof result, "string", `${label}.id must be a string`);
  return result;
}
async function body(response: Response): Promise<Json> {
  return object(await response.json(), "HTTP response");
}
async function request(method: string, path: string, sid?: string, value?: unknown): Promise<Response> {
  const headers: Record<string, string> = {};
  if (sid) headers.authorization = `Bearer ${sid}`;
  if (value !== undefined) headers["content-type"] = "application/json";
  return fetch(`${baseUrl}/api${path}`, {
    method, headers, body: value === undefined ? undefined : JSON.stringify(value),
  });
}
async function status(label: string, response: Response, expected: number | number[]): Promise<Json> {
  const allowed = Array.isArray(expected) ? expected : [expected];
  check(label, allowed.includes(response.status));
  return await response.json() as Json;
}
function authUser(row: typeof usersTable.$inferSelect): AuthUser {
  return {
    id: row.id, email: row.email, firstName: row.firstName, lastName: row.lastName,
    mobile: row.mobile, profileImageUrl: row.profileImageUrl, role: "user",
  };
}
async function authority(userId: string, projectId: string | null, extraPermissions: string[]): Promise<string> {
  const [row] = await db.insert(misAuthoritiesTable).values({
    userId, projectId, role: "custom", extraPermissions, createdById: userId,
  }).returning({ id: misAuthoritiesTable.id });
  assert.ok(row);
  ids.authorities.push(row.id);
  return row.id;
}
async function session(user: typeof usersTable.$inferSelect): Promise<string> {
  const sid = await createSession({ user: authUser(user) });
  ids.sessions.push(sid);
  return sid;
}
function projectBody(prefix: string, allowMultipleEntries = false, overlapPolicy = "nonoverlap", maxEntriesPerPeriod: number | null = null): Json {
  return {
    name: `${prefix} Project`, code: prefix, managerId: null, status: "active",
    startDate: "2026-01-01", endDate: "2026-12-31", currency: "USD",
    reportingSettings: {
      defaultEntryStatus: "draft", preventDuplicatePeriods: true,
      allowMultipleEntries, overlapPolicy, maxEntriesPerPeriod,
    },
  };
}
function line(serviceId: string, quantity = 1, rate = 10, childId?: string, rateReason?: string): Json {
  return {
    ...(childId ? { id: childId } : {}),
    serviceId, quantity, rate, remarks: "parent acceptance line",
    ...(rateReason ? { rateReason } : {}),
  };
}
function parentBody(projectId: string, fromDate: string, toDate: string, serviceIds: string[], action = "draft"): Json {
  return { projectId, fromDate, toDate, action, lines: serviceIds.map((serviceId) => line(serviceId)) };
}
function entryBody(projectId: string, tabId: string, serviceId: string, fromDate: string, toDate = fromDate, rate = 10): Json {
  return { projectId, tabId, serviceId, fromDate, toDate, quantity: 1, rate, remarks: null };
}
async function createParent(sid: string, projectId: string, serviceIds: string[], fromDate: string, toDate: string, action = "draft"): Promise<Json> {
  const response = await request("POST", "/mis/entries/bulk", sid, parentBody(projectId, fromDate, toDate, serviceIds, action));
  const value = await status(`create parent ${fromDate}/${toDate}`, response, 201);
  const parent = object(value.parent, "created parent");
  ids.parents.push(id(parent, "created parent"));
  for (const child of array(value.items, "created parent children")) ids.entries.push(id(child, "created parent child"));
  return value;
}
async function cleanup(): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL mis.maintenance = 'on'`);
    const projectIds = ids.projects;
    const parentRows = projectIds.length
      ? await tx.select({ id: misEntryParentsTable.id }).from(misEntryParentsTable).where(inArray(misEntryParentsTable.projectId, projectIds))
      : [];
    const entryRows = projectIds.length
      ? await tx.select({ id: misEntriesTable.id }).from(misEntriesTable).where(inArray(misEntriesTable.projectId, projectIds))
      : [];
    const parentIds = [...new Set([...ids.parents, ...parentRows.map((row) => row.id)])];
    const entryIds = [...new Set([...ids.entries, ...entryRows.map((row) => row.id)])];
    const entityIds = [...ids.authorities, ...projectIds, ...ids.tabs, ...ids.services, ...parentIds, ...entryIds];
    if (entityIds.length || projectIds.length) {
      await tx.delete(misAuditLogTable).where(or(
        inArray(misAuditLogTable.entityId, entityIds.length ? entityIds : [""]),
        inArray(misAuditLogTable.entryId, entryIds.length ? entryIds : [""]),
        inArray(misAuditLogTable.projectId, projectIds.length ? projectIds : [""]),
      ));
    }
    if (entryIds.length) await tx.delete(misEntriesTable).where(inArray(misEntriesTable.id, entryIds));
    if (parentIds.length) await tx.delete(misEntryParentsTable).where(inArray(misEntryParentsTable.id, parentIds));
    if (ids.authorities.length) await tx.delete(misAuthoritiesTable).where(inArray(misAuthoritiesTable.id, ids.authorities));
    if (ids.services.length) await tx.delete(misServicesTable).where(inArray(misServicesTable.id, ids.services));
    if (projectIds.length) await tx.delete(misProjectTabsTable).where(inArray(misProjectTabsTable.projectId, projectIds));
    if (projectIds.length) await tx.delete(misProjectsTable).where(inArray(misProjectsTable.id, projectIds));
    if (ids.tabs.length) await tx.delete(misTabsTable).where(inArray(misTabsTable.id, ids.tabs));
    if (ids.sessions.length) await tx.delete(sessionsTable).where(inArray(sessionsTable.sid, ids.sessions));
  });
  await Promise.allSettled(ids.sessions.map((sid) => deleteSession(sid)));
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
  await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
}

async function main(): Promise<void> {
  const granted = new Set((await db.select({ userId: misAuthoritiesTable.userId }).from(misAuthoritiesTable)).map((row) => row.userId));
  const users = (await db.select().from(usersTable)).filter((user) => !granted.has(user.id));
  assert.ok(users.length >= 3, "parent harness requires three existing users without MIS grants");
  const [admin, editor, noAccess] = users;
  const adminSid = await session(admin);
  const editorSid = await session(editor);
  const noAccessSid = await session(noAccess);
  const prefix = `MIP${Date.now().toString(36).slice(-8).toUpperCase()}`;
  try {
    await start();
    await authority(admin.id, null, [
      "projects", "project_config", "configuration", "tabs", "services", "entries", "submit", "approve",
      "reset", "history", "delete_approved", "edit_approved", "view_project", "view_entries",
      "create_entries", "edit_entries", "delete_entries", "rate_override", "reports", "financial",
    ]);
    const projectResponse = await status("create scoped-policy project", await request("POST", "/mis/projects", adminSid, projectBody(prefix)), 201);
    const projectId = id(projectResponse, "policy project"); ids.projects.push(projectId);
    const secondResponse = await status("create overlap-policy project", await request("POST", "/mis/projects", adminSid, projectBody(`${prefix}B`)), 201);
    const secondProjectId = id(secondResponse, "second project"); ids.projects.push(secondProjectId);
    const tabResponse = await status("create acceptance tab", await request("POST", "/mis/tabs", adminSid, {
      name: `${prefix} Tab`, code: `${prefix}TAB`, description: "parent acceptance", type: "income",
      financialClass: "income", sequence: 1, active: true, allowEntry: true, allowReporting: true,
    }), 201);
    const tabId = id(tabResponse, "acceptance tab"); ids.tabs.push(tabId);
     const costTabResponse = await status("create cost acceptance tab", await request("POST", "/mis/tabs", adminSid, {
       name: `${prefix} Cost Tab`, code: `${prefix}COST`, description: "cost amount/quantity acceptance",
       type: "cost", financialClass: "cost", sequence: 2, active: true, allowEntry: true, allowReporting: true,
     }), 201);
     const costTabId = id(costTabResponse, "cost acceptance tab"); ids.tabs.push(costTabId);
     await status(`assign acceptance tabs ${projectId}`, await request("PUT", `/mis/projects/${projectId}/tabs`, adminSid, {
       assignments: [
         { tabId, enabled: true, sequence: 1 },
         { tabId: costTabId, enabled: true, sequence: 2 },
       ],
     }), 200);
     await status(`assign acceptance tab ${secondProjectId}`, await request("PUT", `/mis/projects/${secondProjectId}/tabs`, adminSid, {
       assignments: [{ tabId, enabled: true, sequence: 1 }],
     }), 200);
    const serviceIds: string[] = [];
    for (const project of [projectId, secondProjectId]) {
      for (const suffix of ["A", "B"]) {
        const result = await status(`create service ${project}/${suffix}`, await request("POST", `/mis/projects/${project}/services`, adminSid, {
          tabId, name: `${prefix} Service ${project.slice(-4)} ${suffix}`, description: "parent acceptance",
          unit: "unit", defaultRate: 10, active: true, sequence: suffix === "A" ? 1 : 2,
          effectiveFrom: "2026-01-01", effectiveTo: "2026-12-31",
        }), 201);
        const serviceId = id(result, "acceptance service"); ids.services.push(serviceId); serviceIds.push(serviceId);
      }
    }
     const costServiceResponse = await status("create cost acceptance service", await request("POST", `/mis/projects/${projectId}/services`, adminSid, {
       tabId: costTabId, name: `${prefix} Cost Service`, description: "cost amount/quantity acceptance",
       unit: "unit", defaultRate: 10, active: true, sequence: 3,
       effectiveFrom: "2026-01-01", effectiveTo: "2026-12-31",
     }), 201);
     const costServiceId = id(costServiceResponse, "cost acceptance service"); ids.services.push(costServiceId);
    const p1a = serviceIds[0], p1b = serviceIds[1], p2a = serviceIds[2];
    await authority(editor.id, projectId, [
      "view_project", "view_entries", "create_entries", "edit_entries", "submit", "history", "reports",
    ]);
    await authority(noAccess.id, projectId, ["view_project", "edit_entries"]);

    const noAccessResponse = await request("GET", "/mis/entries/parents", noAccessSid);
    await status("noaccess role cannot list parents", noAccessResponse, 403);
    const noAccessCreatorsResponse = await request("GET", "/mis/entries/creators", noAccessSid);
    await status("noaccess role cannot list parent creators", noAccessCreatorsResponse, 403);
    const first = await createParent(editorSid, projectId, [p1a, p1b], "2026-01-10", "2026-01-15");
    const firstParent = object(first.parent, "first parent");
    const firstId = id(firstParent, "first parent");
    check("single parent has immutable bulk number", /^MIS-BULK-\d{6,}$/.test(String(firstParent.bulkNumber)));
    check("parent create has all service children", array(first.items, "first children").length === 2);
    const draftSaved = await status("draft parent can save without reset", await request("PATCH", `/mis/entries/parents/${firstId}`, editorSid, {
      fromDate: "2026-01-10", toDate: "2026-01-15", action: "draft",
      lines: array(first.items, "draft children").map((item, index) => line(item.serviceId, index + 2, item.rate, item.id)),
    }), 200);
    check("draft save remains draft without reset permission", draftSaved.parent.status === "draft"
      && array(draftSaved.items, "draft saved children").every((item) => item.status === "draft"));
    const detail = await status("parent detail includes all children", await request("GET", `/mis/entries/parents/${firstId}`, editorSid), 200);
    check("detail preserves child parent references", array(detail.items, "detail items").every((item) => item.parentId === firstId));
    const list = await status("parent search by bulk number", await request("GET", `/mis/entries/parents?bulkNumber=${encodeURIComponent(String(firstParent.bulkNumber))}`, editorSid), 200);
    check("parent search returns one match", array(list.items, "parent search items").some((item) => item.id === firstId));

     const zeroCost = await status("cost bulk accepts zero quantity with positive amount", await request("POST", "/mis/entries/bulk", editorSid, {
       projectId, fromDate: "2026-04-01", toDate: "2026-04-01", action: "draft",
       lines: [{ serviceId: costServiceId, quantity: 0, amount: 123.45, rate: 999999 }],
     }), 201);
     const zeroCostParent = object(zeroCost.parent, "zero cost parent");
     ids.parents.push(id(zeroCostParent, "zero cost parent"));
     const zeroCostItem = object(array(zeroCost.items, "zero cost items")[0], "zero cost item");
     ids.entries.push(id(zeroCostItem, "zero cost item"));
     check("zero quantity keeps entered positive amount", zeroCostItem.quantity === 0 && zeroCostItem.amount === 123.45);
     check("zero quantity derives a safe zero rate", zeroCostItem.rate === 0);

     const costCreated = await status("cost bulk uses amount and quantity", await request("POST", "/mis/entries/bulk", editorSid, {
       projectId, fromDate: "2026-04-02", toDate: "2026-04-02", action: "draft",
       lines: [
         // The incoming rate is deliberately hostile. It must never override
         // the amount/quantity-derived rate, even for an administrator.
         { serviceId: costServiceId, quantity: 500, amount: 25000, rate: 999, rateReason: "must be ignored" },
         { serviceId: p1a, quantity: 1, rate: 10, remarks: "unchanged income line" },
       ],
     }), 201);
     const costParent = object(costCreated.parent, "cost parent");
     const costParentId = id(costParent, "cost parent"); ids.parents.push(costParentId);
     const costItems = array(costCreated.items, "cost parent items").map((item) => object(item, "cost parent item"));
     ids.entries.push(...costItems.map((item) => id(item, "cost parent item")));
     const costChild = costItems.find((item) => item.serviceId === costServiceId)!;
     const costIncomeChild = costItems.find((item) => item.serviceId === p1a)!;
     const originalCostChildId = id(costChild, "created cost child");
     const originalIncomeChildId = id(costIncomeChild, "created income child");
     check("cost 500/25000 derives rate 50", costChild.quantity === 500 && costChild.amount === 25000 && costChild.rate === 50);
     const reloadedCost = await status("reload cost parent after create", await request("GET", `/mis/entries/parents/${costParentId}`, editorSid), 200);
     check("reloaded cost keeps stored amount and rate", array(reloadedCost.items, "reloaded cost items").some((item) => item.id === originalCostChildId && item.amount === 25000 && item.rate === 50));

     const costAmountEdited = await status("cost edit derives rate from changed amount", await request("PATCH", `/mis/entries/parents/${costParentId}`, editorSid, {
       fromDate: "2026-04-02", toDate: "2026-04-02",
       lines: [
         { id: originalCostChildId, serviceId: costServiceId, quantity: 500, amount: 30000, rate: 1 },
         { id: originalIncomeChildId, serviceId: p1a, quantity: 1, rate: 10 },
       ],
     }), 200);
     const costAmountEditedItems = array(costAmountEdited.items, "cost amount edit items").map((item) => object(item, "cost amount edit item"));
     const editedCostChild = costAmountEditedItems.find((item) => item.id === originalCostChildId)!;
     check("cost 500/30000 derives rate 60 without rate permission", editedCostChild.amount === 30000 && editedCostChild.quantity === 500 && editedCostChild.rate === 60);
     check("cost edit preserves stable child identity", id(editedCostChild, "edited cost child") === originalCostChildId);
     const unchangedIncomeAfterAmount = costAmountEditedItems.find((item) => item.id === originalIncomeChildId)!;
     check("unrelated income record remains unchanged", unchangedIncomeAfterAmount.amount === costIncomeChild.amount && unchangedIncomeAfterAmount.rate === costIncomeChild.rate);

     const costQuantityEdited = await status("cost edit derives rate from changed quantity", await request("PATCH", `/mis/entries/parents/${costParentId}`, editorSid, {
       fromDate: "2026-04-02", toDate: "2026-04-02",
       lines: [
         { id: originalCostChildId, serviceId: costServiceId, quantity: 600, amount: 30000 },
         { id: originalIncomeChildId, serviceId: p1a, quantity: 1, rate: 10 },
       ],
     }), 200);
     const costQuantityEditedItems = array(costQuantityEdited.items, "cost quantity edit items").map((item) => object(item, "cost quantity edit item"));
     const quantityEditedCost = costQuantityEditedItems.find((item) => item.id === originalCostChildId)!;
     check("cost 600/30000 derives rate 50", quantityEditedCost.quantity === 600 && quantityEditedCost.amount === 30000 && quantityEditedCost.rate === 50);
     const reloadedQuantityEdit = await status("reload cost parent after quantity edit", await request("GET", `/mis/entries/parents/${costParentId}`, editorSid), 200);
     check("reload keeps edited cost values", array(reloadedQuantityEdit.items, "reloaded quantity edit items").some((item) => item.id === originalCostChildId && item.quantity === 600 && item.amount === 30000 && item.rate === 50));

     const repeatingFractionEdit = await status("cost repeating fraction preserves amount", await request("PATCH", `/mis/entries/parents/${costParentId}`, editorSid, {
       fromDate: "2026-04-02", toDate: "2026-04-02",
       lines: [
         { id: originalCostChildId, serviceId: costServiceId, quantity: 3, amount: 100 },
         { id: originalIncomeChildId, serviceId: p1a, quantity: 1, rate: 10 },
       ],
     }), 200);
     const repeatingFractionCost = array(repeatingFractionEdit.items, "repeating fraction items")
       .map((item) => object(item, "repeating fraction item")).find((item) => item.id === originalCostChildId)!;
     check("repeating fraction keeps amount instead of qty times rounded rate", repeatingFractionCost.amount === 100 && repeatingFractionCost.rate === 33.333333);
     const costAudits = await db.select().from(misAuditLogTable).where(eq(misAuditLogTable.entryId, originalCostChildId));
     check("derived cost edits do not create rate override audits", costAudits.every((row) => !((row.newValues as Json | null)?.rateAudit)));

     const submittedCost = await status("submit cost parent", await request("POST", `/mis/entries/parents/${costParentId}/action`, editorSid, { action: "submit", remarks: "cost ready" }), 200);
     check("cost parent submit synchronizes status", submittedCost.parent.status === "submitted" && array(submittedCost.items, "submitted cost items").every((item) => item.status === "submitted"));
     await status("income rate permissions remain enforced", await request("POST", `/mis/entries/parents/${costParentId}/action`, editorSid, { action: "approve", remarks: "not an approver" }), 403);
     const approvedCost = await status("approve cost parent", await request("POST", `/mis/entries/parents/${costParentId}/action`, adminSid, { action: "approve", remarks: "cost approved" }), 200);
     check("cost approval remains unchanged", approvedCost.parent.status === "approved" && array(approvedCost.items, "approved cost items").every((item) => item.status === "approved"));
     await status("cost parent period guard remains enforced", await request("POST", "/mis/entries/bulk", editorSid, {
       projectId, fromDate: "2026-04-02", toDate: "2026-04-02", action: "draft",
       lines: [{ serviceId: costServiceId, quantity: 1, amount: 1 }],
     }), 409);

    const duplicateServiceParent = await createParent(editorSid, projectId, [p1a, p1a], "2026-01-20", "2026-01-21");
    const duplicateServiceId = id(duplicateServiceParent.parent, "duplicate-service parent");
    const duplicateServiceItems = array(duplicateServiceParent.items, "duplicate-service children");
    const duplicateServiceEdit = await status("edit duplicate-service lines by child ID", await request("PATCH", `/mis/entries/parents/${duplicateServiceId}`, editorSid, {
      fromDate: "2026-01-20", toDate: "2026-01-21",
      lines: duplicateServiceItems.map((item, index) => line(item.serviceId, index + 2, item.rate, item.id)),
    }), 200);
    check("duplicate service child identities remain distinct", new Set(array(duplicateServiceEdit.items, "duplicate-service edited children").map((item) => item.id)).size === 2);
    const submitted = await status("submit parent", await request("POST", `/mis/entries/parents/${firstId}/action`, editorSid, { action: "submit", remarks: "ready" }), 200);
    check("parent submit synchronizes children", submitted.parent.status === "submitted" && array(submitted.items, "submitted children").every((item) => item.status === "submitted"));
    const submittedLines = array((await body(await request("GET", `/mis/entries/parents/${firstId}`, editorSid))).items, "submitted detail items");
    const submittedEdit = await status("edit submitted parent", await request("PATCH", `/mis/entries/parents/${firstId}`, editorSid, {
      fromDate: "2026-01-10", toDate: "2026-01-15",
      lines: submittedLines.map((item) => line(item.serviceId, item.serviceId === p1a ? 3 : 4, item.rate, item.id)),
    }), 200);
    check("submitted edit preserves submitted status", submittedEdit.parent.status === "submitted");
    check("child IDs remain stable when lines include IDs", array(submittedEdit.items, "submitted edit items").every((item) => submittedLines.some((old) => old.id === item.id)));
    const returned = await status("return submitted parent", await request("POST", `/mis/entries/parents/${firstId}/action`, adminSid, { action: "return", remarks: "needs changes" }), 200);
    check("return is a real returned status", returned.parent.status === "returned");
    const returnedItems = array(returned.items, "returned children");
    await status("edit-only actor cannot reset returned parent", await request("POST", `/mis/entries/parents/${firstId}/action`, editorSid, {
      action: "reset", remarks: "edit-only reset attempt",
    }), 403);
    await status("edit-only actor cannot bypass reset with parent patch", await request("PATCH", `/mis/entries/parents/${firstId}`, editorSid, {
      fromDate: "2026-01-10", toDate: "2026-01-15", action: "draft",
      lines: returnedItems.map((item) => line(item.serviceId, item.quantity, item.rate, item.id)),
    }), 403);
    const unchangedAfterResetBypass = await status("reset denial leaves returned parent unchanged", await request("GET", `/mis/entries/parents/${firstId}`, editorSid), 200);
    check("denied reset and patch leave parent and children returned", unchangedAfterResetBypass.parent.status === "returned"
      && array(unchangedAfterResetBypass.items, "unchanged returned children").every((item) => item.status === "returned"));
    const reset = await status("reset actor can set returned parent to draft", await request("POST", `/mis/entries/parents/${firstId}/action`, adminSid, {
      action: "reset", remarks: "reset for corrections",
    }), 200);
    check("reset synchronizes every child to draft", reset.parent.status === "draft"
      && array(reset.items, "reset children").every((item) => item.status === "draft" && item.updatedById === admin.id));
    const resetAudits = await db.select().from(misAuditLogTable).where(and(
      eq(misAuditLogTable.entityType, "parent"),
      eq(misAuditLogTable.entityId, firstId),
      eq(misAuditLogTable.action, "RESET"),
    ));
    check("reset audit records the reset actor", resetAudits.some((audit) => audit.actorId === admin.id && audit.remarks === "reset for corrections"));
    const returnedEdit = await status("edit returned parent", await request("PATCH", `/mis/entries/parents/${firstId}`, editorSid, {
      fromDate: "2026-01-10", toDate: "2026-01-15", lines: [line(p1a, 5), line(p1b, 6)],
    }), 200);
    check("draft edit after reset preserves draft status", returnedEdit.parent.status === "draft");
    await status("resubmit reset parent", await request("POST", `/mis/entries/parents/${firstId}/action`, editorSid, { action: "submit", remarks: "fixed" }), 200);
    await status("approve parent", await request("POST", `/mis/entries/parents/${firstId}/action`, adminSid, { action: "approve", remarks: "approved" }), 200);
    const childId = id((await body(await request("GET", `/mis/entries/parents/${firstId}`, editorSid))).items[0], "parent child");
    await status("child patch is rejected atomically", await request("PATCH", `/mis/entries/${childId}`, editorSid, entryBody(projectId, tabId, p1a, "2026-01-10")), 409);
    await status("child workflow action is rejected atomically", await request("POST", `/mis/entries/${childId}/action`, editorSid, { action: "reset", remarks: "child" }), 409);
    const hiddenChild = await status("child rejection without view permission is generic", await request("PATCH", `/mis/entries/${childId}`, noAccessSid, entryBody(projectId, tabId, p1a, "2026-01-10")), 403);
    check("unauthorized child rejection omits parent metadata", hiddenChild.parentId === undefined && hiddenChild.openUrl === undefined);
    await status("approved reset still requires approved-edit permission", await request("POST", `/mis/entries/parents/${firstId}/action`, editorSid, {
      action: "reset", remarks: "approved reset without edit-approved",
    }), 403);
    await status("approved edit denied without edit_approved", await request("PATCH", `/mis/entries/parents/${firstId}`, editorSid, {
      fromDate: "2026-01-10", toDate: "2026-01-15", reason: "not allowed", lines: [line(p1a, 7), line(p1b, 8)],
    }), 403);
    const approvedEdit = await status("approved edit authorized with reason", await request("PATCH", `/mis/entries/parents/${firstId}`, adminSid, {
      fromDate: "2026-01-10", toDate: "2026-01-15", reason: "corrected approved quantities", lines: [line(p1a, 9), line(p1b, 10)],
    }), 200);
    check("approved override remains approved", approvedEdit.parent.status === "approved");
    const approvedItems = array(approvedEdit.items, "approved edit items");
    const p1aChild = approvedItems.find((item) => item.serviceId === p1a);
    const p1bChild = approvedItems.find((item) => item.serviceId === p1b);
    check("approved edit returns stable child IDs", Boolean(p1aChild?.id && p1bChild?.id));
    await status("deactivate historical service", await request("PATCH", `/mis/services/${p1b}`, adminSid, {
      tabId, name: `${prefix} Service ${projectId.slice(-4)} B`, description: "parent acceptance",
      unit: "unit", defaultRate: 10, active: false, sequence: 2, effectiveFrom: "2026-01-01", effectiveTo: "2026-12-31",
    }), 200);
    await status("disable historical project assignment", await request("PUT", `/mis/projects/${projectId}/tabs`, adminSid, { assignments: [] }), 200);
    const historicalEdit = await status("edit preserves inactive historical line", await request("PATCH", `/mis/entries/parents/${firstId}`, adminSid, {
      fromDate: "2026-01-10", toDate: "2026-01-15", reason: "rate correction with inactive line",
      lines: [
        line(p1a, 9, 77, p1aChild?.id, "approved rate correction"),
        line(p1b, 10, 10, p1bChild?.id),
      ],
    }), 200);
    check("inactive historical child remains in parent", array(historicalEdit.items, "historical edit items").some((item) => item.id === p1bChild?.id));
    const rateAuditRows = await db.select().from(misAuditLogTable).where(eq(misAuditLogTable.entryId, p1aChild?.id ?? ""));
    check("changed child rate audit retains original/new/reason", rateAuditRows.some((row) => {
      const audit = row.newValues as Json | null;
      return Number(audit?.rateAudit?.originalRate) === 10 && Number(audit?.rateAudit?.newRate) === 77 && audit?.rateAudit?.reason === "approved rate correction";
    }));
    await status("restore project assignment after historical edit", await request("PUT", `/mis/projects/${projectId}/tabs`, adminSid, {
      assignments: [{ tabId, enabled: true, sequence: 1 }],
    }), 200);
    const history = await status("parent history", await request("GET", `/mis/entries/parents/${firstId}/history`, editorSid), 200);
    const historyItems = array(history, "parent history items");
    check("approved edit reason is audited", historyItems.some((item) => item.action === "EDIT_APPROVED" && item.remarks === "corrected approved quantities"));
    const standalone = await status("create legacy standalone entry", await request("POST", "/mis/entries", adminSid, entryBody(secondProjectId, tabId, p2a, "2026-06-10")), 201);
    const standaloneId = id(standalone, "legacy standalone"); ids.entries.push(standaloneId);
    check("legacy standalone remains parentless", standalone.parentId === null && standalone.bulkNumber === null);
    await status("parent conflicts with standalone period", await request("POST", "/mis/entries/bulk", adminSid, parentBody(secondProjectId, "2026-06-10", "2026-06-10", [p2a])), 409);
    const standaloneList = await status("legacy list still returns standalone", await request("GET", `/mis/entries?projectIds=${secondProjectId}&from=2026-06-10&to=2026-06-10&page=1&pageSize=20`, adminSid), 200);
    check("legacy list keeps parentId null", array(standaloneList.items, "legacy list").some((item) => item.id === standaloneId && item.parentId === null));
    const backToBack = await createParent(adminSid, secondProjectId, [p2a], "2026-06-11", "2026-06-12");
    check("back-to-back period is allowed", id(backToBack.parent, "back-to-back parent") !== "");
    const creatorPage = await status("scoped editor can list parent creators", await request("GET", "/mis/entries/creators?page=1&pageSize=100", editorSid), 200);
    const creators = array(creatorPage.items, "parent creator options");
    check("editor sees the creator of a permitted parent", creators.some((creator) => creator.id === editor.id));
    check("editor creator options exclude an unrelated project author", !creators.some((creator) => creator.id === admin.id));
    const filteredParents = await status("parent list accepts creator option ID", await request("GET", `/mis/entries/parents?createdById=${encodeURIComponent(editor.id)}`, editorSid), 200);
    check("creator option ID filters permitted parents", array(filteredParents.items, "creator-filtered parents").every((parent) => parent.createdById === editor.id));
    const exact = await createParent(adminSid, secondProjectId, [p2a], "2026-01-01", "2026-01-03");
    await status("exact overlap rejected", await request("POST", "/mis/entries/bulk", adminSid, parentBody(secondProjectId, "2026-01-01", "2026-01-03", [p2a])), 409);
    const partial = await createParent(adminSid, secondProjectId, [p2a], "2026-02-01", "2026-02-05");
    void exact; void partial;
    await status("partial inclusive overlap rejected", await request("POST", "/mis/entries/bulk", adminSid, parentBody(secondProjectId, "2026-02-05", "2026-02-10", [p2a])), 409);
    await createParent(adminSid, secondProjectId, [p2a], "2026-03-10", "2026-03-20");
    await status("enclosing overlap rejected", await request("POST", "/mis/entries/bulk", adminSid, parentBody(secondProjectId, "2026-03-01", "2026-03-30", [p2a])), 409);
    const concurrent = await Promise.all([
      request("POST", "/mis/entries/bulk", adminSid, parentBody(secondProjectId, "2026-05-01", "2026-05-05", [p2a])),
      request("POST", "/mis/entries/bulk", adminSid, parentBody(secondProjectId, "2026-05-01", "2026-05-05", [p2a])),
    ]);
    check("concurrent overlapping creates have one winner", concurrent.filter((response) => response.status === 201).length === 1);
    check("concurrent overlapping creates have one conflict", concurrent.filter((response) => response.status === 409).length === 1);
    for (const response of concurrent) if (response.status === 201) {
      const value = await body(response); ids.parents.push(id(value.parent, "concurrent parent")); ids.entries.push(...array(value.items, "concurrent children").map((item) => id(item, "concurrent child")));
    }
    const updatePolicy = async (allowMultipleEntries: boolean, overlapPolicy: string, maxEntriesPerPeriod: number | null = null) => {
      await status(`update period policy ${overlapPolicy}`, await request("PATCH", `/mis/projects/${secondProjectId}`, adminSid, {
        ...projectBody(`${prefix}B`, allowMultipleEntries, overlapPolicy, maxEntriesPerPeriod), managerId: null,
      }), 200);
    };
    await updatePolicy(true, "nonoverlap");
    await createParent(adminSid, secondProjectId, [p2a], "2026-08-01", "2026-08-10");
    await status("allowMultiple nonoverlap rejects overlap", await request("POST", "/mis/entries/bulk", adminSid, parentBody(secondProjectId, "2026-08-05", "2026-08-15", [p2a])), 409);
    await updatePolicy(true, "overlap");
    await createParent(adminSid, secondProjectId, [p2a], "2026-09-01", "2026-09-10");
    await status("overlap policy permits overlap", await request("POST", "/mis/entries/bulk", adminSid, parentBody(secondProjectId, "2026-09-05", "2026-09-15", [p2a])), 201);
    await updatePolicy(true, "unlimited");
    await createParent(adminSid, secondProjectId, [p2a], "2026-10-01", "2026-10-10");
    await status("unlimited policy permits overlap", await request("POST", "/mis/entries/bulk", adminSid, parentBody(secondProjectId, "2026-10-02", "2026-10-09", [p2a])), 201);
    await updatePolicy(true, "overlap", 2);
    await createParent(adminSid, secondProjectId, [p2a], "2026-11-01", "2026-11-10");
    await createParent(adminSid, secondProjectId, [p2a], "2026-11-02", "2026-11-09");
    await status("maximum entries per period enforced", await request("POST", "/mis/entries/bulk", adminSid, parentBody(secondProjectId, "2026-11-03", "2026-11-08", [p2a])), 409);
    const editorSubmitted = await createParent(editorSid, projectId, [p1a], "2026-12-01", "2026-12-02", "submit");
    const editorSubmittedId = id(editorSubmitted.parent, "editor submitted parent");
    await status("scoped editor cannot approve", await request("POST", `/mis/entries/parents/${editorSubmittedId}/action`, editorSid, { action: "approve", remarks: "denied" }), 403);
    await status("scoped editor rate override denied", await request("POST", "/mis/entries/bulk", editorSid, {
      ...parentBody(projectId, "2026-12-01", "2026-12-02", [p1a]), lines: [line(p1a, 1, 999)],
    }), 403);
    check("at least forty parent acceptance cases executed", cases >= 40);
  } finally {
    await cleanup();
    await stop();
  }
}
main().then(() => {
  process.stdout.write(`MIS parent acceptance passed (${cases} cases)\n`);
}).catch((error: unknown) => {
  process.stderr.write(`MIS parent acceptance failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});