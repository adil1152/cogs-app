import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";

// (IMPORTANT) This table is mandatory for Replit Auth, don't drop it.
export const sessionsTable = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// Users table — owns auth (email + password hash) and profile info.
// `passwordHash` is nullable so existing rows from the previous OIDC setup
// keep working: those users simply need to register with the same email to
// claim the row and set their password.
export const usersTable = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  passwordHash: varchar("password_hash"),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  mobile: varchar("mobile", { length: 32 }),
  profileImageUrl: varchar("profile_image_url"),
  role: varchar("role", { length: 16 }).notNull().default("user"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type UpsertUser = typeof usersTable.$inferInsert;
export type User = typeof usersTable.$inferSelect;

// Single-row table holding the admin-configured SMTP settings used for
// outbound mail (password reset links). The password is stored as-is (it is
// needed in plaintext to authenticate against the SMTP server) and is never
// returned by the API.
export const smtpSettingsTable = pgTable("smtp_settings", {
  id: varchar("id", { length: 16 }).primaryKey().default("default"),
  host: varchar("host", { length: 255 }).notNull(),
  port: integer("port").notNull().default(587),
  secure: boolean("secure").notNull().default(false),
  username: varchar("username", { length: 255 }),
  password: varchar("password", { length: 255 }),
  fromEmail: varchar("from_email", { length: 255 }).notNull(),
  fromName: varchar("from_name", { length: 120 }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type SmtpSettingsRow = typeof smtpSettingsTable.$inferSelect;

// One-time password reset tokens. We store only the SHA-256 hash of the token;
// the raw token goes into the emailed link. Tokens are single-use and expire.
export const passwordResetTokensTable = pgTable(
  "password_reset_tokens",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("IDX_reset_tokens_user").on(table.userId)],
);

export type PasswordResetToken = typeof passwordResetTokensTable.$inferSelect;
