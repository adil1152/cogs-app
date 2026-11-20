import { sql } from "drizzle-orm";
import { pgTable, varchar, numeric, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { misProjectsTable } from "./mis";

export const misPercentageServicesTable = pgTable("mis_percentage_services", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => misProjectsTable.id, { onDelete: "cascade" }),
  kind: varchar("kind", { length: 16 }).notNull(),
  name: varchar("name", { length: 160 }).notNull(),
  percentage: numeric("percentage", { precision: 9, scale: 6 }).notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("mis_percentage_services_project_idx").on(table.projectId)]);
export const insertMisPercentageServiceSchema = createInsertSchema(misPercentageServicesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type MisPercentageServiceRow = typeof misPercentageServicesTable.$inferSelect;
