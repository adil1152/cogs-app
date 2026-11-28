/**
 * Safe, reusable MIS browser-verification fixture.
 *
 * This command only prepares database rows and short-lived bearer sessions.
 * It deliberately does not launch a browser or change any existing user,
 * password, role, or authority:
 *
 *   pnpm --filter @workspace/api-server exec tsx src/mis-tests/browser-fixture.ts setup
 *   pnpm --filter @workspace/api-server exec tsx src/mis-tests/browser-fixture.ts cleanup
 *
 * Setup metadata (including the bearer SIDs) is kept in a mode-0600 file under
 * /tmp. The file is the only place SIDs are made available. The CLI output
 * contains only fixture identifiers and commands.
 */
import { randomBytes, randomUUID } from "node:crypto";
import {
  access as fsAccess,
  chmod,
  open,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import {
  db,
  misAuthoritiesTable,
  misAuditLogTable,
  misEntriesTable,
  misEntryParentsTable,
  misProjectsTable,
  misProjectTabsTable,
  misServicesTable,
  misTabsTable,
  pool,
  sessionsTable,
  usersTable,
} from "@workspace/db";
import type { AuthUser } from "@workspace/api-zod";
import { GetCurrentAuthUserResponse } from "@workspace/api-zod";
import { auditMis } from "../lib/mis/helpers";
import { createSession } from "../lib/auth";

const METADATA_PATH = "/tmp/mis-interactive-ui.json";
const FIXTURE_SESSION_TTL_MS = 2 * 60 * 60 * 1000;

const TAB_KEYS = ["income", "cost", "expense", "salary", "other"] as const;
type TabKey = (typeof TAB_KEYS)[number];

const SERVICE_KEYS = ["income", "cost", "expense", "salary", "custom", "blank", "zero"] as const;
type ServiceKey = (typeof SERVICE_KEYS)[number];

const ENTRY_KEYS = [
  "projectAPriorAug", "projectBPriorAug", "projectBSeptember",
  "projectAJuneCost", "projectAJulyCost", "projectAAugCost",
  "projectAJuneExpense", "projectAJulyExpense", "projectAAugExpense",
  "projectAJuneSalary", "projectAJulySalary", "projectAAugSalary",
  "projectAJuneIncome", "projectAJulyIncome",
] as const;
type EntryKey = (typeof ENTRY_KEYS)[number];
const PARENT_KEYS = ["projectAParent"] as const;
type ParentKey = (typeof PARENT_KEYS)[number];

type ProjectKey = "a" | "b";

type ProjectMetadata = {
  id: string;
  name: string;
  code: string;
};

type FixtureMetadata = {
  version: 1;
  prefix: string;
  adminUserId: string;
  noAccessUserId: string;
  editorUserId: string;
  authorityId: string;
  projects: Record<ProjectKey, ProjectMetadata>;
  tabs: Record<TabKey, string>;
  services: Record<ProjectKey, Record<ServiceKey, string>>;
  entries: Record<EntryKey, string>;
  parents: Record<ParentKey, string>;
  sessions: {
    adminSid: string;
    noAccessSid: string;
    editorSid: string;
  };
};

type UserRow = typeof usersTable.$inferSelect;

const tabDefinitions: ReadonlyArray<{
  key: TabKey;
  name: string;
  type: "income" | "cost" | "expense" | "salary" | "other";
  financialClass: "income" | "cost" | "expense" | "salary";
  sequence: number;
}> = [
  { key: "income", name: "Income", type: "income", financialClass: "income", sequence: 10 },
  { key: "cost", name: "Cost", type: "cost", financialClass: "cost", sequence: 20 },
  { key: "expense", name: "Expense", type: "expense", financialClass: "expense", sequence: 30 },
  { key: "salary", name: "Salary", type: "salary", financialClass: "salary", sequence: 40 },
  { key: "other", name: "Other", type: "other", financialClass: "expense", sequence: 50 },
];

const serviceDefinitions: ReadonlyArray<{
  key: ServiceKey;
  name: string;
  code: string;
  tab: TabKey;
  defaultRate: number;
  sequence: number;
}> = [
  { key: "income", name: "Income", code: "CATERING", tab: "income", defaultRate: 10, sequence: 10 },
  { key: "cost", name: "Cost", code: "COST", tab: "cost", defaultRate: 2, sequence: 20 },
  { key: "expense", name: "Expense", code: "EXPENSE", tab: "expense", defaultRate: 3, sequence: 30 },
  { key: "salary", name: "Salary", code: "SALARY", tab: "salary", defaultRate: 5, sequence: 40 },
  { key: "custom", name: "Custom", code: "CUSTOM", tab: "other", defaultRate: 2, sequence: 50 },
  { key: "blank", name: "Blank", code: "BLANK", tab: "income", defaultRate: 8, sequence: 60 },
  { key: "zero", name: "Zero", code: "ZERO", tab: "income", defaultRate: 10, sequence: 70 },
];

const editorPermissions = [
  "view_project",
  "view_entries",
  "create_entries",
  "edit_entries",
  "submit",
  "reports",
  "financial",
  "history",
] as const;

function fixturePrefix(): string {
  return `MIS-EUI-${randomBytes(6).toString("hex").toUpperCase()}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function invalidFixture(): Error {
  return new Error("Invalid MIS browser fixture metadata");
}

function requireString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) throw invalidFixture();
  return value;
}

function requireUuid(value: unknown): string {
  const text = requireString(value);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    throw invalidFixture();
  }
  return text;
}

function requireUserId(value: unknown): string {
  const text = requireString(value);
  if (!/^[A-Za-z0-9._:@-]{1,256}$/.test(text)) throw invalidFixture();
  return text;
}

function requireSid(value: unknown, allowEmpty = false): string {
  if (allowEmpty && value === "") return "";
  const text = requireString(value);
  if (!/^[0-9a-f]{64}$/i.test(text)) throw invalidFixture();
  return text;
}

function requireIdMap<T extends readonly string[]>(
  value: unknown,
  keys: T,
): Record<T[number], string> {
  if (!isRecord(value)) throw invalidFixture();
  const output = {} as Record<T[number], string>;
  for (const key of keys) output[key as T[number]] = requireUuid(value[key]);
  return output;
}

function parseMetadata(value: unknown): FixtureMetadata {
  if (!isRecord(value) || value.version !== 1) throw invalidFixture();
  const prefix = requireString(value.prefix);
  if (!prefix.startsWith("MIS-EUI-") || prefix.length > 32) throw invalidFixture();
  if (!isRecord(value.projects)) throw invalidFixture();
  const projects = {} as Record<ProjectKey, ProjectMetadata>;
  for (const key of ["a", "b"] as const) {
    const project = value.projects[key];
    if (!isRecord(project)) throw invalidFixture();
    const expectedName = `${prefix} Project ${key.toUpperCase()}`;
    const expectedCode = `${prefix}${key.toUpperCase()}`;
    if (project.name !== expectedName || project.code !== expectedCode) throw invalidFixture();
    projects[key] = {
      id: requireUuid(project.id),
      name: requireString(project.name),
      code: requireString(project.code),
    };
  }
  if (!isRecord(value.sessions)) throw invalidFixture();
  if (!isRecord(value.services)) throw invalidFixture();
  if (!isRecord(value.entries)) throw invalidFixture();
  if (!isRecord(value.parents)) throw invalidFixture();
  return {
    version: 1,
    prefix,
    adminUserId: requireUserId(value.adminUserId),
    noAccessUserId: requireUserId(value.noAccessUserId),
    editorUserId: requireUserId(value.editorUserId),
    authorityId: requireUuid(value.authorityId),
    projects,
    tabs: requireIdMap(value.tabs, TAB_KEYS),
    services: {
      a: requireIdMap(value.services.a, SERVICE_KEYS),
      b: requireIdMap(value.services.b, SERVICE_KEYS),
    },
    entries: requireIdMap(value.entries, ENTRY_KEYS),
    parents: requireIdMap(value.parents, PARENT_KEYS),
    sessions: {
      adminSid: requireSid(value.sessions.adminSid, true),
      noAccessSid: requireSid(value.sessions.noAccessSid, true),
      editorSid: requireSid(value.sessions.editorSid, true),
    },
  };
}

async function metadataExists(): Promise<boolean> {
  try {
    await fsAccess(METADATA_PATH);
    return true;
  } catch {
    return false;
  }
}

async function createMetadataFile(metadata: FixtureMetadata): Promise<void> {
  const handle = await open(METADATA_PATH, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  } finally {
    await handle.close();
  }
  await chmod(METADATA_PATH, 0o600);
}

async function replaceMetadataFile(metadata: FixtureMetadata): Promise<void> {
  const temporaryPath = `${METADATA_PATH}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(metadata, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, METADATA_PATH);
    await chmod(METADATA_PATH, 0o600);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

async function loadMetadataFile(): Promise<FixtureMetadata> {
  let raw: string;
  try {
    raw = await readFile(METADATA_PATH, "utf8");
  } catch {
    throw new Error("No MIS browser fixture metadata found");
  }
  try {
    return parseMetadata(JSON.parse(raw) as unknown);
  } catch {
    throw invalidFixture();
  }
}

function authUser(user: UserRow): AuthUser {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    mobile: user.mobile,
    profileImageUrl: user.profileImageUrl,
    role: user.role === "admin" ? "admin" : "user",
  };
}

async function createFixtureSession(user: UserRow): Promise<string> {
  const sid = await createSession({ user: authUser(user) });
  await db
    .update(sessionsTable)
    .set({ expire: new Date(Date.now() + FIXTURE_SESSION_TTL_MS) })
    .where(eq(sessionsTable.sid, sid));
  return sid;
}

function newMetadata(
  prefix: string,
  adminUserId: string,
  noAccessUserId: string,
  editorUserId: string,
): FixtureMetadata {
  const projectAId = randomUUID();
  const projectBId = randomUUID();
  const projects = {
    a: {
      id: projectAId,
      name: `${prefix} Project A`,
      code: `${prefix}A`,
    },
    b: {
      id: projectBId,
      name: `${prefix} Project B`,
      code: `${prefix}B`,
    },
  } satisfies Record<ProjectKey, ProjectMetadata>;

  const tabs = {} as Record<TabKey, string>;
  for (const definition of tabDefinitions) tabs[definition.key] = randomUUID();

  const services = {} as Record<ProjectKey, Record<ServiceKey, string>>;
  for (const projectKey of ["a", "b"] as const) {
    services[projectKey] = {} as Record<ServiceKey, string>;
    for (const definition of serviceDefinitions) {
      services[projectKey][definition.key] = randomUUID();
    }
  }

  return {
    version: 1,
    prefix,
    adminUserId,
    noAccessUserId,
    editorUserId,
    authorityId: randomUUID(),
    projects,
    tabs,
    services,
    entries: {
      projectAPriorAug: randomUUID(),
      projectBPriorAug: randomUUID(),
      projectBSeptember: randomUUID(),
      projectAJuneCost: randomUUID(),
      projectAJulyCost: randomUUID(),
      projectAAugCost: randomUUID(),
      projectAJuneExpense: randomUUID(),
      projectAJulyExpense: randomUUID(),
      projectAAugExpense: randomUUID(),
      projectAJuneSalary: randomUUID(),
      projectAJulySalary: randomUUID(),
      projectAAugSalary: randomUUID(),
      projectAJuneIncome: randomUUID(),
      projectAJulyIncome: randomUUID(),
    },
    parents: {
      projectAParent: randomUUID(),
    },
    sessions: { adminSid: "", noAccessSid: "", editorSid: "" },
  };
}

async function findFixtureUsers(): Promise<{
  admin: UserRow;
  noAccess: UserRow;
  editor: UserRow;
}> {
  const [admin] = await db
    .select({ user: usersTable })
    .from(misAuthoritiesTable)
    .innerJoin(usersTable, eq(usersTable.id, misAuthoritiesTable.userId))
    .where(and(eq(misAuthoritiesTable.role, "mis_admin"), isNull(misAuthoritiesTable.projectId)))
    .orderBy(asc(misAuthoritiesTable.createdAt))
    .limit(1)
    .then((rows) => rows.map((row) => row.user));
  if (!admin) throw new Error("An existing global MIS administrator is required");

  const usersWithoutAuthority = await db
    .select({ user: usersTable })
    .from(usersTable)
    .leftJoin(misAuthoritiesTable, eq(misAuthoritiesTable.userId, usersTable.id))
    .where(isNull(misAuthoritiesTable.id))
    .orderBy(asc(usersTable.createdAt), asc(usersTable.id))
    .then((rows) => rows.map((row) => row.user)
      .filter((user) => GetCurrentAuthUserResponse.safeParse({ user: authUser(user) }).success)
      .slice(0, 2));
  if (usersWithoutAuthority.length < 2) {
    throw new Error("Two existing users without MIS authority are required");
  }
  return {
    admin,
    noAccess: usersWithoutAuthority[0],
    editor: usersWithoutAuthority[1],
  };
}

async function seedFixture(metadata: FixtureMetadata, adminUserId: string): Promise<void> {
  const projectRows = (["a", "b"] as const).map((projectKey) => {
    const project = metadata.projects[projectKey];
    return {
      id: project.id,
      name: project.name,
      code: project.code,
      managerId: null,
      status: "active",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      currency: "SAR",
      defaultEntryStatus: "approved",
      preventDuplicatePeriods: true,
      createdById: adminUserId,
    };
  });

  await db.transaction(async (tx) => {
    const tabRows = tabDefinitions.map((definition) => ({
      id: metadata.tabs[definition.key],
      name: definition.name,
      code: `${metadata.prefix}${definition.key.toUpperCase()}`,
      description: "MIS browser verification fixture",
      type: definition.type,
      financialClass: definition.financialClass,
      rateEnabled: definition.type !== "expense" && definition.type !== "salary",
      calculatePercentAgainstIncome: definition.type === "income" || definition.type === "other",
      sequence: definition.sequence,
      active: true,
      allowEntry: true,
      allowReporting: true,
      createdById: adminUserId,
    }));
    await tx.insert(misTabsTable).values(tabRows);
    for (const row of tabRows) {
      await auditMis({
        entityType: "tab",
        entityId: row.id,
        action: "CREATE",
        actorId: adminUserId,
        newValues: row,
      }, tx);
    }

    await tx.insert(misProjectsTable).values(projectRows);
    for (const row of projectRows) {
      await auditMis({
        entityType: "project",
        entityId: row.id,
        projectId: row.id,
        action: "CREATE",
        actorId: adminUserId,
        newValues: row,
      }, tx);
    }

    const assignments = (["a", "b"] as const).flatMap((projectKey) =>
      tabDefinitions.map((definition) => ({
        projectId: metadata.projects[projectKey].id,
        tabId: metadata.tabs[definition.key],
        enabled: true,
        sequence: definition.sequence,
        // Project A intentionally overrides the income type default so the
        // browser check can verify nullable override persistence and its
        // effective service serialization. Project B inherits the type value.
        calculatePercentAgainstIncome: projectKey === "a" && definition.key === "income" ? false : null,
      })),
    );
    await tx.insert(misProjectTabsTable).values(assignments);
    for (const projectKey of ["a", "b"] as const) {
      await auditMis({
        entityType: "project_tabs",
        entityId: metadata.projects[projectKey].id,
        projectId: metadata.projects[projectKey].id,
        action: "REPLACE",
        actorId: adminUserId,
        oldValues: [],
        newValues: assignments.filter((row) => row.projectId === metadata.projects[projectKey].id),
      }, tx);
    }

    for (const projectKey of ["a", "b"] as const) {
      const project = metadata.projects[projectKey];
      const services = serviceDefinitions.map((definition) => ({
        id: metadata.services[projectKey][definition.key],
        projectId: project.id,
        tabId: metadata.tabs[definition.tab],
        name: definition.name,
        code: definition.code,
        description: "MIS browser verification fixture",
        unit: "unit",
        defaultRate: String(definition.defaultRate),
        currency: "SAR",
        active: true,
        sequence: definition.sequence,
        effectiveFrom: "2026-01-01",
        effectiveTo: "2026-12-31",
        createdById: adminUserId,
      }));
      await tx.insert(misServicesTable).values(services);
      for (const row of services) {
        await auditMis({
          entityType: "service",
          entityId: row.id,
          projectId: row.projectId,
          action: "CREATE",
          actorId: adminUserId,
          newValues: row,
        }, tx);
      }
    }

    const entryDefinitions: ReadonlyArray<{
      key: EntryKey;
      projectKey: ProjectKey;
      date: string;
      tab: TabKey;
      service: ServiceKey;
      quantity: number;
      rate: number;
      amount: string;
      calculationMode: "quantity_rate" | "amount";
    }> = [
      { key: "projectAPriorAug", projectKey: "a", date: "2026-08-15", tab: "income", service: "income", quantity: 20, rate: 10, amount: "200.000000", calculationMode: "quantity_rate" },
      { key: "projectBPriorAug", projectKey: "b", date: "2026-08-15", tab: "income", service: "income", quantity: 30, rate: 10, amount: "300.000000", calculationMode: "quantity_rate" },
      { key: "projectBSeptember", projectKey: "b", date: "2026-09-15", tab: "income", service: "income", quantity: 50, rate: 10, amount: "500.000000", calculationMode: "quantity_rate" },
      { key: "projectAJuneIncome", projectKey: "a", date: "2026-06-15", tab: "income", service: "income", quantity: 10, rate: 10, amount: "100.000000", calculationMode: "quantity_rate" },
      { key: "projectAJulyIncome", projectKey: "a", date: "2026-07-15", tab: "income", service: "income", quantity: 12, rate: 10, amount: "120.000000", calculationMode: "quantity_rate" },
      { key: "projectAJuneCost", projectKey: "a", date: "2026-06-15", tab: "cost", service: "cost", quantity: 5, rate: 2, amount: "10.000000", calculationMode: "quantity_rate" },
      { key: "projectAJulyCost", projectKey: "a", date: "2026-07-15", tab: "cost", service: "cost", quantity: 6, rate: 2, amount: "12.000000", calculationMode: "quantity_rate" },
      { key: "projectAAugCost", projectKey: "a", date: "2026-08-15", tab: "cost", service: "cost", quantity: 7, rate: 2, amount: "14.000000", calculationMode: "quantity_rate" },
      { key: "projectAJuneExpense", projectKey: "a", date: "2026-06-15", tab: "expense", service: "expense", quantity: 1, rate: 1, amount: "75.000000", calculationMode: "amount" },
      { key: "projectAJulyExpense", projectKey: "a", date: "2026-07-15", tab: "expense", service: "expense", quantity: 1, rate: 1, amount: "100.000000", calculationMode: "amount" },
      { key: "projectAAugExpense", projectKey: "a", date: "2026-08-15", tab: "expense", service: "expense", quantity: 1, rate: 1, amount: "125.000000", calculationMode: "amount" },
      { key: "projectAJuneSalary", projectKey: "a", date: "2026-06-15", tab: "salary", service: "salary", quantity: 1, rate: 1, amount: "300.000000", calculationMode: "amount" },
      { key: "projectAJulySalary", projectKey: "a", date: "2026-07-15", tab: "salary", service: "salary", quantity: 1, rate: 1, amount: "325.000000", calculationMode: "amount" },
      { key: "projectAAugSalary", projectKey: "a", date: "2026-08-15", tab: "salary", service: "salary", quantity: 1, rate: 1, amount: "350.000000", calculationMode: "amount" },
    ];
    for (const definition of entryDefinitions) {
      const project = metadata.projects[definition.projectKey];
      const tab = tabDefinitions.find((candidate) => candidate.key === definition.tab)!;
      const service = serviceDefinitions.find((candidate) => candidate.key === definition.service)!;
      const amountMode = definition.calculationMode === "amount";
      const row = {
        id: metadata.entries[definition.key],
        projectId: project.id,
        tabId: metadata.tabs[definition.tab],
        serviceId: metadata.services[definition.projectKey][definition.service],
        fromDate: definition.date,
        toDate: definition.date,
        // The legacy database columns remain NOT NULL for migration
        // compatibility. Amount-mode serialization masks these storage zeros
        // as null and exposes only the persisted actual amount.
        quantity: amountMode ? "0" : String(definition.quantity),
        rate: amountMode ? "0" : String(definition.rate),
        amount: definition.amount,
        calculationMode: definition.calculationMode,
        rateEnabled: !amountMode,
        calculatePercentAgainstIncome: definition.tab === "income" && definition.projectKey === "b" ? true : definition.tab === "income" && definition.projectKey === "a" ? false : false,
        remarks: "MIS browser verification fixture",
        projectName: project.name,
        tabName: tab.name,
        serviceName: service.name,
        type: tab.type,
        financialClass: tab.financialClass,
        unit: "unit",
        currency: "SAR",
        status: "approved",
        createdById: adminUserId,
        updatedById: adminUserId,
      };
      await tx.insert(misEntriesTable).values(row);
      await auditMis({
        entryId: row.id,
        projectId: row.projectId,
        entityType: "entry",
        entityId: row.id,
        action: "CREATE",
        actorId: adminUserId,
        newValues: row,
      }, tx);
    }

    const parentProject = metadata.projects.a;
    const parentId = metadata.parents.projectAParent;
    const parent = {
      id: parentId,
      projectId: parentProject.id,
      projectName: parentProject.name,
      projectCode: parentProject.code,
      fromDate: "2026-10-01",
      toDate: "2026-10-31",
      status: "submitted",
      entryType: "bulk",
      createdById: adminUserId,
      updatedById: adminUserId,
    };
    await tx.insert(misEntryParentsTable).values(parent);
    await auditMis({
      entityType: "parent",
      entityId: parent.id,
      projectId: parent.projectId,
      action: "CREATE",
      actorId: adminUserId,
      newValues: parent,
    }, tx);
    const parentChild = {
      id: randomUUID(),
      projectId: parentProject.id,
      tabId: metadata.tabs.income,
      serviceId: metadata.services.a.income,
      parentId,
      fromDate: "2026-10-01",
      toDate: "2026-10-31",
      quantity: "10",
      rate: "10",
      amount: "100",
      calculationMode: "quantity_rate",
      rateEnabled: true,
      calculatePercentAgainstIncome: false,
      remarks: "MIS parent browser fixture",
      projectName: parentProject.name,
      tabName: "Income",
      serviceName: "Income",
      type: "income",
      financialClass: "income",
      unit: "unit",
      currency: "SAR",
      status: "submitted",
      createdById: adminUserId,
      updatedById: adminUserId,
    };
    await tx.insert(misEntriesTable).values(parentChild);
    await auditMis({
      entryId: parentChild.id,
      projectId: parentChild.projectId,
      entityType: "entry",
      entityId: parentChild.id,
      action: "CREATE",
      actorId: adminUserId,
      newValues: parentChild,
    }, tx);

    const authority = {
      id: metadata.authorityId,
      userId: metadata.editorUserId,
      projectId: metadata.projects.a.id,
      role: "custom",
      extraPermissions: [...editorPermissions],
      createdById: adminUserId,
    };
    await tx.insert(misAuthoritiesTable).values(authority);
    await auditMis({
      entityType: "authority",
      entityId: authority.id,
      projectId: authority.projectId,
      action: "CREATE",
      actorId: adminUserId,
      newValues: authority,
    }, tx);
  });
}

function sessionUserId(value: unknown): string | null {
  if (!isRecord(value) || !isRecord(value.user) || typeof value.user.id !== "string") {
    return null;
  }
  return value.user.id;
}

function expectedProject(metadata: FixtureMetadata, projectId: string): ProjectMetadata | null {
  if (metadata.projects.a.id === projectId) return metadata.projects.a;
  if (metadata.projects.b.id === projectId) return metadata.projects.b;
  return null;
}

async function cleanupFixture(metadata: FixtureMetadata): Promise<void> {
  const projectIds = [metadata.projects.a.id, metadata.projects.b.id];
  const tabIds = TAB_KEYS.map((key) => metadata.tabs[key]);
  const authorityIds = [metadata.authorityId];
  const sessionIds = [
    metadata.sessions.adminSid,
    metadata.sessions.noAccessSid,
    metadata.sessions.editorSid,
  ].filter(Boolean);
  const allowedSessionUsers = new Set([
    metadata.adminUserId,
    metadata.noAccessUserId,
    metadata.editorUserId,
  ]);

  await db.transaction(async (tx) => {
    // Audit history is append-only in normal operation. This scoped setting is
    // local to this transaction and is never enabled for application writes.
    await tx.execute(sql`SET LOCAL mis.maintenance = 'on'`);

    const projects = await tx
      .select()
      .from(misProjectsTable)
      .where(inArray(misProjectsTable.id, projectIds));
    for (const project of projects) {
      const expected = expectedProject(metadata, project.id);
      if (
        !expected ||
        project.name !== expected.name ||
        project.code !== expected.code ||
        project.currency !== "SAR" ||
        project.startDate !== "2026-01-01" ||
        project.endDate !== "2026-12-31"
      ) {
        throw new Error("Refusing to clean a changed MIS project");
      }
    }

    const tabs = await tx
      .select()
      .from(misTabsTable)
      .where(inArray(misTabsTable.id, tabIds));
    for (const tab of tabs) {
      const definition = tabDefinitions.find((candidate) => metadata.tabs[candidate.key] === tab.id);
      if (
        !definition ||
        tab.name !== definition.name ||
        tab.code !== `${metadata.prefix}${definition.key.toUpperCase()}`
      ) {
        throw new Error("Refusing to clean a changed MIS tab");
      }
    }

    const authorities = await tx
      .select()
      .from(misAuthoritiesTable)
      .where(inArray(misAuthoritiesTable.id, authorityIds));
    for (const authority of authorities) {
      if (
        authority.userId !== metadata.editorUserId ||
        authority.projectId !== metadata.projects.a.id ||
        authority.role !== "custom"
      ) {
        throw new Error("Refusing to clean a changed MIS authority");
      }
    }

    // The browser can create additional bulk parents after setup. Every row
    // under these two validated, isolated fixture projects is fixture-owned;
    // validate its denormalized project identity before including it in the
    // targeted parent/child cleanup.
    const parentRows = await tx
      .select()
      .from(misEntryParentsTable)
      .where(inArray(misEntryParentsTable.projectId, projectIds));
    for (const parent of parentRows) {
      const expected = expectedProject(metadata, parent.projectId);
      if (
        !expected ||
        parent.projectName !== expected.name ||
        parent.projectCode !== expected.code ||
        parent.entryType !== "bulk"
      ) {
        throw new Error("Refusing to clean a changed MIS parent");
      }
    }
    const parentIds = parentRows.map((parent) => parent.id);

    if (sessionIds.length > 0) {
      const sessions = await tx
        .select()
        .from(sessionsTable)
        .where(inArray(sessionsTable.sid, sessionIds));
      for (const session of sessions) {
        const ownerId = sessionUserId(session.sess);
        if (!ownerId || !allowedSessionUsers.has(ownerId)) {
          throw new Error("Refusing to clean an unrelated session");
        }
      }
    }

    // Everything below is scoped to the two validated fixture project IDs.
    // This also catches entries created by the browser after setup (for
    // example, a temporary custom-rate entry) without using a broad prefix
    // delete that could touch real data.
    const serviceRows = await tx
      .select({ id: misServicesTable.id })
      .from(misServicesTable)
      .where(inArray(misServicesTable.projectId, projectIds));
    const serviceIds = serviceRows.map((row) => row.id);
    const entryRows = await tx
      .select({ id: misEntriesTable.id })
      .from(misEntriesTable)
      .where(inArray(misEntriesTable.projectId, projectIds));
    const entryIds = entryRows.map((row) => row.id);
    const ownedEntityIds = [...projectIds, ...tabIds, ...serviceIds, ...entryIds, ...parentIds, ...authorityIds];

    await tx
      .delete(misAuditLogTable)
      .where(
        or(
          inArray(misAuditLogTable.projectId, projectIds),
          inArray(misAuditLogTable.entityId, ownedEntityIds),
          inArray(misAuditLogTable.entryId, entryIds.length > 0 ? entryIds : [""]),
        ),
      );
    if (entryIds.length > 0) {
      await tx.delete(misEntriesTable).where(inArray(misEntriesTable.id, entryIds));
    }
    await tx.delete(misEntryParentsTable).where(inArray(misEntryParentsTable.id, parentIds));
    await tx.delete(misAuthoritiesTable).where(inArray(misAuthoritiesTable.id, authorityIds));
    if (serviceIds.length > 0) {
      await tx.delete(misServicesTable).where(inArray(misServicesTable.id, serviceIds));
    }
    await tx.delete(misProjectTabsTable).where(inArray(misProjectTabsTable.projectId, projectIds));
    await tx.delete(misProjectsTable).where(inArray(misProjectsTable.id, projectIds));
    await tx.delete(misTabsTable).where(inArray(misTabsTable.id, tabIds));
    if (sessionIds.length > 0) {
      await tx.delete(sessionsTable).where(inArray(sessionsTable.sid, sessionIds));
    }
  });
}

async function runSetup(): Promise<void> {
  if (await metadataExists()) {
    throw new Error("An existing MIS browser fixture must be cleaned up first");
  }
  const users = await findFixtureUsers();
  const prefix = fixturePrefix();
  const metadata = newMetadata(prefix, users.admin.id, users.noAccess.id, users.editor.id);

  // Write a provisional, secret-free-of-email metadata record before mutating
  // MIS rows. A process interrupted after this point can still be cleaned.
  await createMetadataFile(metadata);
  let cleanedOnFailure = false;
  try {
    await seedFixture(metadata, users.admin.id);
    metadata.sessions.adminSid = await createFixtureSession(users.admin);
    metadata.sessions.noAccessSid = await createFixtureSession(users.noAccess);
    metadata.sessions.editorSid = await createFixtureSession(users.editor);
    await replaceMetadataFile(metadata);
  } catch {
    try {
      await cleanupFixture(metadata);
      cleanedOnFailure = true;
    } catch {
      // Preserve the metadata file when cleanup did not complete, so cleanup
      // can be retried with the exact fixture IDs.
    }
    throw new Error("MIS browser fixture setup failed");
  } finally {
    if (cleanedOnFailure) {
      await unlink(METADATA_PATH).catch(() => undefined);
    }
  }

  process.stdout.write(
    [
      `prefix=${metadata.prefix}`,
      `projectA=${metadata.projects.a.id}`,
      `projectB=${metadata.projects.b.id}`,
      "setup=pnpm --filter @workspace/api-server exec tsx src/mis-tests/browser-fixture.ts setup",
      "cleanup=pnpm --filter @workspace/api-server exec tsx src/mis-tests/browser-fixture.ts cleanup",
      "",
    ].join("\n"),
  );
}

async function runCleanup(): Promise<void> {
  const metadata = await loadMetadataFile();
  await cleanupFixture(metadata);
  await unlink(METADATA_PATH);
  process.stdout.write(
    [
      `prefix=${metadata.prefix}`,
      `projectA=${metadata.projects.a.id}`,
      `projectB=${metadata.projects.b.id}`,
      "setup=pnpm --filter @workspace/api-server exec tsx src/mis-tests/browser-fixture.ts setup",
      "cleanup=pnpm --filter @workspace/api-server exec tsx src/mis-tests/browser-fixture.ts cleanup",
      "",
    ].join("\n"),
  );
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command !== "setup" && command !== "cleanup") {
    throw new Error("Use setup or cleanup");
  }
  if (command === "setup") await runSetup();
  else await runCleanup();
}

main()
  .catch(() => {
    process.stderr.write("MIS browser fixture command failed\n");
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => undefined);
  });