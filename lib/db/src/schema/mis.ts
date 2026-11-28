import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgSequence,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./auth";

/** Standalone MIS data model. It deliberately has no relation to COGS projects. */
export const misProjectsTable = pgTable(
  "mis_projects",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    name: varchar("name", { length: 160 }).notNull(),
    code: varchar("code", { length: 32 }).notNull(),
    managerId: varchar("manager_id").references(() => usersTable.id, { onDelete: "set null" }),
    status: varchar("status", { length: 16 }).notNull().default("active"),
    startDate: date("start_date", { mode: "string" }),
    endDate: date("end_date", { mode: "string" }),
    currency: varchar("currency", { length: 3 }).notNull(),
    defaultEntryStatus: varchar("default_entry_status", { length: 16 }).notNull().default("approved"),
    preventDuplicatePeriods: boolean("prevent_duplicate_periods").notNull().default(true),
    allowMultipleMisEntries: boolean("allow_multiple_mis_entries").notNull().default(false),
    overlapPolicy: varchar("overlap_policy", { length: 16 }).notNull().default("nonoverlap"),
    maxEntriesPerPeriod: integer("max_entries_per_period"),
    createdById: varchar("created_by_id").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("UQ_mis_projects_code").on(t.code), index("IDX_mis_projects_status").on(t.status)],
);

export const misTabsTable = pgTable(
  "mis_tabs",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    name: varchar("name", { length: 120 }).notNull(),
    code: varchar("code", { length: 32 }).notNull(),
    description: text("description"),
    type: varchar("type", { length: 16 }).notNull(),
    financialClass: varchar("financial_class", { length: 16 }).notNull(),
    /** Controls whether new entries for a custom type use quantity × rate. */
    rateEnabled: boolean("rate_enabled").notNull().default(true),
    /** Type default; a project-tab override may replace this value. */
    calculatePercentAgainstIncome: boolean("calculate_percent_against_income").notNull().default(false),
    sequence: integer("sequence").notNull().default(0),
    active: boolean("active").notNull().default(true),
    allowEntry: boolean("allow_entry").notNull().default(true),
    allowReporting: boolean("allow_reporting").notNull().default(true),
    createdById: varchar("created_by_id").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("UQ_mis_tabs_code").on(t.code), index("IDX_mis_tabs_active_sequence").on(t.active, t.sequence)],
);

export const misProjectTabsTable = pgTable(
  "mis_project_tabs",
  {
    projectId: varchar("project_id").notNull().references(() => misProjectsTable.id, { onDelete: "cascade" }),
    tabId: varchar("tab_id").notNull().references(() => misTabsTable.id, { onDelete: "restrict" }),
    enabled: boolean("enabled").notNull().default(true),
    sequence: integer("sequence").notNull().default(0),
    /** Nullable so a project can inherit the type default. */
    calculatePercentAgainstIncome: boolean("calculate_percent_against_income"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("UQ_mis_project_tabs").on(t.projectId, t.tabId), index("IDX_mis_project_tabs_project").on(t.projectId, t.enabled, t.sequence)],
);

export const misServicesTable = pgTable(
  "mis_services",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    projectId: varchar("project_id").notNull().references(() => misProjectsTable.id, { onDelete: "restrict" }),
    tabId: varchar("tab_id").notNull().references(() => misTabsTable.id, { onDelete: "restrict" }),
    name: varchar("name", { length: 160 }).notNull(),
    code: varchar("code", { length: 32 }).notNull(),
    description: text("description"),
    unit: varchar("unit", { length: 40 }).notNull(),
    quantitySourceServiceId: varchar("quantity_source_service_id"),
    defaultRate: numeric("default_rate", { precision: 20, scale: 6 }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    active: boolean("active").notNull().default(true),
    sequence: integer("sequence").notNull().default(0),
    effectiveFrom: date("effective_from", { mode: "string" }),
    effectiveTo: date("effective_to", { mode: "string" }),
    createdById: varchar("created_by_id").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("UQ_mis_services_project_code").on(t.projectId, t.code),
    index("IDX_mis_services_project_tab").on(t.projectId, t.tabId, t.active, t.sequence),
  ],
);

export const misAuthoritiesTable = pgTable(
  "mis_authorities",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    projectId: varchar("project_id").references(() => misProjectsTable.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 32 }).notNull(),
    extraPermissions: jsonb("extra_permissions").notNull().default(sql`'[]'::jsonb`),
    createdById: varchar("created_by_id").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [index("IDX_mis_authorities_user").on(t.userId), index("IDX_mis_authorities_project").on(t.projectId)],
);

export const misBulkNumberSeq = pgSequence("mis_bulk_number_seq", {
  startWith: 1,
  minValue: 1,
});

/** One atomic bulk submission. Legacy standalone entries have no parent row. */
export const misEntryParentsTable = pgTable(
  "mis_entry_parents",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    bulkNumber: varchar("bulk_number", { length: 32 }).notNull().unique().default(sql`'MIS-BULK-' || lpad(nextval('mis_bulk_number_seq')::text, 6, '0')`),
    projectId: varchar("project_id").notNull().references(() => misProjectsTable.id, { onDelete: "restrict" }),
    projectName: varchar("project_name", { length: 160 }).notNull(),
    projectCode: varchar("project_code", { length: 32 }).notNull(),
    fromDate: date("from_date", { mode: "string" }).notNull(),
    toDate: date("to_date", { mode: "string" }).notNull(),
    status: varchar("status", { length: 16 }).notNull().default("draft"),
    entryType: varchar("entry_type", { length: 16 }).notNull().default("bulk"),
    createdById: varchar("created_by_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
    updatedById: varchar("updated_by_id").references(() => usersTable.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedById: varchar("deleted_by_id").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("IDX_mis_entry_parents_project_period").on(t.projectId, t.fromDate, t.toDate),
    index("IDX_mis_entry_parents_status").on(t.status, t.updatedAt),
    index("IDX_mis_entry_parents_deleted").on(t.deletedAt),
  ],
);

export const misEntriesTable = pgTable(
  "mis_entries",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    projectId: varchar("project_id").notNull().references(() => misProjectsTable.id, { onDelete: "restrict" }),
    tabId: varchar("tab_id").notNull().references(() => misTabsTable.id, { onDelete: "restrict" }),
    serviceId: varchar("service_id").notNull().references(() => misServicesTable.id, { onDelete: "restrict" }),
    parentId: varchar("parent_id").references(() => misEntryParentsTable.id, { onDelete: "restrict" }),
    fromDate: date("from_date", { mode: "string" }).notNull(),
    toDate: date("to_date", { mode: "string" }).notNull(),
    quantity: numeric("quantity", { precision: 20, scale: 6 }).notNull(),
    rate: numeric("rate", { precision: 20, scale: 6 }).notNull(),
    amount: numeric("amount", { precision: 24, scale: 6 }).notNull(),
    /** Immutable calculation behavior snapshot. Legacy rows are quantity_rate. */
    calculationMode: varchar("calculation_mode", { length: 16 }).notNull().default("quantity_rate"),
    /** Effective rate flag snapshot at save time. */
    rateEnabled: boolean("rate_enabled").notNull().default(true),
    /** Effective percentage flag snapshot at save time. */
    calculatePercentAgainstIncome: boolean("calculate_percent_against_income").notNull().default(false),
    remarks: text("remarks"),
    projectName: varchar("project_name", { length: 160 }).notNull(),
    tabName: varchar("tab_name", { length: 120 }).notNull(),
    serviceName: varchar("service_name", { length: 160 }).notNull(),
    type: varchar("type", { length: 16 }).notNull(),
    financialClass: varchar("financial_class", { length: 16 }).notNull(),
    unit: varchar("unit", { length: 40 }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    status: varchar("status", { length: 16 }).notNull().default("draft"),
    createdById: varchar("created_by_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
    updatedById: varchar("updated_by_id").references(() => usersTable.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedById: varchar("deleted_by_id").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("IDX_mis_entries_scope_period").on(t.projectId, t.tabId, t.serviceId, t.fromDate, t.toDate),
    index("IDX_mis_entries_parent").on(t.parentId),
    index("IDX_mis_entries_report").on(t.status, t.currency, t.fromDate, t.toDate),
    index("IDX_mis_entries_deleted").on(t.deletedAt),
  ],
);

export const misAuditLogTable = pgTable(
  "mis_audit_log",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    entryId: varchar("entry_id"), // deliberately no FK: tombstoned history must survive.
    projectId: varchar("project_id").references(() => misProjectsTable.id, { onDelete: "set null" }),
    entityType: varchar("entity_type", { length: 32 }).notNull(),
    entityId: varchar("entity_id", { length: 64 }).notNull(),
    action: varchar("action", { length: 32 }).notNull(),
    actorId: varchar("actor_id").references(() => usersTable.id, { onDelete: "set null" }),
    remarks: text("remarks"),
    oldValues: jsonb("old_values"),
    newValues: jsonb("new_values"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("IDX_mis_audit_entry").on(t.entryId, t.occurredAt), index("IDX_mis_audit_entity").on(t.entityType, t.entityId)],
);

export const insertMisProjectSchema = createInsertSchema(misProjectsTable);
export const insertMisEntryParentSchema = createInsertSchema(misEntryParentsTable);
export const insertMisTabSchema = createInsertSchema(misTabsTable);
export const insertMisServiceSchema = createInsertSchema(misServicesTable);
export const insertMisAuthoritySchema = createInsertSchema(misAuthoritiesTable);
export const insertMisEntrySchema = createInsertSchema(misEntriesTable);
export type MisProject = typeof misProjectsTable.$inferSelect;
export type MisEntryParent = typeof misEntryParentsTable.$inferSelect;
export type MisTab = typeof misTabsTable.$inferSelect;
export type MisService = typeof misServicesTable.$inferSelect;
export type MisAuthority = typeof misAuthoritiesTable.$inferSelect;
export type MisEntry = typeof misEntriesTable.$inferSelect;
export type MisAuditLog = typeof misAuditLogTable.$inferSelect;
export type InsertMisProject = z.infer<typeof insertMisProjectSchema>;
export type InsertMisEntryParent = z.infer<typeof insertMisEntryParentSchema>;