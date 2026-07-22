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
    pdfRequired: boolean("pdf_required").notNull().default(false),
    disabled: boolean("disabled").notNull().default(false),
    // Entry-date window for non-admin users. NULL = no limit on that side.
    // 0 = that direction fully blocked (e.g. futureDays 0 → no future entries).
    backdatedDays: integer("backdated_days"),
    futureDays: integer("future_days"),
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
    color: varchar("color", { length: 9 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("IDX_project_services_project").on(t.projectId)],
);

/**
 * Sub-items for a "group" service. Admin defines a list of named slots
 * (e.g. "Day Shift", "Night Shift") at the service level; every daily entry
 * for that service then has one cost+manday row per sub-item. Sub-items are
 * locked (no add/remove) once any cost entry exists for the parent service —
 * renames and reorders are still allowed.
 */
export const serviceSubItemsTable = pgTable(
  "service_sub_items",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    projectServiceId: varchar("project_service_id")
      .notNull()
      .references(() => projectServicesTable.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    color: varchar("color", { length: 9 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("IDX_sub_items_service").on(t.projectServiceId)],
);

export type ServiceSubItem = typeof serviceSubItemsTable.$inferSelect;
export type InsertServiceSubItem = typeof serviceSubItemsTable.$inferInsert;

/**
 * Meal types for a "food" service. Admin defines the list (name + manday
 * weight, e.g. Breakfast 0.2) per food service. Fully editable at any time:
 * add / remove / rename / re-weight. Historical entries are unaffected by
 * edits because every daily entry snapshots the name + weight it was saved
 * with (see mealCostEntriesTable).
 */
export const foodMealItemsTable = pgTable(
  "food_meal_items",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    projectServiceId: varchar("project_service_id")
      .notNull()
      .references(() => projectServicesTable.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    /** Manday weight as a fraction (0.2 = 20%). */
    weight: numeric("weight", { precision: 6, scale: 3 }).notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("IDX_meal_items_service").on(t.projectServiceId)],
);

export type FoodMealItem = typeof foodMealItemsTable.$inferSelect;
export type InsertFoodMealItem = typeof foodMealItemsTable.$inferInsert;

export const securityGroupsTable = pgTable(
  "security_groups",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    name: varchar("name", { length: 64 }).notNull(),
    description: text("description"),
    canViewSummary: boolean("can_view_summary").notNull().default(false),
    canEditEntries: boolean("can_edit_entries").notNull().default(false),
    canResetApproval: boolean("can_reset_approval").notNull().default(false),
    autoAssignNewProjects: boolean("auto_assign_new_projects")
      .notNull()
      .default(false),
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

/**
 * Global group membership: a member gets the group's permission flags on
 * EVERY (non-disabled) project, without needing per-project access rows.
 */
export const securityGroupMembersTable = pgTable(
  "security_group_members",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    securityGroupId: varchar("security_group_id")
      .notNull()
      .references(() => securityGroupsTable.id, { onDelete: "cascade" }),
    userId: varchar("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    grantedById: varchar("granted_by_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    grantedAt: timestamp("granted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("UQ_security_group_members_group_user").on(
      t.securityGroupId,
      t.userId,
    ),
    index("IDX_security_group_members_user").on(t.userId),
  ],
);

export type SecurityGroupMember = typeof securityGroupMembersTable.$inferSelect;
export type InsertSecurityGroupMember =
  typeof securityGroupMembersTable.$inferInsert;

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
    manualMandays: numeric("manual_mandays", { precision: 10, scale: 2 })
      .notNull()
      .default("0"),
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
    manualMandays: numeric("manual_mandays", { precision: 10, scale: 2 })
      .notNull()
      .default("0"),
  },
  (t) => [index("IDX_service_costs_entry").on(t.dailyEntryId)],
);

/**
 * Per-day, per-meal-type quantity rows for a "food" service. Each row pairs
 * a service_cost_entries row with one of the food service's meal items and
 * SNAPSHOTS the meal's name + weight at save time. That makes meal items
 * fully editable (rename / re-weight / remove) without ever changing what a
 * historical entry recorded: mealItemId is SET NULL on delete and the
 * snapshot columns keep the row meaningful forever.
 */
export const mealCostEntriesTable = pgTable(
  "meal_cost_entries",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    serviceCostEntryId: varchar("service_cost_entry_id")
      .notNull()
      .references(() => serviceCostEntriesTable.id, { onDelete: "cascade" }),
    mealItemId: varchar("meal_item_id").references(() => foodMealItemsTable.id, {
      onDelete: "set null",
    }),
    /** Snapshot of the meal item's name at save time. */
    name: varchar("name", { length: 255 }).notNull(),
    /** Snapshot of the meal item's weight (fraction) at save time. */
    weight: numeric("weight", { precision: 6, scale: 3 }).notNull(),
    qty: integer("qty").notNull().default(0),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("IDX_meal_costs_parent").on(t.serviceCostEntryId)],
);

export type MealCostEntry = typeof mealCostEntriesTable.$inferSelect;
export type InsertMealCostEntry = typeof mealCostEntriesTable.$inferInsert;

/**
 * Per-day, per-sub-item cost & manday rows for a "group" service. Each row
 * pairs a service_cost_entries row (the parent service line for the day)
 * with one of the parent service's sub-items. A sub-item cannot be deleted
 * while any sub_service_cost_entries reference it (RESTRICT) so historical
 * entries always resolve to a real sub-item name.
 */
export const subServiceCostEntriesTable = pgTable(
  "sub_service_cost_entries",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    serviceCostEntryId: varchar("service_cost_entry_id")
      .notNull()
      .references(() => serviceCostEntriesTable.id, { onDelete: "cascade" }),
    subItemId: varchar("sub_item_id")
      .notNull()
      .references(() => serviceSubItemsTable.id, { onDelete: "restrict" }),
    cost: numeric("cost", { precision: 14, scale: 2 }).notNull().default("0"),
    mandays: numeric("mandays", { precision: 10, scale: 2 })
      .notNull()
      .default("0"),
  },
  (t) => [
    index("IDX_sub_costs_parent").on(t.serviceCostEntryId),
    uniqueIndex("UQ_sub_costs_parent_sub").on(
      t.serviceCostEntryId,
      t.subItemId,
    ),
  ],
);

export type SubServiceCostEntry =
  typeof subServiceCostEntriesTable.$inferSelect;
export type InsertSubServiceCostEntry =
  typeof subServiceCostEntriesTable.$inferInsert;

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

export const entryAttachmentsTable = pgTable(
  "entry_attachments",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    dailyEntryId: varchar("daily_entry_id")
      .notNull()
      .references(() => dailyEntriesTable.id, { onDelete: "cascade" }),
    objectPath: varchar("object_path", { length: 512 }).notNull(),
    fileName: varchar("file_name", { length: 255 }).notNull(),
    fileSize: integer("file_size").notNull().default(0),
    mimeType: varchar("mime_type", { length: 128 }).notNull().default(""),
    uploadedById: varchar("uploaded_by_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("IDX_entry_attachments_entry").on(t.dailyEntryId)],
);

export type EntryAttachment = typeof entryAttachmentsTable.$inferSelect;
export type InsertEntryAttachment = typeof entryAttachmentsTable.$inferInsert;
