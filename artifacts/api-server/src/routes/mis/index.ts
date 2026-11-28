import { Router, type IRouter, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, ilike, inArray, isNull, lte, gte, or, sql } from "drizzle-orm";
import {
  MisActOnEntryBody, MisActOnEntryParentBody, MisCreateAuthorityBody, MisCreateBulkEntriesBody, MisCreateEntryBody, MisCreateProjectBody,
  MisCreateProjectServiceBody, MisCreateTabBody, MisExportReportQueryParams,
  MisDeleteEntryParentParams, MisExportDashboardQueryParams, MisGetDashboardQueryParams, MisGetEntryHistoryParams, MisGetEntryParentHistoryParams, MisGetEntryParentParams, MisGetEntryParams, MisGetProjectParams,
  MisGetReportQueryParams, MisListAuthoritiesQueryParams, MisListEntriesQueryParams,
  MisListEntryParentsQueryParams, MisUpdateEntryParentBody, MisUpdateEntryParentParams,
  MisListProjectServicesParams, MisListProjectServicesQueryParams, MisListProjectTabsParams,
  MisListProjectsQueryParams, MisListTabsQueryParams, MisListUsersQueryParams,
  MisListEntryCreatorsQueryParams,
  MisReplaceProjectTabsBody, MisReplaceProjectTabsParams, MisUpdateAuthorityBody,
  MisUpdateAuthorityParams, MisUpdateEntryBody, MisUpdateEntryParams, MisUpdateProjectBody,
  MisUpdateProjectParams, MisUpdateServiceBody, MisUpdateServiceParams, MisUpdateTabBody,
  MisUpdateTabParams, MisReorderProjectServicesBody, MisReorderProjectServicesParams,
} from "@workspace/api-zod";
import {
  db, misAuthoritiesTable, misAuditLogTable, misEntriesTable, misEntryParentsTable, misProjectsTable,
  misProjectTabsTable, misServicesTable, misTabsTable, usersTable,
} from "@workspace/db";
import { requireAuth } from "../../middlewares/requireAuth";
import { auditMis, dateString, displayName, divideDecimal, finiteNonNegative, multiplyDecimal, strictDate, userMap, userPicker } from "../../lib/mis/helpers";
import { can, canAccessProject, isGlobalMisAdmin, loadMisAccess, permissionsForProject, type MisAccess, type MisPermission } from "../../lib/mis/access";
import { reportPdf as professionalReportPdf } from "../../lib/mis/exports/pdf";
import { reportXlsx } from "../../lib/mis/exports/xlsx";
import type { PresentationMetadata } from "../../lib/mis/exports/model";
import percentageServicesRouter from "./percentage-services";
import { dashboardPdf, dashboardXlsx, type DashboardExportContext } from "../../lib/mis/exports/dashboard";
import { adjustedDashboardProfit, dashboardPercentageAdjustments } from "../../lib/mis/percentage-charges";

const router: IRouter = Router();
router.use(percentageServicesRouter);
const id = (req: Request) => Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
const forbidden = (res: Response, message = "MIS permission required") => { res.status(403).json({ error: message }); };
const invalid = (res: Response, message = "Invalid request") => { res.status(400).json({ error: message }); };
const notFound = (res: Response, message = "MIS record not found") => { res.status(404).json({ error: message }); };
const conflict = (res: Response, message: string) => { res.status(409).json({ error: message }); };

async function access(req: Request, res: Response): Promise<MisAccess | null> {
  const result = await loadMisAccess(req.user!.id);
  if (!result.roles.length) { forbidden(res, "No MIS access grant"); return null; }
  return result;
}
function rawDateBody(body: unknown, key: string): string | null {
  return body && typeof body === "object" ? strictDate((body as Record<string, unknown>)[key]) : null;
}
function parsedQuery<T>(schema: { safeParse: (value: unknown) => { success: boolean; data?: T } }, req: Request): T | null {
  const q: Record<string, unknown> = { ...req.query };
  for (const field of ["from", "to", "startFrom", "startTo", "compareFrom", "compareTo", "fromDate", "toDate"]) {
    if (q[field] != null) {
      const strict = strictDate(q[field]);
      if (!strict) return null;
      q[field] = new Date(`${strict}T00:00:00.000Z`);
    }
  }
  const result = schema.safeParse(q);
  if (!result.success) return null;
  const parsed = result.data as T & { startFrom?: Date; startTo?: Date };
  if (parsed.startFrom && parsed.startTo && parsed.startFrom > parsed.startTo) return null;
  return result.data!;
}
const ENTRY_STATUS_VALUES = ["draft", "submitted", "approved", "rejected", "returned", "cancelled"] as const;
type EntryStatusValue = (typeof ENTRY_STATUS_VALUES)[number];
function statusSubset(value: unknown): EntryStatusValue[] | null {
  if (value == null) return null;
  const values = String(value).split(",").map((item) => item.trim()).filter(Boolean);
  if (!values.length) return null;
  const unique = new Set(values);
  if (unique.size !== values.length || values.some((item) => !(ENTRY_STATUS_VALUES as readonly string[]).includes(item))) return null;
  return values as EntryStatusValue[];
}
function pagination(page: number, pageSize: number) { return { offset: (page - 1) * pageSize, limit: pageSize }; }
function dateValue(value: Date | null): string | null { return value ? dateString(value) : null; }
function numeric(value: unknown): number { return Number(value); }
function decimalAmount(value: number): string {
  if (!finiteNonNegative(value)) throw new Error("Amount must be a finite non-negative number");
  return multiplyDecimal(value, 1);
}

function serializeEntry(entry: typeof misEntriesTable.$inferSelect, users: Map<string, { id: string; email: string | null; firstName: string | null; lastName: string | null }>, bulkNumber: string | null = null) {
  const created = users.get(entry.createdById);
  const updated = entry.updatedById ? users.get(entry.updatedById) : undefined;
  const calculationMode = (entry.calculationMode || "quantity_rate") as "quantity_rate" | "amount";
  return {
    id: entry.id, parentId: entry.parentId, bulkNumber, projectId: entry.projectId, tabId: entry.tabId, serviceId: entry.serviceId,
    fromDate: entry.fromDate, toDate: entry.toDate, quantity: calculationMode === "amount" ? null : numeric(entry.quantity),
    rate: calculationMode === "amount" ? null : numeric(entry.rate), amount: numeric(entry.amount),
    calculationMode,
    rateEnabled: entry.rateEnabled,
    calculatePercentAgainstIncome: entry.calculatePercentAgainstIncome,
    remarks: entry.remarks, projectName: entry.projectName, tabName: entry.tabName, serviceName: entry.serviceName,
    type: entry.type as "income" | "cost" | "expense" | "salary" | "other", financialClass: entry.financialClass as "income" | "cost" | "expense" | "salary" | "excluded",
     unit: entry.unit, currency: entry.currency, status: entry.status as "draft" | "submitted" | "approved" | "rejected" | "returned" | "cancelled",
    createdById: entry.createdById, createdByName: created ? displayName(created) : null,
    updatedById: entry.updatedById, updatedByName: updated ? displayName(updated) : null, createdAt: entry.createdAt, updatedAt: entry.updatedAt,
  };
}
async function entryResponse(entry: typeof misEntriesTable.$inferSelect) {
  const [users, parent] = await Promise.all([
    userMap([entry.createdById, entry.updatedById]),
    entry.parentId ? db.select({ bulkNumber: misEntryParentsTable.bulkNumber }).from(misEntryParentsTable).where(eq(misEntryParentsTable.id, entry.parentId)).then((rows) => rows[0]) : Promise.resolve(undefined),
  ]);
  return serializeEntry(entry, users, parent?.bulkNumber ?? null);
}
async function projectById(projectId: string) {
  const [project] = await db.select().from(misProjectsTable).where(eq(misProjectsTable.id, projectId));
  return project;
}
function projectResult(project: typeof misProjectsTable.$inferSelect, permission: Set<string>, manager?: { id: string; email: string | null; firstName: string | null; lastName: string | null }) {
  return {
    id: project.id, name: project.name, code: project.code, managerId: project.managerId, manager: manager ? userPicker(manager) : null,
    status: project.status as "active" | "inactive", startDate: project.startDate, endDate: project.endDate, currency: project.currency,
     reportingSettings: {
       defaultEntryStatus: project.defaultEntryStatus as "draft" | "submitted" | "approved" | "rejected" | "returned" | "cancelled",
       preventDuplicatePeriods: project.preventDuplicatePeriods,
       allowMultipleEntries: project.allowMultipleMisEntries,
       overlapPolicy: project.overlapPolicy as "nonoverlap" | "overlap" | "unlimited",
       maxEntriesPerPeriod: project.maxEntriesPerPeriod,
     },
    effectivePermissions: [...permission], createdAt: project.createdAt, updatedAt: project.updatedAt,
  };
}
function serializeParent(parent: typeof misEntryParentsTable.$inferSelect, childCount: number, creator?: { id: string; email: string | null; firstName: string | null; lastName: string | null }) {
  return {
    id: parent.id, bulkNumber: parent.bulkNumber, projectId: parent.projectId,
    projectName: parent.projectName, projectNumber: parent.projectCode,
    fromDate: parent.fromDate, toDate: parent.toDate,
    status: parent.status as "draft" | "submitted" | "approved" | "rejected" | "returned" | "cancelled",
    entryType: "bulk" as const, createdById: parent.createdById,
    createdByName: creator ? displayName(creator) : null, childCount,
    createdAt: parent.createdAt, updatedAt: parent.updatedAt,
  };
}
async function assertProject(accessValue: MisAccess, projectId: string, res: Response) {
  const project = await projectById(projectId);
  if (!project) { notFound(res, "MIS project not found"); return null; }
  if (!canAccessProject(accessValue, projectId) || !can(accessValue, "view_project", projectId)) { forbidden(res, "No project-view permission for this MIS project"); return null; }
  return project;
}
async function permittedProjectIds(accessValue: MisAccess, permissions: ("entries" | "view_entries" | "reports" | "financial" | "export")[]): Promise<string[] | undefined> {
  if (permissions.every((permission) => can(accessValue, permission))) return undefined;
  const candidates = accessValue.globalAccess
    ? (await db.select({ id: misProjectsTable.id }).from(misProjectsTable)).map((row) => row.id)
    : accessValue.projectIds;
  return candidates.filter((projectId) => permissions.every((permission) => can(accessValue, permission, projectId)));
}
type EntryInputData = {
  projectId: string;
  tabId: string;
  serviceId: string;
  fromDate: string;
  toDate: string;
  quantity?: number | null;
  rate?: number | null;
  amount?: number | null;
  calculationMode?: CalculationMode;
  remarks: string | null;
  rateReason?: string | null;
};

async function configuredEntryData(
  data: EntryInputData,
  accessValue: MisAccess,
  res: Response,
  savedDraftRate?: number,
  requiredPermission: MisPermission = "create_entries",
  savedCalculationMode?: CalculationMode,
  bulkCostAmountQuantity = false,
) {
  if (!can(accessValue, requiredPermission, data.projectId)) { forbidden(res, `${requiredPermission.replaceAll("_", " ")} permission required`); return null; }
  const [project, tab, service, assignment] = await Promise.all([
    projectById(data.projectId),
    db.select().from(misTabsTable).where(eq(misTabsTable.id, data.tabId)).then((rows) => rows[0]),
    db.select().from(misServicesTable).where(eq(misServicesTable.id, data.serviceId)).then((rows) => rows[0]),
    db.select().from(misProjectTabsTable).where(and(eq(misProjectTabsTable.projectId, data.projectId), eq(misProjectTabsTable.tabId, data.tabId))).then((rows) => rows[0]),
  ]);
  if (!project || !canAccessProject(accessValue, data.projectId)) { forbidden(res, "No access to this MIS project"); return null; }
  if (project.status !== "active") { invalid(res, "Entries cannot be created for an inactive project"); return null; }
  if (!tab || !tab.active || !tab.allowEntry || !assignment?.enabled) { invalid(res, "Tab is not enabled for entries on this project"); return null; }
  if (!service || service.projectId !== project.id || service.tabId !== tab.id || !service.active) { invalid(res, "Service is not active for this project tab"); return null; }
  if ((service.effectiveFrom && data.fromDate < service.effectiveFrom) || (service.effectiveTo && data.toDate > service.effectiveTo)) { invalid(res, "Entry period is outside the service effective dates"); return null; }
  if ((project.startDate && data.fromDate < project.startDate) || (project.endDate && data.toDate > project.endDate)) { invalid(res, "Entry period is outside the project dates"); return null; }
  const flags = effectiveCalculationFlags(tab, assignment);
  // Cost amount + quantity is intentionally a bulk-parent-only behavior. The
  // standalone entry route continues through the existing configured-rate
  // path, while bulk cost lines preserve their submitted amount and derive
  // the stored rate from it.
  const costAmountQuantity = bulkCostAmountQuantity && tab.type === "cost" && data.amount != null;
  if (costAmountQuantity) {
    if (data.quantity == null) { invalid(res, "Cost bulk lines require both quantity and amount"); return null; }
    const enteredAmount = data.amount;
    if (enteredAmount == null) { invalid(res, "Cost bulk lines require both quantity and amount"); return null; }
    let amount: string;
    let rate: string;
    try {
      amount = decimalAmount(enteredAmount);
      rate = divideDecimal(amount, data.quantity);
    } catch (error) {
      invalid(res, error instanceof Error ? error.message : "Invalid cost amount/quantity"); return null;
    }
    return {
      project, tab, service, assignment, flags, calculationMode: "quantity_rate" as const,
      quantity: data.quantity, rate: Number(rate), amount, costAmountQuantity: true,
    };
  }
  if (bulkCostAmountQuantity && tab.type === "cost" && data.amount == null && data.quantity == null) {
    // Preserve the existing blank-line handling and let the caller decide
    // whether this line should be skipped before configuration.
    return null;
  }
  const requestedMode = data.calculationMode;
  let calculationMode = savedCalculationMode ?? requestedMode ?? flags.calculationMode;
  if (!savedCalculationMode && requestedMode && requestedMode !== flags.calculationMode) {
    invalid(res, `New entries for ${tab.name} must use ${flags.calculationMode} mode`); return null;
  }
  if (savedCalculationMode && requestedMode && requestedMode !== savedCalculationMode) {
    // A legacy Salary/Expense row may intentionally transition to direct
    // amount mode. Other mode changes would silently rewrite its historical
    // calculation and are not accepted.
    const allowedTransition = requestedMode === "amount"
      && savedCalculationMode === "quantity_rate"
      && (tab.type === "expense" || tab.type === "salary");
    if (!allowedTransition) {
      invalid(res, "Calculation mode is an immutable entry snapshot"); return null;
    }
    calculationMode = requestedMode;
  }
  const defaultRate = numeric(service.defaultRate);
  let quantity: number;
  let rate: number;
  let amount: string;
  if (calculationMode === "amount") {
    if (data.amount == null) { invalid(res, "An actual amount is required for amount-mode entries"); return null; }
    quantity = 1;
    rate = 1;
    try { amount = decimalAmount(data.amount); } catch (error) {
      invalid(res, error instanceof Error ? error.message : "Invalid amount"); return null;
    }
  } else {
    if (data.quantity == null) { invalid(res, "Quantity is required for quantity-rate entries"); return null; }
    quantity = data.quantity;
    rate = data.rate == null ? (savedDraftRate ?? defaultRate) : data.rate;
    try { amount = multiplyDecimal(quantity, rate); } catch (error) {
      invalid(res, error instanceof Error ? error.message : "Invalid quantity/rate"); return null;
    }
  }
  // Draft edits may retain a historically saved rate after a service default
  // changes. Changing away from both the current default and saved rate is an
  // override and requires the dedicated permission.
  const isOverride = calculationMode === "quantity_rate" && rate !== defaultRate && rate !== savedDraftRate;
  if (isOverride && !can(accessValue, "rate_override", project.id)) { forbidden(res, "Rate override permission required"); return null; }
  if (isOverride && !data.rateReason?.trim()) { invalid(res, "A reason is required when overriding the service rate"); return null; }
  return { project, tab, service, assignment, flags, calculationMode, quantity, rate, amount, costAmountQuantity: false };
}

router.get("/mis/me", requireAuth, async (req, res): Promise<void> => {
  const value = await loadMisAccess(req.user!.id);
  res.json({
    hasAccess: value.roles.length > 0, roles: value.roles, permissions: [...value.globalPermissions],
    projectIds: value.projectIds, globalAccess: value.globalAccess,
    projectPermissions: [...value.projectPermissions.entries()].map(([projectId, permissions]) => ({ projectId, permissions: [...permissions] })),
  });
});

router.get("/mis/users", requireAuth, async (req, res): Promise<void> => {
  const value = await access(req, res); if (!value) return;
  if (!isGlobalMisAdmin(value)) { forbidden(res, "Global MIS administrator required"); return; }
  const q = parsedQuery(MisListUsersQueryParams, req); if (!q) { invalid(res); return; }
  const where = q.search ? ilike(usersTable.email, `%${q.search}%`) : undefined;
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(usersTable).where(where);
  const rows = await db.select().from(usersTable).where(where).orderBy(asc(usersTable.email)).limit(q.pageSize).offset(pagination(q.page, q.pageSize).offset);
  res.json({ items: rows.map(userPicker), total: count, page: q.page, pageSize: q.pageSize });
});

router.get("/mis/authorities", requireAuth, async (req, res): Promise<void> => {
  const value = await access(req, res); if (!value) return;
  const q = parsedQuery(MisListAuthoritiesQueryParams, req); if (!q) { invalid(res); return; }
  if (q.projectId ? (!canAccessProject(value, q.projectId) || !can(value, "authorities", q.projectId)) : !isGlobalMisAdmin(value)) {
    forbidden(res, q.projectId ? "Project authority permission required" : "Global MIS administrator required"); return;
  }
  const rows = await db.select({ authority: misAuthoritiesTable, user: usersTable, project: misProjectsTable })
    .from(misAuthoritiesTable).innerJoin(usersTable, eq(usersTable.id, misAuthoritiesTable.userId))
    .leftJoin(misProjectsTable, eq(misProjectsTable.id, misAuthoritiesTable.projectId))
    .where(q.projectId ? eq(misAuthoritiesTable.projectId, q.projectId) : undefined).orderBy(desc(misAuthoritiesTable.createdAt));
  const filtered = q.search ? rows.filter((r) => `${r.user.email ?? ""} ${r.user.firstName ?? ""} ${r.user.lastName ?? ""}`.toLowerCase().includes(q.search!.toLowerCase())) : rows;
  const slice = filtered.slice(pagination(q.page, q.pageSize).offset, pagination(q.page, q.pageSize).offset + q.pageSize);
  res.json({ items: slice.map(({ authority, user, project }) => ({ id: authority.id, userId: authority.userId, projectId: authority.projectId, role: authority.role, extraPermissions: authority.extraPermissions, user: userPicker(user), projectName: project?.name ?? null, createdAt: authority.createdAt, updatedAt: authority.updatedAt })), total: filtered.length, page: q.page, pageSize: q.pageSize });
});

async function authorityInput(req: Request, res: Response, existingId?: string) {
  const parsed = (existingId ? MisUpdateAuthorityBody : MisCreateAuthorityBody).safeParse(req.body);
  if (!parsed.success) { invalid(res); return null; }
  const data = parsed.data;
  if (data.projectId && !(await projectById(data.projectId))) { invalid(res, "Referenced MIS project does not exist"); return null; }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, data.userId));
  if (!user) { invalid(res, "Referenced user does not exist"); return null; }
  return data;
}
router.post("/mis/authorities", requireAuth, async (req, res): Promise<void> => {
  const value = await access(req, res); if (!value) return;
  const data = await authorityInput(req, res); if (!data) return;
  if (data.projectId == null ? !isGlobalMisAdmin(value) : (!canAccessProject(value, data.projectId) || !can(value, "authorities", data.projectId))) {
    forbidden(res, data.projectId == null ? "Global MIS administrator required" : "Project authority permission required"); return;
  }
  if (data.userId === req.user!.id && data.role !== "mis_admin") { forbidden(res, "Administrators cannot change their own non-admin authority"); return; }
  try {
    const created = await db.transaction(async (tx) => {
      const [row] = await tx.insert(misAuthoritiesTable).values({ ...data, createdById: req.user!.id }).returning();
      await auditMis({ entityType: "authority", entityId: row.id, projectId: row.projectId, action: "CREATE", actorId: req.user!.id, newValues: data }, tx);
      return row;
    });
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, created.userId));
    const project = created.projectId ? await projectById(created.projectId) : undefined;
    res.status(201).json({ ...created, user: userPicker(user!), projectName: project?.name ?? null });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") { conflict(res, "An authority already exists for this user and scope"); return; }
    throw error;
  }
});
router.patch("/mis/authorities/:id", requireAuth, async (req, res): Promise<void> => {
  const value = await access(req, res); if (!value) return;
  const params = MisUpdateAuthorityParams.safeParse(req.params); if (!params.success) { invalid(res); return; }
  const data = await authorityInput(req, res, params.data.id); if (!data) return;
  const [before] = await db.select().from(misAuthoritiesTable).where(eq(misAuthoritiesTable.id, params.data.id));
  if (!before) { notFound(res, "Authority not found"); return; }
  if (before.projectId == null ? !isGlobalMisAdmin(value) : (!canAccessProject(value, before.projectId) || !can(value, "authorities", before.projectId))) {
    forbidden(res, before.projectId == null ? "Global MIS administrator required" : "Project authority permission required"); return;
  }
  if (data.projectId !== before.projectId && (data.projectId == null ? !isGlobalMisAdmin(value) : !can(value, "authorities", data.projectId))) {
    forbidden(res, "Authority scope cannot be broadened by a project administrator"); return;
  }
  if (before.userId === req.user!.id && (data.role !== "mis_admin" || data.projectId != null)) { forbidden(res, "Administrators cannot remove or demote their own global administration"); return; }
  let updated: typeof misAuthoritiesTable.$inferSelect;
  try {
    updated = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(90217531)`);
      if (before.projectId == null && before.role === "mis_admin" && (data.projectId !== null || data.role !== "mis_admin") && (await tx.select({ id: misAuthoritiesTable.id }).from(misAuthoritiesTable).where(and(eq(misAuthoritiesTable.role, "mis_admin"), isNull(misAuthoritiesTable.projectId)))).length <= 1) throw Object.assign(new Error("Cannot remove the final global MIS administrator"), { status: 409 });
      const [row] = await tx.update(misAuthoritiesTable).set({ ...data, updatedAt: new Date() }).where(eq(misAuthoritiesTable.id, before.id)).returning();
      await auditMis({ entityType: "authority", entityId: before.id, projectId: row.projectId, action: "UPDATE", actorId: req.user!.id, oldValues: before, newValues: data }, tx);
      return row;
    });
  } catch (error) { if ((error as { status?: number }).status === 409) { conflict(res, (error as Error).message); return; } if ((error as { code?: string }).code === "23505") { conflict(res, "An authority already exists for this user and scope"); return; } throw error; }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, updated.userId));
  const project = updated.projectId ? await projectById(updated.projectId) : undefined;
  res.json({ ...updated, user: userPicker(user!), projectName: project?.name ?? null });
});
router.delete("/mis/authorities/:id", requireAuth, async (req, res): Promise<void> => {
  const value = await access(req, res); if (!value) return;
  const authorityId = id(req); const [before] = await db.select().from(misAuthoritiesTable).where(eq(misAuthoritiesTable.id, authorityId));
  if (!before) { notFound(res, "Authority not found"); return; }
  if (before.projectId == null ? !isGlobalMisAdmin(value) : (!canAccessProject(value, before.projectId) || !can(value, "authorities", before.projectId))) {
    forbidden(res, before.projectId == null ? "Global MIS administrator required" : "Project authority permission required"); return;
  }
  // Report the policy constraint before the actor constraint: it makes the
  // final-admin safeguard explicit and matches the contract's conflict class.
  if (before.projectId == null && before.role === "mis_admin" && (await db.select({ id: misAuthoritiesTable.id }).from(misAuthoritiesTable).where(and(eq(misAuthoritiesTable.role, "mis_admin"), isNull(misAuthoritiesTable.projectId)))).length <= 1) { conflict(res, "Cannot remove the final global MIS administrator"); return; }
  if (before.userId === req.user!.id) { forbidden(res, "Administrators cannot revoke their own authority"); return; }
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(90217531)`);
      if (before.projectId == null && before.role === "mis_admin" && (await tx.select({ id: misAuthoritiesTable.id }).from(misAuthoritiesTable).where(and(eq(misAuthoritiesTable.role, "mis_admin"), isNull(misAuthoritiesTable.projectId)))).length <= 1) throw Object.assign(new Error("Cannot remove the final global MIS administrator"), { status: 409 });
      await tx.delete(misAuthoritiesTable).where(eq(misAuthoritiesTable.id, before.id));
      await auditMis({ entityType: "authority", entityId: before.id, projectId: before.projectId, action: "DELETE", actorId: req.user!.id, oldValues: before }, tx);
    });
   } catch (error) { if ((error as { status?: number }).status === 409) { conflict(res, (error as Error).message); return; } throw error; }
  res.json({ success: true });
});

router.get("/mis/projects", requireAuth, async (req, res): Promise<void> => {
  const value = await access(req, res); if (!value) return;
  const q = parsedQuery(MisListProjectsQueryParams, req); if (!q) { invalid(res); return; }
  const conditions = [q.status ? eq(misProjectsTable.status, q.status) : undefined, q.search ? or(ilike(misProjectsTable.name, `%${q.search}%`), ilike(misProjectsTable.code, `%${q.search}%`)) : undefined].filter(Boolean);
  const rows = await db.select().from(misProjectsTable).where(and(...conditions as [])).orderBy(asc(misProjectsTable.name));
  const visible = rows.filter((project) => canAccessProject(value, project.id) && can(value, "view_project", project.id));
  const managers = await userMap(visible.map((project) => project.managerId));
  const { offset } = pagination(q.page, q.pageSize);
  res.json({ items: visible.slice(offset, offset + q.pageSize).map((project) => projectResult(project, permissionsForProject(value, project.id), project.managerId ? managers.get(project.managerId) : undefined)), total: visible.length, page: q.page, pageSize: q.pageSize });
});
function validProjectBody(req: Request, res: Response, update = false) {
  const parsed = (update ? MisUpdateProjectBody : MisCreateProjectBody).safeParse(req.body);
  if (!parsed.success) { invalid(res); return null; }
  const startDate = rawDateBody(req.body, "startDate"), endDate = rawDateBody(req.body, "endDate");
  if ((req.body as Record<string, unknown>).startDate !== null && !startDate || (req.body as Record<string, unknown>).endDate !== null && !endDate) { invalid(res, "Dates must be real calendar dates"); return null; }
  if (startDate && endDate && startDate > endDate) { invalid(res, "Start date must be before end date"); return null; }
   const settings = parsed.data.reportingSettings;
   if (settings.maxEntriesPerPeriod != null && !settings.allowMultipleEntries) { invalid(res, "maxEntriesPerPeriod requires allowMultipleEntries"); return null; }
   if (!settings.allowMultipleEntries && settings.overlapPolicy && settings.overlapPolicy !== "nonoverlap") { invalid(res, "overlapPolicy requires allowMultipleEntries"); return null; }
   return {
     ...parsed.data,
     startDate, endDate, currency: parsed.data.currency.toUpperCase(),
     defaultEntryStatus: settings.defaultEntryStatus,
     preventDuplicatePeriods: settings.preventDuplicatePeriods,
     allowMultipleMisEntries: settings.allowMultipleEntries ?? false,
     overlapPolicy: settings.overlapPolicy ?? "nonoverlap",
     maxEntriesPerPeriod: settings.maxEntriesPerPeriod ?? null,
   };
}
router.post("/mis/projects", requireAuth, async (req, res): Promise<void> => {
  const value = await access(req, res); if (!value) return;
  if (!can(value, "projects")) { forbidden(res); return; }
  const data = validProjectBody(req, res); if (!data) return;
  if (data.managerId && !(await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, data.managerId)))[0]) { invalid(res, "Manager user does not exist"); return; }
  try {
    const created = await db.transaction(async (tx) => {
       const { reportingSettings: _reportingSettings, ...projectData } = data;
       const [project] = await tx.insert(misProjectsTable).values({ ...projectData, createdById: req.user!.id }).returning();
      await auditMis({ entityType: "project", entityId: project.id, projectId: project.id, action: "CREATE", actorId: req.user!.id, newValues: data }, tx);
      return project;
    });
    const managers = await userMap([created.managerId]);
    res.status(201).json(projectResult(created, permissionsForProject(value, created.id), created.managerId ? managers.get(created.managerId) : undefined));
  } catch (error) {
    if ((error as { code?: string }).code === "23505") { conflict(res, "MIS project code already exists"); return; }
    throw error;
  }
});
router.get("/mis/projects/:id", requireAuth, async (req, res): Promise<void> => {
  const value = await access(req, res); if (!value) return;
  const params = MisGetProjectParams.safeParse(req.params); if (!params.success) { invalid(res); return; }
  const project = await assertProject(value, params.data.id, res); if (!project) return;
  const managers = await userMap([project.managerId]);
  res.json(projectResult(project, permissionsForProject(value, project.id), project.managerId ? managers.get(project.managerId) : undefined));
});
router.patch("/mis/projects/:id", requireAuth, async (req, res): Promise<void> => {
  const value = await access(req, res); if (!value) return;
  const params = MisUpdateProjectParams.safeParse(req.params); if (!params.success) { invalid(res); return; }
  const before = await assertProject(value, params.data.id, res); if (!before) return;
  if (!can(value, "projects") && !can(value, "project_config", before.id) && !can(value, "configuration", before.id)) { forbidden(res); return; }
  const data = validProjectBody(req, res, true); if (!data) return;
  if (data.managerId && !(await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, data.managerId)))[0]) { invalid(res, "Manager user does not exist"); return; }
  try {
    const updated = await db.transaction(async (tx) => {
       await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`mis-project-period:${before.id}`}))`);
       const { reportingSettings: _reportingSettings, ...projectData } = data;
       const [row] = await tx.update(misProjectsTable).set({ ...projectData, updatedAt: new Date() }).where(eq(misProjectsTable.id, before.id)).returning();
      await auditMis({ entityType: "project", entityId: before.id, projectId: before.id, action: "UPDATE", actorId: req.user!.id, oldValues: before, newValues: data }, tx);
      return row;
    });
    const managers = await userMap([updated.managerId]);
    res.json(projectResult(updated, permissionsForProject(value, updated.id), updated.managerId ? managers.get(updated.managerId) : undefined));
  } catch (error) {
    if ((error as { code?: string }).code === "23505") { conflict(res, "MIS project code already exists"); return; }
    throw error;
  }
});

router.get("/mis/tabs", requireAuth, async (req, res): Promise<void> => {
  const value = await access(req, res); if (!value) return;
  const q = parsedQuery(MisListTabsQueryParams, req); if (!q) { invalid(res); return; }
  const rows = await db.select().from(misTabsTable).where(and(...[q.active == null ? undefined : eq(misTabsTable.active, q.active), q.search ? ilike(misTabsTable.name, `%${q.search}%`) : undefined].filter(Boolean) as [])).orderBy(asc(misTabsTable.sequence), asc(misTabsTable.name));
  res.json(rows);
});
function tabBody(req: Request, res: Response, update = false) {
  const parsed = (update ? MisUpdateTabBody : MisCreateTabBody).safeParse(req.body);
  if (!parsed.success) { invalid(res); return null; }
  return {
    ...parsed.data,
    code: parsed.data.code.toUpperCase(),
    rateEnabled: parsed.data.rateEnabled ?? true,
    calculatePercentAgainstIncome: parsed.data.calculatePercentAgainstIncome
      ?? (parsed.data.type === "income" || parsed.data.type === "other"),
  };
}
router.post("/mis/tabs", requireAuth, async (req, res): Promise<void> => {
  const value = await access(req, res); if (!value) return;
  if (!can(value, "tabs") && !can(value, "configuration")) { forbidden(res); return; }
  const data = tabBody(req, res); if (!data) return;
  try {
    const created = await db.transaction(async (tx) => {
      const [row] = await tx.insert(misTabsTable).values({ ...data, createdById: req.user!.id }).returning();
      await auditMis({ entityType: "tab", entityId: row.id, action: "CREATE", actorId: req.user!.id, newValues: data }, tx);
      return row;
    });
    res.status(201).json(created);
  } catch (error) { if ((error as { code?: string }).code === "23505") { conflict(res, "MIS tab code already exists"); return; } throw error; }
});
router.patch("/mis/tabs/:id", requireAuth, async (req, res): Promise<void> => {
  const value = await access(req, res); if (!value) return;
  if (!can(value, "tabs") && !can(value, "configuration")) { forbidden(res); return; }
  const params = MisUpdateTabParams.safeParse(req.params); const data = tabBody(req, res, true);
  if (!params.success || !data) { if (!data) return; invalid(res); return; }
  const [before] = await db.select().from(misTabsTable).where(eq(misTabsTable.id, params.data.id)); if (!before) { notFound(res, "MIS tab not found"); return; }
  try {
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx.update(misTabsTable).set({ ...data, updatedAt: new Date() }).where(eq(misTabsTable.id, before.id)).returning();
      await auditMis({ entityType: "tab", entityId: row.id, action: "UPDATE", actorId: req.user!.id, oldValues: before, newValues: data }, tx);
      return row;
    });
    res.json(updated);
  } catch (error) { if ((error as { code?: string }).code === "23505") { conflict(res, "MIS tab code already exists"); return; } throw error; }
});

async function assignmentRows(projectId: string) {
  const rows = await db.select({ assignment: misProjectTabsTable, tab: misTabsTable }).from(misProjectTabsTable)
    .innerJoin(misTabsTable, eq(misTabsTable.id, misProjectTabsTable.tabId))
    .where(eq(misProjectTabsTable.projectId, projectId)).orderBy(asc(misProjectTabsTable.sequence), asc(misTabsTable.sequence));
  return rows.map(({ assignment, tab }) => ({
    projectId: assignment.projectId,
    tabId: assignment.tabId,
    enabled: assignment.enabled,
    sequence: assignment.sequence,
    calculatePercentAgainstIncome: assignment.calculatePercentAgainstIncome,
    tab,
  }));
}
router.get("/mis/projects/:id/tabs", requireAuth, async (req, res): Promise<void> => {
  const value = await access(req, res); if (!value) return;
  const params = MisListProjectTabsParams.safeParse(req.params); if (!params.success) { invalid(res); return; }
  const project = await assertProject(value, params.data.id, res); if (!project) return;
  res.json(await assignmentRows(project.id));
});
router.put("/mis/projects/:id/tabs", requireAuth, async (req, res): Promise<void> => {
  const value = await access(req, res); if (!value) return;
  const params = MisReplaceProjectTabsParams.safeParse(req.params); const parsed = MisReplaceProjectTabsBody.safeParse(req.body);
  if (!params.success || !parsed.success) { invalid(res); return; }
  const project = await assertProject(value, params.data.id, res); if (!project) return;
  if (!can(value, "project_config", project.id) && !can(value, "tabs", project.id) && !can(value, "configuration", project.id)) { forbidden(res); return; }
  const tabIds = parsed.data.assignments.map((row) => row.tabId);
  if (new Set(tabIds).size !== tabIds.length) { invalid(res, "A tab may be assigned only once"); return; }
  const tabs = tabIds.length ? await db.select({ id: misTabsTable.id }).from(misTabsTable).where(inArray(misTabsTable.id, tabIds)) : [];
  if (tabs.length !== tabIds.length) { invalid(res, "One or more MIS tabs do not exist"); return; }
  await db.transaction(async (tx) => {
    const old = await tx.select().from(misProjectTabsTable).where(eq(misProjectTabsTable.projectId, project.id));
    await tx.delete(misProjectTabsTable).where(eq(misProjectTabsTable.projectId, project.id));
    if (parsed.data.assignments.length) await tx.insert(misProjectTabsTable).values(parsed.data.assignments.map((row) => ({ ...row, projectId: project.id })));
    await auditMis({ entityType: "project_tabs", entityId: project.id, projectId: project.id, action: "REPLACE", actorId: req.user!.id, oldValues: old, newValues: parsed.data.assignments }, tx);
  });
  res.json(await assignmentRows(project.id));
});

function serviceBody(req: Request, res: Response, update = false) {
  const parsed = (update ? MisUpdateServiceBody : MisCreateProjectServiceBody).safeParse(req.body);
  if (!parsed.success) { invalid(res); return null; }
  const from = rawDateBody(req.body, "effectiveFrom"), to = rawDateBody(req.body, "effectiveTo");
  if ((req.body as Record<string, unknown>).effectiveFrom !== null && !from || (req.body as Record<string, unknown>).effectiveTo !== null && !to || from && to && from > to) { invalid(res, "Effective dates must be real calendar dates in order"); return null; }
  if (!finiteNonNegative(parsed.data.defaultRate)) { invalid(res, "Default rate must be a finite non-negative number"); return null; }
  const code = parsed.data.code?.trim().toUpperCase();
  const currency = parsed.data.currency?.trim().toUpperCase();
  if (code && !/^[A-Z0-9][A-Z0-9_-]{0,31}$/.test(code)) { invalid(res, "Service code must contain only letters, numbers, hyphens, or underscores"); return null; }
  if (currency && !/^[A-Z]{3}$/.test(currency)) { invalid(res, "Service currency must be a three-letter ISO code"); return null; }
  return { ...parsed.data, code, currency, effectiveFrom: from, effectiveTo: to };
}
type CalculationMode = "quantity_rate" | "amount";
type EntryCalculationFlags = {
  rateEnabled: boolean;
  calculatePercentAgainstIncome: boolean;
  calculationMode: CalculationMode;
};

/**
 * Resolve new-entry behavior from the type master and nullable project-tab
 * override. Income and Cost remain quantity/rate for compatibility; Expense
 * and Salary are always direct amounts. Custom types honor rateEnabled.
 */
function effectiveCalculationFlags(
  tab: { type: string; rateEnabled?: boolean | null; calculatePercentAgainstIncome?: boolean | null },
  assignment?: { calculatePercentAgainstIncome?: boolean | null },
): EntryCalculationFlags {
  const forcedAmount = tab.type === "expense" || tab.type === "salary";
  const rateEnabled = forcedAmount ? false : tab.type === "income" || tab.type === "cost" ? true : tab.rateEnabled ?? true;
  const calculatePercentAgainstIncome = assignment?.calculatePercentAgainstIncome
    ?? tab.calculatePercentAgainstIncome
    ?? (tab.type === "income" || tab.type === "other");
  return {
    rateEnabled,
    calculatePercentAgainstIncome,
    calculationMode: rateEnabled ? "quantity_rate" : "amount",
  };
}

function serviceResult(
  service: typeof misServicesTable.$inferSelect,
  tab: typeof misTabsTable.$inferSelect,
  assignment?: typeof misProjectTabsTable.$inferSelect,
) {
  const flags = effectiveCalculationFlags(tab, assignment);
  return { id: service.id, projectId: service.projectId, tabId: service.tabId, code: service.code, name: service.name, description: service.description, unit: service.unit, currency: service.currency,
    quantitySourceServiceId: service.quantitySourceServiceId, defaultRate: numeric(service.defaultRate), active: service.active, sequence: service.sequence, effectiveFrom: service.effectiveFrom, effectiveTo: service.effectiveTo,
    tabName: tab.name, tabType: tab.type, financialClass: tab.financialClass, ...flags, createdAt: service.createdAt, updatedAt: service.updatedAt };
}
router.get("/mis/projects/:id/services", requireAuth, async (req, res): Promise<void> => {
  const value = await access(req, res); if (!value) return;
  const params = MisListProjectServicesParams.safeParse(req.params); const q = parsedQuery(MisListProjectServicesQueryParams, req);
  if (!params.success || !q) { invalid(res); return; }
  const project = await assertProject(value, params.data.id, res); if (!project) return;
  const rows = await db.select({ service: misServicesTable, tab: misTabsTable, assignment: misProjectTabsTable }).from(misServicesTable)
    .innerJoin(misTabsTable, eq(misTabsTable.id, misServicesTable.tabId))
    .innerJoin(misProjectTabsTable, and(eq(misProjectTabsTable.projectId, misServicesTable.projectId), eq(misProjectTabsTable.tabId, misServicesTable.tabId)))
     .where(and(eq(misServicesTable.projectId, project.id), ...(q.tabId ? [eq(misServicesTable.tabId, q.tabId)] : []), ...(q.active == null ? [] : [eq(misServicesTable.active, q.active)]))).orderBy(asc(misServicesTable.sequence), asc(misServicesTable.id));
  const canConfigure = can(value, "services", project.id) || can(value, "project_config", project.id);
  res.json(rows.filter((row) => canConfigure || (row.assignment.enabled && row.tab.active && row.tab.allowEntry)).map(({ service, tab, assignment }) => serviceResult(service, tab, assignment)));
});
router.post("/mis/projects/:id/services", requireAuth, async (req, res): Promise<void> => {
  const value = await access(req, res); if (!value) return;
  const params = MisListProjectServicesParams.safeParse(req.params); if (!params.success) { invalid(res); return; }
  const project = await assertProject(value, params.data.id, res); if (!project) return;
  if (!can(value, "services", project.id) && !can(value, "project_config", project.id)) { forbidden(res); return; }
  const data = serviceBody(req, res); if (!data) return;
  const [tab, assignment] = await Promise.all([
    db.select().from(misTabsTable).where(eq(misTabsTable.id, data.tabId)).then((rows) => rows[0]),
    db.select().from(misProjectTabsTable).where(and(eq(misProjectTabsTable.projectId, project.id), eq(misProjectTabsTable.tabId, data.tabId))).then((rows) => rows[0]),
  ]);
  if (!tab || !assignment?.enabled) { invalid(res, "Service must belong to an enabled project tab"); return; }
  if (!await validateQuantityLink(project.id, tab.type, data.quantitySourceServiceId, res)) return;
  let created: typeof misServicesTable.$inferSelect;
  try {
    created = await db.transaction(async (tx) => {
      const [row] = await tx.insert(misServicesTable).values({ ...data, code: data.code ?? `SVC-${randomUUID().replaceAll("-", "").slice(0, 12)}`, currency: data.currency ?? project.currency, projectId: project.id, defaultRate: String(data.defaultRate), createdById: req.user!.id }).returning();
      await auditMis({ entityType: "service", entityId: row.id, projectId: project.id, action: "CREATE", actorId: req.user!.id, newValues: row }, tx);
      return row;
    });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") { conflict(res, "Service code already exists in this project"); return; }
    throw error;
  }
  res.status(201).json(serviceResult(created, tab, assignment));
});
router.patch("/mis/services/:id", requireAuth, async (req, res): Promise<void> => {
  const value = await access(req, res); if (!value) return;
  const params = MisUpdateServiceParams.safeParse(req.params); if (!params.success) { invalid(res); return; }
  const [before] = await db.select().from(misServicesTable).where(eq(misServicesTable.id, params.data.id)); if (!before) { notFound(res, "MIS service not found"); return; }
  if (!canAccessProject(value, before.projectId)) { forbidden(res); return; }
  if (!can(value, "services", before.projectId) && !can(value, "project_config", before.projectId)) { forbidden(res); return; }
  const data = serviceBody(req, res, true); if (!data) return;
  const assignment = await db.select().from(misProjectTabsTable).where(and(eq(misProjectTabsTable.projectId, before.projectId), eq(misProjectTabsTable.tabId, data.tabId))).then((rows) => rows[0]);
  const tab = await db.select().from(misTabsTable).where(eq(misTabsTable.id, data.tabId)).then((rows) => rows[0]);
  if (!assignment?.enabled || !tab) { invalid(res, "Service must belong to an enabled project tab"); return; }
  const quantitySourceServiceId = data.quantitySourceServiceId === undefined ? before.quantitySourceServiceId : data.quantitySourceServiceId;
  if (!await validateQuantityLink(before.projectId, tab.type, quantitySourceServiceId, res, before.id)) return;
  if (tab.type !== "income") {
    const dependents = await db.select({ id: misServicesTable.id }).from(misServicesTable).where(eq(misServicesTable.quantitySourceServiceId, before.id)).limit(1);
    if (dependents.length) { invalid(res, "Remove quantity links to this service before changing its category"); return; }
  }
  let updated: typeof misServicesTable.$inferSelect;
  try {
    updated = await db.transaction(async (tx) => {
      const [row] = await tx.update(misServicesTable).set({ ...data, code: data.code ?? before.code, currency: data.currency ?? before.currency, defaultRate: String(data.defaultRate), updatedAt: new Date() }).where(eq(misServicesTable.id, before.id)).returning();
      await auditMis({ entityType: "service", entityId: row.id, projectId: row.projectId, action: "UPDATE", actorId: req.user!.id, oldValues: before, newValues: row }, tx);
      return row;
    });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") { conflict(res, "Service code already exists in this project"); return; }
    throw error;
  }
  res.json(serviceResult(updated, tab, assignment));
});

async function validateQuantityLink(projectId: string, tabType: string, sourceId: string | null | undefined, res: Response, serviceId?: string) {
  if (!sourceId) return true;
  const [source] = await db.select({ service: misServicesTable, tab: misTabsTable, assignment: misProjectTabsTable }).from(misServicesTable)
    .innerJoin(misTabsTable, eq(misTabsTable.id, misServicesTable.tabId))
    .innerJoin(misProjectTabsTable, and(eq(misProjectTabsTable.projectId, misServicesTable.projectId), eq(misProjectTabsTable.tabId, misServicesTable.tabId)))
    .where(eq(misServicesTable.id, sourceId));
  if (tabType !== "cost" || sourceId === serviceId || !source || source.service.projectId !== projectId || source.tab.type !== "income" || !source.service.active || !source.tab.active || !source.assignment.enabled) {
    invalid(res, "Link a Cost service to an active Income service in the same project");
    return false;
  }
  return true;
}

router.post("/mis/projects/:id/services/reorder", requireAuth, async (req, res): Promise<void> => {
  const value = await access(req, res); if (!value) return;
  const params = MisReorderProjectServicesParams.safeParse(req.params);
  const parsed = MisReorderProjectServicesBody.safeParse(req.body);
  if (!params.success || !parsed.success) { invalid(res, "A complete service ID order is required"); return; }
  const project = await assertProject(value, params.data.id, res); if (!project) return;
  if (!can(value, "services", project.id) && !can(value, "project_config", project.id)) {
    forbidden(res, "Services permission required"); return;
  }
  const serviceIds = parsed.data.serviceIds;
  if (new Set(serviceIds).size !== serviceIds.length) { invalid(res, "Service IDs must be unique"); return; }
  const current = await db.select({ id: misServicesTable.id })
    .from(misServicesTable).where(eq(misServicesTable.projectId, project.id));
  const currentIds = new Set(current.map((row) => row.id));
  if (currentIds.size !== serviceIds.length || serviceIds.some((serviceId) => !currentIds.has(serviceId))) {
    invalid(res, "serviceIds must contain every service in this project exactly once"); return;
  }
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`mis-services-order:${project.id}`}))`);
      const locked = await tx.select({ id: misServicesTable.id }).from(misServicesTable)
        .where(eq(misServicesTable.projectId, project.id));
      const lockedIds = new Set(locked.map((row) => row.id));
      if (lockedIds.size !== serviceIds.length || serviceIds.some((serviceId) => !lockedIds.has(serviceId))) {
        throw Object.assign(new Error("Service set changed concurrently; refresh and retry"), { status: 409 });
      }
      for (const [sequence, serviceId] of serviceIds.entries()) {
        await tx.update(misServicesTable).set({ sequence, updatedAt: new Date() }).where(and(
          eq(misServicesTable.id, serviceId), eq(misServicesTable.projectId, project.id),
        ));
      }
      await auditMis({
        entityType: "service_order", entityId: project.id, projectId: project.id,
        action: "REORDER", actorId: req.user!.id, newValues: { serviceIds },
      }, tx);
    });
  } catch (error) {
    if ((error as { status?: number }).status === 409) { conflict(res, (error as Error).message); return; }
    throw error;
  }
  const rows = await db.select({ service: misServicesTable, tab: misTabsTable, assignment: misProjectTabsTable })
    .from(misServicesTable)
    .innerJoin(misTabsTable, eq(misTabsTable.id, misServicesTable.tabId))
    .innerJoin(misProjectTabsTable, and(
      eq(misProjectTabsTable.projectId, project.id), eq(misProjectTabsTable.tabId, misServicesTable.tabId),
    ))
    .where(eq(misServicesTable.projectId, project.id))
    .orderBy(asc(misServicesTable.sequence), asc(misServicesTable.id));
  res.json(rows.map(({ service, tab, assignment }) => serviceResult(service, tab, assignment)));
});

router.get("/mis/projects/:id/entry-services", requireAuth, async (req, res): Promise<void> => {
  const value = await access(req, res); if (!value) return;
  const params = MisListProjectServicesParams.safeParse(req.params);
  if (!params.success) { invalid(res); return; }
  const from = req.query.from == null ? null : strictDate(req.query.from);
  const to = req.query.to == null ? null : strictDate(req.query.to);
  if ((req.query.from != null && !from) || (req.query.to != null && !to) || (from && to && from > to)) { invalid(res, "Entry service dates must be real calendar dates in order"); return; }
  const project = await assertProject(value, params.data.id, res); if (!project) return;
  const rows = await db.select({ service: misServicesTable, tab: misTabsTable, assignment: misProjectTabsTable })
    .from(misServicesTable)
    .innerJoin(misTabsTable, eq(misTabsTable.id, misServicesTable.tabId))
    .innerJoin(misProjectTabsTable, and(eq(misProjectTabsTable.projectId, project.id), eq(misProjectTabsTable.tabId, misServicesTable.tabId)))
    .where(and(
      eq(misServicesTable.projectId, project.id),
      eq(misServicesTable.active, true),
      eq(misTabsTable.active, true),
      eq(misTabsTable.allowEntry, true),
      eq(misProjectTabsTable.enabled, true),
      ...(from ? [sql`(${misServicesTable.effectiveFrom} IS NULL OR ${misServicesTable.effectiveFrom} <= ${from})`] : []),
      ...(to ? [sql`(${misServicesTable.effectiveTo} IS NULL OR ${misServicesTable.effectiveTo} >= ${to})`] : []),
    ))
     .orderBy(asc(misServicesTable.sequence), asc(misProjectTabsTable.sequence), asc(misTabsTable.sequence), asc(misServicesTable.name));
  res.json(rows.map(({ service, tab, assignment }) => serviceResult(service, tab, assignment)));
});

function entryBody(req: Request, res: Response, update = false) {
  const parsed = (update ? MisUpdateEntryBody : MisCreateEntryBody).safeParse(req.body);
  if (!parsed.success) { invalid(res); return null; }
  const fromDate = rawDateBody(req.body, "fromDate"), toDate = rawDateBody(req.body, "toDate");
  if (!fromDate || !toDate || fromDate > toDate) { invalid(res, "Entry dates must be real calendar dates with fromDate no later than toDate"); return null; }
  const data = parsed.data as typeof parsed.data & {
    quantity?: number | null; rate?: number | null; amount?: number | null;
    calculationMode?: CalculationMode;
  };
  for (const [field, value] of [["quantity", data.quantity], ["rate", data.rate], ["amount", data.amount] as const]) {
    const numberValue = value as number | null | undefined;
    if (numberValue != null && !finiteNonNegative(numberValue)) { invalid(res, `${field} must be a finite non-negative number`); return null; }
    if (numberValue != null) {
      try { multiplyDecimal(numberValue, 1); } catch (error) {
        invalid(res, error instanceof Error ? error.message : `Invalid ${field}`); return null;
      }
    }
  }
  if (data.quantity == null && data.amount == null) {
    invalid(res, "Quantity/rate or actual amount is required"); return null;
  }
  return { ...data, fromDate, toDate } as EntryInputData;
}
type PeriodConflict = {
  id: string; parentId: string | null; bulkNumber: string | null;
  fromDate: string; toDate: string; status: string;
};
type ConflictError = Error & { status: number; conflict?: PeriodConflict; standaloneDuplicate?: boolean; conflictReason?: string };

async function lockProjectPeriod(tx: any, projectId: string) {
  // One lock covers parent and standalone paths. This intentionally uses a
  // project key rather than a service key so a standalone request cannot race
  // a bulk parent request and bypass the parent-period policy.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`mis-project-period:${projectId}`}))`);
}

async function periodConflicts(
  tx: any,
  projectId: string,
  fromDate: string,
  toDate: string,
  exceptParentId?: string,
  exceptEntryId?: string,
): Promise<PeriodConflict[]> {
  const [parents, standalone] = await Promise.all([
    tx.select({
      id: misEntryParentsTable.id, parentId: misEntryParentsTable.id,
      bulkNumber: misEntryParentsTable.bulkNumber, fromDate: misEntryParentsTable.fromDate,
      toDate: misEntryParentsTable.toDate, status: misEntryParentsTable.status,
    }).from(misEntryParentsTable).where(and(
      eq(misEntryParentsTable.projectId, projectId), isNull(misEntryParentsTable.deletedAt),
      lte(misEntryParentsTable.fromDate, toDate), gte(misEntryParentsTable.toDate, fromDate),
      ...(exceptParentId ? [sql`${misEntryParentsTable.id} <> ${exceptParentId}`] : []),
    )),
    tx.select({
      id: misEntriesTable.id, parentId: misEntriesTable.parentId,
      bulkNumber: sql<string | null>`NULL`, fromDate: misEntriesTable.fromDate,
      toDate: misEntriesTable.toDate, status: misEntriesTable.status,
    }).from(misEntriesTable).where(and(
      eq(misEntriesTable.projectId, projectId), isNull(misEntriesTable.deletedAt), isNull(misEntriesTable.parentId),
      lte(misEntriesTable.fromDate, toDate), gte(misEntriesTable.toDate, fromDate),
      ...(exceptEntryId ? [sql`${misEntriesTable.id} <> ${exceptEntryId}`] : []),
    )),
  ]);
  return [...parents, ...standalone];
}

function periodConflictError(conflict: PeriodConflict, message = "An MIS entry already exists for this project for the selected period."): ConflictError {
  return Object.assign(new Error(message), { status: 409, conflict });
}

async function enforceParentPeriodPolicy(
  tx: any,
  project: typeof misProjectsTable.$inferSelect,
  fromDate: string,
  toDate: string,
  exceptParentId?: string,
) {
  await lockProjectPeriod(tx, project.id);
  const [lockedProject] = await tx.select().from(misProjectsTable).where(eq(misProjectsTable.id, project.id));
  const effectiveProject = lockedProject ?? project;
  const conflicts = await periodConflicts(tx, effectiveProject.id, fromDate, toDate, exceptParentId);
  const policy = effectiveProject.overlapPolicy ?? "nonoverlap";
  const restrictOverlap = !effectiveProject.allowMultipleMisEntries || policy === "nonoverlap";
  if (restrictOverlap && conflicts.length) throw periodConflictError(conflicts[0]);
  if (effectiveProject.allowMultipleMisEntries && effectiveProject.maxEntriesPerPeriod != null && conflicts.length >= effectiveProject.maxEntriesPerPeriod) {
    const error = Object.assign(new Error("The maximum number of MIS entries for this project period has been reached."), { status: 409, conflictReason: "maximum" }) as ConflictError;
    throw error;
  }
}

async function checkDuplicate(tx: any, entry: { projectId: string; tabId: string; serviceId: string; fromDate: string; toDate: string }, exceptId?: string, enforceOwnDuplicate = true) {
  await lockProjectPeriod(tx, entry.projectId);
  const [project] = await tx.select().from(misProjectsTable).where(eq(misProjectsTable.id, entry.projectId));
  // A standalone entry retains the legacy per-service duplicate rule. It also
  // respects an existing parent policy, but never gains a new standalone
  // multi-service restriction by itself.
  if (project?.allowMultipleMisEntries === false || project?.overlapPolicy === "nonoverlap") {
    const parentConflict = (await periodConflicts(tx, entry.projectId, entry.fromDate, entry.toDate, undefined, exceptId))
      .find((row) => row.parentId != null);
    if (parentConflict) throw periodConflictError(parentConflict);
  }
  if (!enforceOwnDuplicate) return false;
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`mis-period:${entry.projectId}:${entry.tabId}:${entry.serviceId}`}))`);
  const duplicate = await tx.execute(sql`
    SELECT id FROM mis_entries
    WHERE project_id = ${entry.projectId} AND tab_id = ${entry.tabId} AND service_id = ${entry.serviceId}
      AND parent_id IS NULL AND deleted_at IS NULL AND from_date <= ${entry.toDate}::date AND to_date >= ${entry.fromDate}::date
      ${exceptId ? sql`AND id <> ${exceptId}` : sql``} LIMIT 1`);
  return duplicate.rows.length > 0;
}

function sendPeriodConflict(res: Response, value: MisAccess, projectId: string, error: ConflictError) {
  const existing = error.conflict;
  if (!existing) {
    res.status(409).json({ error: error.message, ...(error.conflictReason ? { conflict: { reason: error.conflictReason, canView: false } } : {}) });
    return;
  }
  const visible = canAccessProject(value, projectId) && can(value, "view_entries", projectId);
  res.status(409).json({
    error: error.message,
    conflict: visible ? {
      reason: "overlap", canView: true, existing,
      ...(existing.parentId ? { openUrl: `/mis/entries/parents/${existing.parentId}` } : {}),
    } : { reason: "overlap", canView: false },
  });
}
router.get("/mis/entries", requireAuth, async (req, res): Promise<void> => {
  const value = await access(req, res); if (!value) return;
  const q = parsedQuery(MisListEntriesQueryParams, req); if (!q) { invalid(res, "Invalid filters"); return; }
  const statuses = statusSubset(q.statuses);
  if (q.statuses != null && !statuses) { invalid(res, "Invalid statuses filter"); return; }
  if (!can(value, "view_entries") && ![...value.projectPermissions.values()].some((p) => p.has("view_entries"))) { forbidden(res); return; }
  const requested = q.projectIds ? q.projectIds.split(",").map((v) => v.trim()).filter(Boolean) : null;
  const permitted = await permittedProjectIds(value, ["view_entries"]);
  // Lists deliberately intersect requested filters with authorized scope. This
  // avoids exposing rows (or project metadata) while still allowing a picker
  // containing stale project IDs to safely render an empty result.
  const scope = requested ? requested.filter((projectId) => canAccessProject(value, projectId) && (!permitted || permitted.includes(projectId))) : permitted;
  if (scope && !scope.length) { res.json({ items: [], total: 0, page: q.page, pageSize: q.pageSize }); return; }
  const conditions = [isNull(misEntriesTable.deletedAt), ...(scope ? [inArray(misEntriesTable.projectId, scope)] : []), ...(q.tabId ? [eq(misEntriesTable.tabId, q.tabId)] : []), ...(q.serviceId ? [eq(misEntriesTable.serviceId, q.serviceId)] : []),
    ...(q.from ? [gte(misEntriesTable.fromDate, dateString(q.from))] : []), ...(q.to ? [lte(misEntriesTable.toDate, dateString(q.to))] : []),
    ...(q.startFrom ? [gte(misEntriesTable.fromDate, dateString(q.startFrom))] : []), ...(q.startTo ? [lte(misEntriesTable.fromDate, dateString(q.startTo))] : []),
    ...(q.currency ? [eq(misEntriesTable.currency, q.currency.toUpperCase())] : []), ...(statuses ? [inArray(misEntriesTable.status, statuses)] : q.status ? [eq(misEntriesTable.status, q.status)] : []),
    ...(q.entryType ? [eq(misEntriesTable.type, q.entryType)] : []), ...(q.search ? [sql`(${misEntriesTable.projectName} ILIKE ${`%${q.search}%`} OR ${misEntriesTable.tabName} ILIKE ${`%${q.search}%`} OR ${misEntriesTable.serviceName} ILIKE ${`%${q.search}%`} OR COALESCE(${misEntriesTable.remarks}, '') ILIKE ${`%${q.search}%`})`] : [])];
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(misEntriesTable).where(and(...conditions));
  const rows = await db.select().from(misEntriesTable).where(and(...conditions)).orderBy(desc(misEntriesTable.updatedAt)).limit(q.pageSize).offset(pagination(q.page, q.pageSize).offset);
  const users = await userMap(rows.flatMap((row) => [row.createdById, row.updatedById]));
  const parentIds = rows.map((row) => row.parentId).filter((parentId): parentId is string => Boolean(parentId));
  const parentRows = parentIds.length ? await db.select({ id: misEntryParentsTable.id, bulkNumber: misEntryParentsTable.bulkNumber }).from(misEntryParentsTable).where(inArray(misEntryParentsTable.id, parentIds)) : [];
  const bulkNumbers = new Map(parentRows.map((row) => [row.id, row.bulkNumber]));
  res.json({ items: rows.map((row) => serializeEntry(row, users, row.parentId ? bulkNumbers.get(row.parentId) ?? null : null)), total: count, page: q.page, pageSize: q.pageSize });
});
router.post("/mis/entries", requireAuth, async (req, res): Promise<void> => {
  const value = await access(req, res); if (!value) return;
  const data = entryBody(req, res); if (!data) return;
  const config = await configuredEntryData(data, value, res); if (!config) return;
  try {
    const created = await db.transaction(async (tx) => {
       const duplicate = await checkDuplicate(tx, data, undefined, config.project.preventDuplicatePeriods);
       if (config.project.preventDuplicatePeriods && duplicate) {
        const error = new Error("An overlapping entry already exists for this service period") as Error & { status: number }; error.status = 409; throw error;
      }
       const { rateReason: _rateReason, amount: _amount, calculationMode: _calculationMode, ...entryData } = data;
      const [row] = await tx.insert(misEntriesTable).values({
          ...entryData, quantity: String(config.quantity), rate: String(config.rate), amount: config.amount,
         calculationMode: config.calculationMode, rateEnabled: config.flags.rateEnabled,
         calculatePercentAgainstIncome: config.flags.calculatePercentAgainstIncome,
        projectName: config.project.name, tabName: config.tab.name, serviceName: config.service.name, type: config.tab.type,
         financialClass: config.tab.financialClass, unit: config.service.unit, currency: config.service.currency, createdById: req.user!.id, updatedById: req.user!.id,
      }).returning();
        const override = config.calculationMode === "quantity_rate" && numeric(row.rate) !== numeric(config.service.defaultRate);
       await auditMis({ entryId: row.id, projectId: row.projectId, entityType: "entry", entityId: row.id, action: "CREATE", actorId: req.user!.id, remarks: data.rateReason ?? null, newValues: override
         ? { entry: serializeEntry(row, new Map()), rateAudit: { originalRate: numeric(config.service.defaultRate), newRate: numeric(row.rate), changedBy: req.user!.id, changedAt: new Date().toISOString(), reason: data.rateReason } }
         : serializeEntry(row, new Map()) }, tx);
      return row;
    });
    res.status(201).json(await entryResponse(created));
   } catch (error) { if ((error as { status?: number }).status === 409) { sendPeriodConflict(res, value, data.projectId, error as ConflictError); return; } throw error; }
});
router.post("/mis/entries/bulk", requireAuth, async (req, res): Promise<void> => {
  const value = await access(req, res); if (!value) return;
  const parsed = MisCreateBulkEntriesBody.safeParse(req.body);
  if (!parsed.success) { invalid(res, "Invalid bulk entry body"); return; }
  const fromDate = rawDateBody(req.body, "fromDate"), toDate = rawDateBody(req.body, "toDate");
  if (!fromDate || !toDate || fromDate > toDate) { invalid(res, "Bulk entry dates must be real calendar dates in order"); return; }
  const project = await projectById(parsed.data.projectId);
  if (!project) { notFound(res, "MIS project not found"); return; }
  if (!canAccessProject(value, project.id) || !can(value, "create_entries", project.id)) { forbidden(res, "Create-entry permission required"); return; }
  if (parsed.data.action === "submit" && !can(value, "submit", project.id)) { forbidden(res, "Submit permission required"); return; }
  if (parsed.data.action === "submit" && !can(value, "submit", project.id)) { forbidden(res, "Submit permission required"); return; }
  if (project.status !== "active") { invalid(res, "Entries cannot be created for an inactive project"); return; }

  const candidates = parsed.data.lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => (line.quantity !== undefined && line.quantity !== null)
      || (line.amount !== undefined && line.amount !== null));
  if (!candidates.length) { invalid(res, "At least one service line is required for a bulk entry"); return; }
  const prepared: Array<{
    index: number;
    data: EntryInputData;
    config: NonNullable<Awaited<ReturnType<typeof configuredEntryData>>>;
  }> = [];
  for (const { line, index } of candidates) {
    const lineFrom = line.fromDate == null ? fromDate : dateString(line.fromDate);
    const lineTo = line.toDate == null ? toDate : dateString(line.toDate);
    if (!lineFrom || !lineTo || lineFrom > lineTo) { invalid(res, `Line ${index + 1} has an invalid date range`); return; }
    const [serviceRow] = await db.select({ service: misServicesTable, tab: misTabsTable }).from(misServicesTable)
      .innerJoin(misTabsTable, eq(misTabsTable.id, misServicesTable.tabId))
      .where(and(eq(misServicesTable.id, line.serviceId), eq(misServicesTable.projectId, project.id)));
    if (!serviceRow) { invalid(res, `Line ${index + 1} references a service that is not assigned to this project`); return; }
    const data = {
      projectId: project.id, tabId: serviceRow.tab.id, serviceId: line.serviceId,
       fromDate: lineFrom, toDate: lineTo, quantity: line.quantity,
       rate: line.rate, amount: line.amount, calculationMode: line.calculationMode,
       remarks: line.remarks ?? null, rateReason: line.rateReason ?? null,
    };
     const config = await configuredEntryData(data, value, res, undefined, "create_entries", undefined, true);
    if (!config) return;
    prepared.push({ index, data, config });
  }
  const created = await db.transaction(async (tx) => {
    await enforceParentPeriodPolicy(tx, project, fromDate, toDate);
    const [parent] = await tx.insert(misEntryParentsTable).values({
      projectId: project.id, projectName: project.name, projectCode: project.code,
      fromDate, toDate, status: parsed.data.action === "submit" ? "submitted" : "draft",
      entryType: "bulk", createdById: req.user!.id, updatedById: req.user!.id,
    }).returning();
    const rows: Array<{ row: typeof misEntriesTable.$inferSelect; index: number }> = [];
    // Lock services in a stable order to avoid deadlocks between concurrent
    // bulk submissions containing overlapping service lines.
    for (const item of [...prepared].sort((a, b) => a.data.serviceId.localeCompare(b.data.serviceId))) {
      const { data, config } = item;
       const { rateReason: _rateReason, amount: _amount, calculationMode: _calculationMode, ...entryData } = data;
      const [row] = await tx.insert(misEntriesTable).values({
         ...entryData, parentId: parent.id, quantity: String(config.quantity), rate: String(config.rate), amount: config.amount,
         calculationMode: config.calculationMode, rateEnabled: config.flags.rateEnabled,
         calculatePercentAgainstIncome: config.flags.calculatePercentAgainstIncome,
        status: parsed.data.action === "submit" ? "submitted" : "draft",
        projectName: config.project.name, tabName: config.tab.name, serviceName: config.service.name, type: config.tab.type,
        financialClass: config.tab.financialClass, unit: config.service.unit, currency: config.service.currency,
        createdById: req.user!.id, updatedById: req.user!.id,
      }).returning();
        const override = !config.costAmountQuantity
          && config.calculationMode === "quantity_rate"
          && numeric(row.rate) !== numeric(config.service.defaultRate);
      await auditMis({
        entryId: row.id, projectId: row.projectId, entityType: "entry", entityId: row.id,
        action: "CREATE", actorId: req.user!.id, remarks: data.rateReason ?? null,
        newValues: override
          ? { entry: serializeEntry(row, new Map()), rateAudit: { originalRate: numeric(config.service.defaultRate), newRate: numeric(row.rate), changedBy: req.user!.id, changedAt: new Date().toISOString(), reason: data.rateReason } }
          : serializeEntry(row, new Map()),
      }, tx);
      rows.push({ row, index: item.index });
    }
    await auditMis({
      projectId: parent.projectId, entityType: "parent", entityId: parent.id, action: "CREATE",
      actorId: req.user!.id, newValues: parent,
    }, tx);
    return { parent, rows };
  }).catch((error: unknown) => {
    if ((error as { status?: number }).status === 409) {
      sendPeriodConflict(res, value, project.id, error as ConflictError);
      return null;
    }
    throw error;
  });
  if (!created) return;
  const ordered = [...created.rows].sort((a, b) => a.index - b.index).map(({ row }) => row);
  const users = await userMap([created.parent.createdById, created.parent.updatedById, ...ordered.flatMap((row) => [row.createdById, row.updatedById])]);
  const parentUser = users.get(created.parent.createdById);
  const parent = serializeParent(created.parent, ordered.length, parentUser);
  res.status(201).json({ parent, items: ordered.map((row) => serializeEntry(row, users, created.parent.bulkNumber)) });
});

router.get("/mis/entries/creators", requireAuth, async (req, res): Promise<void> => {
  const value = await access(req, res); if (!value) return;
  const q = parsedQuery(MisListEntryCreatorsQueryParams, req); if (!q) { invalid(res); return; }
  if (!can(value, "view_entries") && ![...value.projectPermissions.values()].some((permissions) => permissions.has("view_entries"))) {
    forbidden(res); return;
  }
  // Unlike /mis/users, this endpoint only exposes accounts that authored a
  // parent in a project the caller can actually view. Do not turn this into a
  // general account directory for project-scoped users.
  const permitted = await permittedProjectIds(value, ["view_entries"]);
  const conditions = [
    isNull(misEntryParentsTable.deletedAt),
    ...(permitted ? [inArray(misEntryParentsTable.projectId, permitted)] : []),
    ...(q.search ? [or(
      ilike(usersTable.email, `%${q.search}%`),
      ilike(usersTable.firstName, `%${q.search}%`),
      ilike(usersTable.lastName, `%${q.search}%`),
    )!] : []),
  ];
  const [{ count }] = await db.select({
    count: sql<number>`count(distinct ${usersTable.id})::int`,
  }).from(misEntryParentsTable)
    .innerJoin(usersTable, eq(usersTable.id, misEntryParentsTable.createdById))
    .where(and(...conditions));
  const rows = await db.selectDistinct({
    id: usersTable.id, email: usersTable.email,
    firstName: usersTable.firstName, lastName: usersTable.lastName,
  }).from(misEntryParentsTable)
    .innerJoin(usersTable, eq(usersTable.id, misEntryParentsTable.createdById))
    .where(and(...conditions))
    .orderBy(asc(usersTable.email))
    .limit(q.pageSize).offset(pagination(q.page, q.pageSize).offset);
  res.json({
    items: rows.map(userPicker),
    total: count,
    page: q.page,
    pageSize: q.pageSize,
  });
});

async function permittedParent(accessValue: MisAccess, parentId: string, res: Response) {
  const [parent] = await db.select().from(misEntryParentsTable).where(eq(misEntryParentsTable.id, parentId));
  if (!parent || parent.deletedAt) { notFound(res, "MIS bulk entry not found"); return null; }
  if (!canAccessProject(accessValue, parent.projectId) || !can(accessValue, "view_entries", parent.projectId)) {
    forbidden(res, "No access to this MIS bulk entry"); return null;
  }
  return parent;
}

async function parentResponse(parent: typeof misEntryParentsTable.$inferSelect) {
  const [childRows, users] = await Promise.all([
    db.select({ entry: misEntriesTable }).from(misEntriesTable)
      .innerJoin(misServicesTable, eq(misServicesTable.id, misEntriesTable.serviceId))
      .where(and(eq(misEntriesTable.parentId, parent.id), isNull(misEntriesTable.deletedAt)))
      .orderBy(asc(misServicesTable.sequence), asc(misServicesTable.id), asc(misEntriesTable.id)),
    userMap([parent.createdById, parent.updatedById]),
  ]);
  const children = childRows.map(({ entry }) => entry);
  const childUsers = await userMap(children.flatMap((row) => [row.createdById, row.updatedById]));
  const mergedUsers = new Map([...users, ...childUsers]);
  return {
    parent: serializeParent(parent, children.length, users.get(parent.createdById)),
    items: children.map((row) => serializeEntry(row, mergedUsers, parent.bulkNumber)),
  };
}

router.get("/mis/entries/parents", requireAuth, async (req, res): Promise<void> => {
  const value = await access(req, res); if (!value) return;
  const q = parsedQuery(MisListEntryParentsQueryParams, req); if (!q) { invalid(res, "Invalid parent filters"); return; }
  if (!can(value, "view_entries") && ![...value.projectPermissions.values()].some((p) => p.has("view_entries"))) { forbidden(res); return; }
  const permitted = await permittedProjectIds(value, ["view_entries"]);
  const requestedProject = q.projectId;
  if (requestedProject && (!canAccessProject(value, requestedProject) || (permitted && !permitted.includes(requestedProject)))) {
    res.json({ items: [], total: 0, page: q.page, pageSize: q.pageSize }); return;
  }
  const scope = requestedProject ? [requestedProject] : permitted;
  const conditions = [
    isNull(misEntryParentsTable.deletedAt),
    ...(scope ? [inArray(misEntryParentsTable.projectId, scope)] : []),
    ...(q.bulkNumber ? [ilike(misEntryParentsTable.bulkNumber, `%${q.bulkNumber}%`)] : []),
    ...(q.projectNumber ? [ilike(misEntryParentsTable.projectCode, `%${q.projectNumber}%`)] : []),
    ...(q.createdById ? [eq(misEntryParentsTable.createdById, q.createdById)] : []),
    ...(q.status ? [eq(misEntryParentsTable.status, q.status)] : []),
    ...(q.entryType ? [eq(misEntryParentsTable.entryType, q.entryType)] : []),
    ...(q.fromDate ? [gte(misEntryParentsTable.fromDate, dateString(q.fromDate))] : []),
    ...(q.toDate ? [lte(misEntryParentsTable.toDate, dateString(q.toDate))] : []),
    ...(q.search ? [or(ilike(misEntryParentsTable.bulkNumber, `%${q.search}%`), ilike(misEntryParentsTable.projectName, `%${q.search}%`), ilike(misEntryParentsTable.projectCode, `%${q.search}%`))!] : []),
  ];
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(misEntryParentsTable).where(and(...conditions));
  const rows = await db.select({
    parent: misEntryParentsTable,
    childCount: sql<number>`(SELECT count(*)::int FROM mis_entries e WHERE e.parent_id = mis_entry_parents.id AND e.deleted_at IS NULL)`,
  }).from(misEntryParentsTable).where(and(...conditions)).orderBy(desc(misEntryParentsTable.updatedAt))
    .limit(q.pageSize).offset(pagination(q.page, q.pageSize).offset);
  const users = await userMap(rows.flatMap(({ parent }) => [parent.createdById, parent.updatedById]));
  res.json({
    items: rows.map(({ parent, childCount }) => serializeParent(parent, Number(childCount), users.get(parent.createdById))),
    total: count, page: q.page, pageSize: q.pageSize,
  });
});

router.get("/mis/entries/parents/:id", requireAuth, async (req, res): Promise<void> => {
  const value = await access(req, res); if (!value) return;
  const params = MisGetEntryParentParams.safeParse(req.params); if (!params.success) { invalid(res); return; }
  const parent = await permittedParent(value, params.data.id, res); if (!parent) return;
  res.json(await parentResponse(parent));
});

type ParentLineInput = {
  id?: string;
  serviceId: string;
  quantity?: number | null;
  rate?: number | null;
  amount?: number | null;
  calculationMode?: CalculationMode;
  remarks?: string | null;
  rateReason?: string | null;
  fromDate?: Date | null;
  toDate?: Date | null;
};
type PreparedParentLine = {
  index: number;
  existingChildId?: string;
  data: EntryInputData;
  config: {
    project: typeof misProjectsTable.$inferSelect;
    tab: { name: string; type: string; financialClass: string };
    service: { name: string; unit: string; currency: string; defaultRate: string };
    flags: EntryCalculationFlags;
    calculationMode: CalculationMode;
    quantity: number;
    rate: number;
    amount: string;
    costAmountQuantity?: boolean;
  };
};

async function historicalParentLineData(
  data: PreparedParentLine["data"],
  child: typeof misEntriesTable.$inferSelect,
  project: typeof misProjectsTable.$inferSelect,
  currentService: typeof misServicesTable.$inferSelect | undefined,
  accessValue: MisAccess,
  res: Response,
  requiredPermission: MisPermission,
) {
  if (!can(accessValue, requiredPermission, project.id)) { forbidden(res, `${requiredPermission.replaceAll("_", " ")} permission required`); return null; }
  if (!canAccessProject(accessValue, project.id)) { forbidden(res, "No access to this MIS project"); return null; }
  if (project.status !== "active") { invalid(res, "Entries cannot be edited for an inactive project"); return null; }
  if ((project.startDate && data.fromDate < project.startDate) || (project.endDate && data.toDate > project.endDate)) {
    invalid(res, "Entry period is outside the project dates"); return null;
  }
  const historicalRate = numeric(child.rate);
  const currentDefaultRate = currentService ? numeric(currentService.defaultRate) : historicalRate;
  const flags = {
    rateEnabled: child.rateEnabled,
    calculatePercentAgainstIncome: child.calculatePercentAgainstIncome,
    calculationMode: (child.calculationMode || "quantity_rate") as CalculationMode,
  };
  const costAmountQuantity = child.type === "cost" && data.amount != null;
  if (costAmountQuantity) {
    if (data.quantity == null) { invalid(res, "Cost bulk lines require both quantity and amount"); return null; }
    const enteredAmount = data.amount;
    if (enteredAmount == null) { invalid(res, "Cost bulk lines require both quantity and amount"); return null; }
    let amount: string;
    let rate: string;
    try {
      amount = decimalAmount(enteredAmount);
      rate = divideDecimal(amount, data.quantity);
    } catch (error) {
      invalid(res, error instanceof Error ? error.message : "Invalid cost amount/quantity"); return null;
    }
    return {
      project,
      tab: { name: child.tabName, type: child.type, financialClass: child.financialClass },
      service: { name: child.serviceName, unit: child.unit, currency: child.currency, defaultRate: String(currentDefaultRate) },
      flags, calculationMode: "quantity_rate" as const, quantity: data.quantity, rate: Number(rate), amount,
      costAmountQuantity: true,
    };
  }
  const requestedMode = data.calculationMode;
  let calculationMode = flags.calculationMode;
  if (requestedMode && requestedMode !== calculationMode) {
    const allowedTransition = requestedMode === "amount"
      && calculationMode === "quantity_rate"
      && (child.type === "expense" || child.type === "salary");
    if (!allowedTransition) { invalid(res, "Calculation mode is an immutable entry snapshot"); return null; }
    calculationMode = requestedMode;
  }
  const isOverride = calculationMode === "quantity_rate"
    && data.rate != null && data.rate !== historicalRate && data.rate !== currentDefaultRate;
  if (isOverride && !can(accessValue, "rate_override", project.id)) { forbidden(res, "Rate override permission required"); return null; }
  if (isOverride && !data.rateReason?.trim()) { invalid(res, "A reason is required when overriding the service rate"); return null; }
  let quantity: number;
  let rate: number;
  let amount: string;
  if (calculationMode === "amount") {
    if (data.amount == null) { invalid(res, "An actual amount is required for amount-mode entries"); return null; }
    quantity = 1; rate = 1;
    try { amount = decimalAmount(data.amount); } catch (error) {
      invalid(res, error instanceof Error ? error.message : "Invalid amount"); return null;
    }
  } else {
    if (data.quantity == null) { invalid(res, "Quantity is required for quantity-rate entries"); return null; }
    quantity = data.quantity; rate = data.rate == null ? historicalRate : data.rate;
    try { amount = multiplyDecimal(quantity, rate); } catch (error) {
      invalid(res, error instanceof Error ? error.message : "Invalid quantity/rate"); return null;
    }
  }
  return {
    project,
    tab: { name: child.tabName, type: child.type, financialClass: child.financialClass },
    service: { name: child.serviceName, unit: child.unit, currency: child.currency, defaultRate: String(currentDefaultRate) },
    flags, calculationMode, quantity, rate, amount, costAmountQuantity: false,
  };
}

async function prepareParentLines(
  project: typeof misProjectsTable.$inferSelect,
  lines: ParentLineInput[],
  fromDate: string,
  toDate: string,
  value: MisAccess,
  res: Response,
  requiredPermission: MisPermission = "create_entries",
  existingChildren?: Map<string, typeof misEntriesTable.$inferSelect>,
) {
  const candidates = lines.map((line, index) => ({ line, index }))
    .filter(({ line }) => (line.quantity !== undefined && line.quantity !== null)
      || (line.amount !== undefined && line.amount !== null));
  if (!candidates.length) { invalid(res, "At least one service line is required for a bulk entry"); return null; }
  const prepared: PreparedParentLine[] = [];
  const seenChildIds = new Set<string>();
  for (const { line, index } of candidates) {
    const lineFrom = line.fromDate == null ? fromDate : dateString(line.fromDate);
    const lineTo = line.toDate == null ? toDate : dateString(line.toDate);
    if (!lineFrom || !lineTo || lineFrom > lineTo) { invalid(res, `Line ${index + 1} has an invalid date range`); return null; }
    const existing = line.id ? existingChildren?.get(line.id) : undefined;
    if (line.id && !existing) { invalid(res, `Line ${index + 1} references an unknown child line`); return null; }
    if (line.id && seenChildIds.has(line.id)) { invalid(res, `Line ${index + 1} repeats a child line ID`); return null; }
    if (line.id) seenChildIds.add(line.id);
    if (existing && existing.serviceId !== line.serviceId) { invalid(res, `Line ${index + 1} cannot change its child service identity`); return null; }
    if (existing) {
      const data = {
        projectId: project.id, tabId: existing.tabId, serviceId: existing.serviceId,
         fromDate: lineFrom, toDate: lineTo, quantity: line.quantity,
         rate: line.rate, amount: line.amount, calculationMode: line.calculationMode,
        remarks: line.remarks === undefined ? existing.remarks : line.remarks,
        rateReason: line.rateReason ?? null,
      };
      const currentService = await db.select().from(misServicesTable).where(eq(misServicesTable.id, existing.serviceId)).then((rows) => rows[0]);
      const config = await historicalParentLineData(data, existing, project, currentService, value, res, requiredPermission);
      if (!config) return null;
      prepared.push({ index, existingChildId: existing.id, data, config });
      continue;
    }
    const [serviceRow] = await db.select({ service: misServicesTable, tab: misTabsTable }).from(misServicesTable)
      .innerJoin(misTabsTable, eq(misTabsTable.id, misServicesTable.tabId))
      .where(and(eq(misServicesTable.id, line.serviceId), eq(misServicesTable.projectId, project.id)));
    if (!serviceRow) { invalid(res, `Line ${index + 1} references a service that is not assigned to this project`); return null; }
    const data = {
      projectId: project.id, tabId: serviceRow.tab.id, serviceId: line.serviceId,
       fromDate: lineFrom, toDate: lineTo, quantity: line.quantity,
       rate: line.rate, amount: line.amount, calculationMode: line.calculationMode,
      remarks: line.remarks ?? null, rateReason: line.rateReason ?? null,
    };
       const config = await configuredEntryData(data, value, res, numeric(serviceRow.service.defaultRate), requiredPermission, undefined, true);
    if (!config) return null;
    prepared.push({ index, data, config });
  }
  return prepared;
}

router.patch("/mis/entries/parents/:id", requireAuth, async (req, res): Promise<void> => {
  const value = await access(req, res); if (!value) return;
  const params = MisUpdateEntryParentParams.safeParse(req.params);
  const parsed = MisUpdateEntryParentBody.safeParse(req.body);
  if (!params.success || !parsed.success) { invalid(res, "Invalid bulk parent edit body"); return; }
  const parent = await permittedParent(value, params.data.id, res); if (!parent) return;
  if (parsed.data.projectId && parsed.data.projectId !== parent.projectId) { invalid(res, "A bulk parent cannot move to another project"); return; }
  const fromDate = rawDateBody(req.body, "fromDate"), toDate = rawDateBody(req.body, "toDate");
  if (!fromDate || !toDate || fromDate > toDate) { invalid(res, "Bulk entry dates must be real calendar dates in order"); return; }
  const approved = parent.status === "approved";
  if (approved && !parsed.data.reason?.trim()) { invalid(res, "A reason is required when editing an approved MIS parent"); return; }
  if (approved ? !can(value, "edit_approved", parent.projectId) : !can(value, "edit_entries", parent.projectId)) {
    forbidden(res, approved ? "Editing an approved MIS entry requires edit_approved permission" : "Edit-entry permission required"); return;
  }
  if (!approved && parsed.data.action === "draft" && parent.status !== "draft" && !can(value, "reset", parent.projectId)) {
    forbidden(res, "Reset permission required to set a non-draft MIS parent to draft"); return;
  }
  if (!approved && parsed.data.action === "submit" && !can(value, "submit", parent.projectId)) { forbidden(res, "Submit permission required"); return; }
  const project = await parentProjectOrThrow(parent.projectId);
  const oldChildren = await db.select().from(misEntriesTable)
    .where(and(eq(misEntriesTable.parentId, parent.id), isNull(misEntriesTable.deletedAt)));
  const existingChildren = new Map(oldChildren.map((child) => [child.id, child]));
  const editPermission = approved || can(value, "edit_approved", parent.projectId) ? "edit_approved" : "edit_entries";
  const prepared = await prepareParentLines(project, parsed.data.lines, fromDate, toDate, value, res, editPermission, existingChildren);
  if (!prepared) return;
  try {
    const updated = await db.transaction(async (tx) => {
       await lockProjectPeriod(tx, parent.projectId);
       await tx.execute(sql`SELECT id FROM mis_entry_parents WHERE id = ${parent.id} FOR UPDATE`);
      await enforceParentPeriodPolicy(tx, await projectById(parent.projectId) as typeof misProjectsTable.$inferSelect, fromDate, toDate, parent.id);
      const [current] = await tx.select().from(misEntryParentsTable).where(eq(misEntryParentsTable.id, parent.id));
       if (!current || current.deletedAt) throw Object.assign(new Error("Bulk parent changed concurrently; refresh and retry"), { status: 409 });
       if (current.status === "approved" && !can(value, "edit_approved", current.projectId)) throw Object.assign(new Error("Editing an approved MIS entry requires edit_approved permission"), { status: 403 });
       if (current.status !== parent.status) throw Object.assign(new Error("Bulk parent changed concurrently; refresh and retry"), { status: 409 });
       const currentApproved = current.status === "approved";
       if (currentApproved && !parsed.data.reason?.trim()) throw Object.assign(new Error("A reason is required when editing an approved MIS parent"), { status: 400 });
       const currentPermission = currentApproved ? "edit_approved" : "edit_entries";
       if (!can(value, currentPermission, current.projectId)) throw Object.assign(new Error(`${currentPermission.replaceAll("_", " ")} permission required`), { status: 403 });
        if (!currentApproved && parsed.data.action === "draft" && current.status !== "draft" && !can(value, "reset", current.projectId)) {
          throw Object.assign(new Error("Reset permission required to set a non-draft MIS parent to draft"), { status: 403 });
        }
       if (!currentApproved && parsed.data.action === "submit" && !can(value, "submit", current.projectId)) throw Object.assign(new Error("Submit permission required"), { status: 403 });
       const targetStatus = currentApproved ? "approved" : parsed.data.action === "submit" ? "submitted" : parsed.data.action === "draft" ? "draft" : current.status;
      const oldChildren = await tx.select().from(misEntriesTable).where(and(eq(misEntriesTable.parentId, parent.id), isNull(misEntriesTable.deletedAt)));
       const preparedIds = new Set(prepared.flatMap((item) => item.existingChildId ? [item.existingChildId] : []));
       for (const child of oldChildren) {
         if (!preparedIds.has(child.id)) {
           await tx.update(misEntriesTable).set({ deletedAt: new Date(), deletedById: req.user!.id, updatedById: req.user!.id, updatedAt: new Date() }).where(eq(misEntriesTable.id, child.id));
         }
       }
      const [row] = await tx.update(misEntryParentsTable).set({
        fromDate, toDate, status: targetStatus, updatedById: req.user!.id, updatedAt: new Date(),
      }).where(eq(misEntryParentsTable.id, parent.id)).returning();
       const inserted: typeof misEntriesTable.$inferSelect[] = [];
      for (const item of prepared) {
         const { rateReason: _rateReason, amount: _amount, calculationMode: _calculationMode, ...entryData } = item.data;
         const values = {
            ...entryData, parentId: parent.id, quantity: String(item.config.quantity), rate: String(item.config.rate),
            amount: item.config.amount, calculationMode: item.config.calculationMode,
            rateEnabled: item.config.flags.rateEnabled,
            calculatePercentAgainstIncome: item.config.flags.calculatePercentAgainstIncome,
            status: targetStatus,
           projectName: item.config.project.name, tabName: item.config.tab.name, serviceName: item.config.service.name,
           type: item.config.tab.type, financialClass: item.config.tab.financialClass, unit: item.config.service.unit,
           currency: item.config.service.currency, updatedById: req.user!.id, updatedAt: new Date(),
         };
         const [child] = item.existingChildId
           ? await tx.update(misEntriesTable).set({ ...values, deletedAt: null, deletedById: null }).where(eq(misEntriesTable.id, item.existingChildId)).returning()
           : await tx.insert(misEntriesTable).values({ ...values, createdById: req.user!.id }).returning();
        inserted.push(child);
         const original = oldChildren.find((candidate) => candidate.id === item.existingChildId);
           const rateChanged = original && !item.config.costAmountQuantity
             && item.config.calculationMode === "quantity_rate"
             && numeric(original.rate) !== item.config.rate;
          const modeChanged = original && (original.calculationMode || "quantity_rate") !== item.config.calculationMode;
          if (original && (rateChanged || modeChanged)) {
           await auditMis({ entryId: child.id, projectId: child.projectId, entityType: "entry", entityId: child.id, action: "UPDATE", actorId: req.user!.id,
             remarks: item.data.rateReason ?? null,
             oldValues: original,
              newValues: { entry: child, rateAudit: rateChanged ? { originalRate: numeric(original.rate), newRate: numeric(item.config.rate), changedBy: req.user!.id, changedAt: new Date().toISOString(), reason: item.data.rateReason } : undefined,
                calculationModeAudit: modeChanged ? { originalMode: original.calculationMode || "quantity_rate", newMode: item.config.calculationMode, changedBy: req.user!.id, changedAt: new Date().toISOString() } : undefined } }, tx);
         }
      }
      const action = approved ? "EDIT_APPROVED" : "UPDATE";
      await auditMis({ projectId: row.projectId, entityType: "parent", entityId: row.id, action, actorId: req.user!.id,
        remarks: parsed.data.reason, oldValues: { parent: current, children: oldChildren }, newValues: { parent: row, children: inserted } }, tx);
      return row;
    });
    res.json(await parentResponse(updated));
  } catch (error) {
     if ((error as { status?: number }).status === 409) {
      sendPeriodConflict(res, value, parent.projectId, error as ConflictError); return;
    }
     if ((error as { status?: number }).status === 400) { invalid(res, (error as Error).message); return; }
     if ((error as { status?: number }).status === 403) { forbidden(res, (error as Error).message); return; }
    throw error;
  }
});

async function parentProjectOrThrow(projectId: string) {
  const project = await projectById(projectId);
  if (!project) throw new Error("MIS project not found");
  return project;
}

router.post("/mis/entries/parents/:id/action", requireAuth, async (req, res): Promise<void> => {
  const value = await access(req, res); if (!value) return;
  const params = MisGetEntryParentParams.safeParse(req.params);
  const parsed = MisActOnEntryParentBody.safeParse(req.body);
  if (!params.success || !parsed.success) { invalid(res); return; }
  const parent = await permittedParent(value, params.data.id, res); if (!parent) return;
  const action = parsed.data.action;
  const permission = action === "submit" ? "submit" : action === "approve" || action === "reject" || action === "return" ? "approve" : action === "reset" ? "reset" : "edit_entries";
  const approvedOverride = parent.status === "approved" && (action === "reset" || action === "cancel");
  if (!can(value, approvedOverride ? "edit_approved" : permission, parent.projectId)) {
    forbidden(res, approvedOverride ? "Changing an approved MIS entry requires edit_approved permission" : `${permission.replaceAll("_", " ")} permission required`); return;
  }
  const next: Record<string, string[]> = {
    submit: ["draft", "rejected", "returned"], approve: ["submitted"], reject: ["submitted"],
    return: ["submitted"], reset: ["submitted", "approved", "rejected", "returned", "cancelled"],
    cancel: ["draft", "rejected", "returned", "submitted", "approved"],
  };
  if (!next[action].includes(parent.status)) { conflict(res, `Cannot ${action} a bulk entry in ${parent.status} status`); return; }
  const status = action === "submit" ? "submitted" : action === "approve" ? "approved" : action === "reject" ? "rejected" : action === "return" ? "returned" : action === "reset" ? "draft" : "cancelled";
  try {
    const updated = await db.transaction(async (tx) => {
      await lockProjectPeriod(tx, parent.projectId);
      await tx.execute(sql`SELECT id FROM mis_entry_parents WHERE id = ${parent.id} FOR UPDATE`);
      const [current] = await tx.select().from(misEntryParentsTable).where(eq(misEntryParentsTable.id, parent.id));
      if (!current || current.status !== parent.status || current.deletedAt) throw Object.assign(new Error("Bulk parent changed concurrently; refresh and retry"), { status: 409 });
      const currentApprovedOverride = current.status === "approved" && (action === "reset" || action === "cancel");
      const currentPermission = currentApprovedOverride ? "edit_approved" : permission;
      if (!can(value, currentPermission, current.projectId)) throw Object.assign(new Error(`${currentPermission.replaceAll("_", " ")} permission required`), { status: 403 });
      if (!next[action].includes(current.status)) throw Object.assign(new Error(`Cannot ${action} a bulk entry in ${current.status} status`), { status: 409 });
      const [row] = await tx.update(misEntryParentsTable).set({ status, updatedById: req.user!.id, updatedAt: new Date() }).where(eq(misEntryParentsTable.id, parent.id)).returning();
      await tx.update(misEntriesTable).set({ status, updatedById: req.user!.id, updatedAt: new Date() }).where(and(eq(misEntriesTable.parentId, parent.id), isNull(misEntriesTable.deletedAt)));
      await auditMis({ projectId: row.projectId, entityType: "parent", entityId: row.id, action: action.toUpperCase(), actorId: req.user!.id, remarks: parsed.data.remarks, oldValues: { status: current.status }, newValues: { status } }, tx);
      return row;
    });
    res.json(await parentResponse(updated));
  } catch (error) {
    if ((error as { status?: number }).status === 409) { conflict(res, (error as Error).message); return; }
     if ((error as { status?: number }).status === 403) { forbidden(res, (error as Error).message); return; }
    throw error;
  }
});

router.delete("/mis/entries/parents/:id", requireAuth, async (req, res): Promise<void> => {
  const value = await access(req, res); if (!value) return;
  const params = MisDeleteEntryParentParams.safeParse(req.params); if (!params.success) { invalid(res); return; }
  const parent = await permittedParent(value, params.data.id, res); if (!parent) return;
  if (!can(value, "delete_entries", parent.projectId)) { forbidden(res); return; }
  if (parent.status === "approved" && !can(value, "delete_approved", parent.projectId)) { forbidden(res, "Deleting an approved entry requires delete_approved permission"); return; }
  if (!["draft", "rejected", "returned", "cancelled", "approved"].includes(parent.status)) { conflict(res, "Submitted bulk entries must be reset before deletion"); return; }
  const deleted = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`mis-project-period:${parent.projectId}`}))`);
    await tx.execute(sql`SELECT id FROM mis_entry_parents WHERE id = ${parent.id} FOR UPDATE`);
    const [current] = await tx.select().from(misEntryParentsTable).where(eq(misEntryParentsTable.id, parent.id));
     if (!current || current.deletedAt) throw Object.assign(new Error("Bulk parent changed concurrently; refresh and retry"), { status: 409 });
     if (current.status === "approved" && !can(value, "delete_approved", current.projectId)) throw Object.assign(new Error("Deleting an approved entry requires delete_approved permission"), { status: 403 });
     if (current.status !== parent.status) throw Object.assign(new Error("Bulk parent changed concurrently; refresh and retry"), { status: 409 });
     if (!can(value, "delete_entries", current.projectId)) throw Object.assign(new Error("Delete-entry permission required"), { status: 403 });
     if (current.status === "approved" && !can(value, "delete_approved", current.projectId)) throw Object.assign(new Error("Deleting an approved entry requires delete_approved permission"), { status: 403 });
     if (!["draft", "rejected", "returned", "cancelled", "approved"].includes(current.status)) throw Object.assign(new Error("Submitted bulk entries must be reset before deletion"), { status: 409 });
    const now = new Date();
    const children = await tx.select().from(misEntriesTable).where(and(eq(misEntriesTable.parentId, parent.id), isNull(misEntriesTable.deletedAt)));
    await tx.update(misEntryParentsTable).set({ deletedAt: now, deletedById: req.user!.id, updatedById: req.user!.id, updatedAt: now }).where(eq(misEntryParentsTable.id, parent.id));
    await tx.update(misEntriesTable).set({ deletedAt: now, deletedById: req.user!.id, updatedById: req.user!.id, updatedAt: now }).where(and(eq(misEntriesTable.parentId, parent.id), isNull(misEntriesTable.deletedAt)));
    await auditMis({ projectId: parent.projectId, entityType: "parent", entityId: parent.id, action: "DELETE", actorId: req.user!.id, oldValues: current }, tx);
    for (const child of children) {
      await auditMis({ entryId: child.id, projectId: child.projectId, entityType: "entry", entityId: child.id, action: "DELETE", actorId: req.user!.id, oldValues: child }, tx);
    }
     return true;
  }).catch((error: unknown) => {
    if ((error as { status?: number }).status === 409) { conflict(res, (error as Error).message); return false; }
     if ((error as { status?: number }).status === 403) { forbidden(res, (error as Error).message); return false; }
    throw error;
  });
  if (!deleted) return;
  res.json({ success: true, parentId: parent.id, bulkNumber: parent.bulkNumber });
});

router.get("/mis/entries/parents/:id/history", requireAuth, async (req, res): Promise<void> => {
  const value = await access(req, res); if (!value) return;
  const params = MisGetEntryParentHistoryParams.safeParse(req.params); if (!params.success) { invalid(res); return; }
  const parent = await permittedParent(value, params.data.id, res); if (!parent) return;
  if (!can(value, "history", parent.projectId) && !can(value, "view_entries", parent.projectId)) { forbidden(res); return; }
  const rows = await db.select({ audit: misAuditLogTable, user: usersTable }).from(misAuditLogTable)
    .leftJoin(usersTable, eq(usersTable.id, misAuditLogTable.actorId))
    .where(and(eq(misAuditLogTable.entityType, "parent"), eq(misAuditLogTable.entityId, parent.id)))
    .orderBy(desc(misAuditLogTable.occurredAt));
  res.json(rows.map(({ audit, user }) => ({
    id: audit.id, entryId: audit.entryId ?? parent.id, parentId: parent.id, bulkNumber: parent.bulkNumber,
    action: audit.action, actorId: audit.actorId, actorName: user ? displayName(user) : null,
    remarks: audit.remarks, oldValues: audit.oldValues, newValues: audit.newValues, occurredAt: audit.occurredAt,
  })));
});

async function permittedEntry(accessValue: MisAccess, entryId: string, res: Response, lock = false) {
  const row = (await db.select().from(misEntriesTable).where(eq(misEntriesTable.id, entryId)))[0];
  if (!row || row.deletedAt) { notFound(res, "MIS entry not found"); return null; }
  if (!canAccessProject(accessValue, row.projectId)) { forbidden(res, "No access to this MIS entry"); return null; }
  return row;
}
function rejectChildMutation(accessValue: MisAccess, entry: typeof misEntriesTable.$inferSelect, res: Response) {
  if (!entry.parentId) return false;
  if (!can(accessValue, "view_entries", entry.projectId)) { forbidden(res); return true; }
  res.status(409).json({
    error: "This MIS line belongs to an atomic bulk entry. Modify the parent bulk entry instead.",
    parentId: entry.parentId,
    openUrl: `/mis/entries/parents/${entry.parentId}`,
  });
  return true;
}
router.get("/mis/entries/:id", requireAuth, async (req, res): Promise<void> => {
  const value = await access(req, res); if (!value) return;
  const params = MisGetEntryParams.safeParse(req.params); if (!params.success) { invalid(res); return; }
  const entry = await permittedEntry(value, params.data.id, res); if (!entry) return;
  if (!can(value, "view_entries", entry.projectId) && !can(value, "history", entry.projectId)) { forbidden(res); return; }
  res.json(await entryResponse(entry));
});
router.delete("/mis/entries/:id", requireAuth, async (req, res): Promise<void> => {
  const value = await access(req, res); if (!value) return;
  const entryId = id(req); const before = await permittedEntry(value, entryId, res); if (!before) return;
  if (rejectChildMutation(value, before, res)) return;
  if (!can(value, "delete_entries", before.projectId)) { forbidden(res); return; }
  if (before.status === "approved" && !can(value, "delete_approved", before.projectId)) { forbidden(res, "Deleting an approved entry requires delete_approved permission"); return; }
  if (!["draft", "rejected", "returned", "cancelled", "approved"].includes(before.status)) { conflict(res, "Submitted entries must be reset before deletion"); return; }
  try {
    await db.transaction(async (tx) => {
      await lockProjectPeriod(tx, before.projectId);
      await tx.execute(sql`SELECT id FROM mis_entries WHERE id = ${before.id} FOR UPDATE`);
      const [current] = await tx.select().from(misEntriesTable).where(eq(misEntriesTable.id, before.id));
      if (!current || current.deletedAt) throw Object.assign(new Error("Entry changed concurrently; refresh and retry"), { status: 409 });
      if (current.status === "approved" && !can(value, "delete_approved", current.projectId)) throw Object.assign(new Error("Deleting an approved entry requires delete_approved permission"), { status: 403 });
      if (current.status !== before.status) throw Object.assign(new Error("Entry changed concurrently; refresh and retry"), { status: 409 });
      if (current.parentId) throw Object.assign(new Error("This MIS line belongs to an atomic bulk entry. Modify the parent bulk entry instead."), { status: 409 });
      if (!can(value, "delete_entries", current.projectId)) throw Object.assign(new Error("Delete-entry permission required"), { status: 403 });
      if (current.status === "approved" && !can(value, "delete_approved", current.projectId)) throw Object.assign(new Error("Deleting an approved entry requires delete_approved permission"), { status: 403 });
      if (!["draft", "rejected", "returned", "cancelled", "approved"].includes(current.status)) throw Object.assign(new Error("Submitted entries must be reset before deletion"), { status: 409 });
      await tx.update(misEntriesTable).set({ deletedAt: new Date(), deletedById: req.user!.id, updatedById: req.user!.id, updatedAt: new Date() }).where(eq(misEntriesTable.id, current.id));
      await auditMis({ entryId: current.id, projectId: current.projectId, entityType: "entry", entityId: current.id, action: "DELETE", actorId: req.user!.id, oldValues: current }, tx);
    });
  } catch (error) {
    if ((error as { status?: number }).status === 403) { forbidden(res, (error as Error).message); return; }
    if ((error as { status?: number }).status === 409) { conflict(res, (error as Error).message); return; }
    throw error;
  }
  res.json({ success: true });
});
router.post("/mis/entries/:id/action", requireAuth, async (req, res): Promise<void> => {
  const value = await access(req, res); if (!value) return;
  const parsed = MisActOnEntryBody.safeParse(req.body); if (!parsed.success) { invalid(res); return; }
  const entryId = id(req); const before = await permittedEntry(value, entryId, res); if (!before) return;
  if (rejectChildMutation(value, before, res)) return;
  const action = parsed.data.action;
  const permission = action === "submit" ? "submit" : action === "approve" || action === "reject" || action === "return" ? "approve" : action === "reset" ? "reset" : "edit_entries";
  if (before.status === "approved" && (action === "reset" || action === "cancel") && !can(value, "edit_approved", before.projectId)) {
    forbidden(res, "Changing an approved MIS entry requires edit_approved permission"); return;
  }
  if (!can(value, permission, before.projectId)) { forbidden(res); return; }
  const next: Record<string, string[]> = {
    submit: ["draft", "rejected", "returned"], approve: ["submitted"], reject: ["submitted"], return: ["submitted"], reset: ["submitted", "approved", "rejected", "returned", "cancelled"], cancel: ["draft", "rejected", "returned", "submitted", "approved"],
  };
  if (!next[action].includes(before.status)) { conflict(res, `Cannot ${action} an entry in ${before.status} status`); return; }
  const status = action === "submit" ? "submitted" : action === "approve" ? "approved" : action === "reject" ? "rejected" : action === "return" ? "returned" : action === "reset" ? "draft" : "cancelled";
  const updated = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM mis_entries WHERE id = ${before.id} FOR UPDATE`);
    const [current] = await tx.select().from(misEntriesTable).where(eq(misEntriesTable.id, before.id));
    if (!current || current.status !== before.status || current.deletedAt) throw Object.assign(new Error("Entry changed concurrently; refresh and retry"), { status: 409 });
    const [row] = await tx.update(misEntriesTable).set({ status, updatedById: req.user!.id, updatedAt: new Date() }).where(eq(misEntriesTable.id, before.id)).returning();
    await auditMis({ entryId: row.id, projectId: row.projectId, entityType: "entry", entityId: row.id, action: action.toUpperCase(), actorId: req.user!.id, remarks: parsed.data.remarks, oldValues: { status: before.status }, newValues: { status } }, tx);
    return row;
  }).catch((error: unknown) => {
    if ((error as { status?: number }).status === 409) return null;
    throw error;
  });
  if (!updated) { conflict(res, "Entry changed concurrently; refresh and retry"); return; }
  res.json(await entryResponse(updated));
});
router.get("/mis/entries/:id/history", requireAuth, async (req, res): Promise<void> => {
  const value = await access(req, res); if (!value) return;
  const params = MisGetEntryHistoryParams.safeParse(req.params); if (!params.success) { invalid(res); return; }
  const entry = await permittedEntry(value, params.data.id, res); if (!entry) return;
  if (!can(value, "history", entry.projectId) && !can(value, "view_entries", entry.projectId)) { forbidden(res); return; }
  const rows = await db.select({ audit: misAuditLogTable, user: usersTable }).from(misAuditLogTable)
    .leftJoin(usersTable, eq(usersTable.id, misAuditLogTable.actorId)).where(eq(misAuditLogTable.entryId, entry.id)).orderBy(desc(misAuditLogTable.occurredAt));
  res.json(rows.map(({ audit, user }) => ({ id: audit.id, entryId: entry.id, action: audit.action, actorId: audit.actorId, actorName: user ? displayName(user) : null, remarks: audit.remarks, oldValues: audit.oldValues, newValues: audit.newValues, occurredAt: audit.occurredAt })));
});

type ReportFilter = { projectIds?: string; tabId?: string; serviceId?: string; from?: Date; to?: Date; status?: string; entryType?: string; search?: string; currency?: string };
async function filteredReportEntries(accessValue: MisAccess, filter: ReportFilter, res: Response, limit?: number) {
  const requested = filter.projectIds?.split(",").map((item) => item.trim()).filter(Boolean);
  if (requested?.some((projectId) => !canAccessProject(accessValue, projectId))) { forbidden(res, "One or more requested projects are not permitted"); return null; }
  const scope = requested ?? (accessValue.globalAccess ? undefined : accessValue.projectIds);
  if (scope && !scope.length) return [];
  const conditions = [isNull(misEntriesTable.deletedAt), ...(filter.status === "all" ? [] : [eq(misEntriesTable.status, filter.status ?? "approved")]),
    ...(scope ? [inArray(misEntriesTable.projectId, scope)] : []), ...(filter.tabId ? [eq(misEntriesTable.tabId, filter.tabId)] : []),
    ...(filter.serviceId ? [eq(misEntriesTable.serviceId, filter.serviceId)] : []), ...(filter.currency ? [eq(misEntriesTable.currency, filter.currency.toUpperCase())] : []),
    // Reports use fully-contained periods, never prorated or overlapping records.
    ...(filter.from ? [gte(misEntriesTable.fromDate, dateString(filter.from))] : []), ...(filter.to ? [lte(misEntriesTable.toDate, dateString(filter.to))] : []),
    ...(filter.entryType ? [eq(misEntriesTable.type, filter.entryType)] : []),
    ...(filter.search ? [sql`(${misEntriesTable.projectName} ILIKE ${`%${filter.search}%`} OR ${misEntriesTable.tabName} ILIKE ${`%${filter.search}%`} OR ${misEntriesTable.serviceName} ILIKE ${`%${filter.search}%`})`] : [])];
  return (await db.select({ entry: misEntriesTable }).from(misEntriesTable)
    .innerJoin(misTabsTable, eq(misTabsTable.id, misEntriesTable.tabId))
    .where(and(...conditions, eq(misTabsTable.allowReporting, true))).orderBy(desc(misEntriesTable.updatedAt)).limit(limit ?? 10_000)).map(({ entry }) => entry);
}
type AggregateRow = { currency: string; projectId: string | null; projectName: string | null; projectCode: string | null; tabId: string | null; tabName: string | null; type: string | null; financialClass: string | null; serviceId: string | null; serviceName: string | null; periodStart: string | null; periodEnd: string | null; income: string; cost: string; expenses: string; salaries: string; totalAmount: string; calculatePercentAgainstIncome: boolean | null; serviceOrder: number | null; entryCount: number };
const zeroDimension = (name: string) => sql<string | null>`NULL`.as(name);
const zeroBooleanDimension = (name: string) => sql<boolean | null>`NULL`.as(name);
const zeroNumberDimension = (name: string) => sql<number | null>`NULL`.as(name);
const aggregateAmount = (financialClass: string, name: string) => sql<string>`COALESCE(SUM(CASE WHEN ${misEntriesTable.financialClass} = ${financialClass} THEN ${misEntriesTable.amount} ELSE 0 END), 0)`.as(name);
async function aggregateReporting(accessValue: MisAccess, filter: ReportFilter, reportType: string, dimensions: "currency" | "group"): Promise<AggregateRow[]> {
  const requested = filter.projectIds?.split(",").map((item) => item.trim()).filter(Boolean);
  const scope = requested ?? (accessValue.globalAccess ? undefined : accessValue.projectIds);
  if (scope && !scope.length) return [];
  const full = ["income", "cost", "expense", "salary"].includes(reportType);
  const byProject = ["project-profitability", "project-comparison", "summary"].includes(reportType);
  const byPeriod = reportType === "period-comparison";
  const serviceTab = reportType === "service-tab-comparison";
  const tabOnly = reportType === "dashboard-tab";
  const include = dimensions === "group";
  const fields = {
    currency: misEntriesTable.currency,
    projectId: include && (full || byProject) ? misEntriesTable.projectId : zeroDimension("projectId"),
    projectName: include && (full || byProject) ? misEntriesTable.projectName : zeroDimension("projectName"),
    projectCode: include && (full || byProject) ? misProjectsTable.code : zeroDimension("projectCode"),
    tabId: include && (full || serviceTab || tabOnly) ? misEntriesTable.tabId : zeroDimension("tabId"),
    tabName: include && (full || serviceTab || tabOnly) ? misEntriesTable.tabName : zeroDimension("tabName"),
    type: include && (full || serviceTab || tabOnly) ? misEntriesTable.type : zeroDimension("type"),
    financialClass: include && (full || serviceTab || tabOnly) ? misEntriesTable.financialClass : zeroDimension("financialClass"),
    serviceId: include && (full || serviceTab) ? misEntriesTable.serviceId : zeroDimension("serviceId"),
    serviceName: include && (full || serviceTab) ? misEntriesTable.serviceName : zeroDimension("serviceName"),
    periodStart: include && byPeriod ? misEntriesTable.fromDate : zeroDimension("periodStart"),
    periodEnd: include && byPeriod ? misEntriesTable.toDate : zeroDimension("periodEnd"),
    income: aggregateAmount("income", "income"), cost: aggregateAmount("cost", "cost"), expenses: aggregateAmount("expense", "expenses"), salaries: aggregateAmount("salary", "salaries"),
    totalAmount: sql<string>`COALESCE(SUM(${misEntriesTable.amount}), 0)`.as("totalAmount"),
    calculatePercentAgainstIncome: include
      ? sql<boolean | null>`CASE WHEN BOOL_AND(${misEntriesTable.calculatePercentAgainstIncome} IS TRUE) THEN TRUE WHEN BOOL_OR(${misEntriesTable.calculatePercentAgainstIncome} IS TRUE) THEN NULL ELSE FALSE END`.as("calculatePercentAgainstIncome")
      : zeroBooleanDimension("calculatePercentAgainstIncome"),
    serviceOrder: include && (full || serviceTab) ? misServicesTable.sequence : zeroNumberDimension("serviceOrder"),
    entryCount: sql<number>`COUNT(*)::int`.as("entryCount"),
  };
  const grouping: (
    | typeof misEntriesTable.currency
    | typeof misEntriesTable.projectId
    | typeof misEntriesTable.projectName
    | typeof misProjectsTable.code
    | typeof misEntriesTable.tabId
    | typeof misEntriesTable.tabName
    | typeof misEntriesTable.type
    | typeof misEntriesTable.financialClass
    | typeof misEntriesTable.serviceId
    | typeof misEntriesTable.serviceName
    | typeof misEntriesTable.fromDate
    | typeof misEntriesTable.toDate
     | typeof misServicesTable.sequence
  )[] = [misEntriesTable.currency];
  if (include && (full || byProject)) grouping.push(misEntriesTable.projectId, misEntriesTable.projectName, misProjectsTable.code);
  if (include && (full || serviceTab || tabOnly)) grouping.push(misEntriesTable.tabId, misEntriesTable.tabName, misEntriesTable.type, misEntriesTable.financialClass);
  if (include && (full || serviceTab)) grouping.push(misEntriesTable.serviceId, misEntriesTable.serviceName);
   if (include && (full || serviceTab)) grouping.push(misServicesTable.sequence);
  if (include && byPeriod) grouping.push(misEntriesTable.fromDate, misEntriesTable.toDate);
  const financialClass = full ? reportType : undefined;
  const conditions = [isNull(misEntriesTable.deletedAt), ...(filter.status === "all" ? [] : [eq(misEntriesTable.status, filter.status ?? "approved")]), eq(misTabsTable.allowReporting, true),
    ...(scope ? [inArray(misEntriesTable.projectId, scope)] : []), ...(filter.tabId ? [eq(misEntriesTable.tabId, filter.tabId)] : []), ...(filter.serviceId ? [eq(misEntriesTable.serviceId, filter.serviceId)] : []), ...(filter.currency ? [eq(misEntriesTable.currency, filter.currency.toUpperCase())] : []),
    ...(filter.from ? [gte(misEntriesTable.fromDate, dateString(filter.from))] : []), ...(filter.to ? [lte(misEntriesTable.toDate, dateString(filter.to))] : []), ...(filter.entryType ? [eq(misEntriesTable.type, filter.entryType)] : []), ...(financialClass ? [eq(misEntriesTable.financialClass, financialClass)] : []),
    ...(filter.search ? [sql`(${misEntriesTable.projectName} ILIKE ${`%${filter.search}%`} OR ${misEntriesTable.tabName} ILIKE ${`%${filter.search}%`} OR ${misEntriesTable.serviceName} ILIKE ${`%${filter.search}%`})`] : [])];
  return db.select(fields).from(misEntriesTable)
    .innerJoin(misTabsTable, eq(misTabsTable.id, misEntriesTable.tabId))
    .innerJoin(misProjectsTable, eq(misProjectsTable.id, misEntriesTable.projectId))
    .innerJoin(misServicesTable, eq(misServicesTable.id, misEntriesTable.serviceId))
    .where(and(...conditions)).groupBy(...grouping) as Promise<AggregateRow[]>;
}
function aggregateTotals(row: AggregateRow, includeFinancial: boolean) {
  const fixed = (source: string) => {
    const [whole, fraction = ""] = source.split(".");
    return BigInt(whole) * 1_000_000n + BigInt((fraction + "000000").slice(0, 6));
  };
  const jsonNumber = (value: bigint) => Number(value) / 1_000_000;
  const incomeRaw = fixed(row.income), costRaw = fixed(row.cost), expensesRaw = fixed(row.expenses), salariesRaw = fixed(row.salaries);
  const grossRaw = includeFinancial ? incomeRaw - costRaw - expensesRaw - salariesRaw : 0n, netRaw = grossRaw;
  // SQL performs all aggregation as NUMERIC. Keep fixed-point arithmetic for
  // the derived values too; conversion to JSON numbers happens only here.
  const margin = includeFinancial && incomeRaw !== 0n ? Number((netRaw * 10_000n) / incomeRaw) / 100 : 0;
  return { income: jsonNumber(incomeRaw), cost: jsonNumber(costRaw), expenses: jsonNumber(expensesRaw), salaries: jsonNumber(salariesRaw), totalAmount: jsonNumber(fixed(row.totalAmount)), grossProfit: jsonNumber(grossRaw), netProfit: jsonNumber(netRaw), profitMargin: margin, entryCount: row.entryCount };
}
const aggregateKey = (row: AggregateRow) => [row.currency, row.projectId, row.tabId, row.serviceId, row.periodStart, row.periodEnd].join("|");
const emptyAggregate = (currency: string): AggregateRow => ({ currency, projectId: null, projectName: null, projectCode: null, tabId: null, tabName: null, type: null, financialClass: null, serviceId: null, serviceName: null, periodStart: null, periodEnd: null, income: "0", cost: "0", expenses: "0", salaries: "0", totalAmount: "0", calculatePercentAgainstIncome: false, serviceOrder: null, entryCount: 0 });
async function report(accessValue: MisAccess, filter: ReportFilter & { reportType: string; compareFrom?: Date; compareTo?: Date }, _res: Response, includeFinancial: boolean) {
  const [currentTotals, currentGroups, comparedTotals, comparedGroups] = await Promise.all([
    aggregateReporting(accessValue, filter, filter.reportType, "currency"),
    aggregateReporting(accessValue, filter, filter.reportType, "group"),
    filter.compareFrom || filter.compareTo ? aggregateReporting(accessValue, { ...filter, from: filter.compareFrom, to: filter.compareTo }, filter.reportType, "currency") : Promise.resolve([]),
    filter.compareFrom || filter.compareTo ? aggregateReporting(accessValue, { ...filter, from: filter.compareFrom, to: filter.compareTo }, filter.reportType, "group") : Promise.resolve([]),
  ]);
  // Base currencies include other reporting-enabled classes so an income-only
  // report still shows an explicitly zero group for a selected cost currency.
  const baseline = await aggregateReporting(accessValue, filter, "summary", "currency");
  const totalByCurrency = new Map(currentTotals.map((row) => [row.currency, row]));
  const compareByCurrency = new Map(comparedTotals.map((row) => [row.currency, row]));
  const groupByCurrency = new Map<string, AggregateRow[]>(), comparisonByKey = new Map(comparedGroups.map((row) => [aggregateKey(row), row]));
  for (const row of currentGroups) groupByCurrency.set(row.currency, [...(groupByCurrency.get(row.currency) ?? []), row]);
  const currencies = new Set([...baseline, ...currentTotals, ...comparedTotals, ...currentGroups, ...comparedGroups].map((row) => row.currency));
   return { reportType: filter.reportType, currencyGroups: [...currencies].sort().map((currency) => {
    const groupRows = [...new Map([...(groupByCurrency.get(currency) ?? []).map((row) => [aggregateKey(row), row] as const), ...comparedGroups.filter((row) => row.currency === currency).map((row) => [aggregateKey(row), row] as const)]).entries()].map(([key, representative]) => {
      const current = (groupByCurrency.get(currency) ?? []).find((row) => aggregateKey(row) === key) ?? emptyAggregate(currency);
      const comparison = comparisonByKey.get(key);
      return {
        projectId: representative.projectId, projectName: representative.projectName, projectCode: representative.projectCode,
        tabId: representative.tabId, tabName: representative.tabName, type: representative.type, serviceId: representative.serviceId,
        serviceName: representative.serviceName, periodStart: representative.periodStart, periodEnd: representative.periodEnd,
        serviceOrder: representative.serviceOrder, calculatePercentAgainstIncome: representative.calculatePercentAgainstIncome,
        currentTotals: aggregateTotals(current, includeFinancial),
        comparisonTotals: filter.compareFrom || filter.compareTo ? aggregateTotals(comparison ?? emptyAggregate(currency), includeFinancial) : null,
      };
    }).sort((left, right) => {
      const leftOrder = left.serviceOrder ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = right.serviceOrder ?? Number.MAX_SAFE_INTEGER;
      return leftOrder - rightOrder || String(left.serviceId ?? "").localeCompare(String(right.serviceId ?? ""));
    });
    return {
      currency, currentTotals: aggregateTotals(totalByCurrency.get(currency) ?? emptyAggregate(currency), includeFinancial),
      comparisonTotals: filter.compareFrom || filter.compareTo ? aggregateTotals(compareByCurrency.get(currency) ?? emptyAggregate(currency), includeFinancial) : null,
      groups: groupRows,
    };
  }) };
}
router.get("/mis/reports", requireAuth, async (req, res): Promise<void> => {
  const value = await access(req, res); if (!value) return;
  const q = parsedQuery(MisGetReportQueryParams, req); if (!q) { invalid(res, "Invalid report filters"); return; }
  if (!can(value, "reports") && ![...value.projectPermissions.values()].some((p) => p.has("reports"))) { forbidden(res); return; }
  const requiresFinancial = ["summary", "project-profitability", "project-comparison", "period-comparison"].includes(q.reportType);
  if (requiresFinancial && !can(value, "financial") && ![...value.projectPermissions.values()].some((p) => p.has("financial"))) { forbidden(res, "Financial permission is required for this report"); return; }
  if ((q.compareFrom && !q.compareTo) || (!q.compareFrom && q.compareTo) || (q.compareFrom && q.compareTo && dateString(q.compareFrom) > dateString(q.compareTo)) || (q.from && q.to && dateString(q.from) > dateString(q.to))) { invalid(res, "Report dates must be complete calendar ranges"); return; }
  const permitted = await permittedProjectIds(value, requiresFinancial ? ["reports", "financial"] : ["reports"]);
  const requested = q.projectIds?.split(",").map((part) => part.trim()).filter(Boolean);
  if (requested?.some((projectId) => !canAccessProject(value, projectId) || (permitted && !permitted.includes(projectId)))) { forbidden(res, "One or more requested projects are not permitted"); return; }
  const result = await report(value, { ...q, projectIds: requested ? requested.join(",") : permitted?.join(",") }, res, requiresFinancial); if (!result) return; res.json(result);
});
function spreadsheetText(value: unknown) {
  const text = String(value ?? "");
  // Prevent names/remarks beginning with a spreadsheet formula marker from
  // becoming formulas when CSV or XLSX is opened.
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}
function csvEscape(value: unknown) { const text = typeof value === "number" ? String(value) : spreadsheetText(value); return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; }
type ReportData = NonNullable<Awaited<ReturnType<typeof report>>>;
type ReportTotals = ReportData["currencyGroups"][number]["currentTotals"];
export function reportExportRows(data: ReportData): unknown[][] {
  const header = ["row_type", "currency", "project", "tab", "service", "period_start", "period_end", "current_income", "current_cost", "current_expenses", "current_salaries", "current_gross_profit", "current_net_profit", "current_profit_margin", "current_entry_count", "comparison_income", "comparison_cost", "comparison_expenses", "comparison_salaries", "comparison_gross_profit", "comparison_net_profit", "comparison_profit_margin", "comparison_entry_count"];
  const values = (current: { income: number; cost: number; expenses: number; salaries: number; grossProfit: number; netProfit: number; profitMargin: number; entryCount: number }, comparison: typeof current | null) => [current.income, current.cost, current.expenses, current.salaries, current.grossProfit, current.netProfit, current.profitMargin, current.entryCount, comparison?.income ?? 0, comparison?.cost ?? 0, comparison?.expenses ?? 0, comparison?.salaries ?? 0, comparison?.grossProfit ?? 0, comparison?.netProfit ?? 0, comparison?.profitMargin ?? 0, comparison?.entryCount ?? 0];
  const rows: unknown[][] = [header];
  for (const currencyGroup of data.currencyGroups) {
    rows.push(["currency_total", currencyGroup.currency, null, null, null, null, null, null, ...values(currencyGroup.currentTotals, currencyGroup.comparisonTotals)]);
    for (const row of currencyGroup.groups) rows.push(["group", currencyGroup.currency, row.projectName, row.tabName, row.serviceName, row.periodStart, row.periodEnd, ...values(row.currentTotals, row.comparisonTotals)]);
  }
  return rows;
}
export function reportCsv(data: ReportData) {
  return reportExportRows(data).map((row) => row.map(csvEscape).join(",")).join("\r\n");
}
export function reportPdf(data: ReportData, metadata?: PresentationMetadata): Promise<Buffer> {
  return professionalReportPdf(data, metadata);
}
router.get("/mis/reports/export", requireAuth, async (req, res): Promise<void> => {
  const value = await access(req, res); if (!value) return;
  const q = parsedQuery(MisExportReportQueryParams, req); if (!q) { invalid(res, "Invalid export filters"); return; }
  const requiresFinancial = ["summary", "project-profitability", "project-comparison", "period-comparison"].includes(q.reportType);
  if ((!can(value, "reports") && ![...value.projectPermissions.values()].some((p) => p.has("reports"))) || (!can(value, "export") && ![...value.projectPermissions.values()].some((p) => p.has("export"))) || (requiresFinancial && !can(value, "financial") && ![...value.projectPermissions.values()].some((p) => p.has("financial")))) { forbidden(res, requiresFinancial ? "Reports, export, and financial permissions are required" : "Reports and export permissions are required"); return; }
  const permitted = await permittedProjectIds(value, requiresFinancial ? ["reports", "financial", "export"] : ["reports", "export"]);
  const requested = q.projectIds?.split(",").map((part) => part.trim()).filter(Boolean);
  if (requested?.some((projectId) => !canAccessProject(value, projectId) || (permitted && !permitted.includes(projectId)))) { forbidden(res, "One or more requested projects are not permitted"); return; }
  const data = await report(value, { ...q, projectIds: requested ? requested.join(",") : permitted?.join(",") }, res, requiresFinancial); if (!data) return;
  const fileBase = `mis-${q.reportType}`;
  if (q.format === "csv") { res.type("text/csv").attachment(`${fileBase}.csv`).send(reportCsv(data)); return; }
  const metadata: PresentationMetadata = {
    title: `QNC MIS — ${q.reportType.replaceAll("-", " ")}`,
    reportType: q.reportType,
    from: q.from ? dateString(q.from) : null,
    to: q.to ? dateString(q.to) : null,
    compareFrom: q.compareFrom ? dateString(q.compareFrom) : null,
    compareTo: q.compareTo ? dateString(q.compareTo) : null,
    filters: {
      projectIds: requested ?? [],
      tabId: q.tabId ?? null,
      serviceId: q.serviceId ?? null,
      status: q.status ?? "approved",
      entryType: q.entryType ?? null,
      search: q.search ?? null,
      currency: q.currency ?? null,
    },
  };
  if (q.format === "xlsx") { res.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").attachment(`${fileBase}.xlsx`).send(reportXlsx(data, metadata)); return; }
  res.type("application/pdf").attachment(`${fileBase}.pdf`).send(await reportPdf(data, metadata));
});

type DashboardQuery = NonNullable<ReturnType<typeof MisGetDashboardQueryParams.parse>>;
/** Shared dashboard computation used by the JSON view and the PDF/XLSX exports. */
async function dashboardPayload(value: MisAccess, q: DashboardQuery, requested: string[] | undefined, permitted: string[] | undefined, res: Response) {
  const filter = { ...q, projectIds: requested ? requested.join(",") : permitted?.join(",") };
  const [currencyTotals, projectRows, tabRows, periodRows, entries, serviceRows] = await Promise.all([
    aggregateReporting(value, filter, "summary", "currency"),
    aggregateReporting(value, filter, "summary", "group"),
    aggregateReporting(value, filter, "dashboard-tab", "group"),
    aggregateReporting(value, filter, "period-comparison", "group"),
    filteredReportEntries(value, filter, res, 10),
    q.includeServices === "true" ? aggregateReporting(value, filter, "service-tab-comparison", "group") : Promise.resolve([] as AggregateRow[]),
  ]);
  if (!entries) return;
  const users = await userMap(entries.flatMap((entry) => [entry.createdById, entry.updatedById]));
  const dashboardParentIds = entries.map((entry) => entry.parentId).filter((parentId): parentId is string => Boolean(parentId));
  const dashboardParents = dashboardParentIds.length ? await db.select({ id: misEntryParentsTable.id, bulkNumber: misEntryParentsTable.bulkNumber }).from(misEntryParentsTable).where(inArray(misEntryParentsTable.id, dashboardParentIds)) : [];
  const dashboardBulkNumbers = new Map(dashboardParents.map((row) => [row.id, row.bulkNumber]));
  const byCurrency = <T extends AggregateRow>(rows: T[]) => new Map<string, T[]>([...new Set(rows.map((row) => row.currency))].map((currency) => [currency, rows.filter((row) => row.currency === currency)]));
  const projectsByCurrency = byCurrency(projectRows), tabsByCurrency = byCurrency(tabRows), periodsByCurrency = byCurrency(periodRows);
  const currencyGroups = currencyTotals.sort((left, right) => left.currency.localeCompare(right.currency)).map((total) => ({
    currency: total.currency, totals: aggregateTotals(total, true),
    ...(q.includeServices === "true" ? {
      byService: serviceRows.filter((row) => row.currency === total.currency).map((row) => ({
        serviceId: row.serviceId!, serviceName: row.serviceName!, tabId: row.tabId!, tabName: row.tabName!,
        financialClass: row.financialClass!, totals: aggregateTotals(row, true),
      })).sort((a, b) => a.serviceName.localeCompare(b.serviceName) || a.serviceId.localeCompare(b.serviceId)),
    } : {}),
    byProject: (projectsByCurrency.get(total.currency) ?? []).map((row) => ({ projectId: row.projectId!, projectName: row.projectName!, totals: aggregateTotals(row, true) })).sort((a, b) => a.projectName.localeCompare(b.projectName)),
    byTab: (tabsByCurrency.get(total.currency) ?? []).map((row) => ({ tabId: row.tabId!, tabName: row.tabName!, type: row.type!, financialClass: row.financialClass!, totals: aggregateTotals(row, true) })).sort((a, b) => a.tabName.localeCompare(b.tabName)),
    byPeriod: (periodsByCurrency.get(total.currency) ?? []).map((row) => ({ fromDate: row.periodStart!, toDate: row.periodEnd!, totals: aggregateTotals(row, true) })).sort((a, b) => a.fromDate.localeCompare(b.fromDate)),
  }));
  // Use combined selected-project income, including settings from selected
  // projects without entries in this period. Never combine currency bases.
  const adjustmentBaseRows = await aggregateReporting(value, {
    projectIds: filter.projectIds, from: filter.from, to: filter.to, status: filter.status,
  }, "summary", "group");
  const selectedIds = requested ?? permitted;
  const selectedProjects = await db.select({ id: misProjectsTable.id, name: misProjectsTable.name }).from(misProjectsTable)
    .where(selectedIds ? inArray(misProjectsTable.id, selectedIds) : undefined);
  const percentageAdjustments = await dashboardPercentageAdjustments(value, adjustmentBaseRows.map((row) => ({
    projectId: row.projectId!, projectName: row.projectName!, currency: row.currency,
    income: String(row.income), baseProfit: aggregateTotals(row, true).netProfit,
  })), selectedProjects);
  const adjustedGroups = currencyGroups.map((group) => {
    const adjustedNetProfit = adjustedDashboardProfit(value, selectedProjects.map((project) => project.id), group.totals.netProfit,
      percentageAdjustments.filter((row) => row.currency === group.currency));
    return { ...group, ...(adjustedNetProfit !== undefined ? { adjustedNetProfit } : {}) };
  });
  return { currencyGroups: adjustedGroups, percentageAdjustments, recentEntries: entries.map((entry) => serializeEntry(entry, users, entry.parentId ? dashboardBulkNumbers.get(entry.parentId) ?? null : null)) };
}

router.get("/mis/dashboard", requireAuth, async (req, res): Promise<void> => {
  const value = await access(req, res); if (!value) return;
  const q = parsedQuery(MisGetDashboardQueryParams, req); if (!q) { invalid(res, "Invalid dashboard filters"); return; }
  if (!can(value, "reports") && ![...value.projectPermissions.values()].some((p) => p.has("reports")) || !can(value, "financial") && ![...value.projectPermissions.values()].some((p) => p.has("financial")) ) { res.json({ currencyGroups: [], recentEntries: [] }); return; }
  if (q.from && q.to && dateString(q.from) > dateString(q.to)) { invalid(res, "Dashboard date range is invalid"); return; }
  const permitted = await permittedProjectIds(value, ["reports", "financial"]);
  const requested = q.projectIds?.split(",").map((part) => part.trim()).filter(Boolean);
  if (requested?.some((projectId) => !canAccessProject(value, projectId) || (permitted && !permitted.includes(projectId)))) { forbidden(res, "One or more requested projects are not permitted"); return; }
  const payload = await dashboardPayload(value, q, requested, permitted, res); if (!payload) return;
  res.json(payload);
});

router.get("/mis/dashboard/export", requireAuth, async (req, res): Promise<void> => {
  const value = await access(req, res); if (!value) return;
  const q = parsedQuery(MisExportDashboardQueryParams, req); if (!q) { invalid(res, "Invalid dashboard export filters"); return; }
  if (q.from && q.to && dateString(q.from) > dateString(q.to)) { invalid(res, "Dashboard date range is invalid"); return; }
  // Every included project needs reports + financial + export; never widen scope.
  const permitted = await permittedProjectIds(value, ["reports", "financial", "export"]);
  const requested = q.projectIds?.split(",").map((part) => part.trim()).filter(Boolean);
  // Export the same scope as the screen, never silently drop projects lacking export access.
  if (!requested?.length && permitted) {
    const visible = await permittedProjectIds(value, ["reports", "financial"]);
    const visibleIds = visible ?? (await db.select({ id: misProjectsTable.id }).from(misProjectsTable)).map((project) => project.id);
    if (visibleIds.some((id) => !permitted.includes(id))) {
      forbidden(res, "Some displayed projects lack export permission. Select only projects you can export."); return;
    }
  }
  if (requested?.length ? requested.some((projectId) => !canAccessProject(value, projectId) || (permitted && !permitted.includes(projectId))) : permitted?.length === 0) {
    forbidden(res, "Reports, financial and export permission is required for every included project"); return;
  }
  const { format, view, ...filters } = q;
  const payload = await dashboardPayload(value, { ...filters, includeServices: view === "overview" ? "true" : "false" }, requested?.length ? requested : undefined, permitted, res); if (!payload) return;
  const scopeIds = requested?.length ? requested : permitted;
  const projectNames = (await db.select({ id: misProjectsTable.id, name: misProjectsTable.name, code: misProjectsTable.code }).from(misProjectsTable)
    .where(scopeIds ? inArray(misProjectsTable.id, scopeIds) : undefined).orderBy(asc(misProjectsTable.name)));
  const [tab] = q.tabId ? await db.select({ name: misTabsTable.name }).from(misTabsTable).where(eq(misTabsTable.id, q.tabId)) : [];
  const [service] = q.serviceId ? await db.select({ name: misServicesTable.name }).from(misServicesTable).where(eq(misServicesTable.id, q.serviceId)) : [];
  const context: DashboardExportContext = {
    view, generatedAt: new Date(),
    from: q.from ? dateString(q.from) : null, to: q.to ? dateString(q.to) : null, status: q.status ?? "all",
    projects: requested?.length ? projectNames.map((project) => `${project.name}${project.code ? ` (${project.code})` : ""}`) : null,
    category: tab?.name ?? null, service: service?.name ?? null,
  };
  const fileBase = `${view === "overview" ? "mis-overview-report" : "mis-dashboard"}-${context.from ?? "all"}-to-${context.to ?? "all"}`;
  if (format === "xlsx") {
    res.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").attachment(`${fileBase}.xlsx`).send(dashboardXlsx(payload, context)); return;
  }
  res.type("application/pdf").attachment(`${fileBase}.pdf`).send(await dashboardPdf(payload, context));
});

router.patch("/mis/entries/:id", requireAuth, async (req, res): Promise<void> => {
  const value = await access(req, res); if (!value) return;
  const params = MisUpdateEntryParams.safeParse(req.params); if (!params.success) { invalid(res); return; }
  const data = entryBody(req, res, true); if (!data) return;
  const before = await permittedEntry(value, params.data.id, res); if (!before) return;
  if (rejectChildMutation(value, before, res)) return;
  if (before.status === "approved") { forbidden(res, "Approved MIS entries require the parent edit endpoint and edit_approved permission"); return; }
  if (!can(value, "edit_entries", before.projectId) || !["draft", "submitted", "rejected", "returned"].includes(before.status)) { forbidden(res, "Only draft, submitted, returned, or rejected entries may be edited with edit-entry permission"); return; }
  const config = await configuredEntryData(
    data, value, res, numeric(before.rate), "edit_entries",
    (before.calculationMode || "quantity_rate") as CalculationMode,
  ); if (!config) return;
  try {
    const updated = await db.transaction(async (tx) => {
       await lockProjectPeriod(tx, before.projectId);
       await tx.execute(sql`SELECT id FROM mis_entries WHERE id = ${before.id} FOR UPDATE`);
       const [current] = await tx.select().from(misEntriesTable).where(eq(misEntriesTable.id, before.id));
       if (!current || current.deletedAt) throw Object.assign(new Error("Entry changed concurrently; refresh and retry"), { status: 409 });
       if (current.parentId) throw Object.assign(new Error("This MIS line belongs to an atomic bulk entry. Modify the parent bulk entry instead."), { status: 409 });
       if (current.status === "approved") throw Object.assign(new Error("Approved MIS entries require the parent edit endpoint and edit_approved permission"), { status: 403 });
       if (!["draft", "submitted", "rejected", "returned"].includes(current.status)) throw Object.assign(new Error("Only draft, submitted, returned, or rejected entries may be edited with edit-entry permission"), { status: 403 });
       if (!can(value, "edit_entries", current.projectId)) throw Object.assign(new Error("Edit-entry permission required"), { status: 403 });
       const duplicate = await checkDuplicate(tx, data, current.id, config.project.preventDuplicatePeriods);
       if (config.project.preventDuplicatePeriods && duplicate) {
        const error = new Error("An overlapping entry already exists for this service period") as Error & { status: number }; error.status = 409; throw error;
      }
       const { rateReason: _rateReason, amount: _amount, calculationMode: _calculationMode, ...entryData } = data;
      const [row] = await tx.update(misEntriesTable).set({
         ...entryData, quantity: String(config.quantity), rate: String(config.rate), amount: config.amount,
         calculationMode: config.calculationMode, rateEnabled: config.flags.rateEnabled,
         calculatePercentAgainstIncome: config.flags.calculatePercentAgainstIncome,
        projectName: config.project.name, tabName: config.tab.name, serviceName: config.service.name, type: config.tab.type, financialClass: config.tab.financialClass,
        unit: config.service.unit, currency: config.service.currency, updatedById: req.user!.id, updatedAt: new Date(),
       }).where(eq(misEntriesTable.id, current.id)).returning();
        const rateChanged = config.calculationMode === "quantity_rate" && numeric(current.rate) !== numeric(row.rate);
        const modeChanged = (current.calculationMode || "quantity_rate") !== row.calculationMode;
      await auditMis({ entryId: row.id, projectId: row.projectId, entityType: "entry", entityId: row.id, action: "UPDATE", actorId: req.user!.id, remarks: data.rateReason ?? null,
          oldValues: current, newValues: rateChanged || modeChanged
            ? { entry: row,
              rateAudit: rateChanged ? { originalRate: numeric(current.rate), newRate: numeric(row.rate), changedBy: req.user!.id, changedAt: new Date().toISOString(), reason: data.rateReason } : undefined,
              calculationModeAudit: modeChanged ? { originalMode: current.calculationMode || "quantity_rate", newMode: row.calculationMode, changedBy: req.user!.id, changedAt: new Date().toISOString() } : undefined }
            : row }, tx);
      return row;
    });
    res.json(await entryResponse(updated));
    } catch (error) {
      if ((error as { status?: number }).status === 403) { forbidden(res, (error as Error).message); return; }
      if ((error as { status?: number }).status === 409) { sendPeriodConflict(res, value, data.projectId, error as ConflictError); return; }
      throw error;
    }
});

export default router;