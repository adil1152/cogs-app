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

export const projectsTable = pgTable("projects", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 255 }).notNull(),
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
});

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
    canViewSummary: boolean("can_view_summary").notNull().default(true),
    canEditEntries: boolean("can_edit_entries").notNull().default(false),
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
    currentApprovalLevel: integer("current_approval_level")
      .notNull()
      .default(0),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
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
