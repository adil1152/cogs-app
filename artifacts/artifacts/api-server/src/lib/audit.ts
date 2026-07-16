import {
  db,
  entryAuditLogTable,
  usersTable,
  type InsertEntryAuditLog,
} from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";

type Tx = Pick<typeof db, "insert"> | PgTransaction<any, any, any>;

export interface AuditEvent {
  dailyEntryId: string | null;
  projectId: string;
  action:
    | "CREATE"
    | "UPDATE"
    | "DELETE"
    | "APPROVE"
    | "REJECT"
    | "RESET"
    | "SUBMIT";
  actorId: string | null;
  level?: number | null;
  levelName?: string | null;
  field?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
}

export async function recordAudit(
  events: AuditEvent | AuditEvent[],
  tx?: Tx,
): Promise<void> {
  const list = Array.isArray(events) ? events : [events];
  if (list.length === 0) return;
  const rows: InsertEntryAuditLog[] = list.map((e) => ({
    dailyEntryId: e.dailyEntryId,
    projectId: e.projectId,
    action: e.action,
    level: e.level ?? null,
    levelName: e.levelName ?? null,
    field: e.field ?? null,
    oldValue: e.oldValue ?? null,
    newValue: e.newValue ?? null,
    actorId: e.actorId,
  }));
  const runner = tx ?? db;
  await (runner as typeof db).insert(entryAuditLogTable).values(rows);
}

function norm(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/**
 * Compare two flat snapshots and return one AuditEvent per changed scalar field.
 * Used for entry-level field changes (date, location, notes, override, totalMandays).
 */
export function diffSnapshots(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  ctx: { dailyEntryId: string; projectId: string; actorId: string | null },
): AuditEvent[] {
  const fields = new Set([...Object.keys(before), ...Object.keys(after)]);
  const out: AuditEvent[] = [];
  for (const f of fields) {
    const a = norm(before[f]);
    const b = norm(after[f]);
    if (a !== b) {
      out.push({
        dailyEntryId: ctx.dailyEntryId,
        projectId: ctx.projectId,
        action: "UPDATE",
        actorId: ctx.actorId,
        field: f,
        oldValue: a,
        newValue: b,
      });
    }
  }
  return out;
}

export async function listEntryAudit(entryId: string) {
  const rows = await db
    .select({ a: entryAuditLogTable, u: usersTable })
    .from(entryAuditLogTable)
    .leftJoin(usersTable, eq(usersTable.id, entryAuditLogTable.actorId))
    .where(eq(entryAuditLogTable.dailyEntryId, entryId))
    .orderBy(desc(entryAuditLogTable.occurredAt));
  return rows.map(({ a, u }) => ({
    id: a.id,
    dailyEntryId: a.dailyEntryId,
    projectId: a.projectId,
    action: a.action,
    level: a.level,
    levelName: a.levelName,
    field: a.field,
    oldValue: a.oldValue,
    newValue: a.newValue,
    actorId: a.actorId,
    actorName: u
      ? [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email || null
      : null,
    occurredAt: a.occurredAt.toISOString(),
  }));
}
