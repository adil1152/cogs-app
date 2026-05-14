import { Router, type IRouter, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import {
  GetCurrentAuthUserResponse,
  RegisterWithPasswordBody as RegisterBody,
  LoginWithPasswordBody as LoginBody,
  LogoutResponse,
  UpdateCurrentUserBody as UpdateMeBody,
  ChangeMyPasswordBody as ChangePasswordBody,
} from "@workspace/api-zod";
import { db, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import {
  clearSession,
  getSessionId,
  createSession,
  setSessionCookie,
  updateSessionUser,
  type SessionData,
} from "../lib/auth";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

const BCRYPT_ROUNDS = 10;

function toAuthUser(u: typeof usersTable.$inferSelect) {
  return {
    id: u.id,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    mobile: u.mobile,
    profileImageUrl: u.profileImageUrl,
    role: (u.role as "admin" | "user") ?? "user",
  };
}

function normEmail(s: string): string {
  return s.trim().toLowerCase();
}

function normMobile(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.trim();
  return t.length > 0 ? t : null;
}

router.get("/auth/user", (req: Request, res: Response) => {
  res.json(
    GetCurrentAuthUserResponse.parse({
      user: req.isAuthenticated() ? req.user : null,
    }),
  );
});

router.post("/auth/register", async (req: Request, res: Response) => {
  const parsed = RegisterBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid registration details" });
    return;
  }
  const email = normEmail(parsed.data.email);
  const passwordHash = await bcrypt.hash(parsed.data.password, BCRYPT_ROUNDS);

  let user: typeof usersTable.$inferSelect;
  try {
    // We hold a transaction-scoped advisory lock so that the
    // "is this the first user?" check + insert is serialized across
    // concurrent registrations — otherwise two parallel POSTs could both
    // observe count=0 and both be promoted to admin. The lock key is an
    // arbitrary fixed integer; only register touches it.
    user = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(479201742)`);

      const [existing] = await tx
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.email, email));

      // We never let an unauthenticated caller "claim" an existing user row,
      // even if the row has no password_hash (legacy from the old OIDC setup).
      // That would let anyone seize a coworker's account by knowing their email.
      // Migration of legacy rows is an admin task: an admin can delete the row
      // or set a password via /users/:id, then hand the credentials over.
      if (existing) {
        const e = new Error("Email already registered") as Error & {
          httpStatus: number;
        };
        e.httpStatus = 409;
        throw e;
      }

      const [{ count }] = await tx
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(usersTable);
      const isFirstUser = count === 0;

      const [inserted] = await tx
        .insert(usersTable)
        .values({
          email,
          passwordHash,
          firstName: parsed.data.firstName ?? null,
          lastName: parsed.data.lastName ?? null,
          mobile: normMobile(parsed.data.mobile),
          role: isFirstUser ? "admin" : "user",
        })
        .returning();
      return inserted;
    });
  } catch (err) {
    const status = (err as { httpStatus?: number }).httpStatus;
    const code = (err as { code?: string }).code;
    if (status === 409 || code === "23505") {
      res.status(409).json({ error: "Email already registered" });
      return;
    }
    throw err;
  }

  const sessionData: SessionData = { user: toAuthUser(user) };
  const sid = await createSession(sessionData);
  setSessionCookie(res, sid);
  res.json({ user: sessionData.user });
});

router.post("/auth/login", async (req: Request, res: Response) => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid login details" });
    return;
  }
  const email = normEmail(parsed.data.email);
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email));

  if (!user || !user.passwordHash) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }
  const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
  if (!ok) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const sessionData: SessionData = { user: toAuthUser(user) };
  const sid = await createSession(sessionData);
  setSessionCookie(res, sid);
  res.json({ user: sessionData.user });
});

router.post("/auth/logout", async (req: Request, res: Response) => {
  const sid = getSessionId(req);
  await clearSession(res, sid);
  res.json(LogoutResponse.parse({ success: true }));
});

router.patch("/auth/me", requireAuth, async (req: Request, res: Response) => {
  const parsed = UpdateMeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid profile details" });
    return;
  }
  const update: Partial<typeof usersTable.$inferInsert> = { updatedAt: new Date() };
  if ("firstName" in parsed.data) update.firstName = parsed.data.firstName ?? null;
  if ("lastName" in parsed.data) update.lastName = parsed.data.lastName ?? null;
  if ("mobile" in parsed.data) update.mobile = normMobile(parsed.data.mobile);

  const [updated] = await db
    .update(usersTable)
    .set(update)
    .where(eq(usersTable.id, req.user!.id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const newUser = toAuthUser(updated);
  const sid = getSessionId(req);
  if (sid) await updateSessionUser(sid, newUser);
  res.json(newUser);
});

router.post(
  "/auth/me/password",
  requireAuth,
  async (req: Request, res: Response) => {
    const parsed = ChangePasswordBody.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Password must be at least 8 characters long" });
      return;
    }
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, req.user!.id));
    if (!user || !user.passwordHash) {
      res.status(401).json({ error: "Account has no password set" });
      return;
    }
    const ok = await bcrypt.compare(
      parsed.data.currentPassword,
      user.passwordHash,
    );
    if (!ok) {
      res.status(401).json({ error: "Current password is incorrect" });
      return;
    }
    const newHash = await bcrypt.hash(parsed.data.newPassword, BCRYPT_ROUNDS);
    await db
      .update(usersTable)
      .set({ passwordHash: newHash, updatedAt: new Date() })
      .where(eq(usersTable.id, user.id));
    res.json({ success: true });
  },
);

export default router;
