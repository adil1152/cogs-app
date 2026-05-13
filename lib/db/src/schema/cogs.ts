import { sql } from "drizzle-orm";
import {
  pgTable,
  varchar,
  text,
  date,
  numeric,
  integer,
  timestamp,
  boolean,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

export const projectsTable = pgTable(
  "projects",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    name: varchar("name", { length: 255 }).notNull(),
    code: varchar("code", { length: 32 }),
    location: varchar("location", { length: 255 }).notNull(),
    contractStart: date("contract_start").notNull(),
    contractEnd: date("contract_end").notNull(),
    notes: text("notes"),
    createdById: varchar("created_by_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("UQ_projects_code").on(t.code)],
);

export const projectServicesTable = pgTable(
  "project_services",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    projectId: varchar("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    kind: varchar("kind", { length: 16 }).notNull().default("standard"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("IDX_project_services_project").on(t.projectId)],
);

export const securityGroupsTable = pgTable(
  "security_groups",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    name: varchar("name", { length: 64 }).notNull(),
    description: text("description"),
    canViewSummary: boolean("can_view_summary").notNull().default(false),
    canEditEntries: boolean("can_edit_entries").notNull().default(false),
    canResetApproval: boolean("can_reset_approval").notNull().default(false),
    createdById: varchar("created_by_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("UQ_security_groups_name").on(t.name)],
);

export const projectAccessTable = pgTable(
  "project_access",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    projectId: varchar("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    userId: varchar("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    securityGroupId: varchar("security_group_id").references(
      () => securityGroupsTable.id,
      { onDelete: "set null" },
    ),
    canViewSummary: boolean("can_view_summary").notNull().default(true),
    canEditEntries: boolean("can_edit_entries").notNull().default(false),
    canResetApproval: boolean("can_reset_approval").notNull().default(false),
    grantedById: varchar("granted_by_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    grantedAt: timestamp("granted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("UQ_project_access_project_user").on(t.projectId, t.userId),
  ],
);

export type SecurityGroup = typeof securityGroupsTable.$inferSelect;
export type InsertSecurityGroup = typeof securityGroupsTable.$inferInsert;

export const dailyEntriesTable = pgTable(
  "daily_entries",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    projectId: varchar("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    entryDate: date("entry_date").notNull(),
    location: varchar("location", { length: 255 }).notNull(),
    totalMandays: numeric("total_mandays", {
      precision: 12,
      scale: 2,
    }).notNull(),
    totalMandaysOverride: boolean("total_mandays_override")
      .notNull()
      .default(false),
    /**
     * Workflow state machine:
     *   draft     — created, not yet submitted; not in any approver's queue.
     *   pending   — submitted; advances through the approval chain.
     *               currentApprovalLevel reflects how far it has progressed.
     *   approved  — final approval recorded; lockedAt is set.
     * Reject sends pending → pending (level 0). Reset sends any → draft.
     */
    status: varchar("status", { length: 16 }).notNull().default("draft"),
    currentApprovalLevel: integer("current_approval_level")
      .notNull()
      .default(0),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    sequenceNumber: integer("sequence_number"),
    sequenceCode: varchar("sequence_code", { length: 64 }),
    notes: text("notes"),
    createdById: varchar("created_by_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("IDX_daily_entries_project_date").on(t.projectId, t.entryDate),
    uniqueIndex("UQ_daily_entries_project_seq").on(t.projectId, t.sequenceNumber),
  ],
);

export const serviceCostEntriesTable = pgTable(
  "service_cost_entries",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    dailyEntryId: varchar("daily_entry_id")
      .notNull()
      .references(() => dailyEntriesTable.id, { onDelete: "cascade" }),
    projectServiceId: varchar("project_service_id")
      .notNull()
      .references(() => projectServicesTable.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 16 }).notNull(),
    cost: numeric("cost", { precision: 14, scale: 2 }).notNull().default("0"),
    mandays: numeric("mandays", { precision: 10, scale: 2 }),
    breakfastQty: integer("breakfast_qty"),
    lunchQty: integer("lunch_qty"),
    dinnerQty: integer("dinner_qty"),
    midnightQty: integer("midnight_qty"),
    mealBoxQty: integer("meal_box_qty"),
  },
  (t) => [index("IDX_service_costs_entry").on(t.dailyEntryId)],
);

export const entryApprovalsTable = pgTable(
  "entry_approvals",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    dailyEntryId: varchar("daily_entry_id")
      .notNull()
      .references(() => dailyEntriesTable.id, { onDelete: "cascade" }),
    level: integer("level").notNull(),
    levelName: varchar("level_name", { length: 32 }).notNull(),
    approverId: varchar("approver_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("IDX_entry_approvals_entry").on(t.dailyEntryId),
    uniqueIndex("UQ_entry_approvals_entry_level").on(t.dailyEntryId, t.level),
  ],
);

export type Project = typeof projectsTable.$inferSelect;
export type InsertProject = typeof projectsTable.$inferInsert;

export type ProjectService = typeof projectServicesTable.$inferSelect;
export type InsertProjectService = typeof projectServicesTable.$inferInsert;

export type ProjectAccess = typeof projectAccessTable.$inferSelect;
export type InsertProjectAccess = typeof projectAccessTable.$inferInsert;

export type DailyEntry = typeof dailyEntriesTable.$inferSelect;
export type InsertDailyEntry = typeof dailyEntriesTable.$inferInsert;

export type ServiceCostEntry = typeof serviceCostEntriesTable.$inferSelect;
export type InsertServiceCostEntry = typeof serviceCostEntriesTable.$inferInsert;

export type EntryApproval = typeof entryApprovalsTable.$inferSelect;
export type InsertEntryApproval = typeof entryApprovalsTable.$inferInsert;

export const projectApproverAssignmentsTable = pgTable(
  "project_approver_assignments",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    projectId: varchar("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    level: integer("level").notNull(),
    userId: varchar("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("IDX_approver_assignments_project_level").on(t.projectId, t.level),
    uniqueIndex("UQ_approver_assignments_project_level_user").on(
      t.projectId,
      t.level,
      t.userId,
    ),
  ],
);

export const entryAuditLogTable = pgTable(
  "entry_audit_log",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    dailyEntryId: varchar("daily_entry_id").references(
      () => dailyEntriesTable.id,
      { onDelete: "set null" },
    ),
    projectId: varchar("project_id").notNull(),
    action: varchar("action", { length: 32 }).notNull(),
    level: integer("level"),
    levelName: varchar("level_name", { length: 32 }),
    field: varchar("field", { length: 64 }),
    oldValue: text("old_value"),
    newValue: text("new_value"),
    actorId: varchar("actor_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("IDX_entry_audit_entry").on(t.dailyEntryId),
    index("IDX_entry_audit_project").on(t.projectId),
  ],
);

export type ProjectApproverAssignment =
  typeof projectApproverAssignmentsTable.$inferSelect;
export type InsertProjectApproverAssignment =
  typeof projectApproverAssignmentsTable.$inferInsert;

/**
 * Per-project ordered approval chain. Position 1 is the first approver, the
 * last position is the final approver (which locks the entry). When no rows
 * exist for a project, the system falls back to the default chain
 * [OP, SOP, COO, CC, Additional]. Admins can reorder freely.
 */
export const projectApprovalChainTable = pgTable(
  "project_approval_chain",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    projectId: varchar("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    levelName: varchar("level_name", { length: 32 }).notNull(),
  },
  (t) => [
    uniqueIndex("UQ_approval_chain_project_position").on(
      t.projectId,
      t.position,
    ),
  ],
);

export type ProjectApprovalChainEntry =
  typeof projectApprovalChainTable.$inferSelect;
export type InsertProjectApprovalChainEntry =
  typeof projectApprovalChainTable.$inferInsert;

export type EntryAuditLog = typeof entryAuditLogTable.$inferSelect;
export type InsertEntryAuditLog = typeof entryAuditLogTable.$inferInsert;
