import { sql } from "drizzle-orm";
import { pgTable, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";

export const systemAuditLogTable = pgTable("system_audit_log", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  module: text("module").notNull(),
  actorId: text("actor_id"),
  actorName: text("actor_name").notNull(),
  requestId: text("request_id"),
  path: text("path"),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  entityName: text("entity_name"),
  projectId: text("project_id"),
  projectName: text("project_name"),
  oldValues: jsonb("old_values"),
  newValues: jsonb("new_values"),
  changedFields: jsonb("changed_fields").notNull(),
}, t => [
  index("system_audit_time").on(t.occurredAt),
  index("system_audit_project").on(t.projectId),
  index("system_audit_actor").on(t.actorId),
]);
