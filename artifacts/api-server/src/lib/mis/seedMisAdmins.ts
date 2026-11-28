import { and, eq, isNull, sql } from "drizzle-orm";
import {
  db,
  misAuditLogTable,
  misAuthoritiesTable,
  usersTable,
} from "@workspace/db";
import { logger } from "../logger";

const DEFAULT_MIS_BOOTSTRAP_ADMIN_EMAILS = [
  "adil@qnc.com",
];

function getBootstrapAdminEmails(): string[] {
  const raw = process.env["MIS_BOOTSTRAP_ADMIN_EMAILS"];
  const list = raw ? raw.split(",") : DEFAULT_MIS_BOOTSTRAP_ADMIN_EMAILS;
  return [...new Set(list.map((e) => e.trim().toLowerCase()).filter(Boolean))];
}

/**
 * Idempotently ensures the configured bootstrap emails have global `mis_admin`
 * authority in `mis_authorities`. Safe to run on every startup — missing user
 * accounts and existing `mis_admin` grants are skipped without error.
 */
export async function seedMisAdmins(): Promise<void> {
  const emails = getBootstrapAdminEmails();
  if (emails.length === 0) return;

  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(90217531)`);

      for (const email of emails) {
        const [user] = await tx
          .select({ id: usersTable.id })
          .from(usersTable)
          .where(sql`lower(${usersTable.email}) = ${email}`)
          .limit(1);

        if (!user) continue;

        const [existing] = await tx
          .select({
            id: misAuthoritiesTable.id,
            role: misAuthoritiesTable.role,
          })
          .from(misAuthoritiesTable)
          .where(
            and(
              eq(misAuthoritiesTable.userId, user.id),
              isNull(misAuthoritiesTable.projectId),
            ),
          )
          .limit(1);

        if (existing?.role === "mis_admin") continue;

        if (existing) {
          await tx
            .update(misAuthoritiesTable)
            .set({ role: "mis_admin", updatedAt: new Date() })
            .where(eq(misAuthoritiesTable.id, existing.id));

          await tx.insert(misAuditLogTable).values({
            entryId: null,
            projectId: null,
            entityType: "authority",
            entityId: existing.id,
            action: "BOOTSTRAP_ADMIN",
            actorId: user.id,
            oldValues: { role: existing.role },
            newValues: { role: "mis_admin", scope: "global" },
          });
        } else {
          const [inserted] = await tx
            .insert(misAuthoritiesTable)
            .values({
              userId: user.id,
              projectId: null,
              role: "mis_admin",
              extraPermissions: [],
            })
            .returning({ id: misAuthoritiesTable.id });

          if (inserted) {
            await tx.insert(misAuditLogTable).values({
              entryId: null,
              projectId: null,
              entityType: "authority",
              entityId: inserted.id,
              action: "BOOTSTRAP_ADMIN",
              actorId: user.id,
              newValues: { role: "mis_admin", scope: "global" },
            });
          }
        }

        logger.info({ email }, "Bootstrapped global MIS admin");
      }
    });
  } catch (err) {
    logger.error({ err }, "Failed to bootstrap MIS admins");
  }
}
