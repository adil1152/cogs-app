import { Router, type IRouter, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  CreateUserBody,
  UpdateUserBody,
  UpdateUserRoleBody,
} from "@workspace/api-zod";
import { requireAdmin } from "../middlewares/requireAuth";
import { deleteSessionsForUser } from "../lib/auth";

const router: IRouter = Router();

const BCRYPT_ROUNDS = 10;

function toAppUser(u: typeof usersTable.$inferSelect) {
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

router.get(
  "/users",
  requireAdmin,
  async (_req: Request, res: Response): Promise<void> => {
    const rows = await db.select().from(usersTable).orderBy(usersTable.email);
    res.json(rows.map(toAppUser));
  },
);

router.post(
  "/users",
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = CreateUserBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid user details" });
      return;
    }
    const email = normEmail(parsed.data.email);
    const passwordHash = await bcrypt.hash(parsed.data.password, BCRYPT_ROUNDS);

    try {
      const [created] = await db
        .insert(usersTable)
        .values({
          email,
          passwordHash,
          firstName: parsed.data.firstName ?? null,
          lastName: parsed.data.lastName ?? null,
          mobile: normMobile(parsed.data.mobile),
          role: parsed.data.role ?? "user",
        })
        .returning();
      res.status(201).json(toAppUser(created));
    } catch (err) {
      if ((err as { code?: string }).code === "23505") {
        res.status(409).json({ error: "Email already exists" });
        return;
      }
      throw err;
    }
  },
);

router.patch(
  "/users/:id",
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = UpdateUserBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid user details" });
      return;
    }
    const update: Partial<typeof usersTable.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (parsed.data.email !== undefined)
      update.email = normEmail(parsed.data.email);
    if ("firstName" in parsed.data)
      update.firstName = parsed.data.firstName ?? null;
    if ("lastName" in parsed.data)
      update.lastName = parsed.data.lastName ?? null;
    if ("mobile" in parsed.data)
      update.mobile = normMobile(parsed.data.mobile);
    if (parsed.data.role !== undefined) update.role = parsed.data.role;
    if (parsed.data.password !== undefined) {
      update.passwordHash = await bcrypt.hash(
        parsed.data.password,
        BCRYPT_ROUNDS,
      );
    }

    try {
      const [updated] = await db
        .update(usersTable)
        .set(update)
        .where(eq(usersTable.id, req.params.id as string))
        .returning();
      if (!updated) {
        res.status(404).json({ error: "User not found" });
        return;
      }
      // If role or password changed, invalidate that user's existing sessions
      // so their old session-cached privileges (or password) cannot be reused.
      if (parsed.data.role !== undefined || parsed.data.password !== undefined) {
        await deleteSessionsForUser(updated.id);
      }
      res.json(toAppUser(updated));
    } catch (err) {
      if ((err as { code?: string }).code === "23505") {
        res.status(409).json({ error: "Email already exists" });
        return;
      }
      throw err;
    }
  },
);

router.patch(
  "/users/:id/role",
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = UpdateUserRoleBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body" });
      return;
    }

    const [updated] = await db
      .update(usersTable)
      .set({ role: parsed.data.role, updatedAt: new Date() })
      .where(eq(usersTable.id, req.params.id as string))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Invalidate the target user's existing sessions so a freshly-demoted
    // admin can't keep their elevated session-cached role until expiry.
    await deleteSessionsForUser(updated.id);

    res.json(toAppUser(updated));
  },
);

export default router;
